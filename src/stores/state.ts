/** Single reactive application store (Pinia-free by design, mirroring the
 * MainViewModel responsibilities without its bulk). */

import { computed, reactive, watch } from "vue";
import {
  RULES,
  classifyApplication,
  classifyFile,
} from "@/lib/classification";
import {
  loadPersistedState,
  resolveIconPairs,
  savePersistedState,
  scanDesktop,
  setHitRects,
} from "@/lib/tauri";
import { convertFileSrc } from "@tauri-apps/api/core";
import type {
  AppearanceSettings,
  CustomGroupDefinition,
  DesktopEntry,
  OrganizerMode,
  Panel,
  PanelLayout,
  PersistedState,
  Widget,
} from "@/types";

interface SystemGroupDef {
  groupId: string;
  title: string;
  glyph: string;
  mode: OrganizerMode;
}

const SYSTEM_GROUPS: SystemGroupDef[] = [
  // 文件分区
  { groupId: "project", title: "进行中", glyph: "码", mode: "files" },
  { groupId: "reference", title: "参考资料", glyph: "图", mode: "files" },
  { groupId: "archive", title: "待归档", glyph: "档", mode: "files" },
  { groupId: "quick", title: "快速访问", glyph: "链", mode: "files" },
  { groupId: "inbox", title: "收件箱", glyph: "文", mode: "files" },
  // 应用分类
  { groupId: "design", title: "设计工具", glyph: "设", mode: "applications" },
  { groupId: "development", title: "开发工具", glyph: "代", mode: "applications" },
  { groupId: "communication", title: "沟通协作", glyph: "聊", mode: "applications" },
  { groupId: "office", title: "办公工具", glyph: "办", mode: "applications" },
  { groupId: "media", title: "影音工具", glyph: "影", mode: "applications" },
  { groupId: "system", title: "系统工具", glyph: "系", mode: "applications" },
  { groupId: "network", title: "上网与云盘", glyph: "网", mode: "applications" },
  { groupId: "uncategorized", title: "其他应用", glyph: "应", mode: "applications" },
];

const DEFAULT_APPEARANCE: AppearanceSettings = {
  surfaceMaterial: "clear",
  cornerStyle: "standard",
  borderStyle: "subtle",
  panelOpacity: 0.95,
};

const PANEL_WIDTH = 336;
const PANEL_HEIGHT = 432;
const PANEL_GAP = 14;
const SCREEN_MARGIN = 18;

function defaultRuleStates(): Record<string, boolean> {
  const states: Record<string, boolean> = {};
  for (const rule of RULES) {
    states[rule.id] = true;
  }
  return states;
}

function panelKey(mode: OrganizerMode, groupId: string): string {
  return `${mode}:${groupId}`;
}

let saveTimer: number | undefined;
let zCounter = 10;

export const store = reactive({
  ready: false,
  entries: [] as DesktopEntry[],
  panels: [] as Panel[],
  assignments: {} as Record<string, string>,
  manualAssignments: {} as Record<string, string>,
  ruleStates: defaultRuleStates(),
  panelLayouts: {} as Record<string, PanelLayout>,
  customGroups: [] as CustomGroupDefinition[],
  foldedItems: {} as Record<string, string[]>,
  itemOrders: {} as Record<string, string[]>,
  widgets: [] as Widget[],
  appearance: { ...DEFAULT_APPEARANCE },
  statusMessage: "",
  selectedItemId: "",
});

/** 图标内存缓存：entry.path → asset URL。快照先无图标渲染，这里异步补齐
 * （两段式加载，见 AGENTS.md）。失败路径记录为 null，避免反复重试。 */
export const iconUrls = reactive(new Map<string, string>());

let iconFillTimer: number | undefined;
let iconFillBusy = false;

function scheduleIconFill(): void {
  window.clearTimeout(iconFillTimer);
  iconFillTimer = window.setTimeout(() => void fillMissingIcons(), 120);
}

