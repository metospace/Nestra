import type { DesktopEntry } from '@/types';
import { rankSearch } from './search';

export type DesktopQuickScope = 'all' | 'desktop' | 'zones' | 'mappings';
export interface QuickEntry {
  entry: DesktopEntry;
  scope: Exclude<DesktopQuickScope, 'all'>;
  source: string;
}

export function desktopQuickResults(items: QuickEntry[], scope: DesktopQuickScope, query: string): QuickEntry[] {
  const needle = query.trim().toLowerCase();
  const unique = new Map<string, QuickEntry>();
  for (const item of items) {
    const { entry, source } = item;
    if (entry.isHidden || (scope !== 'all' && scope !== item.scope)) continue;
    if (needle && ![entry.name, entry.path, source].some(value => value.toLowerCase().includes(needle))) continue;
    const key = entry.path.toLowerCase();
    if (!unique.has(key)) unique.set(key, item);
  }
  return rankSearch([...unique.values()].map(item => item.entry)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')), needle)
    .map(entry => unique.get(entry.path.toLowerCase())!);
}
