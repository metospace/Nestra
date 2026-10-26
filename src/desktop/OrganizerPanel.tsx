import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, CheckCheck, Ellipsis, EyeOff, FolderCog, History, ListChecks, Pencil, RefreshCw, Search, SlidersHorizontal, Trash2, UnfoldVertical, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { startMove } from '@/composables/useSurfaceDrag';
import { useItemDrop } from '@/composables/useItemDrag';
import { useOrganizerLayout } from '@/composables/useOrganizerLayout';
import { usePanelAutoHide } from '@/composables/usePanelAutoHide';
import { useFileMoves, openMoveResults } from '@/composables/fileMoveReports';
import { surfaceAppearance } from '@/domain/presentation';
import { splitOrganizerOverflow } from '@/domain/organizerLayout';
import { dropDescription, sourceFor } from '@/domain/sources';
import { fileFilters, matchesFilter } from '@/lib/organizer';
import { showManager } from '@/lib/tauri';
import { batchMoveItems, batchReturnItems, bringToFront, confirmDialog, getItemsByPanel, getSelectedEntries, openSurfaceSettings, pinEntry, removeCustomGroup, removeTabGroup, renameCustomGroup, renameTabGroup, rescan, selectPanelItems, setActiveTab, setPanelVisible, showStatus, store, toggleFoldVisibility, updateGroupView, updateLayout, useNestra } from '@/stores/state';
import type { CustomGroupDefinition, DesktopEntry, Panel } from '@/types';
import ItemTile, { EntryIcon } from './ItemTile';
import { IconButton, ResizeHandles, surfaceStyle } from './SurfaceChrome';
import OrganizerPages from './OrganizerPages';
import OrganizerOverflowFolder from './OrganizerOverflowFolder';

