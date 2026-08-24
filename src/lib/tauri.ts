/** Typed wrappers around the Tauri IPC surface. */

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { DesktopEntry } from "@/types";

export function scanDesktop(): Promise<DesktopEntry[]> {
  return invoke<DesktopEntry[]>("scan_desktop");
}

export function openEntry(target: string, launchKind: string): Promise<void> {
  return invoke("open_entry", { target, launchKind });
}

export function revealEntry(path: string): Promise<void> {
  return invoke("reveal_entry", { path });
}

export async function loadPersistedState<T>(): Promise<T | null> {
  const value = await invoke<unknown>("load_state");
  return (value ?? null) as T | null;
}

export function savePersistedState(state: unknown): Promise<void> {
  return invoke("save_state", { state });
}

/** Pushes interactive rects (physical px) for the Win32 hit-test pass-through. */
export function setHitRects(
  rects: { x: number; y: number; width: number; height: number }[],
): Promise<void> {
  return invoke("set_hit_rects", { rects });
}

/** Turns a cached icon path into a URL the webview can load. */
export function iconSrc(iconPath: string | null): string | null {
  if (!iconPath) {
    return null;
  }

  try {
    return convertFileSrc(iconPath);
  } catch {
    return null;
  }
}
