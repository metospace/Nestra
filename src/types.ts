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
}

export interface PanelLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  visible: boolean;
}

export interface CustomGroupDefinition {
  id: string;
  name: string;
  mode: OrganizerMode;
  isFoldEnabled: boolean;
}

export interface AppearanceSettings {
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

export type WidgetKind = "note" | "todo";

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
  assignments: Record<string, string>;
  manualAssignments: Record<string, string>;
  ruleStates: Record<string, boolean>;
  panelLayouts: Record<string, PanelLayout>;
  customGroups: CustomGroupDefinition[];
  foldedItems: Record<string, string[]>;
  itemOrders: Record<string, string[]>;
  widgets: Widget[];
  appearance: AppearanceSettings;
  /** 快捷启动：仅存桌面条目 id 引用，绝不移动真实文件。 */
  launcherIds: string[];
}

/** A panel rendered on the desktop layer. */
export interface Panel {
  key: string; // stable layout/state key, e.g. "files:project"
  groupId: string; // classification bucket id or custom group id
  title: string;
  glyph: string;
  mode: OrganizerMode;
  isSystem: boolean;
}
