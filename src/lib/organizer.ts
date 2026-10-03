import type { CustomGroupDefinition, DesktopEntry } from "@/types";

export const fileFilters = [
  { value: "all", label: "全部" }, { value: "documents", label: "文档" },
  { value: "images", label: "图片" }, { value: "applications", label: "应用" },
  { value: "folders", label: "文件夹" }, { value: "media", label: "影音" },
  { value: "archives", label: "压缩包" },
] as const;
export function inFolder(path: string, folder: string): boolean {
  const normalize = (s: string) => s.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
  const p = normalize(path);
  return p.slice(0, p.lastIndexOf("\\")) === normalize(folder);
}
export function matchesFilter(entry: DesktopEntry, filter: CustomGroupDefinition["filter"]): boolean {
  if (!filter || filter === "all") return true;
  if (filter === "folders") return entry.kind === "folder";
  if (filter === "applications") return entry.isApplication || ["shortcut", "url", "appref"].includes(entry.kind);
  if (entry.kind !== "file") return false;
  const ext = entry.path.split(".").pop()?.toLowerCase() ?? "";
  const extensions = {
    documents: "pdf doc docx xls xlsx ppt pptx txt md csv rtf odt ods",
    images: "png jpg jpeg gif webp bmp svg ico heic avif tiff",
    media: "mp3 wav flac m4a aac ogg mp4 mov mkv avi webm wmv",
    archives: "zip rar 7z tar gz bz2 xz",
  };
  return extensions[filter].split(" ").includes(ext);
}