export default function OrganizerPanel({ panel: rootPanel, items: initialItems }: { panel: Panel; items: DesktopEntry[] }) {
  const state = useNestra(), fileMoves = useFileMoves();
  const rootGroup = state.customGroups.find(group => group.id === rootPanel.groupId);
  const tabModel = state.tabGroups.find(tabs => `tabs:${tabs.id}` === rootPanel.key);
  const tabGroups = (tabModel?.groupIds ?? []).map(id => state.customGroups.find(group => group.id === id)).filter((group): group is CustomGroupDefinition => Boolean(group));
  const aggregate = tabModel?.activeGroupId === '__all__';
  const activeGroup = aggregate ? undefined : tabGroups.find(group => group.id === tabModel?.activeGroupId) ?? tabGroups[0] ?? rootGroup;
  const panel = state.panels.find(panel => panel.groupId === activeGroup?.id) ?? rootPanel;
  const items = getItemsByPanel()[panel.key] ?? initialItems;
  const layout = state.panelLayouts[rootPanel.key];
  const [localQuery, setLocalQuery] = useState(''), [aggregateFilter, setAggregateFilter] = useState<CustomGroupDefinition['filter']>('all');
  const [searchVisible, setSearchVisible] = useState(false), searchInput = useRef<HTMLInputElement>(null);
  const [more, setMore] = useState(false), [renaming, setRenaming] = useState(false), [nameDraft, setNameDraft] = useState(''), [renameBusy, setRenameBusy] = useState(false), nameInput = useRef<HTMLInputElement>(null);
  const [batchBusy, setBatchBusy] = useState(false), [showFolded, setShowFolded] = useState(false);
  const [page, setPage] = useState(0);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null), disposeBox = useRef<(() => void) | undefined>(undefined);
  const filtered = items.filter(entry => matchesFilter(entry, aggregate ? aggregateFilter : activeGroup?.filter) && entry.name.toLowerCase().includes(localQuery.toLowerCase()));
  const foldedIds = new Set(state.foldedItems[panel.key] ?? []), foldedEntries = filtered.filter(entry => foldedIds.has(entry.id));
  const visibleEntries = showFolded ? filtered : filtered.filter(entry => !foldedIds.has(entry.id));
  const sizingCount = localQuery ? items.filter(entry => matchesFilter(entry, aggregate ? aggregateFilter : activeGroup?.filter) && (showFolded || !foldedIds.has(entry.id))).length : visibleEntries.length;
  const { rootRef, contentRef, fit } = useOrganizerLayout(layout, sizingCount, state.displays);
  const pageSize = fit?.pageSize ?? 1, pageCount = Math.max(1, Math.ceil(visibleEntries.length / pageSize));
  const folderMode = layout?.overflowMode === 'folder', overflow = splitOrganizerOverflow(visibleEntries, pageSize);
  const hasOverflow = folderMode && overflow.overflow.length > 0;
  const currentPage = Math.min(page, pageCount - 1), pageEntries = folderMode ? overflow.visible : visibleEntries.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const foldedPreviewCount = Math.max(0, Math.floor(((fit?.layout.width ?? 264) - 106) / 48));
  const selected = state.selectionPanel === panel.key ? getSelectedEntries().filter(entry => visibleEntries.some(visible => visible.id === entry.id)) : [];
  const writable = Boolean(activeGroup && sourceFor(activeGroup).writable), dropLabel = activeGroup ? dropDescription(activeGroup) : '全部来源只供浏览；请选择一个可接收文件的来源';
  const drop = useItemDrop(`zone:${rootPanel.key}`, { groupId: activeGroup?.id, mode: writable ? 'move' : 'blocked', label: dropLabel });
  const foldedDrop = useItemDrop(`fold:${rootPanel.key}`, { groupId: activeGroup?.id, mode: writable ? 'move' : 'blocked', label: '收入折叠区', fold: true });
  const expanded = usePanelAutoHide(rootPanel.key, rootRef, Boolean(layout?.autoHide) && !state.paused, layout?.autoHideDelay ?? 800,
    more || renaming || renameBusy || batchBusy || overflowOpen || state.surfaceSettingsKey === rootPanel.key || drop.isOver || foldedDrop.isOver);
  const visibleIds = visibleEntries.map(entry => entry.id).join('\n');
  useEffect(() => {
    if (store.selectionPanel !== panel.key) return;
    const ids = visibleEntries.map(entry => entry.id), selectedIds = store.selectedItemIds.filter(id => ids.includes(id));
    if (selectedIds.length !== store.selectedItemIds.length) selectPanelItems(panel.key, selectedIds);
  }, [visibleIds, panel.key]);
  useEffect(() => { if (renaming) { nameInput.current?.focus(); nameInput.current?.select(); } }, [renaming]);
  useEffect(() => { if (searchVisible) searchInput.current?.focus(); }, [searchVisible]);
  useEffect(() => () => disposeBox.current?.(), []);
  useEffect(() => { setPage(0); }, [localQuery, activeGroup?.id, aggregateFilter, showFolded, pageSize]);
  useEffect(() => { setOverflowOpen(false); }, [localQuery, activeGroup?.id, aggregateFilter, showFolded, hasOverflow]);
  useEffect(() => {
    if (!layout || !fit) return;
    const { x, y, width, height } = fit.layout;
    if (layout.x !== x || layout.y !== y || layout.width !== width || layout.height !== height) updateLayout(rootPanel.key, { x, y, width, height });
  }, [fit?.layout.x, fit?.layout.y, fit?.layout.width, fit?.layout.height, layout?.x, layout?.y, layout?.width, layout?.height, rootPanel.key]);
  if (!layout || !fit) return null;
  const appearance = surfaceAppearance(layout, state.appearance);
  function beginRename() { if ((!rootGroup && !tabModel) || renameBusy) return; setMore(false); setNameDraft(tabModel?.name ?? rootGroup!.name); setRenaming(true); }
  async function saveName() {
    const name = nameDraft.trim(); if (!name || renameBusy) return; setRenameBusy(true);
    try { if (tabModel) renameTabGroup(tabModel.id, name); else if (rootGroup) await renameCustomGroup(rootGroup.id, name);
      if ((store.tabGroups.find(group => group.id === tabModel?.id)?.name ?? store.customGroups.find(group => group.id === rootGroup?.id)?.name) === name) setRenaming(false);
    } finally { setRenameBusy(false); }
  }
  async function remove() {
    if (tabModel) { if (await confirmDialog('删除此标签组？各个收纳区会恢复独立显示，文件保持原位。')) removeTabGroup(tabModel.id); }
    else if (rootGroup) await removeCustomGroup(rootGroup.id);
  }
  async function batch(target: string) { if (batchBusy) return; setBatchBusy(true); try { await batchMoveItems(selected.map(entry => entry.id), target); } finally { setBatchBusy(false); } }
  async function returnSelected() { if (batchBusy) return; setBatchBusy(true); try { await batchReturnItems(selected.filter(entry => entry.zone).map(entry => entry.id)); } finally { setBatchBusy(false); } }
  function startBox(event: React.PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.tile,button,input,[role="menu"]')) return;
    disposeBox.current?.(); const root = event.currentTarget as HTMLElement, start = { x: event.clientX, y: event.clientY }, pointerId = event.pointerId;
    const original = event.ctrlKey && store.selectionPanel === panel.key ? [...store.selectedItemIds] : [];
    function move(next: PointerEvent) {
      if (next.pointerId !== pointerId) return;
      document.body.classList.add('is-gesturing');
      const box = { x: Math.min(start.x, next.clientX), y: Math.min(start.y, next.clientY), width: Math.abs(next.clientX - start.x), height: Math.abs(next.clientY - start.y) }; setSelectionBox(box);
      const ids = [...root.querySelectorAll<HTMLElement>('[data-item-id]')].filter(element => { const rect = element.getBoundingClientRect(); return rect.right >= box.x && rect.left <= box.x + box.width && rect.bottom >= box.y && rect.top <= box.y + box.height; }).map(element => element.dataset.itemId!);
      selectPanelItems(panel.key, [...new Set([...original, ...ids])]);
    }
    function end() { document.body.classList.remove('is-gesturing'); setSelectionBox(null); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', end); if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId); disposeBox.current = undefined; }
    disposeBox.current = end; selectPanelItems(panel.key, original); root.setPointerCapture(pointerId); window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); window.addEventListener('blur', end);
  }
  return <motion.section initial={false} animate={{ opacity: expanded ? 1 : 0 }} transition={{ duration: .12 }} ref={element => { rootRef.current = element; drop.setNodeRef(element); }} className={`nestra-panel organizer-auto-layout is-draggable ${drop.isOver ? 'is-drop-target' : ''}`} data-auto-hidden={!expanded ? 'true' : undefined} aria-hidden={!expanded || undefined} data-group-id={activeGroup?.id} data-drop-label={dropLabel} data-drop-mode={writable ? 'move' : 'blocked'} data-material={appearance.surfaceMaterial} data-border={appearance.borderStyle} style={{ ...surfaceStyle(fit.layout, state.appearance), visibility: expanded ? 'visible' : 'hidden', pointerEvents: expanded ? 'auto' : 'none' }} onPointerDown={() => bringToFront(rootPanel.key)}>
    <header className="panel-header organizer-heading select-none" onPointerDown={event => {
      // Portal menu events bubble through React's header, but are outside its
      // DOM. They must remain menu selections rather than starting a gesture.
      if (!event.currentTarget.contains(event.target as Node) || renaming || (event.target as HTMLElement).closest('button,input,[role="tab"]')) return;
      bringToFront(rootPanel.key); startMove(event as unknown as PointerEvent, fit.layout, { minWidth: 264, minHeight: 176, commit: value => updateLayout(rootPanel.key, value) });
    }} onDoubleClick={event => { if (event.currentTarget.contains(event.target as Node) && !(event.target as HTMLElement).closest('button,input')) beginRename(); }} onContextMenu={event => { if (!event.currentTarget.contains(event.target as Node)) return; event.preventDefault(); setMore(true); }}>
      {renaming ? <><Input ref={nameInput} value={nameDraft} onChange={event => setNameDraft(event.target.value)} aria-label="收纳区名称" className="h-7 min-w-0 flex-1" disabled={renameBusy} onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); void saveName(); } if (event.key === 'Escape' && !renameBusy) setRenaming(false); }} /><IconButton aria-label="保存名称" disabled={renameBusy || !nameDraft.trim()} onClick={() => void saveName()}><Check /></IconButton><IconButton aria-label="取消重命名" disabled={renameBusy} onClick={() => setRenaming(false)}><X /></IconButton></> : <>
        <div className="organizer-title" title="双击重命名 · 右键更多操作"><h2>{tabModel?.name ?? panel.title}</h2></div>
        <IconButton aria-label="搜索此栏" title="搜索此栏" onClick={() => { setSearchVisible(!searchVisible); if (searchVisible) setLocalQuery(''); }}><Search /></IconButton>
        <IconButton aria-label="此栏样式与布局" title="此栏样式与布局" data-surface-settings-trigger onClick={() => openSurfaceSettings(rootPanel.key)}><SlidersHorizontal /></IconButton>
      </>}
      <DropdownMenu open={more} onOpenChange={setMore} modal={false}><DropdownMenuTrigger asChild><IconButton aria-label="更多操作" title="更多操作"><Ellipsis /></IconButton></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="nestra-hit max-h-[80vh] w-60 overflow-y-auto">
          <DropdownMenuLabel>{tabModel?.name ?? panel.title}</DropdownMenuLabel>
          {(rootGroup || tabModel) && <DropdownMenuItem onSelect={beginRename}><Pencil />重命名</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => openSurfaceSettings(rootPanel.key)}><SlidersHorizontal />样式与布局</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { void showManager('files', activeGroup?.id); }}><FolderCog />管理内容与来源</DropdownMenuItem>
          <DropdownMenuSub><DropdownMenuSubTrigger>文件筛选</DropdownMenuSubTrigger><DropdownMenuSubContent className="nestra-hit"><DropdownMenuRadioGroup value={aggregate ? aggregateFilter : activeGroup?.filter ?? 'all'} onValueChange={value => aggregate ? setAggregateFilter(value as CustomGroupDefinition['filter']) : updateGroupView(panel.groupId, { filter: value as CustomGroupDefinition['filter'] })}>{fileFilters.map(item => <DropdownMenuRadioItem key={item.value} value={item.value}>{item.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuSubContent></DropdownMenuSub>
          {selected.length > 0 && <DropdownMenuSub><DropdownMenuSubTrigger disabled={batchBusy}>移动选中的 {selected.length} 项</DropdownMenuSubTrigger><DropdownMenuSubContent className="nestra-hit">{state.customGroups.filter(group => group.id !== activeGroup?.id && sourceFor(group).writable).map(group => <DropdownMenuItem key={group.id} onSelect={() => void batch(group.id)}>{group.name}</DropdownMenuItem>)}</DropdownMenuSubContent></DropdownMenuSub>}
          <DropdownMenuItem onSelect={() => selectPanelItems(panel.key, visibleEntries.map(entry => entry.id))}><CheckCheck />选择全部可见项目</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { setShowFolded(!showFolded); if (!foldedEntries.length) toggleFoldVisibility(panel.key); }}><UnfoldVertical />{showFolded ? '收起折叠项目' : '展开折叠项目'}</DropdownMenuItem>
          <DropdownMenuSeparator />
          {fileMoves.reports.length > 0 && <DropdownMenuItem onSelect={openMoveResults}><ListChecks />本次整理结果</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => { void showManager('data'); }}><History />查看移动记录</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { void rescan().then(() => showStatus(`「${panel.title}」已刷新`)); }}><RefreshCw />刷新文件</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPanelVisible(rootPanel.key, false)}><EyeOff />隐藏此栏</DropdownMenuItem>
          {(rootGroup || tabModel) && <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onSelect={() => void remove()}><Trash2 />{tabModel ? '删除标签组' : '删除收纳区'}</DropdownMenuItem></>}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    {tabModel && <Tabs value={aggregate ? '__all__' : activeGroup?.id} onValueChange={value => setActiveTab(tabModel.id, value)}><TabsList className="mx-2 mb-1 h-8 max-w-[calc(100%-16px)] justify-start overflow-x-auto"><TabsTrigger value="__all__">全部来源</TabsTrigger>{tabGroups.map(group => <TabsTrigger key={group.id} value={group.id} data-group-id={group.id} data-drop-label={dropDescription(group)} data-drop-mode={sourceFor(group).writable ? 'move' : 'blocked'}>{group.name}</TabsTrigger>)}</TabsList></Tabs>}
    {searchVisible && <div className="organizer-search"><Input ref={searchInput} value={localQuery} onChange={event => setLocalQuery(event.target.value)} placeholder="搜索此栏中的文件…" aria-label="搜索此栏中的文件" className="h-8" onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') { setSearchVisible(false); setLocalQuery(''); } }} /><IconButton aria-label="关闭栏内搜索" onClick={() => { setSearchVisible(false); setLocalQuery(''); }}><X /></IconButton></div>}
    {selected.length > 1 && <div className="organizer-selection"><span>已选 {selected.length} 项</span><Button size="sm" variant="ghost" disabled={batchBusy} onClick={() => { selected.forEach(pinEntry); showStatus('已添加快捷引用，文件未移动'); }}>固定</Button><Button size="sm" variant="ghost" disabled={batchBusy} onClick={() => setMore(true)}>移动到…</Button>{selected.some(entry => entry.zone) && <Button size="sm" variant="ghost" disabled={batchBusy} onClick={() => void returnSelected()}>放回桌面</Button>}<IconButton aria-label="清除选择" onClick={() => selectPanelItems(panel.key, [])}><X /></IconButton></div>}
    {state.mappingErrors[panel.groupId] && <p role="status" className="px-3 pb-2 text-xs text-amber-600">{state.mappingErrors[panel.groupId]}</p>}
    {foldedEntries.length > 0 && !showFolded && <div ref={foldedDrop.setNodeRef} className="fold-strip" data-fold-target title="拖到分区或桌面上即可取出">{foldedEntries.slice(0, foldedPreviewCount).map(entry => <ItemTile key={entry.id} entry={entry} compact folded panelKey={panel.key} />)}{foldedEntries.length > foldedPreviewCount && <Button variant="ghost" size="sm" aria-label="展开全部折叠项目" onClick={() => setShowFolded(true)}>+{foldedEntries.length - foldedPreviewCount}</Button>}</div>}
    <div ref={contentRef} className={`organizer-content min-h-0 flex-1 overflow-hidden p-2 ${selected.length > 1 ? 'has-selection' : ''}`} onPointerDown={startBox}>
      {visibleEntries.length > 0 ? <div className={`items-layout surface-item-grid ${layout.viewMode === 'list' ? 'is-list' : ''}`} style={{ gridTemplateColumns: `repeat(${fit.columns}, minmax(0, 1fr))`, gridAutoRows: `${fit.tileHeight}px` }}>{pageEntries.map(entry => <ItemTile key={entry.id} entry={entry} folded={foldedIds.has(entry.id)} panelKey={panel.key} list={layout.viewMode === 'list'} selectionOrder={visibleEntries.map(item => item.id)} />)}{hasOverflow && <Button variant="ghost" className={`tile overflow-folder h-full ${layout.viewMode === 'list' ? 'is-list' : ''}`} aria-label={`打开更多项目，${overflow.overflow.length} 项`} onClick={() => setOverflowOpen(true)}><span className="overflow-preview" aria-hidden="true">{overflow.overflow.slice(0, 4).map(entry => <span className="overflow-preview-cell" key={entry.id}><EntryIcon entry={entry}/></span>)}</span><span className="tile-label">更多项目 ({overflow.overflow.length})</span></Button>}</div> : <div className="empty-hint"><p>{items.length && !filtered.length ? '没有符合条件的项目' : foldedEntries.length ? '项目都已折叠' : activeGroup?.mappedPath ? '文件夹为空' : '空收纳区'}</p><small>{writable ? '拖入文件会移动到此目录' : '选择其他来源，或调整筛选条件'}</small></div>}
    </div>
    {!folderMode && <OrganizerPages title={panel.title} page={currentPage} pageCount={pageCount} count={visibleEntries.length} onChange={setPage}/>}
    {selectionBox && <div className="selection-box" style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.width, height: selectionBox.height }} />}
    <ResizeHandles layout={fit.layout} minHeight={fit.minHeight} commit={value => updateLayout(rootPanel.key, { ...value, autoSize: false })} onStart={() => bringToFront(rootPanel.key)}/>
    {overflowOpen && hasOverflow && <OrganizerOverflowFolder layout={layout} entries={overflow.overflow} panelKey={panel.key} title={tabModel?.name ?? panel.title} onClose={() => setOverflowOpen(false)}/>}
  </motion.section>;
}

