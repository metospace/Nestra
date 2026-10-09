export interface HitRect { x: number; y: number; width: number; height: number }

/** The native region is a union: descendants of a popup scrim add no area. */
export function normalizeHitRects(rects: HitRect[], width: number, height: number): HitRect[] {
  const clipped = rects.filter(r => [r.x, r.y, r.width, r.height].every(Number.isFinite)).map(r => {
    const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
    return { x, y, width: Math.min(width, Math.round(r.x + r.width)) - x,
      height: Math.min(height, Math.round(r.y + r.height)) - y };
  }).filter(r => r.width > 0 && r.height > 0)
    .sort((a, b) => a.x - b.x || a.y - b.y || b.width - a.width || b.height - a.height);
  return clipped.filter((r, i) => !clipped.some((other, j) => j !== i &&
    other.x <= r.x && other.y <= r.y && other.x + other.width >= r.x + r.width &&
    other.y + other.height >= r.y + r.height &&
    (other.x !== r.x || other.y !== r.y || other.width !== r.width || other.height !== r.height || j < i)));
}

/** One IPC at a time, latest geometry wins. Failed sends remain retryable. */
export function createHitRegionSync(send: (rects: HitRect[]) => Promise<unknown>) {
  let pending: HitRect[] | undefined, running: Promise<void> | undefined;
  let acknowledged: string | undefined;
  async function drain() {
    while (pending) {
      const rects = pending;
      pending = undefined;
      const key = JSON.stringify(rects);
      if (key === acknowledged) continue;
      try { await send(rects); acknowledged = key; }
      catch { /* Keep the previous acknowledgement so the next sync can retry. */ }
    }
  }
  function publish(rects: HitRect[]): Promise<void> {
    pending = rects;
    if (!running) running = drain().then(() => {
      running = undefined;
      if (pending) return publish(pending);
    });
    return running;
  }
  return publish;
}