async function fillMissingIcons(): Promise<void> {
  if (iconFillBusy) {
    // 上一批还在解析：这批结束后 watch 会再触发一轮。
    scheduleIconFill();
    return;
  }

  const missing = store.entries.filter(
    (entry) => !iconUrls.has(entry.path) && !iconUrls.has(`null:${entry.path}`),
  );
  if (missing.length === 0) return;

  iconFillBusy = true;
  try {
    // 标记为进行中，防止并发批次重复请求同一集合。
    for (const entry of missing) iconUrls.set(entry.path, "");

    const pairs: [string, string][] = missing.map((entry) => [entry.path, entry.target]);
    const resolved = await resolveIconPairs(pairs);

    for (const [path, png] of Object.entries(resolved)) {
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
    // 整批失败：回滚占位，稍后重试一次。
    for (const entry of missing) {
      if (iconUrls.get(entry.path) === "") iconUrls.delete(entry.path);
    }
    scheduleIconFill();
  } finally {
    iconFillBusy = false;
  }
}

/** 组件取图标用：命中缓存返回 URL，否则 null（渲染字形徽章）。 */
export function cachedIconUrl(entryPath: string): string | null {
  const url = iconUrls.get(entryPath);
  return url || null;
}

// 拖拽/缩放直接改 reactive layout，深度监听兜底持久化（debounce 内置），
// 同时把可见面板的物理矩形同步给 Rust 做命中测试（空白区点击穿透）。
watch(
  () => [store.panelLayouts, store.widgets],
  () => {
    scheduleSave();
    scheduleHitRectSync();
  },
  { deep: true },
);

/* ------------------------------------------------------------------ */
/* Derived                                                             */
/* ------------------------------------------------------------------ */

/** Resolved group for an entry: manual override wins over auto rules. */
function resolveGroup(entry: DesktopEntry): string | null {
  const manual = store.manualAssignments[entry.id];
  if (manual && store.panels.some((p) => p.groupId === manual)) {
    return manual;
  }
  return null;
}

export const itemsByPanel = computed<Record<string, DesktopEntry[]>>(() => {
  const result: Record<string, DesktopEntry[]> = {};

  for (const panel of store.panels) {
    let pool: DesktopEntry[];

    if (panel.isSystem) {
      pool = store.entries.filter((entry) => {
        const inRightPool = panel.mode === "applications"
          ? entry.isApplication
          : !entry.isApplication;
        if (!inRightPool || entry.isHidden) return false;

        const manual = resolveGroup(entry);
        if (manual) return manual === panel.groupId;
        return panel.mode === "applications"
          ? classifyApplication(entry, isRuleEnabled) === panel.groupId
          : classifyFile(entry, isRuleEnabled) === panel.groupId;
      });
    } else {
      pool = store.entries.filter(
        (entry) =>
          !entry.isHidden &&
          resolveGroup(entry) === panel.groupId &&
          (panel.mode === "mixed" ||
            (panel.mode === "applications"
              ? entry.isApplication
              : !entry.isApplication)),
      );
    }

    result[panel.key] = sortForPanel(panel.groupId, pool);
  }

  return result;
});

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

function isRuleEnabled(ruleId: string): boolean {
  return store.ruleStates[ruleId] !== false;
}

export function foldedIds(panelKeyString: string): Set<string> {
  return new Set(store.foldedItems[panelKeyString] ?? []);
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export async function initialize(): Promise<void> {
  await restoreState();
  await rescan();
  ensurePanels();
  ensureLayouts();
  applyAppearanceToCss();
  scheduleHitRectSync();
  store.ready = true;
}

async function restoreState(): Promise<void> {
  try {
    const persisted = await loadPersistedState<PersistedState>();
    if (!persisted) return;

    store.assignments = persisted.assignments ?? {};
    store.manualAssignments = persisted.manualAssignments ?? {};
    store.ruleStates = { ...defaultRuleStates(), ...(persisted.ruleStates ?? {}) };
    store.panelLayouts = persisted.panelLayouts ?? {};
    store.customGroups = persisted.customGroups ?? [];
    store.foldedItems = persisted.foldedItems ?? {};
    store.itemOrders = persisted.itemOrders ?? {};
    store.widgets = persisted.widgets ?? [];
    store.appearance = { ...DEFAULT_APPEARANCE, ...(persisted.appearance ?? {}) };
  } catch {
    // Corrupt state falls back to defaults, exactly like the WPF StateStore.
  }
}

export async function rescan(): Promise<void> {
  store.entries = await scanDesktop();
  pruneGhostReferences();
  ensurePanels();
  // 快照已上屏，异步补齐缺失图标（不阻塞面板渲染）。
  scheduleIconFill();
}

/** 清理指向已不存在条目的记录，避免面板里出现幽灵项目。 */
function pruneGhostReferences(): void {
  const alive = new Set(store.entries.map((entry) => entry.id));

  for (const itemId of Object.keys(store.manualAssignments)) {
    if (!alive.has(itemId)) delete store.manualAssignments[itemId];
  }

  for (const [key, list] of Object.entries(store.foldedItems)) {
    const filtered = list.filter((id) => alive.has(id));
    if (filtered.length !== list.length) store.foldedItems[key] = filtered;
  }

  for (const [groupId, order] of Object.entries(store.itemOrders)) {
    const filtered = order.filter((id) => alive.has(id));
    if (filtered.length !== order.length) store.itemOrders[groupId] = filtered;
  }
}

function ensurePanels(): void {
  const panels: Panel[] = [];

  for (const def of SYSTEM_GROUPS) {
    panels.push({
      key: panelKey(def.mode, def.groupId),
      groupId: def.groupId,
      title: def.title,
      glyph: def.glyph,
      mode: def.mode,
      isSystem: true,
    });
  }

  for (const group of store.customGroups) {
    panels.push({
      key: panelKey(group.mode, group.id),
      groupId: group.id,
      title: group.name,
      glyph: "组",
      mode: group.mode,
      isSystem: false,
    });
  }

  store.panels = panels;
}

/** First-run placement: flow the panels across the screen like the old
 * BalancedWrapPanel did. Existing layouts are never touched. */
function ensureLayouts(): void {
  const screenWidth = Math.max(window.screen.width, window.innerWidth);
  const columns = Math.max(
    1,
    Math.floor((screenWidth - SCREEN_MARGIN * 2) / (PANEL_WIDTH + PANEL_GAP)),
  );

  store.panels.forEach((panel, index) => {
    if (store.panelLayouts[panel.key]) return;

    const row = Math.floor(index / columns);
    const column = index % columns;
    store.panelLayouts[panel.key] = {
      x: SCREEN_MARGIN + column * (PANEL_WIDTH + PANEL_GAP),
      y: SCREEN_MARGIN + row * (PANEL_HEIGHT / 1.6),
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      zIndex: ++zCounter,
      visible: true,
    };
  });

  scheduleSave();
}

export function applyAppearanceToCss(): void {
  const root = document.documentElement;
  root.style.setProperty("--panel-opacity", String(store.appearance.panelOpacity));
  root.dataset.material = store.appearance.surfaceMaterial;

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

/** 把可见面板/小组件的矩形（换算成物理像素）推给 Rust 命中测试。 */
export function scheduleHitRectSync(): void {
  if (hitRectTimer !== undefined) {
    window.clearTimeout(hitRectTimer);
  }

  hitRectTimer = window.setTimeout(async () => {
    hitRectTimer = undefined;

    const dpr = window.devicePixelRatio || 1;
    const rects: { x: number; y: number; width: number; height: number }[] = [];

    for (const layout of Object.values(store.panelLayouts)) {
      if (layout.visible === false) continue;
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

    try {
      await setHitRects(rects);
    } catch {
      // 命中同步失败只影响穿透体验，不提示。
    }
  }, 120);
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

export function scheduleSave(): void {
  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer);
  }

  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    const snapshot: PersistedState = {
      assignments: store.assignments,
      manualAssignments: store.manualAssignments,
      ruleStates: store.ruleStates,
      panelLayouts: store.panelLayouts,
      customGroups: store.customGroups,
      foldedItems: store.foldedItems,
      itemOrders: store.itemOrders,
      widgets: store.widgets,
      appearance: store.appearance,
    };

    // 串行化写入：连续快速操作时禁止并发 invoke save_state，
    // 否则后一次保存会覆盖前一次（见 AGENTS.md）。
    persistChain = persistChain
      .then(() => savePersistedState(snapshot))
      .catch((error) => showStatus(`状态保存失败：${error}`));
  }, 600);
}

/** 所有 savePersistedState 都串在这条链上，保证任意时刻只有一个写入。 */
let persistChain: Promise<void> = Promise.resolve();

let statusTimer: number | undefined;
export function showStatus(message: string): void {
  store.statusMessage = message;
  if (statusTimer !== undefined) window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    store.statusMessage = "";
    statusTimer = undefined;
  }, 3000);
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
  showStatus(visible ? "分区已恢复显示" : "分区已隐藏，可在管理器恢复");
}

