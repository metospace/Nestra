/** Shared drag/resize mechanics for panels and widgets.
 * Pointer-capture based so the gesture survives fast moves. */

import type { PanelLayout } from "@/types";

export type ResizeDirection =
  | "n" | "s" | "e" | "w"
  | "ne" | "nw" | "se" | "sw";

interface SurfaceConstraints {
  minWidth?: number;
  minHeight?: number;
}

const DEFAULT_MIN_W = 260;
const DEFAULT_MIN_H = 170;

function viewport(): { width: number; height: number } {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Moves the surface by header drags; clamped to stay reachable. */
export function startMove(
  event: PointerEvent,
  layout: PanelLayout,
  constraints: SurfaceConstraints = {},
): void {
  if (event.button !== 0) return;
  const originX = event.clientX;
  const originY = event.clientY;
  const startX = layout.x;
  const startY = layout.y;
  let latestX = startX;
  let latestY = startY;

  const onMove = (move: PointerEvent) => {
    const dx = move.clientX - originX;
    const dy = move.clientY - originY;
    const { width, height } = viewport();
    const w = layout.width ?? (constraints.minWidth ?? DEFAULT_MIN_W);

    latestX = clamp(startX + dx, -w + 120, width - 120);
    latestY = clamp(startY + dy, 0, height - 48);
    layout.x = latestX;
    layout.y = latestY;
  };

  attachGesture(event, onMove);
}

/** Resizes from one of the eight edges. */
export function startResize(
  event: PointerEvent,
  direction: ResizeDirection,
  layout: PanelLayout,
  constraints: SurfaceConstraints = {},
): void {
  if (event.button !== 0) return;
  const originX = event.clientX;
  const originY = event.clientY;
  const start = { ...layout };
  const minWidth = constraints.minWidth ?? DEFAULT_MIN_W;
  const minHeight = constraints.minHeight ?? DEFAULT_MIN_H;
  const { width: viewW, height: viewH } = viewport();

  const apply = () => {
    const dx = latestDx();
    const dy = latestDy();

    if (direction.includes("e")) {
      layout.width = clamp(start.width + dx, minWidth, viewW - start.x);
    }
    if (direction.includes("s")) {
      layout.height = clamp(start.height + dy, minHeight, viewH - start.y);
    }
    if (direction.includes("w")) {
      const width = clamp(start.width - dx, minWidth, start.x + start.width);
      layout.width = width;
      layout.x = start.x + start.width - width;
    }
    if (direction.includes("n")) {
      const height = clamp(start.height - dy, minHeight, start.y + start.height);
      layout.height = height;
      layout.y = start.y + start.height - height;
    }
  };

  let currentDx = 0;
  let currentDy = 0;
  const latestDx = () => currentDx;
  const latestDy = () => currentDy;

  const onMove = (move: PointerEvent) => {
    currentDx = move.clientX - originX;
    currentDy = move.clientY - originY;
    apply();
  };

  attachGesture(event, onMove);
}

function attachGesture(
  event: PointerEvent,
  onMove: (move: PointerEvent) => void,
): void {
  const end = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", end);
    document.body.classList.remove("is-gesturing");
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", end);
  document.body.classList.add("is-gesturing");
  event.preventDefault();
}
