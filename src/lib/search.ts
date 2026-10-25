import type { DesktopEntry, EverythingSearchResponse } from "@/types";

export type SearchScope = "all" | "everything" | "desktop" | "zones" | "mappings" | "applications";
export interface SearchResult { entries: DesktopEntry[]; message: string; indexAvailable?: boolean }

interface SearchSources {
  local: DesktopEntry[];
  mappedPaths: string[];
  everything: (query: string, limit: number) => Promise<EverythingSearchResponse>;
  mapped: (paths: string[], query: string, limit: number) => Promise<DesktopEntry[]>;
  recent?: string[];
}

/** Exact names beat prefixes and path matches; recent opens only break ties. */
export function rankSearch(entries: DesktopEntry[], query: string, recent: string[] = []): DesktopEntry[] {
  const needle=query.trim().toLowerCase();
  const recentRank=new Map(recent.map((path,index)=>[path.toLowerCase(),index]));
  const score=(entry:DesktopEntry)=>{const name=entry.name.toLowerCase();return !needle?0:name===needle?0:name.replace(/\.[^.]+$/,'')===needle?1:name.startsWith(needle)?2:name.includes(needle)?3:4;};
  const recency=(entry:DesktopEntry)=>recentRank.get(entry.path.toLowerCase())??recentRank.get(entry.target?.toLowerCase())??Number.MAX_SAFE_INTEGER;
  return [...entries].sort((a,b)=>score(a)-score(b)||recency(a)-recency(b));
}

/** Keep scope and provider failures explicit; indexed results never enter the
 * authoritative desktop store or its persisted file references. */
export async function runSearch(query: string, scope: SearchScope, sources: SearchSources, onPartial?: (result: SearchResult) => void): Promise<SearchResult> {
  onPartial?.({ entries: scope === "everything" ? [] : rankSearch(sources.local,query,sources.recent).slice(0,500), message: "已显示本地结果 · 正在查询其他来源…" });
  const useIndex = scope === "all" || scope === "everything";
  const useMapped = (scope === "all" || scope === "mappings") && query.trim().length >= 2 && sources.mappedPaths.length > 0;
  const [index, mapped] = await Promise.all([
    useIndex ? sources.everything(query, 200).catch(() => ({ available: false, message: "Everything 连接失败", total: 0, entries: [] })) : null,
    useMapped ? sources.mapped(sources.mappedPaths, query, 200).then(entries => ({ entries, failed: false }))
      .catch(() => ({ entries: [], failed: true })) : null,
  ]);
  const unique = new Map<string, DesktopEntry>();
  for (const entry of [...(scope === "everything" ? [] : sources.local), ...(mapped?.entries ?? []), ...(index?.entries ?? [])]) {
    const key = entry.path.toLowerCase();
    if (!unique.has(key)) unique.set(key, entry);
  }
  const label = { desktop: "桌面项目", zones: "收纳区项目", mappings: "已映射文件夹 · 子目录最多 12 层 / 20,000 个项目 · 最多 200 个匹配", applications: "开始菜单与已安装应用目录" };
  let message = useIndex ? index!.available
    ? index!.message + (index!.total > 200 ? ` · 索引匹配 ${index!.total} 项，加载前 200 项；缩小范围可继续查找` : "")
    : index!.message + (scope === "all" ? " · 当前搜索桌面、收纳区、映射文件夹和已安装应用" : " · 请重试查询或检查 Everything 索引状态")
    : label[scope as keyof typeof label];
  if (mapped?.failed) message += " · 映射目录查询失败，仅显示已加载项目";
  if(unique.size>500)message+=' · 合并结果最多加载 500 项，请缩小搜索范围';
  return { entries: rankSearch([...unique.values()],query,sources.recent).slice(0, scope === "everything" ? 200 : 500), message, ...(useIndex ? { indexAvailable: index!.available } : {}) };
}
