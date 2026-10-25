/** Shared drag/resize mechanics for panels and widgets.
 * Pointer-capture based so the gesture survives fast moves. */

import type { PanelLayout } from "@/types";
import { containSurface, displayAtPoint } from "@/lib/layout";
import { flushState, store } from "@/stores/state";

export type ResizeDirection =
  | "n" | "s" | "e" | "w"
  | "ne" | "nw" | "se" | "sw";

interface SurfaceConstraints {
  minWidth?: number;
  minHeight?: number;
  /** React/Zustand callers commit geometry instead of mutating a render snapshot. */
  commit?: (layout: Partial<PanelLayout>) => void;
}

const DEFAULT_MIN_W = 260;
const DEFAULT_MIN_H = 170;

function screens() {
  return store.displays.length ? store.displays : [{ id: 'viewport', name: '当前屏幕', x: 0, y: 0,
    width: window.innerWidth, height: window.innerHeight, isPrimary: true }];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Moves the whole surface inside a connected display. */
export function startMove(
  event: PointerEvent,
  original: PanelLayout,
  constraints: SurfaceConstraints = {},
): void {
  const layout = constraints.commit ? { ...original } : original;
  if (event.button !== 0 || layout.locked) return;
  const originX = event.clientX;
  const originY = event.clientY;
  const startX = layout.x;
  const startY = layout.y;
  const width = layout.width ?? (constraints.minWidth ?? DEFAULT_MIN_W);
  const height = layout.height ?? (constraints.minHeight ?? DEFAULT_MIN_H);

  const onMove = (move: PointerEvent) => {
    if (move.pointerId !== event.pointerId) return;
    const dx = move.clientX - originX;
    const dy = move.clientY - originY;
    const display = displayAtPoint(move.clientX, move.clientY, screens());
    Object.assign(layout, { x: startX + dx, y: startY + dy, width, height });
    containSurface(layout, display);
    if (display.id !== 'viewport') {
      layout.monitorId = display.id;
      layout.monitorBounds = { x: display.x, y: display.y };
    }
    delete layout.displacedFrom;
    constraints.commit?.(placementPatch(layout));
  };

  attachGesture(event, onMove);
}

/** Resizes from one of the eight edges. */
export function startResize(
  event: PointerEvent,
  direction: ResizeDirection,
  original: PanelLayout,
  constraints: SurfaceConstraints = {},
): void {
  const layout = constraints.commit ? { ...original } : original;
  if (event.button !== 0 || layout.locked) return;
  const originX = event.clientX;
  const originY = event.clientY;
  const display = displayAtPoint(layout.x + layout.width / 2, layout.y + layout.height / 2, screens());
  containSurface(layout, display);
  const start = { ...layout };
  const minWidth = constraints.minWidth ?? DEFAULT_MIN_W;
  const minHeight = constraints.minHeight ?? DEFAULT_MIN_H;

  const apply = () => {
    const dx = latestDx();
    const dy = latestDy();

    if (direction.includes("e")) {
      layout.width = clamp(start.width + dx, Math.min(minWidth, display.x + display.width - start.x), display.x + display.width - start.x);
    }
    if (direction.includes("s")) {
      layout.height = clamp(start.height + dy, Math.min(minHeight, display.y + display.height - start.y), display.y + display.height - start.y);
    }
    if (direction.includes("w")) {
      const width = clamp(start.width - dx, Math.min(minWidth, start.x + start.width - display.x), start.x + start.width - display.x);
      layout.width = width;
      layout.x = start.x + start.width - width;
    }
    if (direction.includes("n")) {
      const height = clamp(start.height - dy, Math.min(minHeight, start.y + start.height - display.y), start.y + start.height - display.y);
      layout.height = height;
      layout.y = start.y + start.height - height;
    }
  };

  let currentDx = 0;
  let currentDy = 0;
  const latestDx = () => currentDx;
  const latestDy = () => currentDy;

  const onMove = (move: PointerEvent) => {
    if (move.pointerId !== event.pointerId) return;
    currentDx = move.clientX - originX;
    currentDy = move.clientY - originY;
    apply();
    if (display.id !== 'viewport') {
      layout.monitorId = display.id;
      layout.monitorBounds = { x: display.x, y: display.y };
    }
    delete layout.displacedFrom;
    constraints.commit?.(placementPatch(layout));
  };

  attachGesture(event, onMove);
}

/** Do not overwrite z-order, appearance or visibility from a stale React snapshot. */
function placementPatch(layout: PanelLayout): Partial<PanelLayout> {
  return { x: layout.x, y: layout.y, width: layout.width, height: layout.height,
    monitorId: layout.monitorId, monitorBounds: layout.monitorBounds, displacedFrom: layout.displacedFrom };
}

function attachGesture(
  event: PointerEvent,
  onMove: (move: PointerEvent) => void,
): void {
  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const pointerId = event.pointerId;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("blur", end);
    target?.removeEventListener("lostpointercapture", end);
    if (target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    document.body.classList.remove("is-gesturing");
    // Flush the final placement now; don't leave it in the 600ms debounce gap.
    void flushState().catch(() => {});
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  window.addEventListener("blur", end);
  target?.addEventListener("lostpointercapture", end);
  target?.setPointerCapture(pointerId);
  document.body.classList.add("is-gesturing");
  event.preventDefault();
}
