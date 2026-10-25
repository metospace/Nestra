import { useState } from 'react';
import { EyeOff, Layers, Link, Pin, Play, Plus, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { startMove } from '@/composables/useSurfaceDrag';
import { useItemDrop } from '@/composables/useItemDrag';
import { surfaceAppearance } from '@/domain/presentation';
import { showManager } from '@/lib/tauri';
import { bringToFront, confirmDialog, getLauncherEntries, LAUNCHER_PANEL_KEY, launchAll, launchEntries, openSurfaceSettings, setPanelVisible, toggleLauncher, updateLayout, useNestra } from '@/stores/state';
import ItemTile from './ItemTile';
import { IconButton, ResizeHandles, surfaceStyle } from './SurfaceChrome';

export default function LauncherPanel() {
  const state = useNestra(), layout = state.panelLayouts[LAUNCHER_PANEL_KEY], items = getLauncherEntries();
  const [busy, setBusy] = useState(false);
  const drop = useItemDrop('launcher-zone', { groupId: 'launcher', mode: 'reference', label: '添加到快捷启动（仅引用，原文件不移动）' });
  if (!layout) return null;
  const appearance = surfaceAppearance(layout, state.appearance);
  async function launchCollection(ids: string[]) {
    if (busy) return; const entries = items.filter(entry => ids.includes(entry.id));
    if (entries.length > 1 && !await confirmDialog(`启动集合中的 ${entries.length} 个入口？`)) return;
    setBusy(true); try { await launchEntries(entries); } finally { setBusy(false); }
  }
  async function all() {
    if (busy || (items.length > 1 && !await confirmDialog(`启动这 ${items.length} 个项目？`))) return;
    setBusy(true); try { await launchAll(); } finally { setBusy(false); }
  }
  return <section ref={drop.setNodeRef} className={`nestra-panel is-draggable ${drop.isOver ? 'is-drop-target' : ''}`} data-group-id="launcher" data-drop-label="添加到快捷启动（仅引用，原文件不移动）" data-drop-mode="reference" data-material={appearance.surfaceMaterial} data-border={appearance.borderStyle} style={surfaceStyle(layout, state.appearance)} onPointerDown={() => bringToFront(LAUNCHER_PANEL_KEY)}>
    <header className="panel-header organizer-heading select-none" onPointerDown={event => { if ((event.target as HTMLElement).closest('button')) return; bringToFront(LAUNCHER_PANEL_KEY); startMove(event as unknown as PointerEvent, layout, { minWidth: 240, minHeight: 160, commit: value => updateLayout(LAUNCHER_PANEL_KEY, value) }); }}>
      <div className="organizer-title"><h2>快捷启动</h2><small>{items.length} 个入口</small></div>
      <IconButton aria-label="管理快捷入口" title="管理快捷入口" onClick={() => { void showManager('launcher'); }}><Plus /></IconButton>
      <IconButton aria-label="快捷启动样式与布局" title="快捷启动样式与布局" data-surface-settings-trigger onClick={() => openSurfaceSettings(LAUNCHER_PANEL_KEY)}><SlidersHorizontal /></IconButton>
      <IconButton aria-label="隐藏快捷启动" title="隐藏快捷启动（控制中心可恢复）" onClick={() => setPanelVisible(LAUNCHER_PANEL_KEY, false)}><EyeOff /></IconButton>
    </header>
    {state.launchCollections.length > 0 && <div className="launcher-collections">{state.launchCollections.map(collection => <Button key={collection.id} variant="outline" size="sm" disabled={busy} title={`打开集合：${collection.name}`} onClick={() => void launchCollection(collection.entryIds)}><Layers size={13} />{collection.name}</Button>)}</div>}
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <div className={`surface-item-grid launcher-grid ${layout.viewMode === 'list' ? 'is-list' : ''}`} style={{ gridTemplateColumns: layout.viewMode === 'list' ? '1fr' : `repeat(${layout.columns ?? 4}, minmax(0, 1fr))` }}>{items.map(entry => <div key={entry.id} className={`launcher-entry ${layout.viewMode === 'list' ? 'is-list' : ''}`}><ItemTile entry={entry} panelKey={LAUNCHER_PANEL_KEY} list={layout.viewMode === 'list'} singleClick /><Button variant="ghost" size="icon" className="launcher-remove size-5" title="移除引用，保留原文件" aria-label={`移除引用：${entry.name}`} onClick={() => toggleLauncher(entry.id)}><X size={12} /></Button></div>)}</div>
      {!items.length && <div className="empty-hint"><Pin size={24} /><p>拖入常用文件或应用</p><Button variant="outline" size="sm" onClick={() => { void showManager('launcher'); }}>添加快捷入口</Button></div>}
    </div>
    <footer className="organizer-footer"><span><Link size={12} />仅保存引用</span><Button variant="ghost" size="sm" disabled={!items.length || busy} onClick={() => void all()}><Play size={12} />启动全部</Button></footer>
    <ResizeHandles layout={layout} minWidth={240} minHeight={160} onStart={() => bringToFront(LAUNCHER_PANEL_KEY)} commit={value => updateLayout(LAUNCHER_PANEL_KEY, value)} />
  </section>;
}
