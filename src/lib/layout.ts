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

function fitsSurface(layout: Pick<PanelLayout, 'x' | 'y' | 'width' | 'height'>, display: DisplayInfo): boolean {
  return layout.x >= display.x && layout.y >= display.y
    && layout.x + layout.width <= display.x + display.width
    && layout.y + layout.height <= display.y + display.height;
}

/** Move only the temporary display placement. Preserve the user's coordinates
 * through disconnects, resolution changes and virtual-desktop origin changes. */
export function recoverSurface(layout: PanelLayout, displays: DisplayInfo[]): boolean {
  displays = displays.filter(d => [d.x, d.y, d.width, d.height].every(Number.isFinite) && d.width > 0 && d.height > 0);
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
  // A smaller resolution may still have the same monitor identity. Do not
  // reset a usable temporary placement to the original (then clamp it again)
  // on every refresh: the batch recovery may have moved it to avoid a neighbour.
  if (layout.displacedFrom) {
    const restored = home ? { ...saved,
      x: saved.x + (saved.monitorBounds ? home.x - saved.monitorBounds.x : 0),
      y: saved.y + (saved.monitorBounds ? home.y - saved.monitorBounds.y : 0),
    } : undefined;
    const temporaryMonitor = displays.find(d => d.id === layout.monitorId);
    if ((!home || !restored || !fitsSurface(restored, home)) && temporaryMonitor) {
      const temporary = { ...layout,
        x: layout.x + (layout.monitorBounds ? temporaryMonitor.x - layout.monitorBounds.x : 0),
        y: layout.y + (layout.monitorBounds ? temporaryMonitor.y - layout.monitorBounds.y : 0),
      };
      if (fitsSurface(temporary, temporaryMonitor)) {
        layout.x = temporary.x; layout.y = temporary.y;
        if (layout.monitorBounds) layout.monitorBounds = { x: temporaryMonitor.x, y: temporaryMonitor.y };
        return before !== JSON.stringify(layout);
      }
    }
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
      if (primary.legacyId || layout.monitorBounds) layout.monitorBounds = { x: primary.x, y: primary.y };
    }
  }
  const intended = { monitorId: layout.monitorId ?? primary.id, x: layout.x, y: layout.y,
    width: layout.width, height: layout.height,
    ...(layout.monitorBounds ? { monitorBounds: { ...layout.monitorBounds } } : {}) };
  const reachable = displays.find(display => reachableOn(layout, display));
  if (!reachable) {
    layout.width = Math.min(layout.width, Math.max(1, primary.width - 36));
    layout.height = Math.min(layout.height, Math.max(1, primary.height - 82));
    layout.x = primary.x + Math.max(0, Math.min(18, primary.width - layout.width));
    layout.y = primary.y + Math.max(0, Math.min(64, primary.height - 36));
    layout.monitorId = primary.id;
    if (primary.legacyId || layout.monitorBounds) layout.monitorBounds = { x: primary.x, y: primary.y };
  }
  const target = reachable ? displayAtPoint(layout.x + layout.width / 2, layout.y + layout.height / 2, displays) : primary;
  containSurface(layout, target);
  if (!layout.displacedFrom && (layout.x !== intended.x || layout.y !== intended.y
    || layout.width !== intended.width || layout.height !== intended.height)) {
    layout.displacedFrom = intended;
  }
  return before !== JSON.stringify(layout);
}

/** Recover all panels and widgets together. Only displaced surfaces participate
 * in packing; existing arrangements (including intentional overlap) are kept.
 * Originals stay in displacedFrom so a reconnect or restart can restore them. */
