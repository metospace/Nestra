export interface PointerPoint { x: number; y: number }
export interface HoverRegion { x: number; y: number; width: number; height: number }

/** Physical Windows desktop coordinates become the same CSS coordinates as hit regions. */
export function localPointer(point: PointerPoint, origin: PointerPoint, scale: number): PointerPoint {
  const ratio = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return { x: (point.x - origin.x) / ratio, y: (point.y - origin.y) / ratio };
}
export function pointerInside(point: PointerPoint, region: HoverRegion): boolean {
  return point.x >= region.x && point.y >= region.y && point.x < region.x + region.width && point.y < region.y + region.height;
}

/** Ephemeral hover state. Never changes persisted layout visibility or geometry. */
export class PanelAutoHide {
  visible = false;
  private entered: number | null = null;
  private left: number | null = null;
  private revealedUntil = 0;
  reveal(now: number) { this.visible = true; this.revealedUntil = now + 2500; this.left = null; }
  step(now: number, inside: boolean, pinOpen: boolean, holdOpen: boolean, hideDelay: number): boolean {
    if (pinOpen) { this.visible = true; this.entered = null; this.left = null; return true; }
    if (inside) {
      this.left = null;
      this.entered ??= now;
      if (now - this.entered >= 120) this.visible = true;
    } else {
      this.entered = null;
      if (holdOpen || now < this.revealedUntil) this.left = null;
      else if (this.visible) {
        this.left ??= now;
        if (now - this.left >= hideDelay) this.visible = false;
      }
    }
    return this.visible;
  }
}
