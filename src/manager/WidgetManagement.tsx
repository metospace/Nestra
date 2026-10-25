import { useEffect, useState } from 'react';
import { Clipboard, Clock, ListChecks, Plus, Search, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { clipClear, setClipboardEnabled } from '@/lib/tauri';
import { confirmDialog, createWidget, DESKTOP_SEARCH_KEY, locateSurface, mutateStore, removeWidget, setPanelVisible, setWidgetVisible, showStatus, useNestra } from '@/stores/state';
import TodoList from '@/components/TodoList';
import { EditableName, Field, Modal, PageHeading, Section } from './primitives';

const kinds = [
  { kind: 'note', title: '便签', icon: StickyNote, description: '记录临时想法与常用信息' },
  { kind: 'todo', title: '待办', icon: ListChecks, description: '追踪今天要完成的事' },
  { kind: 'clipboard', title: '剪贴板', icon: Clipboard, description: '最近 50 条文本，仅本次运行' },
  { kind: 'clock', title: '时钟', icon: Clock, description: '查看时间与日期' },
] as const;
export default function WidgetManagement() {
  const store = useNestra();
  const [selected, setSelected] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const widget = store.widgets.find(item => item.id === selected);
  useEffect(() => { if (selected && !widget) setEditOpen(false); }, [selected, widget]);
  const edit = (id: string) => { setSelected(id); setEditOpen(true); };
  const enabled = async (value: boolean) => { try { await setClipboardEnabled(value); mutateStore(draft => { draft.clipboardEnabled = value; }); } catch (error) { showStatus(`设置失败：${error}`); } };
  const clear = async () => { if (await confirmDialog('清空本次运行的全部剪贴板历史？')) { try { await clipClear(); showStatus('剪贴板历史已清空'); } catch (error) { showStatus(`无法清空：${error}`); } } };
  return <><PageHeading title="小组件" description="把信息留在桌面。隐藏组件后，内容与显示设置仍会保留。"/>
    <div className="widget-catalog">{kinds.map(kind => <Button key={kind.kind} variant="outline" className="widget-choice" onClick={() => createWidget(kind.kind)}><kind.icon/><span><strong>{kind.title}</strong><small>{kind.description}</small></span><Plus/></Button>)}</div>
    {store.panelLayouts[DESKTOP_SEARCH_KEY] && <Section><div className="source-row"><div className="source-icon"><Search/></div><div className="row-content"><strong>桌面搜索</strong><small>搜索文件和应用 · 可独立拖动</small></div><Button variant="ghost" size="sm" onClick={() => setPanelVisible(DESKTOP_SEARCH_KEY, store.panelLayouts[DESKTOP_SEARCH_KEY]!.visible === false)}>{store.panelLayouts[DESKTOP_SEARCH_KEY]!.visible === false ? '恢复显示' : '隐藏'}</Button><Button variant="outline" size="sm" onClick={() => locateSurface(DESKTOP_SEARCH_KEY)}>显示并定位</Button></div></Section>}
    <Section title="我的小组件" action={<span className="muted-text">{store.widgets.length} 个</span>}>{store.widgets.map(item => { const kind = kinds.find(kind => kind.kind === item.kind)!; return <div key={item.id} className="source-row"><div className="source-icon"><kind.icon/></div><div className="row-content"><strong>{item.title}</strong><small>{kind.title} · {item.layout.visible ? '桌面可见' : '已隐藏'}{item.kind === 'todo' ? ` · ${item.todos.filter(todo => !todo.completed).length} 项待办` : ''}</small></div><Button variant="ghost" size="sm" onClick={() => setWidgetVisible(item.id, !item.layout.visible)}>{item.layout.visible ? '隐藏' : '恢复显示'}</Button><Button variant="outline" size="sm" onClick={() => locateSurface(`widget:${item.id}`)}>显示并定位</Button><Button variant="outline" size="sm" onClick={() => edit(item.id)}>编辑</Button></div>; })}{!store.widgets.length && <p className="card-note">选择上方的小组件，添加到桌面。</p>}</Section>
    <Section title="剪贴板记录"><div className="settings-row"><div><h3>记录复制的文本</h3><p>最多 50 条，退出后清空。暂停时不采集。</p></div><Switch checked={store.clipboardEnabled} aria-label="记录剪贴板文本" onCheckedChange={value => void enabled(value)}/></div><Button variant="outline" onClick={() => void clear()}>清空历史</Button></Section>
    <Modal open={editOpen} onOpenChange={setEditOpen} title={widget?.title ?? '编辑小组件'} description={widget?.kind === 'todo' ? '新增和完成状态自动保存；修改文字请点击保存或按 Enter。未提交草稿在本窗口保留到退出。' : '内容会自动保存。'}>
      {widget && <div className="form-stack"><Field label="标题"><EditableName value={widget.title} label="小组件标题" onCommit={value => mutateStore(draft => { const target = draft.widgets.find(item => item.id === widget.id); if (target) target.title = value; })}/></Field>{widget.kind === 'note' && <Field label="便签内容"><Textarea value={widget.content} rows={9} aria-label="便签内容" onChange={event => { const content = event.target.value; mutateStore(draft => { const target = draft.widgets.find(item => item.id === widget.id); if (target) target.content = content; }); }}/></Field>}{widget.kind === 'todo' && <TodoList key={widget.id} widget={widget} className="manager-todo-list"/>}<div className="danger-section"><p>删除会移除该小组件及其便签或待办内容。</p><Button variant="destructive" onClick={() => void removeWidget(widget.id)}>删除小组件</Button></div></div>}
    </Modal>
  </>;
}
