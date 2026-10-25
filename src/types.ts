/** Shared domain types, mirroring the Rust scanner models and the persisted
 * state shape (camelCase over the IPC boundary). */

export type OrganizerMode = "files" | "applications" | "mixed";

export type SurfaceMaterial = "clear" | "matte" | "glass" | "acrylic";
export type CornerStyle = "square" | "compact" | "standard" | "rounded";
export type BorderStyle = "none" | "subtle" | "strong" | "shadow";

export interface DesktopEntry {
  id: string;
  name: string;
  path: string;
  target: string;
  kind: "file" | "folder" | "shortcut" | "url" | "appref" | "shell";
  launchKind: "filesystem" | "shell";
  sourceLabel: string;
  glyph: string;
  isHidden: boolean;
  isFresh: boolean;
  isApplication: boolean;
  iconPath: string | null;
  /** 位于个人桌面内才可重命名/删除/收纳（公共桌面项目只读展示）。 */
  canManage: boolean;
  /** 所在收纳区的目录名（Desktop\.nestra\<zone>\）；不在收纳区为 null。 */
  zone: string | null;
}

export interface EverythingSearchResponse {
  available: boolean;
  message: string;
  total: number;
  entries: DesktopEntry[];
}

export interface PanelLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  visible: boolean;
  /** One-time upgrade to a hidden launcher; later explicit visibility is retained. */
  launcherVisibilityMigrated?: boolean;
  viewMode?: "grid" | "list";
  columns?: number;
  density?: "compact" | "comfortable";
  iconSize?: number;
  itemGap?: number;
  labelLines?: number;
  /** Hide this organizer until the pointer hovers over its saved rectangle. */
  autoHide?: boolean;
  /** Delay after leaving the surface, in milliseconds. */
  autoHideDelay?: number;
  /** Missing fields inherit the global desktop appearance. */
  appearance?: Partial<Omit<AppearanceSettings, "theme">> & { backgroundColor?: string };
  monitorId?: string;
  /** Monitor origin when this placement was set (virtual desktop coordinates). */
  monitorBounds?: { x: number; y: number };
  locked?: boolean;
  /** Saved assignment while its monitor is disconnected. */
  displacedFrom?: { monitorId: string; x: number; y: number; width: number; height: number; monitorBounds?: { x: number; y: number } };
}

export interface DisplayInfo {
  id: string;
  legacyId?: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isPrimary: boolean;
}

export interface TabGroupDefinition {
  id: string;
  name: string;
  groupIds: string[];
  activeGroupId: string;
}

/** 收纳区 = 真实目录 Desktop\.nestra\<dirName> 的悬浮面板视图。 */
export interface CustomGroupDefinition {
  id: string;
  name: string;
  /** .nestra 下的目录名（改名时目录同步改名）。 */
  dirName: string;
  /** Existing directory view. Removing this group never dissolves its files. */
  mappedPath?: string;
  sourceKind?: "zone" | "folder" | "category";
  dropPolicy?: "none" | "move";
  /** Legacy migration fields from the pre-model tab implementation. */
  tabSet?: string;
  activeTab?: string;
  filter?: "all" | "documents" | "images" | "applications" | "folders" | "media" | "archives";
}

export interface AppearanceSettings {
  /** One-time visual upgrade; later theme/material choices remain user-owned. */
  styleVersion?: number;
  theme?: "light" | "dark";
  surfaceMaterial: SurfaceMaterial;
  cornerStyle: CornerStyle;
  borderStyle: BorderStyle;
  panelOpacity: number; // 0..1
}

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface ClipItem {
  id: string;
  text: string;
  createdLabel: string;
}

export type WidgetKind = "note" | "todo" | "clipboard" | "clock";

export interface LaunchCollection { id: string; name: string; entryIds: string[] }

export interface Widget {
  id: string;
  kind: WidgetKind;
  title: string;
  content: string;
  todos: TodoItem[];
  layout: PanelLayout;
  createdAt: number;
}

export interface PersistedState {
  schemaVersion?: number;
  launcherReferences?: Record<string, DesktopEntry>;
  launchCollections?: LaunchCollection[];
  clipboardEnabled?: boolean;
  panelLayouts: Record<string, PanelLayout>;
  customGroups: CustomGroupDefinition[];
  tabGroups?: TabGroupDefinition[];
  foldedItems: Record<string, string[]>;
  itemOrders: Record<string, string[]>;
  widgets: Widget[];
  appearance: AppearanceSettings;
  /** 快捷启动：纯引用语义，仅存条目 id，绝不移动真实文件。 */
  launcherIds: string[];
  startWithWindows?: boolean;
  hideNativeIcons?: boolean;
  /** 共存模型迁移标记：旧版默认隐藏原生图标，升级时复位一次后写 true。 */
  coexistMigrated?: boolean;
}

/** A panel rendered on the desktop layer. */
export interface Panel {
  key: string; // stable layout/state key, e.g. "zone:custom-a1b2c3"
  groupId: string; // custom group id, or "launcher"
  title: string;
  glyph: string;
  /** 收纳区永远是 mixed；字段保留给 Panel/折叠等既有代码路径。 */
  mode: OrganizerMode;
  isSystem: boolean;
}
