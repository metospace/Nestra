import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { localPointer, type PointerPoint } from '@/domain/panelAutoHide';

interface NativeSample { generation: number; cursor: PointerPoint | null; origin: PointerPoint | null }
const subscribers = new Set<(point: PointerPoint | null) => void>();
let epoch = 0, nativeGeneration = 0, ownedGeneration = 0, unlisten: (() => void) | undefined;
let controlChain: Promise<unknown> = Promise.resolve();
function publish(point: PointerPoint | null) { for (const listener of subscribers) listener(point); }
function moved(event: PointerEvent) { publish({ x: event.clientX, y: event.clientY }); }
function tracking(enabled: boolean, generation = epoch): Promise<number> {
  const task = controlChain.catch(() => {}).then(async () => {
    if (enabled && generation !== epoch) return 0;
    const accepted = await invoke<number>('set_desktop_hover_tracking', { enabled, generation: ownedGeneration });
    if (enabled) ownedGeneration = accepted;
    return accepted;
  });
  controlChain = task;
  return task;
}
async function start(generation: number) {
  try {
    const stop = await listen<NativeSample>('nestra://desktop-pointer', event => {
      if (generation !== epoch || event.payload.generation !== nativeGeneration) return;
      const { cursor, origin } = event.payload;
      publish(cursor && origin ? localPointer(cursor, origin, window.devicePixelRatio) : null);
    });
    if (generation !== epoch) { stop(); return; }
    unlisten = stop;
    const accepted = await tracking(true, generation);
    if (generation === epoch) nativeGeneration = accepted;
  } catch {
    if (generation === epoch) publish(null);
  }
}

const reveals = new Map<string, number>();
const revealListeners = new Map<string, Set<() => void>>();
/** Retain a short reveal request while remote state mounts a previously hidden surface. */
export function revealAutoHidePanel(key: string) {
  const now = performance.now();
  for (const [saved, time] of reveals) if (now - time > 2500) reveals.delete(saved);
  reveals.set(key, now);
  for (const listener of revealListeners.get(key) ?? []) listener();
}
export function subscribePanelReveal(key: string, listener: () => void): () => void {
  const listeners = revealListeners.get(key) ?? new Set<() => void>();
  revealListeners.set(key, listeners); listeners.add(listener);
  if (performance.now() - (reveals.get(key) ?? -Infinity) < 2500) listener();
  return () => { listeners.delete(listener); if (!listeners.size) revealListeners.delete(key); };
}
/** One native event source per desktop, with no input overlay in hidden regions. */
export function subscribeDesktopPointer(listener: (point: PointerPoint | null) => void): () => void {
  subscribers.add(listener);
  if (subscribers.size === 1) {
    nativeGeneration = 0;
    window.addEventListener('pointermove', moved, true);
    void start(++epoch);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true; subscribers.delete(listener);
    if (!subscribers.size) {
      epoch++; nativeGeneration = 0; unlisten?.(); unlisten = undefined;
      window.removeEventListener('pointermove', moved, true);
      void tracking(false).catch(() => {});
    }
  };
}