export function recoverSurfaces(layouts: PanelLayout[], displays: DisplayInfo[]): boolean {
  displays = displays.filter(d => [d.x, d.y, d.width, d.height].every(Number.isFinite) && d.width > 0 && d.height > 0);
  if (!displays.length) return false;
  const before = JSON.stringify(layouts);
  for (const layout of layouts) recoverSurface(layout, displays);
  const visible = layouts.filter(layout => layout.visible !== false);
  const occupied = visible.filter(layout => !layout.displacedFrom);
  const displaced = visible.filter(layout => layout.displacedFrom).sort((a, b) => {
    const aa = a.displacedFrom!, bb = b.displacedFrom!;
    return aa.monitorId.localeCompare(bb.monitorId) || aa.y - bb.y || aa.x - bb.x
      || aa.width - bb.width || aa.height - bb.height;
  });
  const overlap = (a: Pick<PanelLayout, 'x' | 'y' | 'width' | 'height'>, b: Pick<PanelLayout, 'x' | 'y' | 'width' | 'height'>) =>
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  for (const layout of displaced) {
    // Keep already usable recovery placements, including after serialization.
    if (!occupied.some(other => overlap(layout, other))) { occupied.push(layout); continue; }
    const screens = [...displays].sort((a, b) =>
      Number(b.id === layout.monitorId) - Number(a.id === layout.monitorId)
      || Number(b.isPrimary) - Number(a.isPrimary) || a.id.localeCompare(b.id));
    // Score against the original size on every pass. Using the shortened
    // cascade height as a new desired size would make crowded layouts drift
    // again on every refresh (and after restarting).
    const desiredWidth = layout.displacedFrom!.width;
    const desiredHeight = layout.displacedFrom!.height;
    let selected: { x: number; y: number; width: number; height: number; screen: DisplayInfo } | undefined;
    let bestScore: number[] | undefined;
    // First fit the whole surface. Only if no display has room, cascade with
    // exposed headers, temporarily shortening the new surface if needed.
    for (const cascade of [false, true]) {
      for (const [screenIndex, screen] of screens.entries()) {
        const width = Math.min(desiredWidth, screen.width);
        const height = Math.min(desiredHeight, screen.height);
        const right = screen.x + screen.width, bottom = screen.y + screen.height;
        const xs = new Set([layout.x, screen.x, screen.x + 18, right - width]);
        const ys = new Set([layout.y, screen.y, screen.y + 64, bottom - height]);
        for (const other of occupied) {
          xs.add(other.x + other.width); xs.add(other.x + other.width + 12);
          xs.add(other.x - width); xs.add(other.x - width - 12);
          ys.add(other.y + other.height); ys.add(other.y + other.height + 12);
          ys.add(other.y - height); ys.add(other.y - height - 12);
          if (cascade) ys.add(other.y + Math.min(36, other.height) + 8);
        }
        for (const x of xs) for (const y of ys) {
          if (x < screen.x || x + width > right || y < screen.y) continue;
          const candidateHeight = cascade ? Math.min(height, bottom - y) : height;
          if (candidateHeight < Math.min(46, height) || y + candidateHeight > bottom) continue;
          const candidate = { x, y, width, height: candidateHeight, screen };
          const area = occupied.reduce((total, other) => total + overlap(candidate, other), 0);
          if (!cascade && area > 0) continue;
          // A cascade is raised above intersecting surfaces, so protect their
          // headers from this new rectangle before minimizing size changes.
          const headerArea = occupied.reduce((total, other) => total
            + overlap(candidate, { ...other, height: Math.min(36, other.height) }), 0);
          const score = [cascade ? headerArea : 0,
            desiredWidth * desiredHeight - width * candidateHeight, screenIndex,
            cascade ? area : 0, (x - layout.x) ** 2 + (y - layout.y) ** 2, y, x];
          if (!bestScore || score.some((v, i) => v < bestScore![i]! && score.slice(0, i).every((v, j) => v === bestScore![j]))) {
            selected = candidate; bestScore = score;
          }
        }
      }
      if (selected) break;
    }
    if (selected) {
      const { screen, ...placement } = selected;
      Object.assign(layout, placement, { monitorId: screen.id, monitorBounds: { x: screen.x, y: screen.y } });
      const intersecting = occupied.filter(other => overlap(layout, other));
      if (intersecting.length) layout.zIndex = Math.max(layout.zIndex ?? 0, ...intersecting.map(other => (other.zIndex ?? 0) + 1));
    }
    occupied.push(layout);
  }
  return before !== JSON.stringify(layouts);
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
