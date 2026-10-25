/** Application service with a single Zustand view store.
 *
 * 真收纳模型：收纳区 = Desktop\.nestra\<dirName> 的真实目录，成员资格由
 * 路径决定（entry.zone），不做 id 引用归类。拖进收纳区 = 文件真实移动，
 * 桌面图标自然消失；放回桌面 = 移回顶层。快捷启动是纯引用例外。 */

import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { createRefreshQueue } from "@/lib/refreshQueue";
import { discardTodoDraft } from "@/composables/useTodoDraft";
import { fileMoves, trackFileMoves, type MoveTask } from '@/composables/fileMoveReports';
import { createHitRegionSync, normalizeHitRects } from "@/lib/hitRegions";
import { inFolder, matchesFilter } from "@/lib/organizer";
import { containSurface, createDisplayRecoveryGate, recoverSurface, recoverSurfaces } from "@/lib/layout";
import { rankSearch, runSearch } from "@/lib/search";
import { sourceFor, referenceFromId } from "@/domain/sources";
import { FROST_APPEARANCE, migrateConfiguration, prepareRestore, reconcileStorageZones } from "@/domain/configuration";
import type { SearchScope, SearchResult } from "@/lib/search";
import {
  listDisplays,
  moveToFolder,
  scanFolder,
  scanPaths,
  searchMappedFolders,
  searchEverything,
  setMappingWatchPaths,
  undoFileMove,
  acknowledgeExit,
  backupConfiguration,
  setClipboardEnabled,
  scanApplications,
  listStorageZones,
} from "@/lib/tauri";
import {
  DESKTOP_CHANGED_EVENT,
  SESSION_EVENT,
  STATE_CHANGED_EVENT,
  createZone,
  dissolveZone,
  getPaused,
  loadPersistedState,
  moveToDesktopNative,
  moveToZone,
  launchEntry,
  recycleEntry,
  renameEntry,
  renameZoneDir,
  resolveIconPairs,
  savePersistedState,
  scanDesktop,
  setHideNativeIcons as setHideNativeIconsNative,
  setHitRects,
  setPaused as setPausedNative,
  setStartWithWindows as setStartWithWindowsNative,
  startWithWindows as readStartWithWindows,
} from "@/lib/tauri";
import { convertFileSrc } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type {
  AppearanceSettings,
  CustomGroupDefinition,
  DesktopEntry,
  DisplayInfo,
  Panel,
  PanelLayout,
  PersistedState,
  TabGroupDefinition,
  Widget,
  LaunchCollection,
} from "@/types";

const DEFAULT_APPEARANCE: AppearanceSettings = {
  ...FROST_APPEARANCE,
};

const PANEL_WIDTH = 336;
const PANEL_HEIGHT = 432;
const PANEL_GAP = 14;
const SCREEN_MARGIN = 18;

/** 快捷启动面板的布局键。 */
export const LAUNCHER_PANEL_KEY = "system:launcher";
export const DESKTOP_SEARCH_KEY = "system:search";

function zonePanelKey(groupId: string): string {
  return `zone:${groupId}`;
}

let saveTimer: number | undefined;
let zCounter = 10;

/** 面板与小组件共用的置顶计数器；重启后从持久化值继续，避免层级错乱。 */
export function nextZ(): number {
  return ++zCounter;
}

// The service is the only writer. Keeping its working objects stable preserves
// native operations which retain a layout or file identity across await points.
// Components read useNestra() and write through actions/mutateStore only.
export const store = {
  launcherReferences: {} as Record<string, DesktopEntry>,
  launchCollections: [] as LaunchCollection[],
  clipboardEnabled: true,
  persistenceBlocked: false,
  applications: [] as DesktopEntry[],
  recentLaunchPaths: [] as string[],
  ready: false,
  entries: [] as DesktopEntry[],
  panels: [] as Panel[],
  panelLayouts: {} as Record<string, PanelLayout>,
  customGroups: [] as CustomGroupDefinition[],
  tabGroups: [] as TabGroupDefinition[],
  displays: [] as DisplayInfo[],
  foldedItems: {} as Record<string, string[]>,
  itemOrders: {} as Record<string, string[]>,
  widgets: [] as Widget[],
  appearance: { ...DEFAULT_APPEARANCE },
  launcherIds: [] as string[],
  /** 桌面层自定义确认框（原生 confirm 在非激活窗口/命中区外不可用）。 */
  confirmRequest: null as {
    message: string;
    resolve: (ok: boolean) => void;
  } | null,
  statusMessage: "",
  statusAction: null as "show-launcher" | null,
  selectedItemId: "",
  selectedItemIds: [] as string[],
  selectionPanel: "",
  selectionAnchor: "",
  paused: false,
  searchOpen: false,
  searchQuery: "",
  surfaceSettingsKey: "",
  hideNativeIcons: false,
  startWithWindows: false,
};

export type NestraState = typeof store;
export const iconUrls = new Map<string, string>();
export const mappingErrors: Record<string, string> = {};
export const operationResults: { name: string; path: string; ok: boolean; message: string }[] = [];
let revision = 0;
// Scanner rows are replaced, never edited in place. Reuse their detached view
// arrays while dragging/resizing so each pointer frame clones only UI data.
const scanSnapshots = new WeakMap<DesktopEntry[], DesktopEntry[]>();
function snapshotEntries(entries: DesktopEntry[]): DesktopEntry[] {
  let snapshot = scanSnapshots.get(entries);
  if (!snapshot) { snapshot = structuredClone(entries); scanSnapshots.set(entries, snapshot); }
  return snapshot;
}

function viewSnapshot() {
  // structuredClone deliberately excludes the confirmation callback. Everything
  // rendered is a detached snapshot, so async mutations cannot tear an old render.
  const { entries, applications, confirmRequest: _confirmation, ...mutable } = store;
  return {
    ...structuredClone(mutable),
    entries: snapshotEntries(entries), applications: snapshotEntries(applications),
    confirmRequest: store.confirmRequest ? { ...store.confirmRequest } : null,
    iconUrls: new Map(iconUrls), mappingErrors: { ...mappingErrors },
    operationResults: operationResults.map(result => ({ ...result })), revision,
  };
}

const nestraStore = createStore(viewSnapshot);
export function useNestra() { return useStore(nestraStore); }

/** Publish does not save: applying a remote snapshot must never echo a write. */
function publishState(): void {
  revision += 1;
  nestraStore.setState(viewSnapshot(), true);
}

/** Synchronous UI edit against the current service state, never a retained draft.
 * Native/async operations use the named service actions instead. */
export function mutateStore(edit: (state: NestraState) => void): void {
  if (isExitFrozen()) return;
  edit(store);
  applyAppearanceToCss();
  scheduleSave();
  scheduleHitRectSync();
}

export function getSelectedEntries() { return store.entries.filter(e => store.selectedItemIds.includes(e.id)); }
export function selectPanelItems(panelKey: string, ids: string[]): void {
  store.selectionPanel = panelKey;
  store.selectedItemIds = [...new Set(ids)];
  store.selectedItemId = ids.at(-1) ?? '';
  publishState();
}
export function selectItem(id: string, panelKey: string, order: string[], ctrl: boolean, shift: boolean): void {
  const previous = store.selectionPanel === panelKey ? store.selectedItemIds : [];
  const start = order.indexOf(store.selectionAnchor), end = order.indexOf(id);
  const ids = shift && store.selectionPanel === panelKey && start >= 0 && end >= 0
    ? [...new Set([...(ctrl ? previous : []), ...order.slice(Math.min(start,end),Math.max(start,end)+1)])]
    : ctrl ? previous.includes(id) ? previous.filter(v=>v!==id) : [...previous,id] : [id];
  selectPanelItems(panelKey,ids);
  if (!shift) store.selectionAnchor=id;
  publishState();
}
export async function batchMoveItems(ids: string[], target: string): Promise<void> {
  return runStateMutation(async () => {
    if (fileMoves.busy) { showStatus('正在整理文件，请等待本次操作完成'); return; }
    const group = store.customGroups.find(group => group.id === target);
    const destination = group ? JSON.stringify([group.dirName, group.mappedPath, sourceFor(group).writable]) : '';
    const selectionIds = [...new Set(ids)];
    const tasks = selectionIds.map(id => {
      const entry = store.entries.find(item => item.id === id);
      const path = entry?.path ?? id;
      return { name: entry?.name ?? id, path, run: async () => {
        const current = store.customGroups.find(group => group.id === target);
        if (target !== 'launcher' && (!current || JSON.stringify([current.dirName, current.mappedPath, sourceFor(current).writable]) !== destination)) throw new Error('目标目录已改变，请重新选择目标并发起移动');
        if (store.entries.find(item => item.id === id)?.path !== path) throw new Error('源文件已改变或不在当前列表中，请刷新后重新选择');
        return moveItemOrThrow(id, target);
      } };
  });
  const report = await trackFileMoves(target === 'launcher' ? '快捷启动（引用）' : group?.name ?? '已失效的目标', tasks, async () => { await rescan(); scheduleSave(); });
  if (report) {
    selectPanelItems(store.selectionPanel, selectionIds.filter((_, index) => report.items[index]?.state === 'failed'));
    showStatus(`整理完成：${report.items.filter(item=>item.state==='success').length} 项成功，${report.items.filter(item=>item.state==='failed').length} 项失败`);
  }
  });
}

export async function batchReturnItems(ids: string[]): Promise<void> {
  return runStateMutation(async () => {
    if (fileMoves.busy) { showStatus('正在整理文件，请等待本次操作完成'); return; }
    const tasks = [...new Set(ids)].map(id => {
      const entry = store.entries.find(item => item.id === id);
      const path = entry?.path ?? id;
      return { name: entry?.name ?? id, path, run: async () => {
        if (store.entries.find(item => item.id === id)?.path !== path) throw new Error('源文件已改变，请刷新后重新选择');
        return returnItemOrThrow(id);
      } };
  });
  await trackFileMoves('个人桌面', tasks, async () => { await rescan(); scheduleSave(); });
  });
}

/** 图标内存缓存：entry.path → asset URL。快照先无图标渲染，这里异步补齐
 * （两段式加载，见 AGENTS.md）。失败路径记录为 null，避免反复重试。 */
let iconFillTimer: number | undefined;
let iconFillBusy = false;

function scheduleIconFill(): void {
  window.clearTimeout(iconFillTimer);
  iconFillTimer = window.setTimeout(() => void fillMissingIcons(), 120);
}

async function fillMissingIcons(): Promise<void> {
  if (iconFillBusy) {
    // 上一批还在解析：完成后继续调度缺失图标。
    scheduleIconFill();
    return;
  }

  const missing = store.entries.filter(
    (entry) => !iconUrls.has(entry.path) && !iconUrls.has(`null:${entry.path}`),
  ).slice(0, 32);
  if (missing.length === 0) return;

  iconFillBusy = true;
  try {
    // 标记为进行中，防止并发批次重复请求同一集合。
    for (const entry of missing) iconUrls.set(entry.path, "");

    const pairs: [string, string][] = missing.map((entry) => [entry.path, entry.target]);
    const resolved = await resolveIconPairs(pairs);

    for (const entry of missing) {
      const path = entry.path;
      const png = resolved[path];
      const url = png ? convertFileSrc(png) : null;
      if (url) {
        iconUrls.set(path, url);
      } else {
        // 解析失败：移出待解析集合并永久标记，字形徽章兜底。
        iconUrls.delete(path);
        iconUrls.set(`null:${path}`, "x");
      }
    }
  } catch {
    // Failures are ordinary (including virtual shell entries). Retain a
    // negative cache for this session instead of retrying IPC every 120 ms.
    for (const entry of missing) {
      iconUrls.delete(entry.path);
      iconUrls.set(`null:${entry.path}`, "x");
    }
  } finally {
    iconFillBusy = false;
    publishState();
    if (store.entries.some(entry => !iconUrls.has(entry.path) && !iconUrls.has(`null:${entry.path}`))) {
      scheduleIconFill();
    }
  }
}

/** 组件取图标用：命中缓存返回 URL，否则 null（渲染字形徽章）。 */
export function cachedIconUrl(entryPath: string): string | null {
  const url = iconUrls.get(entryPath);
  return url || null;
}

