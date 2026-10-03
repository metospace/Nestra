import type { DisplayInfo, PanelLayout } from "@/types";

/** Keep a usable header after a display is unplugged or an old layout is invalid.
 * Valid layouts on any connected display keep their exact position. */
export function recoverSurface(layout: PanelLayout, displays: DisplayInfo[]): boolean {
  if (!displays.length) return false;
  const before = JSON.stringify(layout);
  const primary = displays.find(display => display.isPrimary) ?? displays[0]!;
  if (layout.displacedFrom) {
    const home = displays.find(display => display.id === layout.displacedFrom!.monitorId);
    if (home) { Object.assign(layout, layout.displacedFrom); delete layout.displacedFrom; }
  }
  if (layout.monitorId && !displays.some(display => display.id === layout.monitorId) && !layout.displacedFrom) {
    layout.displacedFrom = { monitorId: layout.monitorId, x: layout.x, y: layout.y, width: layout.width, height: layout.height };
    layout.x = primary.x - layout.width - 1; // Recover even if the old location overlaps another screen.
  }
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
  layout.x = finite(layout.x, primary.x + 18);
  layout.y = finite(layout.y, primary.y + 64);
  layout.width = Math.max(120, finite(layout.width, 336));
  layout.height = Math.max(80, finite(layout.height, 300));
  const reachable = displays.find(display =>
    layout.x + Math.min(120, layout.width) <= display.x + display.width
    && layout.x + layout.width - 120 >= display.x
    && layout.y >= display.y
    && layout.y + 36 <= display.y + display.height);
  if (!reachable) {
    layout.width = Math.min(layout.width, primary.width - 36);
    layout.height = Math.min(layout.height, primary.height - 82);
    layout.x = primary.x + Math.max(0, Math.min(18, primary.width - layout.width));
    layout.y = primary.y + Math.max(0, Math.min(64, primary.height - 36));
    layout.monitorId = primary.id;
  }
  return before !== JSON.stringify(layout);
}
