import type { PersistedState } from "@/types";
import { referenceFromId } from "./sources";

function object(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
/** Validate imports before they can replace the live configuration. */
export function validateConfiguration(input: unknown): asserts input is PersistedState {
  if (!object(input) || !object(input.panelLayouts) || !Array.isArray(input.customGroups) || !Array.isArray(input.widgets)) throw new Error("不是有效的 Nestra 配置");
  if ((input.schemaVersion ?? 1) > 2 || ![1, 2].includes(input.schemaVersion ?? 1)) throw new Error("配置版本不受支持，请使用对应版本的 Nestra");
  for (const key of Object.keys(input)) if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("配置包含无效字段");
  const forbidden = new Set(["__proto__", "constructor", "prototype"]);
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) { if (forbidden.has(key)) throw new Error("配置包含无效字段"); inspect(nested); }
  };
  inspect(input);
  if (input.launcherReferences !== undefined && !object(input.launcherReferences)) throw new Error("快捷引用格式无效");
  const seen = new Set<string>(), directories = new Set<string>();
  for (const group of input.customGroups) {
    if (!object(group) || typeof group.id !== "string" || !group.id || typeof group.name !== "string" || !group.name.trim() || seen.has(group.id)) throw new Error("文件来源缺少名称或身份重复");
    seen.add(group.id);
    if (group.sourceKind !== undefined && !["zone", "folder", "category"].includes(group.sourceKind)) throw new Error("来源类型无效");
    if (group.dropPolicy !== undefined && !["none", "move"].includes(group.dropPolicy)) throw new Error("拖入策略无效");
    if (group.filter !== undefined && !["all", "documents", "images", "applications", "folders", "media", "archives"].includes(group.filter)) throw new Error("来源筛选无效");
    if (group.dirName !== undefined && typeof group.dirName !== "string") throw new Error("收纳区目录名无效");
    if (group.sourceKind !== "category" && !group.mappedPath && group.dirName && /[<>:"/\\|?*\x00-\x1f]|^\.{1,2}$/.test(group.dirName)) throw new Error("收纳区目录名无效");
    if (group.sourceKind !== "category" && !group.mappedPath && group.dirName) {
      const directory = group.dirName.toLowerCase();
      if (directories.has(directory)) throw new Error("收纳区目录关联重复");
      directories.add(directory);
    }
    if (group.mappedPath && typeof group.mappedPath !== "string") throw new Error("映射路径无效");
  }
  const layoutValid = (layout: unknown) => {
    if (!object(layout) || !["x", "y", "width", "height", "zIndex"].every(key => typeof layout[key] === "number" && Number.isFinite(layout[key])) || layout.width <= 0 || layout.height <= 0) return false;
    for (const [key, min, max] of [["iconSize",24,64],["itemGap",0,24],["labelLines",1,3],["columns",2,8]] as const) if (layout[key] !== undefined && (!Number.isInteger(layout[key]) || layout[key] < min || layout[key] > max)) return false;
    if (layout.density !== undefined && !["compact","comfortable"].includes(layout.density)) return false;
    if (layout.viewMode !== undefined && !["grid","list"].includes(layout.viewMode)) return false;
    if (layout.appearance !== undefined) {
      const a = layout.appearance;
      if (!object(a)) return false;
      for (const [key, values] of Object.entries({surfaceMaterial:["clear","matte","glass","acrylic"],cornerStyle:["square","compact","standard","rounded"],borderStyle:["none","subtle","strong","shadow"]})) if (a[key] !== undefined && !values.includes(a[key])) return false;
      if (a.panelOpacity !== undefined && (typeof a.panelOpacity !== "number" || !Number.isFinite(a.panelOpacity) || a.panelOpacity < .45 || a.panelOpacity > 1)) return false;
      if (a.backgroundColor !== undefined && (typeof a.backgroundColor !== "string" || !/^#[0-9a-f]{6}$/i.test(a.backgroundColor))) return false;
    }
    return true;
  };
  for (const [key, layout] of Object.entries(input.panelLayouts)) {
    if (["__proto__", "constructor", "prototype"].includes(key) || !layoutValid(layout)) throw new Error("面板布局无效");
  }
  const widgetIds = new Set<string>();
  for (const widget of input.widgets) { if (!object(widget) || typeof widget.id !== "string" || typeof widget.title !== "string" || !["note", "todo", "clipboard", "clock"].includes(widget.kind) || typeof widget.content !== "string" || !Array.isArray(widget.todos) || !layoutValid(widget.layout)) throw new Error("小组件数据无效");
    if (widgetIds.has(widget.id) || widget.todos.some((todo: unknown) => !object(todo) || typeof todo.id !== "string" || typeof todo.text !== "string" || typeof todo.completed !== "boolean")) throw new Error("待办或小组件身份无效");
    widgetIds.add(widget.id);
  }
  for (const list of [input.tabGroups ?? [], input.launchCollections ?? []]) {
    if (!Array.isArray(list)) throw new Error("分组列表无效");
    const ids = new Set<string>();
    for (const item of list) if (!object(item) || typeof item.id !== "string" || typeof item.name !== "string" || ids.has(item.id) || !Array.isArray(item.groupIds ?? item.entryIds) || !(item.groupIds ?? item.entryIds).every((id: unknown) => typeof id === "string")) throw new Error("分组数据无效");
    for (const item of list) { if (ids.has(item.id)) throw new Error("分组身份重复"); ids.add(item.id); }
  }
  if (!Array.isArray(input.launcherIds) || !input.launcherIds.every((id: unknown) => typeof id === "string")) throw new Error("快捷引用无效");
  for (const refs of [input.foldedItems ?? {}, input.itemOrders ?? {}]) if (!object(refs) || Object.entries(refs).some(([key, list]) => ["__proto__", "constructor", "prototype"].includes(key) || !Array.isArray(list) || !list.every(id => typeof id === "string"))) throw new Error("项目排序或折叠数据无效");
  if (!object(input.appearance) || !["clear", "matte", "glass", "acrylic"].includes(input.appearance.surfaceMaterial) || !["square", "compact", "standard", "rounded"].includes(input.appearance.cornerStyle) || !["none", "subtle", "strong", "shadow"].includes(input.appearance.borderStyle) || typeof input.appearance.panelOpacity !== "number" || !Number.isFinite(input.appearance.panelOpacity) || input.appearance.panelOpacity < .45 || input.appearance.panelOpacity > 1) throw new Error("外观数据无效");
  for (const [key, ref] of Object.entries(input.launcherReferences ?? {})) if (["__proto__", "constructor", "prototype"].includes(key) || !object(ref) || ref.id !== key || typeof ref.path !== "string" || typeof ref.name !== "string" || typeof ref.target !== "string" || !["filesystem", "shell"].includes(ref.launchKind) || !["file", "folder", "shortcut", "url", "appref", "shell"].includes(ref.kind)) throw new Error("快捷引用目标无效");
}

export function migrateConfiguration(input: PersistedState): PersistedState {
  if ((input.schemaVersion ?? 1) > 2) throw new Error("配置来自更新版本，当前版本不会覆盖它");
  const next = structuredClone(input);
  next.schemaVersion = 2;
  next.panelLayouts ??= {};
  next.customGroups ??= [];
  next.widgets ??= [];
  next.launcherIds ??= [];
  next.foldedItems ??= {};
  next.itemOrders ??= {};
  next.launcherReferences ??= {};
  next.launchCollections ??= [];
  for (const id of next.launcherIds ?? []) {
    const ref = referenceFromId(id);
    if (ref && !next.launcherReferences[id]) next.launcherReferences[id] = ref;
  }
  for (const group of next.customGroups ?? []) {
    group.sourceKind ??= group.mappedPath ? "folder" : "zone";
    group.dropPolicy ??= group.sourceKind === "category" ? "none" : "move";
  }
  for (const tabs of next.tabGroups ?? []) {
    const key = `tabs:${tabs.id}`;
    const anchor = next.panelLayouts?.[`zone:${tabs.groupIds[0]}`];
    if (!next.panelLayouts[key] && anchor) next.panelLayouts[key] = { ...anchor };
  }
  return next;
}

/** Configuration restore is additive for sources, never a directory operation. */
export function prepareRestore(current: PersistedState, imported: PersistedState): PersistedState {
  validateConfiguration(imported);
  const next = migrateConfiguration(imported);
  // Old backups may refer to the same physical directory using a different ID.
  for (const group of next.customGroups) {
    if (group.mappedPath || group.sourceKind === "category") continue;
    const owner = current.customGroups.find(item => !item.mappedPath && item.sourceKind !== "category" && item.dirName.toLowerCase() === group.dirName?.toLowerCase());
    if (!owner || owner.id === group.id || next.customGroups.some(item => item !== group && item.id === owner.id)) continue;
    const oldId = group.id;
    group.id = owner.id;
    for (const tabs of next.tabGroups ?? []) { tabs.groupIds = tabs.groupIds.map(id => id === oldId ? owner.id : id); if (tabs.activeGroupId === oldId) tabs.activeGroupId = owner.id; }
    for (const map of [next.panelLayouts, next.foldedItems]) { const oldKey = `zone:${oldId}`, key = `zone:${owner.id}`; if (map[oldKey]) { (map as Record<string, unknown>)[key] = map[oldKey]; delete map[oldKey]; } }
    if (next.itemOrders[oldId]) { next.itemOrders[owner.id] = next.itemOrders[oldId]!; delete next.itemOrders[oldId]; }
  }
  for (const group of current.customGroups) {
    const found = next.customGroups.find(item => item.id === group.id);
    if (!found) next.customGroups.push(structuredClone(group));
    else if (!group.mappedPath && group.sourceKind !== "category") {
      // A configuration is not authority to rename/rebind an existing owned directory.
      Object.assign(found, { sourceKind: "zone", mappedPath: undefined, dirName: group.dirName, name: group.name });
    }
  }
  next.panelLayouts = { ...current.panelLayouts, ...next.panelLayouts };
  next.coexistMigrated = true;
  next.startWithWindows = current.startWithWindows; // Native autostart requires its explicit switch.
  return next;
}
