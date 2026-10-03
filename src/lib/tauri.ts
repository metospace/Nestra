/** Typed wrappers around the Tauri IPC surface. */

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { ClipItem, DesktopEntry, DisplayInfo, EverythingSearchResponse } from "@/types";

export const scanApplications = (): Promise<DesktopEntry[]> => invoke("scan_applications");
export const setClipboardEnabled = (enabled: boolean): Promise<void> => invoke("set_clipboard_enabled", { enabled });
export const pickFile = (): Promise<string | null> => invoke("pick_file");
export interface ConfigurationBackup { name: string; path: string; createdAt: string }
export const backupConfiguration = (reason = "manual"): Promise<string> => invoke("backup_configuration", { reason });
export const listConfigurationBackups = (): Promise<ConfigurationBackup[]> => invoke("list_configuration_backups");
export const exportConfiguration = (folder: string): Promise<string> => invoke("export_configuration", { folder });
export const readConfiguration = (path: string): Promise<unknown> => invoke("read_configuration", { path });
export interface StorageZone { dirName: string; path: string; itemCount: number }
export const listStorageZones = (): Promise<StorageZone[]> => invoke("list_storage_zones");

export function scanDesktop(): Promise<DesktopEntry[]> {
  return invoke<DesktopEntry[]>("scan_desktop");
}

export function scanFolder(path: string): Promise<DesktopEntry[]> {
  return invoke("scan_folder", { path });
}

export function scanPaths(paths: string[]): Promise<DesktopEntry[]> {
  return invoke("scan_paths", { paths });
}

export function moveToFolder(path: string, folder: string | null): Promise<string> {
  return invoke("move_to_folder", { path, folder });
}
export interface FileMove {id:number;name:string;fromPath:string;toPath:string;createdAt:number;undone:boolean}
export const listFileMoves = (): Promise<FileMove[]> => invoke('list_file_moves');
export const recentLaunches = (): Promise<string[]> => invoke('recent_launches');
export const undoFileMove = (id:number): Promise<{fromPath:string;newPath:string}> => invoke('undo_file_move',{id});

export function setMappingWatchPaths(paths: string[]): Promise<void> {
  return invoke("set_mapping_watch_paths", { paths });
}

export function searchMappedFolders(paths: string[], query: string, limit = 80): Promise<DesktopEntry[]> {
  return invoke("search_mapped_folders", { paths, query, limit });
}

export function searchEverything(query: string, limit = 80): Promise<EverythingSearchResponse> {
  return invoke("search_everything", { query, limit });
}

export function pickFolder(): Promise<string | null> {
  return invoke("pick_folder");
}

export function listDisplays(): Promise<DisplayInfo[]> {
  return invoke("list_displays");
}

/** 批量异步补齐图标：pairs 为 [主路径, 备选路径]；返回 主路径 → PNG 路径。 */
export function resolveIconPairs(
  pairs: [string, string][],
): Promise<Record<string, string | null>> {
  return invoke("resolve_icon_pairs", { pairs });
}

export function openEntry(target: string, launchKind: string): Promise<void> {
  return invoke("open_entry", { target, launchKind });
}

/** Let the Windows shell launch the original shortcut, including its arguments,
 * working directory, elevation and advertised application metadata. */
export function launchEntry(entry: DesktopEntry): Promise<void> {
  return openEntry(entry.kind === "shell" ? entry.target : entry.path, entry.launchKind);
}

export function showManager(module?: string, objectId?: string): Promise<void> {
  return invoke("show_manager", { module, objectId });
}

export function revealEntry(path: string): Promise<void> {
  return invoke("reveal_entry", { path });
}

export async function loadPersistedState<T>(): Promise<T | null> {
  const value = await invoke<unknown>("load_state");
  return (value ?? null) as T | null;
}

export function savePersistedState(state: unknown, origin: string, expected: unknown): Promise<void> {
  return invoke("save_state", { state, origin, expected });
}

export function renameEntry(path: string, name: string): Promise<string> {
  return invoke("rename_entry", { path, name });
}

export function recycleEntry(path: string): Promise<void> {
  return invoke("recycle_entry", { path });
}

/** 真收纳：把文件/文件夹真实移入 Desktop\.nestra\<zoneDir>，返回新路径。 */
export function moveToZone(path: string, zoneDir: string): Promise<string> {
  return invoke("move_to_zone", { path, zoneDir });
}

/** 批量收进收纳区（外部拖放）。返回移动成功的新路径列表。 */
export function movePathsToZone(paths: string[], zoneDir: string): Promise<string[]> {
  return invoke("move_paths_to_zone", { paths, zoneDir });
}

/** 把收纳区项目放回桌面顶层。 */
export function moveToDesktopNative(path: string): Promise<string> {
  return invoke("move_to_desktop", { path });
}

/** 解散收纳区：目录内容全部放回桌面。返回放回的项目数。 */
export function dissolveZone(zoneDir: string): Promise<number> {
  return invoke("dissolve_zone", { zoneDir });
}

/** 收纳区改名时同步目录名。 */
export function renameZoneDir(oldDir: string, newDir: string): Promise<void> {
  return invoke("rename_zone_dir", { oldDir, newDir });
}

export function setPaused(paused: boolean): Promise<boolean> {
  return invoke("set_paused", { paused });
}

export function getPaused(): Promise<boolean> {
  return invoke("get_paused");
}

export function setHideNativeIcons(hide: boolean): Promise<boolean> {
  return invoke("set_hide_native_icons", { hide });
}

export function startWithWindows(): Promise<boolean> {
  return invoke("start_with_windows");
}

export function setStartWithWindows(enabled: boolean): Promise<boolean> {
  return invoke("set_start_with_windows", { enabled });
}

export function requestOpenSearch(): Promise<void> {
  return invoke("open_search");
}

/** 桌面层永不激活（WS_EX_NOACTIVATE），需要打字时向前台线程"借"键盘焦点。 */
export function grantDesktopInput(): Promise<void> {
  return invoke("grant_desktop_input");
}

/** 输入完成后归还焦点给之前的前台窗口。 */
export function releaseDesktopInput(): Promise<void> {
  return invoke("release_desktop_input");
}

export function showShellMenu(options: {
  path: string;
  x: number;
  y: number;
  toDesktop: boolean;
  inLauncher: boolean;
  canFold: boolean;
  canRename: boolean;
}): Promise<string> {
  return invoke("show_shell_menu", {
    path: options.path,
    x: options.x,
    y: options.y,
    toDesktop: options.toDesktop,
    inLauncher: options.inLauncher,
    canFold: options.canFold,
    canRename: options.canRename,
  });
}

export const STATE_CHANGED_EVENT = "nestra://state-changed";
export const DESKTOP_CHANGED_EVENT = "nestra://desktop-changed";
export const SESSION_EVENT = "nestra://session";

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

/* 剪贴板历史 --------------------------------------------------------------- */

export const CLIPBOARD_CHANGED_EVENT = "nestra://clipboard-changed";

export function clipLoad(): Promise<ClipItem[]> {
  return invoke("clip_load");
}

/** 复制历史项回系统剪贴板，返回被复制的文本。 */
export function clipCopy(id: string): Promise<string> {
  return invoke("clip_copy", { id });
}

export function clipRemove(id: string): Promise<void> {
  return invoke("clip_remove", { id });
}

export function clipClear(): Promise<void> {
  return invoke("clip_clear");
}

export function createZone(name: string): Promise<string> {
  return invoke("create_zone", { name });
}
