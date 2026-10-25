import { useRef, useState, type MouseEvent } from 'react';
import { ArrowUpRight, CornerUpLeft, FolderOpen, MoreHorizontal, Pencil, Pin, Trash2, FoldVertical, UnfoldVertical } from 'lucide-react';
import { useItemDrag, useItemDrop } from '@/composables/useItemDrag';
import { sourceFor } from '@/domain/sources';
import { launchEntry, revealEntry, showShellMenu } from '@/lib/tauri';
import { cachedIconUrl, canManageEntry, foldItem, isLauncher, moveEntryToDesktop, moveItem, recycleDesktopItem, renameDesktopItem, rescan, showStatus, selectItem, selectPanelItems, toggleLauncher, unfoldItem, useNestra } from '@/stores/state';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from '@/components/ui/context-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DesktopEntry } from '@/types';

export interface ItemTileProps { entry: DesktopEntry; folded?: boolean; panelKey?: string; compact?: boolean; list?: boolean; hit?: boolean; selectionOrder?: string[]; singleClick?: boolean }
/** File activation is a domain decision; modifier clicks always remain selections. */
export function tileActivation(event: { detail: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, singleClickLaunch: boolean, doubleClick = false): 'open' | 'select' | 'none' {
  if (event.ctrlKey || event.metaKey || event.shiftKey) return doubleClick ? 'none' : 'select';
  if (doubleClick) return singleClickLaunch ? 'none' : 'open';
  if (singleClickLaunch) return event.detail <= 1 ? 'open' : 'none';
  return 'select';
}
export default function ItemTile({ entry, folded, panelKey = '', compact, list, hit, selectionOrder, singleClick }: ItemTileProps) {
  const state = useNestra();
  const opening = useRef(false);
  const [nativeMenuOpen, setNativeMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false), [renameValue, setRenameValue] = useState(''), [renameBusy, setRenameBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null), menuPoint = useRef({ screenX: 0, screenY: 0 });
  const managed = canManageEntry(entry), singleClickLaunch = singleClick ?? (Boolean(panelKey) && entry.isApplication);
  const image = cachedIconUrl(entry.path);
  const drag = useItemDrag(entry, `${panelKey}${folded ? ':folded' : ''}`);
  const group = state.customGroups.find(group => `zone:${group.id}` === panelKey);
  const drop = useItemDrop(`drop:${panelKey}:${entry.id}:${folded ? 'fold' : ''}`, { groupId: group?.id, beforeId: entry.id, fold: folded, mode: group && sourceFor(group).writable ? 'move' : 'blocked', label: group ? `移动到「${group.name}」` : undefined }, !group);
  async function safeOpen() {
    if (opening.current || drag.isDragging) return;
    opening.current = true; try { await launchEntry(entry); } catch { showStatus(`无法打开：${entry.name}`); } finally { opening.current = false; }
  }
  function select(event: MouseEvent) {
    const action = tileActivation(event, singleClickLaunch);
    if (action === 'open') { selectPanelItems(panelKey, []); void safeOpen(); }
    else if (action === 'select') selectItem(entry.id, panelKey, selectionOrder ?? [entry.id], event.ctrlKey || event.metaKey, event.shiftKey);
  }
  function rename() { setRenameValue(entry.name); setRenaming(true); }
  async function systemMenu() {
    setNativeMenuOpen(true);
    try {
      const dpr = window.devicePixelRatio || 1;
      const result = await showShellMenu({ path: entry.path, x: Math.round(menuPoint.current.screenX * dpr), y: Math.round(menuPoint.current.screenY * dpr), toDesktop: Boolean(entry.zone) && managed, inLauncher: isLauncher(entry.id), canFold: Boolean(panelKey) && !folded, canRename: managed });
      if (result === 'desktop') void moveEntryToDesktop(entry.id);
      else if (result === 'launcher') toggleLauncher(entry.id);
      else if (result === 'fold' && panelKey) foldItem(panelKey, entry.id);
      else if (result === 'rename') rename();
      else if (result === 'invoked') window.setTimeout(() => void rescan(), 500);
    } catch { showStatus('无法打开系统菜单，请重新右键后重试'); } finally { setNativeMenuOpen(false); }
  }
  async function submitRename() {
    const name = renameValue.trim(); if (!name || renameBusy) return;
    setRenameBusy(true);
    try { if (name !== entry.name) await renameDesktopItem(entry, name); setRenaming(false); } finally { setRenameBusy(false); }
  }
  return <>
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <button ref={node => { drag.setNodeRef(node); drop.setNodeRef(node); }} type="button" {...drag.attributes} {...drag.listeners} data-desktop-input
          className={['tile', state.selectionPanel === panelKey && state.selectedItemIds.includes(entry.id) ? 'is-selected' : '', folded ? 'is-folded' : '', compact ? 'compact' : '', list ? 'is-list' : '', hit ? 'nestra-hit' : '', drag.isDragging ? 'is-dragging' : ''].join(' ')}
          data-item-id={entry.id} data-native-menu-open={nativeMenuOpen || undefined} draggable={false} title={`${entry.name}\n${entry.sourceLabel}`} onDragStart={event => event.preventDefault()}
          onClick={select} onDoubleClick={event => { if (tileActivation(event, singleClickLaunch, true) === 'open') void safeOpen(); }}
          onContextMenuCapture={event => { menuPoint.current = { screenX: event.screenX, screenY: event.screenY }; }}>
          {entry.isFresh && <span className="fresh-dot" />}
          {image ? <img src={image} alt="" draggable={false} /> : <span className="glyph-badge">{entry.glyph}</span>}
          <span className="tile-label">{entry.name}</span>
          {isLauncher(entry.id) && <Pin className="launcher-pin" size={10} aria-label="已在快捷启动中" />}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="nestra-hit w-56 max-h-[80vh] overflow-y-auto">
        <ContextMenuItem onSelect={() => void safeOpen()}><ArrowUpRight />打开</ContextMenuItem>
        {entry.kind !== 'shell' && <ContextMenuItem onSelect={() => { void revealEntry(entry.path).catch(() => showStatus('无法在资源管理器中显示')); }}><FolderOpen />在资源管理器中显示</ContextMenuItem>}
        {state.customGroups.some(group => sourceFor(group).writable && group.dirName !== entry.zone) && <ContextMenuSub><ContextMenuSubTrigger>移动到收纳区</ContextMenuSubTrigger><ContextMenuSubContent className="nestra-hit">
          {state.customGroups.filter(group => sourceFor(group).writable && group.dirName !== entry.zone).map(group => <ContextMenuItem key={group.id} onSelect={() => { void moveItem(entry.id, group.id); }}>{group.name}</ContextMenuItem>)}
        </ContextMenuSubContent></ContextMenuSub>}
        {entry.zone && managed && <ContextMenuItem onSelect={() => { void moveEntryToDesktop(entry.id); }}><CornerUpLeft />放回桌面</ContextMenuItem>}
        {panelKey && <ContextMenuItem onSelect={() => folded ? unfoldItem(panelKey, entry.id) : foldItem(panelKey, entry.id)}>{folded ? <UnfoldVertical /> : <FoldVertical />}{folded ? '取消折叠' : '收入折叠'}</ContextMenuItem>}
        <ContextMenuItem onSelect={() => toggleLauncher(entry.id)}><Pin />{isLauncher(entry.id) ? '移出快捷启动' : '添加到快捷启动'}</ContextMenuItem>
        <ContextMenuSeparator />
        {managed && <ContextMenuItem onSelect={rename}><Pencil />重命名</ContextMenuItem>}
        {entry.kind !== 'shell' && <ContextMenuItem onSelect={() => void systemMenu()}><MoreHorizontal />更多系统操作…</ContextMenuItem>}
        {managed && <ContextMenuItem className="text-destructive" onSelect={() => { void recycleDesktopItem(entry); }}><Trash2 />移到回收站</ContextMenuItem>}
      </ContextMenuContent>
    </ContextMenu>
    <Dialog open={renaming} onOpenChange={open => { if (!renameBusy) setRenaming(open); }}>
      <DialogContent className="nestra-hit max-w-sm" onOpenAutoFocus={event => { event.preventDefault(); nameInput.current?.focus(); nameInput.current?.select(); }}>
        <form onSubmit={event => { event.preventDefault(); void submitRename(); }}>
          <DialogHeader><DialogTitle>重命名</DialogTitle><DialogDescription>更改文件名称，已有引用会同步更新。</DialogDescription></DialogHeader>
          <Input ref={nameInput} className="my-4" aria-label="文件名称" value={renameValue} disabled={renameBusy} onChange={event => setRenameValue(event.target.value)} onKeyDown={event => { if ((event.nativeEvent.isComposing || event.keyCode === 229) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); } }} />
          <DialogFooter><Button type="button" variant="outline" disabled={renameBusy} onClick={() => setRenaming(false)}>取消</Button><Button type="submit" disabled={!renameValue.trim() || renameBusy}>{renameBusy ? '保存中…' : '保存'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}


