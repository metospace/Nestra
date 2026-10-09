import type { DisplayInfo, PanelLayout } from "@/types";

/** Select a real monitor, including gaps in a multi-monitor desktop. */
export function displayAtPoint(x: number, y: number, displays: DisplayInfo[]): DisplayInfo {
  const inside = displays.find(d => x >= d.x && x < d.x + d.width && y >= d.y && y < d.y + d.height);
  if (inside) return inside;
  const distance = (d: DisplayInfo) => Math.max(d.x - x, 0, x - d.x - d.width) ** 2
    + Math.max(d.y - y, 0, y - d.y - d.height) ** 2;
  return displays.reduce((nearest, d) => distance(d) < distance(nearest) ? d : nearest);
}

/** Contain the entire surface, shrinking only when its screen is smaller. */
export function containSurface(layout: PanelLayout, display: Pick<DisplayInfo, 'x' | 'y' | 'width' | 'height'>): void {
  layout.width = Math.min(Math.max(1, layout.width), display.width);
  layout.height = Math.min(Math.max(1, layout.height), display.height);
  layout.x = Math.max(display.x, Math.min(layout.x, display.x + display.width - layout.width));
  layout.y = Math.max(display.y, Math.min(layout.y, display.y + display.height - layout.height));
}

/** Move only the temporary display placement. Preserve the user's coordinates
 * through disconnects, resolution changes and virtual-desktop origin changes. */
export function recoverSurface(layout: PanelLayout, displays: DisplayInfo[]): boolean {
  if (!displays.length) return false;
  const before = JSON.stringify(layout);
  const primary = displays.find(display => display.isPrimary) ?? displays[0]!;
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
  layout.x = finite(layout.x, primary.x + 18);
  layout.y = finite(layout.y, primary.y + 64);
  layout.width = Math.max(120, finite(layout.width, 336));
  layout.height = Math.max(46, finite(layout.height, 300));
  const reachableOn = (placement: Pick<PanelLayout, 'x' | 'y' | 'width'>, display: DisplayInfo) =>
    placement.x + Math.min(120, placement.width) <= display.x + display.width
    && placement.x + placement.width - 120 >= display.x
    && placement.y >= display.y && placement.y + 36 <= display.y + display.height;
  const saved = layout.displacedFrom ?? {
    monitorId: layout.monitorId ?? '', x: layout.x, y: layout.y,
    width: layout.width, height: layout.height,
    ...(layout.monitorBounds ? { monitorBounds: { ...layout.monitorBounds } } : {}),
  };
  let home = displays.find(display => display.id === saved.monitorId
    || (display.legacyId && (saved.monitorId === display.legacyId || saved.monitorId.startsWith(`${display.legacyId}:`))));
  // Old configurations have no hardware identity. Windows can renumber a lone
  // monitor from DISPLAY2 to DISPLAY1. Preserve reachable legacy coordinates.
  if (!home && /^\\\\\.\\DISPLAY\d+(?::.*)?$/i.test(saved.monitorId)) {
    const candidates = displays.filter(display => reachableOn(saved, display));
    if (candidates.length === 1) home = candidates[0];
  }
  if (home) {
    const dx = saved.monitorBounds ? home.x - saved.monitorBounds.x : 0;
    const dy = saved.monitorBounds ? home.y - saved.monitorBounds.y : 0;
    Object.assign(layout, saved, { x: saved.x + dx, y: saved.y + dy, monitorId: home.id });
    if (home.legacyId || saved.monitorBounds) layout.monitorBounds = { x: home.x, y: home.y };
    delete layout.displacedFrom;
  } else if (saved.monitorId) {
    layout.displacedFrom = { ...saved };
    // Keep an already recovered fallback in place on subsequent refreshes.
    if (layout.monitorId === saved.monitorId || !displays.some(d => d.id === layout.monitorId)) {
      layout.x = primary.x + 18; layout.y = primary.y + 64;
      layout.monitorId = primary.id;
      if (primary.legacyId) layout.monitorBounds = { x: primary.x, y: primary.y };
    }
  }
  const intended = { monitorId: layout.monitorId ?? primary.id, x: layout.x, y: layout.y,
    width: layout.width, height: layout.height,
    ...(layout.monitorBounds ? { monitorBounds: { ...layout.monitorBounds } } : {}) };
  const reachable = displays.find(display => reachableOn(layout, display));
  if (!reachable) {
    layout.width = Math.min(layout.width, primary.width - 36);
    layout.height = Math.min(layout.height, primary.height - 82);
    layout.x = primary.x + Math.max(0, Math.min(18, primary.width - layout.width));
    layout.y = primary.y + Math.max(0, Math.min(64, primary.height - 36));
    layout.monitorId = primary.id;
  }
  const target = reachable ? displayAtPoint(layout.x + layout.width / 2, layout.y + layout.height / 2, displays) : primary;
  containSurface(layout, target);
  if (!layout.displacedFrom && (layout.x !== intended.x || layout.y !== intended.y
    || layout.width !== intended.width || layout.height !== intended.height)) {
    layout.displacedFrom = intended;
  }
  return before !== JSON.stringify(layout);
}

/** Require repeated, nonempty monitor data before changing saved placements.
 * Reset the grace period after enumeration failures (common during wake-up). */
export function createDisplayRecoveryGate(graceMs = 5000, stableMs = 1500) {
  let startedAt: number | undefined;
  let changedAt = 0;
  let signature = '';
  return (displays: DisplayInfo[], now: number): boolean => {
    if (!displays.length) { startedAt = undefined; signature = ''; return false; }
    if (startedAt === undefined) startedAt = now;
    const next = JSON.stringify(displays.map(d => [d.id, d.x, d.y, d.width, d.height]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    if (next !== signature) { signature = next; changedAt = now; }
    return now - startedAt >= graceMs && now - changedAt >= stableMs;
  };
}