export function bringToFront(key: string): void {
  const layout = store.panelLayouts[key];
  if (!layout) return;
  layout.zIndex = ++zCounter;
  scheduleSave();
}

export function moveItem(itemId: string, targetGroupId: string): void {
  const entry = store.entries.find((item) => item.id === itemId);
  if (!entry) return;

  const panel = store.panels.find(
    (candidate) => candidate.groupId === targetGroupId,
  );
  if (!panel) return;

  const modeOk =
    panel.mode === "mixed" ||
    (panel.mode === "applications" ? entry.isApplication : !entry.isApplication);
  if (panel.isSystem) {
    // 系统分区的归类由规则驱动；仅允许模式匹配的手动覆盖。
    if (!modeOk) return;
    store.manualAssignments[itemId] = targetGroupId;
  } else {
    if (!modeOk) return;
    store.manualAssignments[itemId] = targetGroupId;
  }

  scheduleSave();
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

export function setRuleEnabled(ruleId: string, enabled: boolean): void {
  store.ruleStates[ruleId] = enabled;
  scheduleSave();
}

export function setAppearance(patch: Partial<AppearanceSettings>): void {
  Object.assign(store.appearance, patch);
  applyAppearanceToCss();
  scheduleSave();
}

export function addCustomGroup(name: string, mode: OrganizerMode): void {
  const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
  store.customGroups.push({ id, name, mode, isFoldEnabled: true });
  ensurePanels();
  ensureLayouts();
  scheduleSave();
  showStatus(`已创建分组「${name}」`);
}

export function renameCustomGroup(id: string, name: string): void {
  const group = store.customGroups.find((candidate) => candidate.id === id);
  if (group) {
    group.name = name;
    ensurePanels();
    scheduleSave();
  }
}

export function removeCustomGroup(id: string): void {
  store.customGroups = store.customGroups.filter((group) => group.id !== id);

  // 手动指向该分区的项目回到自动分类。
  for (const [itemId, groupId] of Object.entries(store.manualAssignments)) {
    if (groupId === id) delete store.manualAssignments[itemId];
  }

  ensurePanels();
  scheduleSave();
  showStatus("分组已删除，项目回到自动分类");
}

export function resetLayouts(): void {
  store.panelLayouts = {};
  ensureLayouts();
  showStatus("面板布局已重置");
}

/* ------------------------------------------------------------------ */
/* Widgets                                                             */
/* ------------------------------------------------------------------ */

export function createWidget(kind: "note" | "todo"): void {
  const offset = store.widgets.length % 5;
  const widget: Widget = {
    id: crypto.randomUUID().replace(/-/g, ""),
    kind,
    title: kind === "note" ? "便签" : "待办",
    content: "",
    todos: [],
    createdAt: Date.now(),
    layout: {
      x: 120 + offset * 28,
      y: 90 + offset * 26,
      width: 310,
      height: kind === "note" ? 250 : 320,
      zIndex: 1000 + offset,
      visible: true,
    },
  };

  store.widgets.push(widget);
  scheduleSave();
  showStatus(kind === "note" ? "便签已创建" : "待办清单已创建");
}

export function removeWidget(id: string): void {
  store.widgets = store.widgets.filter((widget) => widget.id !== id);
  scheduleSave();
}

export function touchWidget(): void {
  scheduleSave();
}
