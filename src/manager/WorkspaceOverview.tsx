import { useState, type CSSProperties } from 'react';
import { AppWindow, ArrowUpRight, ClipboardList, Clock, FileText, Folder, FolderOpen, Image, LayoutGrid, ListTodo, PanelsTopLeft, Plus, Square, SquareCheck, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cachedIconUrl, getItemsByPanel, getLauncherEntries, viewSurface, useNestra } from '@/stores/state';
import { surfaceAppearance, surfaceVariables } from '@/domain/presentation';
import type { DesktopEntry, PanelLayout, Widget } from '@/types';
import { EmptyState, PageHeading } from './primitives';

interface Surface { key: string; title: string; groupId?: string; layout: PanelLayout; entries: DesktopEntry[]; widget?: Widget }
const widgetIcons = { note: StickyNote, todo: ListTodo, clock: Clock, clipboard: ClipboardList };
function surfaceIcon(surface: Surface) { return surface.widget ? widgetIcons[surface.widget.kind] : surface.key === 'system:launcher' ? LayoutGrid : Folder; }
function entryIcon(entry: DesktopEntry) { return entry.kind === 'folder' ? Folder : entry.isApplication ? AppWindow : /\.(png|jpe?g|webp|gif)$/i.test(entry.name) ? Image : FileText; }
function summary(surface: Surface) {
  if (!surface.layout.visible) return '已隐藏 · 可随时恢复';
  if (!surface.widget) return `${surface.entries.length} 个项目`;
  if (surface.widget.kind === 'todo') return `${surface.widget.todos.filter(todo => !todo.completed).length} 项待完成`;
  if (surface.widget.kind === 'note') return surface.widget.content || '便签内容为空';
  return surface.widget.kind === 'clock' ? '时间与日期' : '剪贴板历史';
}
export default function WorkspaceOverview({ onNavigate, onAdd }: { onNavigate: (module: string, objectId?: string) => void; onAdd: (kind?: 'zone' | 'folder') => void }) {
  const store = useNestra();
  const [selectedKey, setSelectedKey] = useState('');
  const items = getItemsByPanel();
  const surfaces: Surface[] = [
    ...store.panels.filter(panel => !store.tabGroups.some(tabs => tabs.groupIds.includes(panel.groupId))).filter(panel => store.panelLayouts[panel.key]).map(panel => ({ ...panel, layout: store.panelLayouts[panel.key]!, entries: panel.key === 'system:launcher' ? getLauncherEntries() : items[panel.key] ?? [] })).filter(surface => surface.key !== 'system:launcher' || surface.layout.visible || surface.entries.length > 0),
    ...store.widgets.map(widget => ({ key: `widget:${widget.id}`, title: widget.title, layout: widget.layout, entries: [], widget })),
  ];
  const selected = surfaces.find(surface => surface.key === selectedKey) ?? surfaces[0];
  const manage = (surface: Surface) => onNavigate(surface.widget ? 'widgets' : surface.key === 'system:launcher' ? 'launcher' : 'files', store.customGroups.some(group => group.id === surface.groupId) ? surface.groupId : undefined);
  const SelectedIcon = selected ? surfaceIcon(selected) : PanelsTopLeft;
  return <><PageHeading title="桌面空间" description="查看桌面内容，继续手边的工作。"><DropdownMenu><DropdownMenuTrigger asChild><Button><Plus/>添加内容</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => onAdd()}><Folder/>收纳区或文件来源</DropdownMenuItem><DropdownMenuItem onSelect={() => onNavigate('widgets')}><PanelsTopLeft/>便签、待办与组件</DropdownMenuItem></DropdownMenuContent></DropdownMenu></PageHeading>
    {!selected ? <div className="manager-card"><EmptyState icon={PanelsTopLeft} title="从一个收纳区开始" description="新建收纳区后，拖入会移动文件；显示已有文件夹默认只浏览。"><div className="page-actions"><Button onClick={() => onAdd('zone')}><Plus/>新建收纳区</Button><Button variant="outline" onClick={() => onAdd('folder')}><FolderOpen/>显示已有文件夹</Button></div></EmptyState></div> : <div className="workspace-overview">
      <section className="workspace-list manager-card" aria-label="桌面内容"><div className="card-heading"><h2>我的桌面</h2><span className="muted-text">{surfaces.length} 项</span></div><div className="surface-list">{surfaces.map(surface => { const Icon = surfaceIcon(surface); return <Button variant="ghost" key={surface.key} className={`surface-list-item ${selected.key === surface.key ? 'is-selected' : ''}`} aria-pressed={selected.key === surface.key} onClick={() => setSelectedKey(surface.key)}><span className="source-icon"><Icon/></span><span className="row-content"><strong>{surface.title}</strong><small>{summary(surface)}</small></span><span className={`status-dot ${!surface.layout.visible || store.paused ? 'is-paused' : ''}`}/></Button>; })}</div><Button variant="ghost" className="w-full" onClick={() => onNavigate('files')}><FoldersIcon/>管理所有文件来源</Button></section>
      <section className="workspace-detail manager-card" aria-label="当前选择"><div className="workspace-detail-header"><div className="source-icon"><SelectedIcon/></div><div className="row-content"><h2>{selected.title}</h2><p>{selected.layout.appearance ? '独立风格' : '跟随全局风格'}</p></div><Badge variant="secondary">{!selected.layout.visible ? '已隐藏' : store.paused ? '桌面已暂停' : '桌面显示中'}</Badge></div>
        <div className="workspace-preview-stage"><article className="nestra-panel workspace-surface-preview" style={surfaceVariables(selected.layout, store.appearance) as CSSProperties} data-material={surfaceAppearance(selected.layout, store.appearance).surfaceMaterial} data-border={surfaceAppearance(selected.layout, store.appearance).borderStyle}><header><SelectedIcon size={16}/><strong>{selected.title}</strong><span>{selected.widget ? '' : `${selected.entries.length} 项`}</span></header>
          {!selected.widget && <div className={`overview-file-preview ${selected.layout.viewMode === 'list' ? 'is-list' : ''}`}>{selected.entries.map(entry => { const Icon = entryIcon(entry); const url = cachedIconUrl(entry.path); return <div key={entry.id} className="overview-file" title={entry.name}>{url ? <img src={url} alt=""/> : <Icon/>}<span>{entry.name}</span></div>; })}{!selected.entries.length && <p className="preview-empty">{selected.key === 'system:launcher' ? '固定常用入口，随时打开。' : '拖入文件，让桌面井然有序。'}</p>}</div>}
          {selected.widget?.kind === 'note' && <p className="overview-note">{selected.widget.content || '在桌面写下灵感。'}</p>}
          {selected.widget?.kind === 'todo' && <ul className="overview-todos">{selected.widget.todos.map(todo => <li key={todo.id} className={todo.completed ? 'is-completed' : ''}>{todo.completed ? <SquareCheck size={16}/> : <Square size={16}/>}<span>{todo.text}</span></li>)}{!selected.widget.todos.length && <li className="muted-text">在桌面添加第一项待办。</li>}</ul>}
          {selected.widget && ['clock', 'clipboard'].includes(selected.widget.kind) && <div className="overview-widget-placeholder"><SelectedIcon size={32}/><p>{summary(selected)}</p><small>在桌面查看与使用</small></div>}
        </article><p className="field-hint">内容预览 · 在桌面调整位置与尺寸</p></div>
        <div className="workspace-detail-footer"><Button onClick={() => void viewSurface(selected.key)}><ArrowUpRight/>{selected.layout.visible ? '在桌面查看' : '恢复到桌面'}</Button><Button variant="outline" onClick={() => manage(selected)}>管理内容</Button><Button variant="ghost" onClick={() => onNavigate('appearance')}>全局外观</Button></div>
      </section>
    </div>}</>;
}
function FoldersIcon() { return <Folder size={16}/>; }
