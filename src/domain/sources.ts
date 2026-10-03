import type { CustomGroupDefinition, DesktopEntry } from "@/types";

export type FileSource =
  | { kind: "zone"; id: string; directory: string; writable: true }
  | { kind: "folder"; id: string; directory: string; writable: boolean }
  | { kind: "category"; id: string; writable: false };

/** Compatibility adapter keeps existing identities and real directory ownership. */
export function sourceFor(group: CustomGroupDefinition): FileSource {
  if (group.sourceKind === "category") return { kind: "category", id: group.id, writable: false };
  if (group.mappedPath) return { kind: "folder", id: group.id, directory: group.mappedPath, writable: group.dropPolicy !== "none" };
  return { kind: "zone", id: group.id, directory: group.dirName, writable: true };
}
export function sourceLabel(group: CustomGroupDefinition): string {
  return { zone: "收纳区", folder: "文件夹映射", category: "分类视图" }[sourceFor(group).kind];
}
export function dropDescription(group: CustomGroupDefinition): string {
  const source = sourceFor(group);
  return source.writable ? `移动到${source.kind === "zone" ? "收纳区" : "文件夹"}「${group.name}」`
    : source.kind === "category" ? "分类视图仅展示，不接收文件" : "文件夹浏览模式，不接收文件";
}
export function referenceFromId(id: string): DesktopEntry | null {
  const path = id.replace(/^(?:app:shortcut:|file:)/, "");
  if (path === id || !path) return null;
  return { id, path, name: path.split(/[\\/]/).pop() ?? path, target: path, kind: "file", launchKind: "filesystem",
    sourceLabel: "快捷引用", glyph: "引", isHidden: false, isFresh: false, isApplication: false, iconPath: null, canManage: false, zone: null };
}
