import { useEffect, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { Copy, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import TodoList from '@/components/TodoList';
import { startMove } from '@/composables/useSurfaceDrag';
import { surfaceAppearance } from '@/domain/presentation';
import { CLIPBOARD_CHANGED_EVENT, clipClear, clipCopy, clipLoad, clipRemove } from '@/lib/tauri';
import { confirmDialog, mutateStore, nextZ, setWidgetVisible, showStatus, useNestra } from '@/stores/state';
import type { ClipItem, PanelLayout, Widget } from '@/types';
import { IconButton, ResizeHandles, surfaceStyle } from './SurfaceChrome';

export default function WidgetFrame({ widget }: { widget: Widget }) {
  const state = useNestra(), layout = widget.layout;
  const [clips, setClips] = useState<ClipItem[]>([]), [now, setNow] = useState(new Date());
  function update(patch: Partial<Widget>) { mutateStore(draft => { const target = draft.widgets.find(item => item.id === widget.id); if (target) Object.assign(target, patch); }); }
  function commit(value: Partial<PanelLayout>) { mutateStore(draft => { const target = draft.widgets.find(item => item.id === widget.id); if (target) Object.assign(target.layout, value); }); }
  function front() { mutateStore(draft => { const target = draft.widgets.find(item => item.id === widget.id); if (target) target.layout.zIndex = nextZ(); }); }
  useEffect(() => {
    if (widget.kind !== 'clipboard') return;
    let disposed = false, unlisten: (() => void) | undefined;
    async function load() { try { const values = await clipLoad(); if (!disposed) setClips(values); } catch { if (!disposed) setClips([]); } }
    void load(); void getCurrentWebview().listen(CLIPBOARD_CHANGED_EVENT, () => void load()).then(dispose => { if (disposed) dispose(); else unlisten = dispose; });
    return () => { disposed = true; unlisten?.(); };
  }, [widget.kind]);
  useEffect(() => { if (widget.kind !== 'clock') return; const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, [widget.kind]);
  async function copy(item: ClipItem) { try { await clipCopy(item.id); showStatus('已复制到剪贴板'); } catch { showStatus('复制失败'); } }
  const appearance = surfaceAppearance(layout, state.appearance);
  return <section className="nestra-panel" data-widget-kind={widget.kind} data-material={appearance.surfaceMaterial} data-border={appearance.borderStyle} style={surfaceStyle(layout, state.appearance)} onPointerDown={front}>
    <header className="panel-header select-none" onPointerDown={event => { if ((event.target as HTMLElement).closest('button,input')) return; front(); startMove(event as unknown as PointerEvent, layout, { minWidth: 220, minHeight: 150, commit }); }}>
      <Input aria-label="小组件名称" value={widget.title} className="widget-title h-7 min-w-0 flex-1 border-transparent bg-transparent px-1 shadow-none" spellCheck={false} onPointerDown={event => event.stopPropagation()} onChange={event => update({ title: event.target.value })} />
      <IconButton aria-label="隐藏小组件" title="隐藏小组件（控制中心可恢复）" onClick={() => setWidgetVisible(widget.id, false)}><X /></IconButton>
    </header>
    {widget.kind === 'note' ? <Textarea value={widget.content} className="widget-note min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent p-3 shadow-none" placeholder="写点什么…内容会自动保存" aria-label="便签内容" spellCheck={false} onChange={event => update({ content: event.target.value })} /> : widget.kind === 'todo' ? <TodoList widget={widget} /> : widget.kind === 'clock' ? <div className="clock-content"><strong>{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</strong><span>{now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span></div> : <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pt-2"><span className="flex-1 text-[11px] text-muted-foreground">{state.clipboardEnabled ? '点按条目复制到剪贴板' : '记录已暂停 · 现有历史仍可使用'}</span><IconButton aria-label="清空历史" onClick={() => { void confirmDialog('清空全部剪贴板历史？').then(confirmed => { if (confirmed) void clipClear(); }); }}><Trash2 /></IconButton></div>
      <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-2">{clips.map(item => <li key={item.id} className="clipboard-entry group flex items-start gap-1 rounded-md p-1 hover:bg-muted/50"><Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start whitespace-pre-wrap p-2 text-left" onClick={() => void copy(item)}><Copy size={13} className="shrink-0" /><span className="min-w-0 flex-1 break-all text-xs leading-relaxed">{item.text.length > 120 ? `${item.text.slice(0, 120)}…` : item.text}</span></Button><span className="shrink-0 pt-2 text-[10px] text-muted-foreground">{item.createdLabel}</span><IconButton aria-label="删除该条" title="删除该条" onClick={() => { void clipRemove(item.id); }}><X /></IconButton></li>)}</ul>
      <footer className="organizer-footer"><span>{clips.length ? `${clips.length} 条记录` : '暂无历史 · 复制任意文本即可记录'}</span></footer>
    </div>}
    <ResizeHandles layout={layout} commit={commit} onStart={front} minWidth={220} minHeight={150} />
  </section>;
}