// There is no deep watcher or secondary persistence plugin. Local actions call
// scheduleSave; remote application only publishes a detached Zustand snapshot.

/* ------------------------------------------------------------------ */
/* 收纳区目录名                                                         */
/* ------------------------------------------------------------------ */

/** 组名 → 合法目录名：去掉 Windows 非法字符，空名兜底。 */
function sanitizeZoneDir(name: string): string {
  const clean = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .trim()
    .replace(/\.+$/, "");
  return clean || "收纳区";
}

/** 在已有收纳区中挑一个不冲突的目录名。 */
function uniqueZoneDir(base: string, excludeId?: string): string {
  const taken = new Set(
    store.customGroups
      .filter((group) => group.id !== excludeId)
      .map((group) => group.dirName.toLowerCase()),
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function groupForPanel(panel: Panel): CustomGroupDefinition | undefined {
  return store.customGroups.find((group) => group.id === panel.groupId);
}

/* ------------------------------------------------------------------ */
/* Derived                                                             */
/* ------------------------------------------------------------------ */

/** 分区内容 = 路径位于该收纳区目录下的条目（文件系统即真相）。 */
export function getItemsByPanel(): Record<string, DesktopEntry[]> {
  const result: Record<string, DesktopEntry[]> = {};

  for (const panel of store.panels) {
    if (panel.groupId === "launcher") {
      result[panel.key] = [];
      continue;
    }
    const group = groupForPanel(panel);
    const pool = group
      ? store.entries.filter(
          (entry) => !entry.isHidden && (group.sourceKind === "category" ? !entry.zone && ["个人桌面", "公共桌面"].includes(entry.sourceLabel) : group.mappedPath ? inFolder(entry.path, group.mappedPath) : entry.zone === group.dirName),
        )
      : [];
    result[panel.key] = sortForPanel(panel.groupId, pool);
  }

  for (const tabs of store.tabGroups) {
    result[`tabs:${tabs.id}`] = [...new Map(tabs.groupIds.flatMap(id => (result[zonePanelKey(id)] ?? []).filter(entry => matchesFilter(entry, store.customGroups.find(group => group.id === id)?.filter))).map(entry => [entry.id, entry])).values()];
  }

  return result;
}

/** 快捷启动面板的条目：按 launcherIds 的存储顺序（= 用户添加顺序）。 */
export function getLauncherEntries(): DesktopEntry[] {
  return store.launcherIds
    .map((id) => store.launcherReferences[id] ?? store.entries.find((entry) => entry.id === id) ?? referenceFromId(id))
    .filter((entry): entry is DesktopEntry => Boolean(entry));
}

/** 桌面层渲染所有可见面板；收纳区即使是空的也要显示（等待拖入）。 */
export function getVisibleDesktopPanels(): Panel[] {
  return store.panels.filter(
    (panel) => store.panelLayouts[panel.key]?.visible !== false && (() => {
      const tabGroup = store.tabGroups.find((tabs) => tabs.groupIds.includes(panel.groupId));
      if (!tabGroup) return true;
      return false;
    })(),
  );
}

export function searchResults(query: string): DesktopEntry[] {
  const needle = query.trim().toLowerCase();
  const pool = store.entries.filter((entry) => !entry.isHidden);
  if (!needle) return pool.slice(0, 16);
  return pool
    .filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        entry.sourceLabel.toLowerCase().includes(needle) ||
        entry.target.toLowerCase().includes(needle),
    )
    ;
}

export function isLauncher(entryId: string): boolean {
  return store.launcherIds.includes(entryId);
}

/** 拖放落点所在的项目 id（把项目插到它前面）；空白处返回 null 表示末尾。 */
export function dropTargetId(event: DragEvent): string | null {
  const tile = (event.target as HTMLElement).closest?.("[data-item-id]");
  return tile?.getAttribute("data-item-id") ?? null;
}

function sortForPanel(groupId: string, items: DesktopEntry[]): DesktopEntry[] {
  const order = store.itemOrders[groupId];
  if (order && order.length > 0) {
    const rank = new Map(order.map((id, index) => [id, index]));
    return [...items].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  return [...items].sort((a, b) => {
    if (a.isFresh !== b.isFresh) return a.isFresh ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

export function foldedIds(panelKeyString: string): Set<string> {
  return new Set(store.foldedItems[panelKeyString] ?? []);
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

let initialization: Promise<void> | undefined;
/** Multiple React mounts share one native listener/refresh lifecycle. */
export function initialize(): Promise<void> {
  if (!initialization) initialization = initializeService().catch(error => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

async function initializeService(): Promise<void> {
  await restoreState();
  await recoverStorageZones();
  await syncMappingWatches();
  await refreshDisplays();
  try {
    store.startWithWindows = await readStartWithWindows();
  } catch {
    store.startWithWindows = false;
  }
  try {
    store.paused = await getPaused();
  } catch {
    store.paused = false;
  }
  if (!store.hideNativeIcons) {
    try {
      await setHideNativeIconsNative(false);
    } catch {
      /* 启动时恢复系统图标失败不阻断 */
    }
  }
  // 扫描/IPC 任一步失败都不能让 ready 卡住——否则整个桌面层渲染为空，
  // 托盘新建收纳区等监听也永远绑不上。
  try {
    await rescan();
  } catch {
    store.entries = [];
  }
  ensurePanels();
  ensureLayouts();
  ensureLauncherLayout();
  const launcherVisibilityChanged = hideLegacyLauncher();
  applyAppearanceToCss();
  try {
    await bindIpc();
  } catch {
    /* IPC 绑定失败也保持可用 */
  }
  store.ready = true;
  publishState();
  if (launcherVisibilityChanged) scheduleSave();
  void scanApplications().then(async applications => {
    if (isExitFrozen()) return;
    store.applications = applications;
    publishState();
    await setClipboardEnabled(store.clipboardEnabled);
  }).catch(() => showStatus("应用目录暂时不可用，可在搜索页重新刷新"));
  recoverDesktopLayouts();
  if (getCurrentWebviewWindow().label === "desktop") {
    // Enumeration/monitor numbering may settle after initialization or wake-up.
    // A periodic refresh also restores displaced surfaces when a monitor returns.
    window.setInterval(() => { void refreshDisplays(); }, 2000);
  }

  // 面板此时才真的挂载进 DOM，且桌面层窗口刚被 Rust resize 到位。
  // 用几个递增的延迟反复校准命中矩形，覆盖冷启动期的 reflow/窗口大小竞态。
  scheduleHitRectSync();
  window.setTimeout(() => scheduleHitRectSync(0), 350);
  window.setTimeout(() => scheduleHitRectSync(0), 900);
}

let ipcBound = false;

async function bindIpc(): Promise<void> {
  if (ipcBound) return;
  ipcBound = true;
  const label = getCurrentWebviewWindow().label;

  await listen<number>("nestra://prepare-exit", event => { void prepareExit(event.payload); });
  await listen<string>("nestra://exit-cancelled", event => {
    cancelExitPreparation();
    showStatus(`退出已取消：${event.payload}`);
    // Events ignored while waiting for other windows may have changed disk,
    // file membership or display topology. Reconcile once input is restored.
    void applyRemoteState();
    void rescan().catch(() => {});
    void refreshDisplays();
  });

  await listen<string>(STATE_CHANGED_EVENT, (event) => {
    if (isExitFrozen()) return;
    if (event.payload === label) return;
    void applyRemoteState();
  });

  await listen(DESKTOP_CHANGED_EVENT, () => {
    if (isExitFrozen()) return;
    // 静默重扫：桌面频繁变动时弹 toast 只会打扰用户。
    void rescan().catch(() => showStatus("桌面刷新失败，现有项目已保留"));
  });

  await listen<string>(SESSION_EVENT, (event) => {
    if (isExitFrozen()) return;
    if (event.payload === "paused") store.paused = true;
    if (event.payload === "resumed") {
      store.paused = false;
      scheduleHitRectSync(0);
    }
    if (event.payload === "search" && label === "desktop") openSearch();
    if (event.payload === "search-manager" && label === "manager") {
      store.searchOpen = true;
    }
    publishState();
  });
}

let preparingExit: number | null = null;
let previousBodyInert = false;
let exitInputFrozen = false;
let pendingStateMutations = 0;

/** Native events and asynchronous producers are not blocked by DOM inert. */
export function isExitFrozen(): boolean { return exitInputFrozen; }

async function runStateMutation<T>(operation: () => Promise<T>): Promise<T> {
  if (isExitFrozen()) throw new Error("正在退出，请等待保存完成");
  pendingStateMutations += 1;
  try { return await operation(); }
  finally { pendingStateMutations -= 1; publishState(); }
}

function cancelExitPreparation(): void {
  preparingExit = null;
  if (exitInputFrozen) document.body.inert = previousBodyInert;
  exitInputFrozen = false;
}

async function prepareExit(requestId: number): Promise<void> {
  if (preparingExit === requestId) return;
  preparingExit = requestId;
  try {
    const deadline = Date.now() + 10000;
    // Let active mouse-up handlers and file operations commit before freezing input.
    while (!store.ready || desktopGestureActive() || fileMoves.busy || pendingStateMutations > 0) {
      if (preparingExit !== requestId) return;
      if (Date.now() >= deadline) throw new Error("操作仍在进行，请完成后重新退出");
      await new Promise(resolve => window.setTimeout(resolve, 50));
    }
    if (preparingExit !== requestId) return;
    previousBodyInert = document.body.inert;
    document.body.inert = true;
    exitInputFrozen = true;
    // Flush already-committed edits only; explicit todo drafts remain drafts.
    do {
      await flushState();
      if (Date.now() >= deadline) throw new Error("配置保存尚未完成，请稍后重试");
    } while (preparingExit === requestId && !equivalent(lastSynced, snapshotFromStore()));
    if (preparingExit !== requestId) return;
    if (desktopGestureActive() || fileMoves.busy) throw new Error("仍有文件操作未完成");
    await acknowledgeExit(requestId, null);
  } catch (error) {
    if (preparingExit !== requestId) return;
    cancelExitPreparation();
    showStatus(`退出前保存失败：${error}`);
    await acknowledgeExit(requestId, String(error)).catch(() => {});
  }
}

function isEditingText(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLElement &&
    el.matches("input, textarea, [contenteditable]")
  );
}

let fileChangeDepth = 0;
async function performFileChange<T>(operation: () => Promise<T>): Promise<T> {
  fileChangeDepth += 1;
  try { return await operation(); } finally { fileChangeDepth -= 1; }
}

export type { SearchScope } from "@/lib/search";

function matchesSearchScope(entry: DesktopEntry, scope: SearchScope): boolean {
  if (scope === "applications") return entry.isApplication;
  const mapped = store.customGroups.some((group) => group.mappedPath && inFolder(entry.path, group.mappedPath));
  if (scope === "mappings") return mapped;
  if (scope === "zones") return Boolean(entry.zone) && !mapped;
  if (scope === "desktop") return !entry.zone && !mapped && ["个人桌面", "公共桌面", "系统入口"].includes(entry.sourceLabel);
  return true;
}

export async function searchWithDetails(query: string, scope: SearchScope, onPartial?: (result: SearchResult) => void): Promise<SearchResult> {
  const needle = query.trim().toLowerCase();
  const local = rankSearch([...store.entries, ...store.applications].filter(entry => !entry.isHidden && matchesSearchScope(entry, scope) && (!needle || `${entry.name} ${entry.path} ${entry.sourceLabel}`.toLowerCase().includes(needle))),query,store.recentLaunchPaths).slice(0,500);
  const paths = store.customGroups.flatMap((group) => group.mappedPath ? [group.mappedPath] : []);
  return runSearch(query, scope, { local, mappedPaths: paths, everything: searchEverything, mapped: searchMappedFolders, recent:store.recentLaunchPaths }, onPartial);
}

function desktopGestureActive(): boolean {
  if (fileChangeDepth > 0) return true;
  return document.body.classList.contains("is-gesturing")
    || document.body.classList.contains("is-external-dragging");
}

async function applyRemoteState(): Promise<void> {
  if (isExitFrozen()) return;
  // 拖拽手势中或正在打字时套用远端快照会让面板跳回/输入被冲掉——稍后再试。
  if (desktopGestureActive() || isEditingText()) {
    window.setTimeout(() => void applyRemoteState(), 350);
    return;
  }
  const task = persistChain.then(async () => {
    if (isExitFrozen()) return;
    if (desktopGestureActive() || isEditingText()) {
      window.setTimeout(() => void applyRemoteState(), 350);
      return;
    }
    const persisted = await loadPersistedState<PersistedState>();
    if (isExitFrozen()) return;
    if (!persisted) return;
    // A gesture can begin while load_state is in flight.
    if (desktopGestureActive() || isEditingText()) {
      window.setTimeout(() => void applyRemoteState(), 350);
      return;
    }
    if ((persisted.schemaVersion ?? 1) > 2) { store.persistenceBlocked = true; showStatus("配置来自更新版本，已停止写入"); return; }
    // 三方合并：保留本窗口尚未保存的本地改动（拖拽中的布局、刚建的收纳区），
    // 而不是被远端快照整体覆盖。
    const merged = mergePersisted(lastSynced, snapshotFromStore(), persisted);
    const previousMappings = JSON.stringify(store.customGroups.map(g => g.mappedPath));
    applyPersisted(merged);
    if (previousMappings !== JSON.stringify(store.customGroups.map(g => g.mappedPath))) {
      void syncMappingWatches();
      void rescan().catch(() => {});
    }
    lastSynced = persisted;
    ensurePanels();
    const layoutCount = Object.keys(store.panelLayouts).length;
    ensureLayouts();
    ensureLauncherLayout();
    applyAppearanceToCss();
    scheduleHitRectSync();
    // 远端带来了没有布局的新分区时，ensureLayouts 补的位置需要回写磁盘。
    if (Object.keys(store.panelLayouts).length > layoutCount) scheduleSave();
  });
  persistChain = task.catch(() => {
    // 远端状态损坏时保持当前内存快照。
  });
  await persistChain;
}

/** 快捷启动面板首次布局：贴着屏幕右下角。 */
function hideLegacyLauncher(): boolean {
  const layout = store.panelLayouts[LAUNCHER_PANEL_KEY];
  if (!layout || layout.launcherVisibilityMigrated) return false;
  layout.visible = false;
  layout.launcherVisibilityMigrated = true;
  return true;
}

function ensureLauncherLayout(): void {
  if (!store.panelLayouts[DESKTOP_SEARCH_KEY]) {
    const display = store.displays.find(d => d.isPrimary) ?? store.displays[0];
    store.panelLayouts[DESKTOP_SEARCH_KEY] = { x: (display?.x ?? 0) + Math.max(0, ((display?.width ?? window.innerWidth) - 280) / 2),
      y: (display?.y ?? 0) + 14, width: 280, height: 46, zIndex: 8, visible: true };
    if (display) { containSurface(store.panelLayouts[DESKTOP_SEARCH_KEY]!, display); store.panelLayouts[DESKTOP_SEARCH_KEY]!.monitorId = display.id; }
  }
  if (store.panelLayouts[LAUNCHER_PANEL_KEY]) return;

  store.panelLayouts[LAUNCHER_PANEL_KEY] = {
    x: Math.max(20, window.innerWidth - 376),
    y: Math.max(20, window.innerHeight - 470),
    width: 336,
    height: 420,
    zIndex: 5,
    visible: false,
    launcherVisibilityMigrated: true,
    viewMode: "grid",
    columns: 4,
    density: "comfortable",
  };
}

async function restoreState(): Promise<void> {
  try {
    const persisted = await loadPersistedState<PersistedState>();
    if (!persisted) return;
    if ((persisted.schemaVersion ?? 1) < 2) {
      await backupConfiguration("migration");
    }
    applyPersisted(migrateConfiguration(persisted));
    lastSynced = persisted;
    if ((persisted.schemaVersion ?? 1) < 2 || !persisted.appearance?.styleVersion || !persisted.coexistMigrated) scheduleSave();
  } catch (error) {
    store.persistenceBlocked = true;
    showStatus(`配置未载入，已停止写入以保留原数据：${error}`);
  }
}

async function recoverStorageZones(): Promise<void> {
  try {
    const zones = await listStorageZones();
    const groups = reconcileStorageZones(store.customGroups, zones);
    const count = groups.length - store.customGroups.length;
    if (!count) return;
    store.customGroups = groups;
    // A corrupt configuration without a valid backup remains read-only, but
    // its files can still be displayed from the filesystem's real directories.
    if (!store.persistenceBlocked) {
      scheduleSave();
      showStatus(`已重新关联 ${count} 个收纳目录，文件保持原位`);
    }
  } catch {
    showStatus("收纳目录暂时无法读取，请在控制中心检查数据与恢复");
  }
}

function applyPersisted(persisted: PersistedState): void {
  // Keep mutable store data separate from the three-way merge baseline.
  persisted = JSON.parse(JSON.stringify(persisted)) as PersistedState;
  // Remote application only publishes; it never schedules a local save.
  // Active move/resize handlers retain these objects across asynchronous saves.
  const layouts = persisted.panelLayouts ?? {};
  for (const [key, layout] of Object.entries(layouts)) {
    const existing = store.panelLayouts[key];
    if (existing) {
      for (const key of Object.keys(existing)) if (!(key in layout)) Reflect.deleteProperty(existing, key);
      Object.assign(existing, layout);
      layouts[key] = existing;
    }
  }
  store.panelLayouts = layouts;
  // 旧版本的分组没有 dirName（当时不做真实文件移动）——补一个合法目录名。
  const rawGroups = persisted.customGroups ?? [];
  store.customGroups = rawGroups.map((group) => ({
    ...group,
    id: group.id,
    name: group.name,
    dirName: group.dirName || sanitizeZoneDir(group.name),
  }));
  const persistedTabs = persisted.tabGroups ?? [];
  if (Array.isArray(persisted.tabGroups)) {
    store.tabGroups = persistedTabs
      .map((tabs) => ({
        ...tabs,
        groupIds: tabs.groupIds.filter((id) => store.customGroups.some((group) => group.id === id)),
      }))
      .map((tabs) => ({
        ...tabs,
        activeGroupId: (tabs.activeGroupId === "__all__" || tabs.groupIds.includes(tabs.activeGroupId)) ? tabs.activeGroupId : (tabs.groupIds[0] ?? ""),
      }));
  } else {
    // One-time migration from the old "same string means tabs" representation.
    const legacy = new Map<string, CustomGroupDefinition[]>();
    for (const group of store.customGroups) {
      if (!group.tabSet?.trim()) continue;
      legacy.set(group.tabSet, [...(legacy.get(group.tabSet) ?? []), group]);
    }
    store.tabGroups = [...legacy.entries()]
      .filter(([, groups]) => groups.length > 1)
      .map(([name, groups], index) => ({
        id: `tabs-migrated-${index}`,
        name,
        groupIds: groups.map((group) => group.id),
        activeGroupId: groups.some((group) => group.id === groups[0].activeTab)
          ? groups[0].activeTab!
          : groups[0].id,
      }));
    for (const group of store.customGroups) {
      delete group.tabSet;
      delete group.activeTab;
    }
  }
  {
    // 同名的旧分组补出来的 dirName 可能撞车，统一去重。
    const seen = new Set<string>();
    for (const group of store.customGroups) {
      if (seen.has(group.dirName.toLowerCase())) {
        group.dirName = uniqueZoneDir(group.dirName, group.id);
      }
      seen.add(group.dirName.toLowerCase());
    }
  }
  store.foldedItems = persisted.foldedItems ?? {};
  store.itemOrders = persisted.itemOrders ?? {};
  store.widgets = (persisted.widgets ?? []).map((widget) => {
    const existing = store.widgets.find((item) => item.id === widget.id);
    if (!existing) return widget;
    for (const key of Object.keys(existing.layout)) if (!(key in widget.layout)) Reflect.deleteProperty(existing.layout, key);
    Object.assign(existing.layout, widget.layout);
    Object.assign(existing, { ...widget, layout: existing.layout });
    return existing;
  });
  store.launcherIds = persisted.launcherIds ?? [];
  store.launcherReferences = persisted.launcherReferences ?? {};
  store.launchCollections = persisted.launchCollections ?? [];
  store.clipboardEnabled = persisted.clipboardEnabled ?? true;
  store.appearance = { ...DEFAULT_APPEARANCE, ...(persisted.appearance ?? {}) };
  // 旧版本默认接管桌面，老状态文件里 hideNativeIcons 常被写成 true。
  // 切换到共存模型后复位一次；标记随前端的正常保存链写入。
  store.hideNativeIcons =
    persisted.hideNativeIcons === true && persisted.coexistMigrated === true;
  if (typeof persisted.startWithWindows === "boolean") {
    store.startWithWindows = persisted.startWithWindows;
  }

  // zCounter 从已持久化的最大 zIndex 继续，否则重启后低层面板点不置顶。
  for (const layout of Object.values(store.panelLayouts)) {
    zCounter = Math.max(zCounter, layout.zIndex ?? 0);
  }
  for (const widget of store.widgets) {
    zCounter = Math.max(zCounter, widget.layout?.zIndex ?? 0);
  }
  publishState();
}

async function syncMappingWatches(): Promise<void> {
  const paths = store.customGroups.flatMap((group) => group.mappedPath ? [group.mappedPath] : []);
  try { await setMappingWatchPaths(paths); } catch { /* non-Tauri preview */ }
}

const displayRecoveryReady = createDisplayRecoveryGate();
let canRecoverDisplays = false;
let displayRefreshRunning = false;
export async function refreshDisplays(): Promise<void> {
  if (isExitFrozen()) return;
  return runStateMutation(async () => {
    if (displayRefreshRunning) return;
    displayRefreshRunning = true;
    try {
      const displays = await listDisplays();
      canRecoverDisplays = displayRecoveryReady(displays, Date.now());
      if (displays.length) store.displays = displays;
    } catch { canRecoverDisplays = displayRecoveryReady([], Date.now()); }
    finally { displayRefreshRunning = false; }
    if (store.ready) recoverDesktopLayouts();
  });
}

function recoverDesktopLayouts(): void {
  if (isExitFrozen()) return;
  if (!canRecoverDisplays || getCurrentWebviewWindow().label !== "desktop" || desktopGestureActive()) return;
  const changed = recoverSurfaces(
    [...Object.values(store.panelLayouts), ...store.widgets.map(widget => widget.layout)], store.displays,
  );
  if (changed) { scheduleSave(); scheduleHitRectSync(); }
}
async function scanAllEntries(): Promise<DesktopEntry[]> {
  const entries = await scanDesktop();
  const unique = new Map(entries.map(e => [e.id, e]));
  for (const group of store.customGroups.filter(g => g.mappedPath)) {
    let mapped: DesktopEntry[];
    try {
      mapped = await scanFolder(group.mappedPath!);
      delete mappingErrors[group.id];
    } catch (error) {
      mappingErrors[group.id] = `文件夹暂不可用：${error}`;
      mapped = store.entries.filter(e => inFolder(e.path, group.mappedPath!));
    }
    for (const entry of mapped) if (!unique.has(entry.id)) unique.set(entry.id, entry);
  }
  const referencePaths = store.launcherIds.filter(id => !unique.has(id))
    .filter(id => id.startsWith("file:") || id.startsWith("app:shortcut:"))
    .map(id => id.replace(/^(file:|app:shortcut:)/, ""));
  if (referencePaths.length) {
    for (const entry of await scanPaths(referencePaths)) if (!unique.has(entry.id)) unique.set(entry.id, entry);
  }
  return [...unique.values()];
}
const refreshDesktop = createRefreshQueue(scanAllEntries, (entries) => {
  store.entries = entries;
  for (const id of store.launcherIds) { const entry = entries.find(item => item.id === id); if (entry) store.launcherReferences[id] = { ...entry, name: store.launcherReferences[id]?.name ?? entry.name, iconPath: null }; }
  pruneGhostReferences();
  ensurePanels();
  // 快照已上屏，异步补齐缺失图标（不阻塞面板渲染）。
  scheduleIconFill();
  publishState();
}, desktopGestureActive);

export function rescan(): Promise<void> {
  if (isExitFrozen()) return Promise.resolve();
  return runStateMutation(() => refreshDesktop());
}

/** 清理指向已不存在条目的记录，避免面板里出现幽灵项目。 */
function pruneGhostReferences(): void {
  const alive = new Set(store.entries.map((entry) => entry.id));

  for (const [key, list] of Object.entries(store.foldedItems)) {
    const filtered = list.filter((id) => alive.has(id));
    if (filtered.length !== list.length) store.foldedItems[key] = filtered;
  }

  for (const [groupId, order] of Object.entries(store.itemOrders)) {
    const filtered = order.filter((id) => alive.has(id));
    if (filtered.length !== order.length) store.itemOrders[groupId] = filtered;
  }

  // 快捷启动同样只保留还存在的引用（引用语义：文件没了入口也没意义）。
  const launcherIds = store.launcherIds.filter((id) => alive.has(id) || store.launcherReferences[id] || referenceFromId(id));
  if (launcherIds.length !== store.launcherIds.length) store.launcherIds = launcherIds;
}

/** 条目 id 随路径变化（重命名/移动进出收纳区）时，把引用迁到新 id 上。 */
function migrateItemId(oldId: string, newId: string): void {
  if (oldId === newId) return;

  for (const [key, list] of Object.entries(store.foldedItems)) {
    if (list.includes(oldId)) {
      store.foldedItems[key] = list.map((id) => (id === oldId ? newId : id));
    }
  }
  for (const [key, order] of Object.entries(store.itemOrders)) {
    if (order.includes(oldId)) {
      store.itemOrders[key] = order.map((id) => (id === oldId ? newId : id));
    }
  }
  store.launcherIds = store.launcherIds.map((id) => (id === oldId ? newId : id));
  const reference = store.launcherReferences[oldId];
  if (reference) {
    const path = newId.replace(/^(?:app:shortcut:|file:)/, "");
    store.launcherReferences[newId] = { ...reference, id: newId, path, target: path };
    delete store.launcherReferences[oldId];
  }
  for (const collection of store.launchCollections) collection.entryIds = collection.entryIds.map(id => id === oldId ? newId : id);
  if (store.selectedItemId === oldId) store.selectedItemId = newId;
  store.selectedItemIds = (store.selectedItemIds??[]).map(id=>id===oldId?newId:id);
  if (store.selectionAnchor===oldId) store.selectionAnchor=newId;
}

export async function undoRecordedMove(id:number): Promise<void> {
  return runStateMutation(async () => {
    await performFileChange(async()=>{
      const moved=await undoFileMove(id);
      const affected=[...store.entries,...Object.values(store.launcherReferences)].filter(e=>e.path.toLowerCase()===moved.fromPath.toLowerCase());
      for(const entry of affected)migrateItemId(entry.id,remappedId(entry,moved.newPath));
  });
  await rescan();scheduleSave();showStatus('已撤销移动，文件回到原位置');
  });
}

/** Match scanner identity after extension changes as well as ordinary moves. */
function remappedId(entry: DesktopEntry, newPath: string): string {
  const application = entry.kind !== "folder" && /\.(lnk|url|appref-ms|exe|bat|cmd)$/i.test(newPath);
  const prefix = application ? "app:shortcut:" : "file:";
  return `${prefix}${newPath}`;
}

/** Include references not present in the current scan (and descendants of moved folders). */
function migratePathReferences(fromPath: string, newPath: string): void {
  const normalized = (path: string) => path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const source = normalized(fromPath);
  const entries = [...store.entries, ...Object.values(store.launcherReferences)];
  const ids = new Set([
    ...entries.map(entry => entry.id), ...store.launcherIds,
    ...Object.values(store.foldedItems).flat(), ...Object.values(store.itemOrders).flat(),
    ...store.launchCollections.flatMap(collection => collection.entryIds),
  ]);
  for (const id of ids) {
    if (!/^(file:|app:shortcut:)/.test(id)) continue;
    const path = id.replace(/^(file:|app:shortcut:)/, "");
    const normalizedPath = normalized(path);
    if (normalizedPath !== source && !normalizedPath.startsWith(`${source}\\`)) continue;
    const target = newPath + path.slice(fromPath.length);
    const entry = entries.find(entry => entry.id === id);
    // For unknown descendants, preserve the established identity on a pure move.
    const newId = entry ? remappedId(entry, target) : id.slice(0, id.length - path.length) + target;
    migrateItemId(id, newId);
  }
}

function ensurePanels(): void {
  const panels: Panel[] = [];

  for (const group of store.customGroups) {
    panels.push({
      key: zonePanelKey(group.id),
      groupId: group.id,
      title: group.name,
      glyph: [...group.name][0] ?? "组",
      mode: "mixed",
      isSystem: false,
    });
  }

  // 快捷启动作为特殊面板注册，管理器里可以控制显隐。
  for (const tabs of store.tabGroups) panels.push({ key: `tabs:${tabs.id}`, groupId: `tabs:${tabs.id}`, title: tabs.name, glyph: "组", mode: "mixed", isSystem: false });
  panels.push({
    key: LAUNCHER_PANEL_KEY,
    groupId: "launcher",
    title: "快捷启动",
    glyph: "快",
    mode: "mixed",
    isSystem: true,
  });

  store.panels = panels;
  publishState();
}

/** First-run placement: flow the panels across the screen like the old
 * BalancedWrapPanel did. Existing layouts are never touched. */
function ensureLayouts(): void {
  const display = store.displays.find(d => d.isPrimary) ?? store.displays[0];
  const screenWidth = display?.width ?? Math.max(window.screen.width, window.innerWidth);
  const columns = Math.max(
    1,
    Math.floor((screenWidth - SCREEN_MARGIN * 2) / (PANEL_WIDTH + PANEL_GAP)),
  );

  let added = false;
  store.panels.forEach((panel, index) => {
    if (panel.key === LAUNCHER_PANEL_KEY || store.panelLayouts[panel.key]) return;

    const row = Math.floor(index / columns);
    const column = index % columns;
    added = true;
    store.panelLayouts[panel.key] = {
      x: (display?.x ?? 0) + SCREEN_MARGIN + column * (PANEL_WIDTH + PANEL_GAP),
      y: (display?.y ?? 0) + SCREEN_MARGIN + row * (PANEL_HEIGHT + PANEL_GAP),
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      zIndex: ++zCounter,
      visible: true,
      viewMode: "grid",
      columns: 4,
      density: "comfortable",
    };
    if (display) {
      // Keep the intended row if it does not fit. Batch display recovery can
      // find a temporary place without losing these original coordinates.
      store.panelLayouts[panel.key]!.monitorId = display.id;
      store.panelLayouts[panel.key]!.monitorBounds = { x: display.x, y: display.y };
    }
  });

  // Remote state application also calls this helper. Saving when nothing was
  // added broadcasts the same snapshot back forever between the two windows.
  if (added) scheduleSave();
}

export function applyAppearanceToCss(): void {
  const root = document.documentElement;
  root.style.setProperty("--panel-opacity", String(store.appearance.panelOpacity));
  root.dataset.material = store.appearance.surfaceMaterial;
  root.classList.toggle("dark", store.appearance.theme === "dark");

  const radii: Record<string, string> = {
    square: "2px",
    compact: "8px",
    standard: "14px",
    rounded: "22px",
  };
  root.style.setProperty("--panel-radius", radii[store.appearance.cornerStyle] ?? "14px");
}

/* ------------------------------------------------------------------ */
/* Hit-test rects（空白区点击穿透）                                      */
/* ------------------------------------------------------------------ */

let hitRectTimer: number | undefined;
const syncHitRegion = createHitRegionSync(setHitRects);

/** 把屏幕上真实可见的悬浮表面矩形（换算成物理像素）推给 Rust 命中测试。
 * 优先读实际渲染出的 DOM（getBoundingClientRect，永远反映最终位置），
 * 面板尚未挂载时回退到布局数值。 */
async function pushHitRects(): Promise<void> {
  // 只有桌面层窗口负责推命中矩形；管理器窗口的同一份 store 绝不能碰它，
  // 否则会用自己没有面板的 DOM/过期布局把桌面可点击区域改错。
  if (getCurrentWebviewWindow().label !== "desktop") return;
  const dpr = window.devicePixelRatio || 1;
  const rects: { x: number; y: number; width: number; height: number }[] = [];

  // Only while an internal tile is actively dragged, receive drops between
  // panels too. Cleanup restores the shaped window on up/cancel/Escape/blur.
  if (document.body.classList.contains("is-item-dragging")) {
    await syncHitRegion([{ x: 0, y: 0, width: Math.round(window.innerWidth * dpr), height: Math.round(window.innerHeight * dpr) }]);
    return;
  }

  // 1) 权威来源：正在屏幕上绘制的悬浮表面（面板 + 快捷启动 + 小组件）。
  document.querySelectorAll<HTMLElement>(".nestra-panel, .nestra-hit").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') {
      rects.push({
        x: Math.round(r.left * dpr),
        y: Math.round(r.top * dpr),
        width: Math.round(r.width * dpr),
        height: Math.round(r.height * dpr),
      });
    }
  });

  // 2) 兜底仅限冷启动早期（DOM 未挂载）：且只推**有活面板**的布局键。
  // 旧状态文件里残留着无面板的孤儿布局（files:*/applications:*），无脑
  // 全推会在图标区铺出一大片幽灵命中矩形——桌面图标会被盖住点不动。
  // ready 之后 DOM 是权威：空就是真空，全屏穿透。
  if (rects.length === 0 && !store.ready) {
    const livePanelKeys = new Set(store.panels.map((panel) => panel.key));
    for (const [key, layout] of Object.entries(store.panelLayouts)) {
      if (layout.visible === false || !livePanelKeys.has(key)) continue;
      rects.push({
        x: Math.round(layout.x * dpr),
        y: Math.round(layout.y * dpr),
        width: Math.round(layout.width * dpr),
        height: Math.round(layout.height * dpr),
      });
    }

    for (const widget of store.widgets) {
      rects.push({
        x: Math.round(widget.layout.x * dpr),
        y: Math.round(widget.layout.y * dpr),
        width: Math.round(widget.layout.width * dpr),
        height: Math.round(widget.layout.height * dpr),
      });
    }
  }

  try {
    await syncHitRegion(normalizeHitRects(rects, Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr)));
  } catch {
    // 命中同步失败只影响穿透体验，不提示。
  }
}

export function scheduleHitRectSync(_delay = 16): void {
  // Coalesce within a frame; a debounce would never update the native region
  // while a panel is continuously moving.
  if (hitRectTimer !== undefined) return;
  hitRectTimer = window.requestAnimationFrame(() => {
    hitRectTimer = undefined;
    void pushHitRects();
  });
}

// 桌面层被 Rust 在启动后 resize/移动过：窗口尺寸一变就要重算命中矩形，
// 否则面板可点区域与实际显示位置错位（整层都点不动）。
let hitResizeBound = false;
function bindHitResizeListener(): void {
  if (hitResizeBound) return;
  hitResizeBound = true;
  window.addEventListener("resize", () => scheduleHitRectSync());
  window.addEventListener("resize", () => { if (store.ready) void refreshDisplays(); });
}
bindHitResizeListener();

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

export function scheduleSave(): void {
  publishState();
  if (store.persistenceBlocked) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { saveTimer = undefined; void flushState().catch(() => {}); }, 600);
}

export function flushState(): Promise<void> {
  window.clearTimeout(saveTimer); saveTimer = undefined;
  const task = persistChain.then(async () => {
    if (store.persistenceBlocked) throw new Error("配置写入已停止，请先修复配置");
    if (desktopGestureActive()) { scheduleSave(); return; }
    for (let attempt = 0; attempt < 3; attempt++) {
      const base = lastSynced;
      const local = snapshotFromStore();
      const disk = await loadPersistedState<PersistedState>();
      if (disk && (disk.schemaVersion ?? 1) > 2) { store.persistenceBlocked = true; throw new Error("配置来自更新版本，已停止写入"); }
      if (desktopGestureActive()) { scheduleSave(); return; }
      const merged = disk ? mergePersisted(base, local, disk) : local;
      try { await savePersistedState(merged, getCurrentWebviewWindow().label, disk); }
      catch (error) { if (String(error).includes("STATE_CONFLICT") && attempt < 2) continue; throw error; }
      // A gesture/file operation can start during the write. Its handlers must
      // finish before a snapshot is applied; keep the baseline on this chain.
      while (desktopGestureActive()) await new Promise(resolve => window.setTimeout(resolve, 50));
      lastSynced = merged;
      const applied = mergePersisted(local, snapshotFromStore(), merged, true);
      applyPersisted(applied);
      if (!equivalent(applied, merged)) scheduleSave();
      ensurePanels(); ensureLayouts(); ensureLauncherLayout(); scheduleHitRectSync();
      return;
    }
  });
  persistChain = task.catch(error => showStatus(`状态保存失败：${error}`));
  return task;
}

export function currentConfiguration(): PersistedState { return snapshotFromStore(); }

export function restoreConfiguration(imported: PersistedState, expected: PersistedState): Promise<void> {
  if (isExitFrozen()) return Promise.reject(new Error("正在退出，请等待保存完成"));
  window.clearTimeout(saveTimer); saveTimer = undefined;
  const task = persistChain.then(async () => {
    if (store.persistenceBlocked || desktopGestureActive()) throw new Error("当前配置不可恢复，请等待操作结束");
    const base = lastSynced;
    const disk = await loadPersistedState<PersistedState>();
    const local = snapshotFromStore();
    const current = disk ? mergePersisted(base, local, disk) : local;
    if (!equivalent(current, expected)) throw new Error("配置在预览后发生变化，请重新预览恢复");
    const prepared = prepareRestore(current, imported);
    await backupConfiguration("restore");
    if (desktopGestureActive() || !equivalent(local, snapshotFromStore())) throw new Error("配置在预览后发生变化，请重新预览恢复");
    await savePersistedState(prepared, getCurrentWebviewWindow().label, disk);
    while (desktopGestureActive()) await new Promise(resolve => window.setTimeout(resolve, 50));
    // An edit made while save_state was in flight must survive the restore.
    const applied = mergePersisted(local, snapshotFromStore(), prepared, true);
    lastSynced = prepared; applyPersisted(applied); ensurePanels(); ensureLayouts(); ensureLauncherLayout();
    if (!equivalent(applied, prepared)) scheduleSave();
    applyAppearanceToCss(); await syncMappingWatches(); await rescan(); scheduleHitRectSync();
    await setHideNativeIconsNative(store.hideNativeIcons);
    await setClipboardEnabled(store.clipboardEnabled);
    showStatus("配置已恢复；当前收纳目录与原文件保持完整");
  });
  persistChain = task.catch(error => showStatus(`恢复未完成：${error}`));
  return task;
}

function snapshotFromStore(): PersistedState {
  return JSON.parse(JSON.stringify({
    schemaVersion: 2,
    launcherReferences: store.launcherReferences ?? {},
    launchCollections: store.launchCollections ?? [],
    clipboardEnabled: store.clipboardEnabled ?? true,
    panelLayouts: store.panelLayouts,
    customGroups: store.customGroups,
    tabGroups: store.tabGroups,
    foldedItems: store.foldedItems,
    itemOrders: store.itemOrders,
    widgets: store.widgets,
    appearance: store.appearance,
    launcherIds: [...store.launcherIds],
    startWithWindows: store.startWithWindows,
    hideNativeIcons: store.hideNativeIcons,
    coexistMigrated: true,
  })) as PersistedState;
}

/** 本窗口最近一次与磁盘同步过的快照（三方合并的 base）。 */
let lastSynced: PersistedState | null = null;

/** 所有 savePersistedState 都串在这条链上，保证任意时刻只有一个写入。 */
let persistChain: Promise<void> = Promise.resolve();

/** serde_json sorts object keys; array order remains meaningful. */
function equivalent(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown) => JSON.stringify(value, (_key, nested) =>
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? Object.fromEntries(Object.keys(nested).sort().map(key => [key, nested[key]])) : nested);
  return canonical(left) === canonical(right);
}

/** 三方合并（base/local/remote），防止两个窗口的整文档快照互相覆盖。
 * 集合按 key 合并：本地或远端单边新增的保留、单边删除的尊重、两边都改的
 * 以远端为准；标量字段本地有改动用本地、否则跟远端。 */
function mergePersisted(
  base: PersistedState | null,
  local: PersistedState,
  remote: PersistedState,
  // Only the completion of our own write uses this: local edits happened
  // after the captured snapshot and must not be undone by that older result.
  preferLaterLocal = false,
): PersistedState {
  const byId = <T extends { id: string }>(list: T[] | undefined) => {
    const map: Record<string, T> = {};
    for (const item of list ?? []) map[item.id] = item;
    return map;
  };

  const mergeMap = <V>(
    b: Record<string, V> | undefined,
    l: Record<string, V> | undefined,
    r: Record<string, V> | undefined,
  ): Record<string, V> => {
    const out: Record<string, V> = {};
    const keys = new Set([...Object.keys(l ?? {}), ...Object.keys(r ?? {})]);
    for (const key of keys) {
      const inL = l != null && key in l;
      const inR = r != null && key in r;
      const inB = b != null && key in b;
      if (inL && inR) {
        // 只有本地改了用本地、只有远端改了用远端；两边都改 → 远端赢
        // （最后写入者胜，保证两个窗口收敛到同一份，不会来回覆盖）。
        const remoteSame = equivalent(r[key], b?.[key]);
        out[key] = remoteSame || (preferLaterLocal && !equivalent(l[key], b?.[key])) ? l[key] : r[key];
      } else if (inL) {
        if (!inB) out[key] = l[key]; // 本地新增；远端已删则尊重删除
      } else if (inR) {
        if (!inB) out[key] = r[key]; // 远端新增；本地已删则尊重删除
      }
    }
    return out;
  };

  const mergeLayout = (b: PanelLayout | undefined, l: PanelLayout, r: PanelLayout): PanelLayout => {
    const fields = (layout: PanelLayout | undefined) => layout as unknown as Record<string, unknown> | undefined;
    const out = mergeMap(fields(b), fields(l), fields(r));
    // Position, size and monitor recovery form one placement. Appearance,
    // visibility and item presentation can be edited independently of a drag.
    const keys = ["x", "y", "width", "height", "monitorId", "monitorBounds", "displacedFrom"] as const;
    const placement = (layout: PanelLayout | undefined) => Object.fromEntries(
      keys.filter(key => layout && key in layout).map(key => [key, layout![key]]),
    );
    const localWins = equivalent(placement(r), placement(b))
      || (preferLaterLocal && !equivalent(placement(l), placement(b)));
    const selected = localWins ? placement(l) : placement(r);
    for (const key of keys) {
      if (key in selected) out[key] = selected[key];
      else delete out[key];
    }
    return out as unknown as PanelLayout;
  };

  const mergeIds = (
    b: string[] | undefined,
    l: string[] | undefined,
    r: string[] | undefined,
  ): string[] => {
    if (equivalent(l ?? [], b ?? [])) return [...(r ?? [])];
    if (equivalent(r ?? [], b ?? [])) return [...(l ?? [])];
    const baseSet = new Set(b ?? []);
    const localSet = new Set(l ?? []), remoteSet = new Set(r ?? []);
    const order = preferLaterLocal ? [...(l ?? []), ...(r ?? [])] : [...(r ?? []), ...(l ?? [])];
    const merged = [...new Set(order)].filter(id => !baseSet.has(id) || (localSet.has(id) && remoteSet.has(id)));
    return merged;
  };

  const pickScalar = <V>(b: V | undefined, l: V, r: V | undefined): V =>
    equivalent(l, b) ? (r as V) ?? l : l;

  const groupsL = byId(local.customGroups);
  const groupsR = byId(remote.customGroups);
  const groupsB = byId(base?.customGroups);
  const mergedGroups = mergeMap(groupsB, groupsL, groupsR);

  const widgetsL = byId(local.widgets);
  const widgetsR = byId(remote.widgets);
  const widgetsB = byId(base?.widgets);
  const mergedWidgets = mergeMap(widgetsB, widgetsL, widgetsR);
  for (const id of Object.keys(mergedWidgets)) {
    const l = widgetsL[id], r = widgetsR[id], b = widgetsB[id];
    if (!l || !r) continue;
    const fields = (widget: Widget | undefined) => widget as unknown as Record<string, unknown> | undefined;
    mergedWidgets[id] = {
      ...mergeMap(fields(b), fields(l), fields(r)) as unknown as Widget,
      layout: mergeLayout(b?.layout, l.layout, r.layout),
    };
  }

  const tabsL = byId(local.tabGroups);
  const tabsR = byId(remote.tabGroups);
  const tabsB = byId(base?.tabGroups);
  const mergedTabs = mergeMap(tabsB, tabsL, tabsR);

  const mergedLayouts = mergeMap(base?.panelLayouts, local.panelLayouts, remote.panelLayouts);
  for (const key of Object.keys(mergedLayouts)) {
    const l = local.panelLayouts[key], r = remote.panelLayouts[key];
    if (l && r) mergedLayouts[key] = mergeLayout(base?.panelLayouts[key], l, r);
  }
  const mergedFolded = mergeMap(base?.foldedItems, local.foldedItems, remote.foldedItems);
  const mergedOrders = mergeMap(base?.itemOrders, local.itemOrders, remote.itemOrders);
  // Startup may discover a directory while another window is still saving its
  // newly created source. Keep the saved owner, not a second recovery panel
  // that applyPersisted would rebind to an invented, nonexistent directory.
  const aliases = new Map<string, string>();
  for (const group of Object.values(mergedGroups)) {
    if (!group.id.startsWith("recovered:") || group.mappedPath || group.sourceKind === "category") continue;
    const owner = Object.values(mergedGroups).find(other => !other.id.startsWith("recovered:") && !other.mappedPath
      && other.sourceKind !== "category" && other.dirName?.toLowerCase() === group.dirName?.toLowerCase());
    if (!owner) continue;
    aliases.set(group.id, owner.id);
    delete mergedGroups[group.id];
    const from = zonePanelKey(group.id), to = zonePanelKey(owner.id);
    if (!mergedLayouts[to] && mergedLayouts[from]) mergedLayouts[to] = mergedLayouts[from]!;
    if (!mergedFolded[to] && mergedFolded[from]) mergedFolded[to] = mergedFolded[from]!;
    if (!mergedOrders[owner.id] && mergedOrders[group.id]) mergedOrders[owner.id] = mergedOrders[group.id]!;
    delete mergedLayouts[from]; delete mergedFolded[from]; delete mergedOrders[group.id];
  }
  for (const [id, tabs] of Object.entries(mergedTabs)) {
    if (!aliases.size) break;
    mergedTabs[id] = { ...tabs, groupIds: [...new Set(tabs.groupIds.map(id => aliases.get(id) ?? id))],
      activeGroupId: aliases.get(tabs.activeGroupId) ?? tabs.activeGroupId };
  }

  // 数组字段保持原顺序：本地顺序优先，远端新增的按原顺序追加。
  const orderBy = <T extends { id: string }>(
    merged: Record<string, T>,
    l: T[] | undefined,
    r: T[] | undefined,
  ): T[] => {
    const out: T[] = [];
    const seen = new Set<string>();
    for (const item of [...(l ?? []), ...(r ?? [])]) {
      if (!seen.has(item.id) && merged[item.id]) {
        out.push(merged[item.id]);
        seen.add(item.id);
      }
    }
    return out;
  };

  // Desktop and manager can change different tasks in the same widget. Merge
  // tasks by their own identities; unrelated widget edits must not erase them.
  for (const id of Object.keys(mergedWidgets)) {
    const l = widgetsL[id], r = widgetsR[id], b = widgetsB[id];
    if (l?.kind === 'todo' && r?.kind === 'todo') {
      mergedWidgets[id] = {
        ...mergedWidgets[id]!,
        todos: orderBy(mergeMap(byId(b?.todos), byId(l.todos), byId(r.todos)), l.todos, r.todos),
      };
    }
  }

  return {
    schemaVersion: 2,
    launcherReferences: mergeMap(base?.launcherReferences, local.launcherReferences, remote.launcherReferences),
    launchCollections: orderBy(mergeMap(byId(base?.launchCollections), byId(local.launchCollections), byId(remote.launchCollections)), local.launchCollections, remote.launchCollections),
    clipboardEnabled: pickScalar(base?.clipboardEnabled, local.clipboardEnabled ?? true, remote.clipboardEnabled),
    panelLayouts: mergedLayouts,
    customGroups: orderBy(mergedGroups, local.customGroups, remote.customGroups),
    tabGroups: orderBy(mergedTabs, local.tabGroups, remote.tabGroups),
    foldedItems: mergedFolded,
    itemOrders: mergedOrders,
    widgets: orderBy(mergedWidgets, local.widgets, remote.widgets),
    appearance: pickScalar(base?.appearance, local.appearance, remote.appearance),
    launcherIds: mergeIds(base?.launcherIds, local.launcherIds, remote.launcherIds),
    startWithWindows: pickScalar(base?.startWithWindows, local.startWithWindows, remote.startWithWindows),
    hideNativeIcons: pickScalar(base?.hideNativeIcons, local.hideNativeIcons, remote.hideNativeIcons),
    coexistMigrated: true,
  };
}

let statusTimer: number | undefined;
export function showStatus(message: string, action: "show-launcher" | null = null): void {
  store.statusMessage = message;
  store.statusAction = action;
  publishState();
  if (statusTimer !== undefined) window.clearTimeout(statusTimer);
  statusTimer = undefined;
  // Keep an actionable result available until used, dismissed or replaced.
  if (action) return;
  statusTimer = window.setTimeout(() => {
    store.statusMessage = "";
    statusTimer = undefined;
    publishState();
  }, 3000);
}

export function dismissStatus(): void {
  if (statusTimer !== undefined) window.clearTimeout(statusTimer);
  statusTimer = undefined;
  store.statusMessage = "";
  store.statusAction = null;
  publishState();
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export function updateLayout(key: string, patch: Partial<PanelLayout>): void {
  const layout = store.panelLayouts[key];
  if (!layout) return;
  Object.assign(layout, patch);
  scheduleSave();
}

/** 面板显示/隐藏（隐藏后面板矩形也会从命中列表移除）。 */
export function setPanelVisible(key: string, visible: boolean): void {
  updateLayout(key, { visible });
  showStatus(visible ? "面板已恢复显示" : "面板已隐藏，可在管理器恢复");
}

export function bringToFront(key: string): void {
  const layout = store.panelLayouts[key];
  if (!layout) return;
  layout.zIndex = ++zCounter;
  scheduleSave();
}

/** 把项目收进收纳区 = 文件真实移动到 .nestra\<dirName>。
 * 返回移动后的新条目 id；失败返回 null。 */
export async function moveItem(itemId: string, targetGroupId: string): Promise<string | null> {
  return runStateMutation(async () => {
    try {
      const id = await moveItemOrThrow(itemId, targetGroupId);
      if (targetGroupId === 'launcher') return id;
      try { await rescan(); } catch (error) { showStatus(`移动已完成，但列表刷新失败：${error}`); return id; }
      showStatus('文件已移动到目标目录');
      return id;
    } catch (error) { showStatus(`收纳失败：${error}`); return null; }
  });
}

async function moveItemOrThrow(itemId: string, targetGroupId: string): Promise<string> {
  const entry = store.entries.find((item) => item.id === itemId);
  if (!entry) throw new Error('源文件不在当前列表中，请刷新后重新选择');

  if (targetGroupId === "launcher") {
    // 快捷启动是纯引用：不移动文件。
    if (!isLauncher(itemId)) toggleLauncher(itemId);
    return itemId;
  }

  const group = store.customGroups.find((candidate) => candidate.id === targetGroupId);
  if (group && !sourceFor(group).writable) throw new Error('此视图只浏览，不接收文件');
  if (!group) throw new Error('目标目录已不存在');

  if ((!entry.canManage && !store.customGroups.some(g => g.mappedPath && inFolder(entry.path, g.mappedPath))) || entry.kind === "shell") {
    throw new Error('这个项目不能收纳');
  }
  if (entry.zone === group.dirName || (group.mappedPath && inFolder(entry.path, group.mappedPath))) return itemId;

  return performFileChange(async () => {
      const newPath = group.mappedPath ? await moveToFolder(entry.path, group.mappedPath) : await moveToZone(entry.path, group.dirName);
      const id = remappedId(entry, newPath);
      migrateItemId(itemId, id);
      clearFolded(id);
      scheduleSave();
      return id;
    });
}

/** 把 itemId 归入 groupId 并排到 beforeId 之前（null = 末尾）。
 * 已在该收纳区的项目只改顺序，不做文件移动。 */
export async function placeItem(
  itemId: string,
  groupId: string,
  beforeId: string | null,
): Promise<void> {
  return runStateMutation(async () => {
    const newId = await moveItem(itemId, groupId);
    if (!newId) return;

    const panel = store.panels.find((candidate) => candidate.groupId === groupId);
    if (!panel || panel.groupId === "launcher") return;

    const ids = (getItemsByPanel()[panel.key] ?? [])
      .map((item) => item.id)
      .filter((id) => id !== newId);
    const at = beforeId ? ids.indexOf(beforeId) : -1;
    if (at >= 0) {
      ids.splice(at, 0, newId);
    } else {
      ids.push(newId);
    }
    store.itemOrders[groupId] = ids;
    scheduleSave();
  });
}

/** 把收纳区项目放回桌面顶层（文件真实移回，原生图标重新出现）。 */
export async function moveEntryToDesktop(itemId: string): Promise<void> {
  return runStateMutation(async () => {
    try {
      await returnItemOrThrow(itemId);
      try { await rescan(); } catch (error) { showStatus(`已放回桌面，但列表刷新失败：${error}`); return; }
      scheduleSave(); showStatus('文件已放回桌面');
    } catch (error) { showStatus(`无法放回桌面：${error}`); }
  });
}

async function returnItemOrThrow(itemId: string): Promise<void> {
  const entry = store.entries.find((item) => item.id === itemId);
  if (!entry || !entry.zone) throw new Error('项目已不在收纳区，请刷新后重新选择');
  const mapped = store.customGroups.some(g => g.mappedPath && inFolder(entry.path, g.mappedPath));
  if (!entry.canManage && !mapped) {
    throw new Error('这个项目不能移动');
  }

  await performFileChange(async () => {
      const newPath = mapped ? await moveToFolder(entry.path, null) : await moveToDesktopNative(entry.path);
      migrateItemId(entry.id, remappedId(entry, newPath));
      scheduleSave();
    });
}

/** 外部路径拖放：落在收纳区面板上 = 真实移入该区；
 * 落在快捷启动上 = 仅添加引用，不动文件。 */
export async function dropPaths(paths: string[], groupId: string | null): Promise<void> {
  return runStateMutation(async () => {
    if (paths.length === 0) return;

    if (groupId === "launcher") {
      let added = 0;
      for (const path of paths) {
        let entry = store.entries.find(
          (item) => item.path.toLowerCase() === path.toLowerCase(),
        );
        if (!entry) {
          try {
            entry = (await scanPaths([path]))[0];
            if (entry) store.entries = [...store.entries, entry];
          } catch { showStatus("无法读取这个快捷引用，原文件未改变"); }
        }
        if (entry && !isLauncher(entry.id)) {
          store.launcherIds.push(entry.id);
          store.launcherReferences[entry.id] = { ...entry, iconPath: null };
          added += 1;
        }
      }
      if (added > 0) {
        scheduleSave();
        showStatus(`已添加 ${added} 个快捷引用，原文件仍在桌面`);
      } else {
        showStatus("这些项目已经在快捷启动里");
      }
      return;
    }

    const group = groupId
      ? store.customGroups.find((candidate) => candidate.id === groupId)
      : null;
    if (!group) {
      showStatus("未落入收纳区，请拖到收纳区面板内松手");
      return;
    }

    if (!sourceFor(group).writable) { showStatus("此视图只浏览，不接收文件；原文件未改变"); return; }
    if (fileMoves.busy) { showStatus('正在整理文件，请等待本次操作完成'); return; }
    const destination = JSON.stringify([group.dirName, group.mappedPath, sourceFor(group).writable]);
    const tasks: MoveTask[] = [...new Set(paths)].map(path => {
      const entry = store.entries.find((item) => item.path.toLowerCase() === path.toLowerCase());
      return { name: path.split(/[\\/]/).pop() ?? path, path, run: async () => {
        const current = store.customGroups.find(item => item.id === groupId);
        if (!current || JSON.stringify([current.dirName, current.mappedPath, sourceFor(current).writable]) !== destination) throw new Error('目标目录已改变，请重新选择目标并发起移动');
        await performFileChange(async () => {
          const newPath = group.mappedPath ? await moveToFolder(path, group.mappedPath) : await moveToZone(path, group.dirName);
          if (entry) migrateItemId(entry.id, remappedId(entry, newPath));
          scheduleSave();
        });
      } };
  });
  const report = await trackFileMoves(group.name, tasks, async () => { await rescan(); scheduleSave(); });
  if (report) showStatus(`已收纳 ${report.items.filter(item=>item.state==='success').length} 项，${report.items.filter(item=>item.state==='failed').length} 项失败`);
  });
}

/** 引用语义：只记 id，不动文件。 */
export function toggleLauncher(entryId: string): void {
  if (isLauncher(entryId)) {
    store.launcherIds = store.launcherIds.filter((id) => id !== entryId);
    showStatus("已移出快捷启动");
  } else {
    store.launcherIds.push(entryId);
    const entry = store.entries.find(item => item.id === entryId) ?? store.applications.find(item => item.id === entryId);
    if (entry) store.launcherReferences[entryId] = { ...entry, iconPath: null };
    showStatus("已加入快捷启动，单击图标即可启动",
      store.panelLayouts[LAUNCHER_PANEL_KEY]?.visible === true ? null : "show-launcher");
  }
  scheduleSave();
}

/** 批量启动：间隔拉起，避免同时抢占磁盘/焦点。 */
export async function launchAll(): Promise<void> {
  const items = getLauncherEntries();
  if (items.length === 0) {
    showStatus("快捷启动还没有项目，右键收纳区磁贴即可添加");
    return;
  }

  await launchEntries(items);
}

function clearFolded(itemId: string): void {
  for (const [key, list] of Object.entries(store.foldedItems)) {
    if (list.includes(itemId)) {
      store.foldedItems[key] = list.filter((id) => id !== itemId);
    }
  }
}

export function foldItem(panelKeyString: string, itemId: string): void {
  const list = store.foldedItems[panelKeyString] ?? [];
  if (!list.includes(itemId)) {
    store.foldedItems[panelKeyString] = [...list, itemId];
    scheduleSave();
  }
}

export function unfoldItem(panelKeyString: string, itemId: string): void {
  const list = store.foldedItems[panelKeyString] ?? [];
  store.foldedItems[panelKeyString] = list.filter((id) => id !== itemId);
  scheduleSave();
}

export function toggleFoldVisibility(panelKeyString: string): void {
  const list = store.foldedItems[panelKeyString] ?? [];
  showStatus(
    list.length === 0
      ? "把项目拖到标题栏的「折叠」上即可收纳"
      : `折叠区有 ${list.length} 个项目，拖出即可恢复`,
  );
}

export function setAppearance(patch: Partial<AppearanceSettings>): void {
  Object.assign(store.appearance, patch);
  applyAppearanceToCss();
  scheduleSave();
}

export async function addCustomGroup(name: string): Promise<boolean> {
  return runStateMutation(async () => {
    const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
    let dirName: string;
    try {
      dirName = await createZone(uniqueZoneDir(sanitizeZoneDir(name)));
    } catch (error) {
      showStatus(`创建收纳区失败：${error}`);
      return false;
    }
    store.customGroups.push({ id, name, dirName });
    ensurePanels();
    ensureLayouts();
    scheduleSave();
    scheduleHitRectSync();
    showStatus(`已创建收纳区「${name}」`);
    return true;
  });
}

export function setPanelPresentation(
  key: string,
  patch: Pick<Partial<PanelLayout>, "viewMode" | "columns" | "density" | "iconSize" | "itemGap" | "labelLines" | "autoHide" | "autoHideDelay" | "autoSize">,
): void {
  const normalized = { ...patch };
  if (normalized.columns != null) normalized.columns = Math.max(2, Math.min(8, normalized.columns));
  if (normalized.iconSize != null) normalized.iconSize = Math.round(Math.max(24, Math.min(64, normalized.iconSize)));
  if (normalized.itemGap != null) normalized.itemGap = Math.round(Math.max(0, Math.min(24, normalized.itemGap)));
  if (normalized.labelLines != null) normalized.labelLines = Math.round(Math.max(1, Math.min(3, normalized.labelLines)));
  if (normalized.autoHideDelay != null) normalized.autoHideDelay = Number.isFinite(normalized.autoHideDelay) ? Math.round(Math.max(200, Math.min(5000, normalized.autoHideDelay))) : 800;
  updateLayout(key, normalized);
}

export function setSurfaceAppearance(key: string, patch: NonNullable<PanelLayout['appearance']> | null): void {
  const layout = store.panelLayouts[key] ?? store.widgets.find(w => `widget:${w.id}` === key)?.layout;
  if (!layout) return;
  if (patch === null) delete layout.appearance;
  else layout.appearance = { ...layout.appearance, ...patch };
  scheduleSave();
}

export function openSurfaceSettings(key: string): void {
  if (!store.panelLayouts[key]) return;
  store.surfaceSettingsKey = key;
  publishState();
  scheduleHitRectSync();
}

export function useGlobalAppearanceForAll(): void {
  for (const layout of Object.values(store.panelLayouts)) delete layout.appearance;
  scheduleSave();
}

export function clearSurfaceBackground(key: string): void {
  const layout = store.panelLayouts[key];
  if (!layout?.appearance) return;
  delete layout.appearance.backgroundColor;
  if (!Object.keys(layout.appearance).length) delete layout.appearance;
  scheduleSave();
}

export function movePanelToDisplay(key: string, displayId: string): void {
  const layout = store.panelLayouts[key];
  const display = store.displays.find((item) => item.id === displayId);
  if (!layout || !display) return;
  layout.x = Math.round(display.x + Math.max(16, (display.width - layout.width) / 2));
  layout.y = Math.round(display.y + Math.max(16, (display.height - layout.height) / 2));
  layout.monitorId = display.id;
  layout.monitorBounds = { x: display.x, y: display.y };
  layout.zIndex = nextZ();
  containSurface(layout, display);
  delete layout.displacedFrom;
  scheduleSave();
  scheduleHitRectSync();
}

export function arrangePanels(mode: "grid" | "cascade", displayId?: string): void {
  const display = store.displays.find((item) => item.id === displayId)
    ?? store.displays.find((item) => item.isPrimary)
    ?? { id: "virtual", x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const panels = getVisibleDesktopPanels().filter(panel => !store.panelLayouts[panel.key]?.locked);
  if (!panels.length) return;
  if (mode === "cascade") {
    panels.forEach((panel, index) => {
      const layout = store.panelLayouts[panel.key];
      if (!layout) return;
      const offset = (index % 9) * 28;
      Object.assign(layout, {
        x: Math.round(display.x + 18 + offset),
        y: Math.round(display.y + 18 + offset),
        monitorId: display.id,
        zIndex: nextZ(),
      });
    });
  } else {
    const gap = 14;
    const columns = Math.max(1, Math.floor((display.width - 36 + gap) / (PANEL_WIDTH + gap)));
    panels.forEach((panel, index) => {
      const layout = store.panelLayouts[panel.key];
      if (!layout) return;
      const row = Math.floor(index / columns);
      const column = index % columns;
      Object.assign(layout, {
        x: Math.round(display.x + 18 + column * (PANEL_WIDTH + gap)),
        y: Math.round(display.y + 18 + row * (Math.min(PANEL_HEIGHT, display.height - 36) + gap)),
        width: Math.min(PANEL_WIDTH, display.width - 36),
        height: Math.min(PANEL_HEIGHT, display.height - 36),
        monitorId: display.id,
        zIndex: nextZ(),
      });
    });
  }
  for (const panel of panels) { const layout=store.panelLayouts[panel.key]; if(layout){containSurface(layout,display);layout.monitorBounds={x:display.x,y:display.y};delete layout.displacedFrom;} }
  scheduleSave();
  scheduleHitRectSync();
  showStatus(mode === "grid" ? "面板已平铺" : "面板已层叠排列");
}

export async function addFolderMapping(name: string, path: string): Promise<boolean> {
  return runStateMutation(async () => {
    path = path.trim().replace(/[\\/]+$/, "");
    if (/^[a-z]:$/i.test(path)) path += "\\";
    try { await scanFolder(path); } catch (error) { showStatus(`无法添加映射：${error}`); return false; }
    if (store.customGroups.some(g => g.mappedPath?.toLowerCase() === path.toLowerCase())) {
      showStatus("这个文件夹已经映射"); return false;
    }
    store.customGroups.push({ id: `custom-${crypto.randomUUID().slice(0, 8)}`, name, dirName: path, mappedPath: path, sourceKind: "folder", dropPolicy: "none" });
    ensurePanels(); ensureLayouts(); await syncMappingWatches(); scheduleSave(); await rescan(); scheduleHitRectSync();
    showStatus("文件夹映射已添加，原文件位置未改变"); return true;
  });
}

export function updateGroupView(id: string, patch: Pick<Partial<CustomGroupDefinition>, "filter">): void {
  const group = store.customGroups.find(g => g.id === id);
  if (!group) return;
  Object.assign(group, patch); scheduleSave(); scheduleHitRectSync();
}

export function createTabGroup(name: string): string {
  const id = `tabs-${crypto.randomUUID().slice(0, 8)}`;
  store.tabGroups.push({ id, name: name.trim() || "文件组", groupIds: [], activeGroupId: "" });
  ensurePanels(); ensureLayouts();
  scheduleSave();
  return id;
}

export function renameTabGroup(id: string, name: string): void {
  const tabs = store.tabGroups.find((item) => item.id === id);
  if (!tabs || !name.trim()) return;
  tabs.name = name.trim();
  ensurePanels();
  scheduleSave();
}

export function removeTabGroup(id: string): void {
  store.tabGroups = store.tabGroups.filter((item) => item.id !== id);
  delete store.panelLayouts[`tabs:${id}`]; ensurePanels();
  scheduleSave();
  scheduleHitRectSync();
  showStatus("标签组已解散，收纳区恢复为独立面板");
}

export function assignGroupToTabs(groupId: string, tabGroupId: string | null): void {
  for (const tabs of store.tabGroups ?? []) {
    tabs.groupIds = tabs.groupIds.filter((id) => id !== groupId);
    if (tabs.activeGroupId === groupId) tabs.activeGroupId = tabs.groupIds[0] ?? "";
  }

  if (tabGroupId) {
    const tabs = store.tabGroups.find((item) => item.id === tabGroupId);
    if (tabs) {
      tabs.groupIds.push(groupId);
      if (!tabs.activeGroupId) tabs.activeGroupId = groupId;
    }
  }
  scheduleSave();
  scheduleHitRectSync();
}

export function setActiveTab(tabGroupId: string, groupId: string): void {
  const tabs = store.tabGroups.find((item) => item.id === tabGroupId);
  if (!tabs || (groupId !== "__all__" && !tabs.groupIds.includes(groupId))) return;
  tabs.activeGroupId = groupId;
  scheduleSave();
}

export function moveTab(tabGroupId: string, groupId: string, direction: -1 | 1): void {
  const tabs = store.tabGroups.find((item) => item.id === tabGroupId);
  if (!tabs) return;
  const from = tabs.groupIds.indexOf(groupId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= tabs.groupIds.length) return;
  [tabs.groupIds[from], tabs.groupIds[to]] = [tabs.groupIds[to], tabs.groupIds[from]];
  scheduleSave();
  scheduleHitRectSync();
}

export async function renameCustomGroup(id: string, name: string): Promise<void> {
  return runStateMutation(async () => {
    // An earlier write must finish before the directory transaction starts.
    await persistChain;
    const group = store.customGroups.find((candidate) => candidate.id === id);
    if (!group || group.name === name) return;
    if (group.mappedPath || group.sourceKind === "category") { group.name = name; ensurePanels(); scheduleSave(); return; }

    // 目录名跟着改：收纳区成员资格按路径判定，改完目录即完成迁移。
    const newDir = uniqueZoneDir(sanitizeZoneDir(name), id);
    if (newDir !== group.dirName) {
      const oldDir = group.dirName;
      try {
        await performFileChange(async () => {
          await renameZoneDir(oldDir, newDir);
          // Saves replace group objects. Apply the physical result to the live ID.
          const current = store.customGroups.find(candidate => candidate.id === id);
          if (current) { current.dirName = newDir; current.name = name; }
          else store.customGroups.push({ ...group, dirName: newDir, name });
          const paths = [
            ...store.entries.map(entry => entry.path), ...Object.values(store.launcherReferences).map(entry => entry.path),
            ...store.launcherIds.map(id => id.replace(/^(file:|app:shortcut:)/, "")),
            ...store.launchCollections.flatMap(collection => collection.entryIds.map(id => id.replace(/^(file:|app:shortcut:)/, ""))),
          ];
          for (const originalPath of paths) {
            const marker = `\\.nestra\\${oldDir}\\`;
            const path = originalPath.replace(/\//g, "\\");
            const idx = path.toLowerCase().lastIndexOf(marker.toLowerCase());
            if (idx < 0) continue;
            const from = path.slice(0, idx + marker.length - 1);
            const to = `${path.slice(0, idx)}\\.nestra\\${newDir}`;
            migratePathReferences(from, to);
          }
          scheduleSave();
        });
      } catch (error) {
        showStatus(`收纳区目录改名失败：${error}`);
        return;
      }
    }
    const current = store.customGroups.find(candidate => candidate.id === id);
    if (current) current.name = name;
    ensurePanels();
    scheduleSave();
    void rescan().catch(error => showStatus(`名称已更新，但文件列表刷新失败：${error}`));
  });
}

/** 删除收纳区：目录里的文件全部放回桌面（不丢数据），再删分组记录。 */
export async function removeCustomGroup(id: string): Promise<void> {
  return runStateMutation(async () => {
    let group = store.customGroups.find((candidate) => candidate.id === id);
    if (!group) return;
    if (
      !(await confirmDialog(
        group.sourceKind === "category" ? `移除「${group.name}」分类视图？原文件保持原位。` : group.mappedPath ? `移除「${group.name}」的映射？原文件夹及文件保持原位。` : `删除收纳区「${group.name}」？里面的文件会放回桌面。`,
      ))
    ) {
      return;
    }

    await persistChain;
    group = store.customGroups.find(candidate => candidate.id === id);
    if (!group) return;
    try {
      if (!group.mappedPath && group.sourceKind !== "category") {
        const dirName = group.dirName;
        const result = await performFileChange(async () => {
          const result = await dissolveZone(dirName);
          for (const move of result.moves) migratePathReferences(move.fromPath, move.newPath);
          // Successful moves are durable even if another file was locked.
          scheduleSave();
          return result;
        });
        if (result.error) {
          await rescan();
          showStatus(`部分文件已放回桌面，收纳区已保留：${result.error}`);
          return;
        }
      }
    } catch (error) {
      showStatus(`放回文件失败：${error}`);
      return;
    }

    store.customGroups = store.customGroups.filter((candidate) => candidate.id !== id);
    for (const tabs of store.tabGroups ?? []) {
      tabs.groupIds = tabs.groupIds.filter((groupId) => groupId !== id);
      if (tabs.activeGroupId === id) tabs.activeGroupId = tabs.groupIds[0] ?? "";
    }

    delete store.panelLayouts[zonePanelKey(id)];
    delete store.foldedItems[zonePanelKey(id)];
    delete store.itemOrders[id];

    ensurePanels();
    if (typeof syncMappingWatches === "function") await syncMappingWatches();
    scheduleSave();
    await rescan();
    showStatus(group.sourceKind === "category" ? "分类视图已移除，文件未改变" : group.mappedPath ? "映射已移除，原文件夹未改变" : "收纳区已删除，文件已放回桌面");
  });
}

export async function resetLayouts(): Promise<void> {
  return runStateMutation(async () => {
    if (!(await confirmDialog("把所有分区面板恢复到默认位置？"))) return;
    store.panelLayouts = {};
    ensureLayouts();
    ensureLauncherLayout();
    scheduleSave(); scheduleHitRectSync();
    showStatus("面板布局已重置");
  });
}

export function openSearch(query = ""): void {
  store.searchOpen = true;
  store.searchQuery = query;
  publishState();
  scheduleHitRectSync(0);
  // SearchPanel focuses its input; DesktopLayer coordinates native ownership.
}

export function closeSearch(): void {
  store.searchOpen = false;
  store.searchQuery = "";
  publishState();
  scheduleHitRectSync(0);
}

export async function setPaused(paused: boolean): Promise<void> {
  return runStateMutation(async () => {
    try {
      await setPausedNative(paused);
      store.paused = paused;
      publishState();
    } catch (error) {
      showStatus(`无法切换桌面层：${error}`);
    }
  });
}

export async function setHideNativeIcons(hide: boolean): Promise<void> {
  return runStateMutation(async () => {
    try {
      await setHideNativeIconsNative(hide);
      store.hideNativeIcons = hide;
      scheduleSave();
      showStatus(hide ? "已隐藏系统桌面图标" : "已显示系统桌面图标");
    } catch (error) {
      showStatus(`无法切换系统图标：${error}`);
    }
  });
}

export async function setStartWithWindows(enabled: boolean): Promise<void> {
  return runStateMutation(async () => {
    try {
      store.startWithWindows = await setStartWithWindowsNative(enabled);
      scheduleSave();
      showStatus(enabled ? "已设为开机启动" : "已取消开机启动");
    } catch (error) {
      showStatus(`无法修改开机启动：${error}`);
    }
  });
}

/** All windows use the shared accessible confirmation component. The desktop
 * variant additionally participates in the native keyboard/hit-region adapter. */
export function confirmDialog(message: string): Promise<boolean> {
  if (store.confirmRequest) store.confirmRequest.resolve(false);
  return new Promise((resolve) => {
    store.confirmRequest = {
      message,
      resolve: (ok) => {
        store.confirmRequest = null;
        publishState();
        resolve(ok);
      },
    };
    publishState();
  });
}

export async function renameDesktopItem(entry: DesktopEntry, name: string): Promise<void> {
  return runStateMutation(async () => {
    try {
      const newPath = await renameEntry(entry.path, name);
      // 条目 id = 前缀 + 路径：改名后 id 变了，折叠/排序/快捷启动
      // 状态必须迁到新 id，否则 rescan 时会被当成幽灵引用剪掉。
      migrateItemId(entry.id, remappedId(entry, newPath));
      await rescan();
      scheduleSave();
      showStatus("已重命名");
    } catch (error) {
      showStatus(`无法重命名：${error}`);
    }
  });
}

export async function recycleDesktopItem(entry: DesktopEntry): Promise<void> {
  return runStateMutation(async () => {
    if (entry.kind === "shell") {
      showStatus("系统入口不能删除");
      return;
    }
    if (!(await confirmDialog(`把「${entry.name}」移到回收站？`))) return;
    try {
      await recycleEntry(entry.path);
      await rescan();
      showStatus("已移到回收站");
    } catch (error) {
      showStatus(`无法删除：${error}`);
    }
  });
}

export function canManageEntry(entry: DesktopEntry): boolean {
  // canManage 由后端标记（个人桌面内才可改名/删除/收纳）；公共桌面项目只读展示。
  return entry.canManage;
}

/* ------------------------------------------------------------------ */
/* Widgets                                                             */
/* ------------------------------------------------------------------ */

export function createWidget(kind: "note" | "todo" | "clipboard" | "clock"): void {
  if (isExitFrozen()) return;
  const offset = store.widgets.length % 5;
  const widget: Widget = {
    id: crypto.randomUUID().replace(/-/g, ""),
    kind,
    title: kind === "note" ? "便签" : kind === "todo" ? "待办" : kind === "clock" ? "时钟" : "剪贴板",
    content: "",
    todos: [],
    createdAt: Date.now(),
    layout: {
      x: 120 + offset * 28,
      y: 90 + offset * 26,
      width: 310,
      height: kind === "note" ? 250 : kind === "todo" ? 320 : 360,
      zIndex: nextZ(),
      visible: true,
    },
  };

  store.widgets.push(widget);
  scheduleSave();
  showStatus(
    `${widget.title}已创建`,
  );
}

export async function removeWidget(id: string): Promise<void> {
  return runStateMutation(async () => {
    if (!(await confirmDialog("删除这个小组件？内容不会再保留。"))) return;
    store.widgets = store.widgets.filter((widget) => widget.id !== id);
    discardTodoDraft(id);
    scheduleSave();
  });
}

export function touchWidget(): void {
  scheduleSave();
}

export function createCategoryView(name: string, filter: CustomGroupDefinition["filter"]): void {
  store.customGroups.push({ id: `view-${crypto.randomUUID().slice(0, 8)}`, name, dirName: "", sourceKind: "category", dropPolicy: "none", filter });
  ensurePanels(); ensureLayouts(); scheduleSave(); scheduleHitRectSync();
}

export function layoutFor(key: string): PanelLayout | undefined {
  return key.startsWith("widget:") ? store.widgets.find(widget => `widget:${widget.id}` === key)?.layout : store.panelLayouts[key];
}

export function locateSurface(key: string): void {
  const layout = layoutFor(key);
  const primary = store.displays.find(display => display.isPrimary) ?? store.displays[0];
  if (!layout || !primary) return;
  const display = store.displays.find(item => item.id === layout.monitorId) ?? primary;
  Object.assign(layout, { visible: true, x: display.x + 28, y: display.y + 76,
    monitorId: display.id, monitorBounds: { x: display.x, y: display.y },
    width: Math.min(layout.width, display.width - 56), height: Math.min(layout.height, display.height - 104), zIndex: nextZ() });
  delete layout.displacedFrom;
  void setPaused(false); scheduleSave(); scheduleHitRectSync(); void emit('nestra://reveal-surface', key).catch(() => {}); showStatus("已显示并定位到显示器左上方");
}

/** Viewing preserves a usable saved position, including locked surfaces. */
export async function viewSurface(key: string): Promise<void> {
  return runStateMutation(async () => {
    const layout = layoutFor(key);
    if (!layout) { showStatus('桌面内容已不存在，请刷新后重试'); return; }
    if (desktopGestureActive() || fileMoves.busy) { showStatus('正在移动或调整内容，请完成后再查看桌面'); return; }
    if (!store.displays.length) { showStatus('暂时无法获取显示器信息，请刷新后重试'); return; }
    try {
      if (store.paused) { await setPausedNative(false); store.paused = false; }
      recoverSurface(layout, store.displays);
      layout.visible = true; layout.zIndex = nextZ();
      scheduleHitRectSync(); await flushState();
      await emit('nestra://reveal-surface', key);
      await getCurrentWebviewWindow().hide();
    } catch (error) { showStatus(`无法在桌面查看：${error}`); }
  });
}

export function setWidgetVisible(id: string, visible: boolean): void {
  const widget = store.widgets.find(item => item.id === id);
  if (widget) { widget.layout.visible = visible; scheduleSave(); scheduleHitRectSync(); }
}

export function pinEntry(entry: DesktopEntry): void {
  store.launcherReferences[entry.id] = { ...entry, canManage: false, iconPath: null };
  if (!store.launcherIds.includes(entry.id)) store.launcherIds.push(entry.id);
  scheduleSave(); showStatus("已固定到快捷启动，原项目不移动",
    store.panelLayouts[LAUNCHER_PANEL_KEY]?.visible === true ? null : "show-launcher");
}

/** Explicit opt-in: show the launcher at its saved location, recovering only
 * inaccessible layouts. Pinning a reference never changes visibility itself. */
export async function setLauncherVisible(visible: boolean): Promise<void> {
  return runStateMutation(async () => {
    if (visible && store.paused) {
      try { await setPausedNative(false); }
      catch (error) { showStatus(`无法显示快捷启动：${error}`); return; }
      store.paused = false;
    }
    ensureLauncherLayout();
    const layout = store.panelLayouts[LAUNCHER_PANEL_KEY]!;
    if (visible) { recoverSurface(layout, store.displays); layout.zIndex = nextZ(); }
    layout.visible = visible;
    scheduleSave(); scheduleHitRectSync();
    showStatus(visible ? "桌面启动栏已显示" : "桌面启动栏已隐藏，可在快捷启动页恢复");
  });
}

export function reorderLauncher(id: string, direction: -1 | 1): void {
  const index = store.launcherIds.indexOf(id), next = index + direction;
  if (index < 0 || next < 0 || next >= store.launcherIds.length) return;
  [store.launcherIds[index], store.launcherIds[next]] = [store.launcherIds[next]!, store.launcherIds[index]!];
  scheduleSave();
}

export function rebindLauncher(oldId: string, entry: DesktopEntry): void {
  migrateItemId(oldId, entry.id); store.launcherReferences[entry.id] = { ...entry, iconPath: null };
  store.launcherIds = [...new Set(store.launcherIds)]; scheduleSave(); showStatus("快捷入口已重新绑定");
}

export async function rebindMapping(id: string, path: string): Promise<void> {
  return runStateMutation(async () => {
    if (!store.customGroups.some(item => item.id === id && item.mappedPath)) return;
    await scanFolder(path);
    const group = store.customGroups.find(item => item.id === id && item.mappedPath);
    if (!group) throw new Error("该映射已被移除，请重新添加");
    if (store.customGroups.some(item => item.id !== id && item.mappedPath?.toLowerCase() === path.toLowerCase())) throw new Error("这个目录已存在映射");
    group.mappedPath = path; group.dirName = path;
    await syncMappingWatches(); await rescan(); scheduleSave();
  });
}

export function clearOperationResults(): void {
  operationResults.splice(0);
  publishState();
}

export async function launchEntries(entries: DesktopEntry[]): Promise<void> {
  operationResults.splice(0);
  publishState();
  for (const entry of entries) {
    try { await launchEntry(entry); operationResults.push({ name: entry.name, path: entry.path, ok: true, message: "已请求打开" }); }
    catch (error) { operationResults.push({ name: entry.name, path: entry.path, ok: false, message: String(error) }); }
    publishState();
    await new Promise(resolve => window.setTimeout(resolve, 120));
  }
  showStatus(`启动完成：${operationResults.filter(item => item.ok).length} 项成功，${operationResults.filter(item => !item.ok).length} 项失败`);
}

export async function executeOrganization(plan: { id: string; path: string; name: string }[], targetId: string): Promise<void> {
  return runStateMutation(async () => {
    if (fileMoves.busy) { showStatus('正在整理文件，请等待本次操作完成'); return; }
    operationResults.splice(0);
    const original = store.customGroups.find(group => group.id === targetId);
    const dirName = original?.dirName;
    const tasks = plan.map(item => ({ ...item, run: async () => {
      const entry = store.entries.find(entry => entry.id === item.id && entry.path === item.path);
      const target = store.customGroups.find(group => group.id === targetId);
      if (!entry || !target || sourceFor(target).kind !== 'zone' || target.dirName !== dirName) throw new Error('来源或目标发生变化，请重新预览');
      return moveItemOrThrow(item.id, targetId);
    } }));
    await trackFileMoves(original?.name ?? '已失效的目标', tasks, async report => {
      operationResults.splice(0, operationResults.length, ...report.items.map(item => ({name:item.name,path:item.path,ok:item.state==='success',message:item.state==='success'?'移动完成':item.error})));
      await rescan(); scheduleSave();
  });
  });
}

/** Reconnect an existing owned directory without creating, moving or renaming files. */
export async function registerStorageZone(dirName: string): Promise<void> {
  return runStateMutation(async () => {
    const zones = await listStorageZones();
    if (!zones.some(zone => zone.dirName === dirName)) { showStatus("收纳目录已不可访问，请刷新后重试"); return; }
    if (store.customGroups.some(group => !group.mappedPath && group.sourceKind !== "category" && group.dirName.toLowerCase() === dirName.toLowerCase())) return;
    store.customGroups.push({id:`custom-${crypto.randomUUID().slice(0,8)}`,name:dirName,dirName,sourceKind:"zone",dropPolicy:"move"});
    ensurePanels(); ensureLayouts(); scheduleSave(); await rescan(); scheduleHitRectSync(); showStatus("收纳目录已重新关联，文件保持原位");
  });
}
