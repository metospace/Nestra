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

export function desktopQuickAppearance(appearance?: Partial<import('@/types').AppearanceSettings>) {
  const corners = { square: '2px', compact: '8px', standard: '14px', rounded: '22px' };
  const materials = new Set(['clear', 'matte', 'glass', 'acrylic']);
  const opacity = appearance?.panelOpacity;
  return {
    dark: appearance?.theme !== 'light',
    radius: corners[appearance?.cornerStyle ?? 'rounded'] ?? corners.rounded,
    material: appearance?.surfaceMaterial && materials.has(appearance.surfaceMaterial) ? appearance.surfaceMaterial : 'glass',
    opacity: typeof opacity === 'number' && Number.isFinite(opacity) ? Math.min(1, Math.max(.2, opacity)) : .88,
  };
}

export function desktopQuickStep(index: number, total: number, columns: number, key: string): number {
  if (total < 1) return 0;
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const next = index + (key === 'ArrowDown' ? columns : -columns);
    return next < 0 || next >= total ? index : next;
  }
  return Math.min(total - 1, Math.max(0, index + (key === 'ArrowRight' ? 1 : -1)));
}
