import type { CustomGroupDefinition, DesktopEntry } from '@/types';
import { rankSearch } from './search';
import { matchesFilter } from './organizer';

export type DesktopQuickScope = 'all' | 'desktop' | 'zones' | 'mappings';
export interface QuickEntry {
  entry: DesktopEntry;
  scope: Exclude<DesktopQuickScope, 'all'>;
  source: string;
  locationId?: string;
}

export function desktopQuickResults(items: QuickEntry[], scope: DesktopQuickScope, query: string): QuickEntry[] {
  const needle = query.trim().toLowerCase();
  const unique = new Map<string, QuickEntry>();
  for (const item of items) {
    const { entry, source } = item;
    if (entry.isHidden || (scope !== 'all' && scope !== item.scope)) continue;
    if (needle && ![entry.name, entry.path, source].some(value => value.toLowerCase().includes(needle))) continue;
    const key = quickPathKey(entry.path);
    if (!unique.has(key)) unique.set(key, item);
  }
  return rankSearch([...unique.values()].map(item => item.entry)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')), needle)
    .map(entry => unique.get(quickPathKey(entry.path))!);
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

export type QuickLocationKind = 'desktop' | 'zones' | 'mappings' | 'category';
export type QuickItemKind = 'folder' | 'file' | 'app' | 'system';
export interface QuickLocation {
  id: string;
  kind: QuickLocationKind;
  title: string;
  zone?: string;
  path?: string;
  physicalPath?: string;
  group?: CustomGroupDefinition;
}
export function quickPathKey(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}
export function quickItemKind(entry: DesktopEntry): QuickItemKind {
  if (entry.kind === 'folder') return 'folder';
  if (entry.kind === 'shell') return 'system';
  if (entry.isApplication || ['shortcut', 'url', 'appref'].includes(entry.kind)) return 'app';
  return 'file';
}
export function quickLocations(groups: CustomGroupDefinition[], entries: DesktopEntry[],
    storage: { dirName: string; path: string }[] = []): QuickLocation[] {
  const physical = new Map(storage.map(zone => [quickPathKey(zone.dirName), zone]));
  const places: QuickLocation[] = [{ id: 'desktop', kind: 'desktop', title: '桌面' }];
  const configured = new Set<string>();
  for (const group of groups) {
    const id = `group:${group.id}`;
    if (group.mappedPath) places.push({ id, kind: 'mappings', title: group.name, path: group.mappedPath, group });
    else if (group.sourceKind === 'category') places.push({ id, kind: 'category', title: group.name, group });
    else {
      configured.add(quickPathKey(group.dirName));
      places.push({ id, kind: 'zones', title: group.name, zone: group.dirName, physicalPath: physical.get(quickPathKey(group.dirName))?.path, group });
    }
  }
  // Keep physical folders that exist even when saved panel metadata is missing.
  const fallback = new Map<string, string>();
  for (const [key, zone] of physical) if (!configured.has(key)) fallback.set(key, zone.dirName);
  for (const entry of entries) {
    if (entry.zone && !configured.has(quickPathKey(entry.zone))) fallback.set(quickPathKey(entry.zone), entry.zone);
  }
  for (const [key, zone] of [...fallback].sort((a, b) => a[1].localeCompare(b[1], 'zh-Hans-CN'))) {
    places.push({ id: `unconfigured:${key}`, kind: 'zones', title: zone, zone, physicalPath: physical.get(key)?.path });
  }
  return places;
}
export function quickLocationEntries(place: QuickLocation, entries: DesktopEntry[]): DesktopEntry[] {
  if (place.kind === 'mappings') return [];
  if (place.kind === 'zones') return entries.filter(e => !e.isHidden && !!e.zone && quickPathKey(e.zone) === quickPathKey(place.zone!));
  return entries.filter(e => !e.isHidden && !e.zone && (place.kind !== 'category' || matchesFilter(e, place.group?.filter)));
}
export function orderQuickLocation(entries: DesktopEntry[], ids: string[]): DesktopEntry[] {
  const order = new Map(ids.map((id, index) => [id, index]));
  return [...entries].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity)
    || Number(b.kind === 'folder') - Number(a.kind === 'folder')
    || a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

/** Reserve capacity for explicit navigation when global search has slow shares. */
export function quickScanBudget(pending: number, direct: boolean): number {
  return Math.max(0, (direct ? 4 : 2) - pending);
}

export function quickResultIndex(results: QuickEntry[], activePath: string | null): number {
  return activePath === null ? -1 : results.findIndex(({ entry }) => quickPathKey(entry.path) === activePath);
}

export function quickEnterResult(results: QuickEntry[], activePath: string | null): QuickEntry | undefined {
  return results[activePath === null ? 0 : quickResultIndex(results, activePath)];
}
