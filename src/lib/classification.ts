/** Classification rules ported 1:1 from the WPF ClassificationService. */

import type { DesktopEntry, OrganizerMode } from "@/types";

export interface RuleDescriptor {
  id: string;
  mode: OrganizerMode;
  glyph: string;
  title: string;
  detail: string;
}

const IMAGE_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ai", ".psd", ".fig",
];

const ARCHIVE_KEYWORDS = ["发票", "合同", "报销", "invoice", "contract", "receipt"];

const PROJECT_EXTENSIONS = [
  ".md", ".cs", ".js", ".ts", ".tsx", ".vue", ".svelte", ".json", ".yaml", ".yml",
];

const DESIGN_KEYWORDS = [
  "figma", "adobe", "photoshop", "illustrator", "indesign", "sketch", "blender",
  "canva", "affinity",
];

const DEVELOPMENT_KEYWORDS = [
  "visual studio", "vscode", "code", "terminal", "powershell", "github", "git",
  "jetbrains", "docker", "postman", "python", "node",
];

const COMMUNICATION_KEYWORDS = [
  "微信", "wechat", "qq", "飞书", "lark", "钉钉", "dingtalk", "teams", "slack",
  "zoom", "会议", "meeting", "telegram",
];

const OFFICE_KEYWORDS = [
  "word", "excel", "powerpoint", "outlook", "office", "wps", "notion", "obsidian",
  "onenote",
];

const MEDIA_KEYWORDS = [
  "music", "media", "player", "spotify", "vlc", "potplayer", "网易云", "音乐",
  "视频", "剪映",
];

const SYSTEM_KEYWORDS = [
  "settings", "control panel", "explorer", "calculator", "store", "设置",
  "控制面板", "资源管理器", "计算器",
];

const NETWORK_KEYWORDS = [
  "chrome", "edge", "firefox", "browser", "浏览器",
  "网盘", "onedrive", "dropbox", "cloud drive",
  "xftp", "xshell", "clash", "todesk", "向日葵", "远程", "remote", "vpn",
];

export const RULES: RuleDescriptor[] = [
  { id: "file-archive", mode: "files", glyph: "档", title: "名称包含发票、合同或报销", detail: "进入“待归档”分区" },
  { id: "file-image", mode: "files", glyph: "图", title: "图片与设计源文件", detail: "进入“参考资料”分区" },
  { id: "file-project", mode: "files", glyph: "项", title: "代码、Markdown 与配置文件", detail: "进入“进行中”分区" },
  { id: "app-design", mode: "applications", glyph: "设", title: "设计软件名称或发布者词典", detail: "进入“设计工具”分类" },
  { id: "app-development", mode: "applications", glyph: "代", title: "开发、终端与版本控制词典", detail: "进入“开发工具”分类" },
  { id: "app-communication", mode: "applications", glyph: "聊", title: "聊天与会议软件词典", detail: "进入“沟通协作”分类" },
  { id: "app-office", mode: "applications", glyph: "办", title: "文档、表格与知识管理词典", detail: "进入“办公工具”分类" },
  { id: "app-media", mode: "applications", glyph: "影", title: "音乐、视频与播放器词典", detail: "进入“影音工具”分类" },
  { id: "app-system", mode: "applications", glyph: "系", title: "Windows 系统工具词典", detail: "进入“系统工具”分类" },
  { id: "app-network", mode: "applications", glyph: "网", title: "浏览器、网盘与远程工具词典", detail: "进入“上网与云盘”分类" },
];

function containsAny(source: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => source.includes(keyword));
}

/** File-bucket classification; mirrors ClassifyFile. */
export function classifyFile(
  entry: DesktopEntry,
  isEnabled: (ruleId: string) => boolean,
): string {
  const name = entry.name.toLowerCase();
  const dot = entry.name.lastIndexOf(".");
  const extension = dot >= 0 ? entry.name.slice(dot).toLowerCase() : "";

  if (entry.kind === "shell") {
    return "quick";
  }

  if (isEnabled("file-archive") && containsAny(name, ARCHIVE_KEYWORDS)) {
    return "archive";
  }

  if (isEnabled("file-image") && IMAGE_EXTENSIONS.includes(extension)) {
    return "reference";
  }

  if (isEnabled("file-project") && PROJECT_EXTENSIONS.includes(extension)) {
    return "project";
  }

  if (entry.kind === "folder" || extension === ".lnk" || extension === ".url") {
    return "quick";
  }

  return "inbox";
}

/** Application-bucket classification; mirrors ClassifyApplication. */
export function classifyApplication(
  entry: DesktopEntry,
  isEnabled: (ruleId: string) => boolean,
): string {
  const searchable =
    `${entry.name} ${entry.sourceLabel} ${entry.target}`.toLowerCase();

  if (isEnabled("app-design") && containsAny(searchable, DESIGN_KEYWORDS)) return "design";
  if (isEnabled("app-development") && containsAny(searchable, DEVELOPMENT_KEYWORDS)) return "development";
  if (isEnabled("app-communication") && containsAny(searchable, COMMUNICATION_KEYWORDS)) return "communication";
  if (isEnabled("app-office") && containsAny(searchable, OFFICE_KEYWORDS)) return "office";
  if (isEnabled("app-media") && containsAny(searchable, MEDIA_KEYWORDS)) return "media";
  if (isEnabled("app-system") && containsAny(searchable, SYSTEM_KEYWORDS)) return "system";
  if (isEnabled("app-network") && containsAny(searchable, NETWORK_KEYWORDS)) return "network";

  return "uncategorized";
}
