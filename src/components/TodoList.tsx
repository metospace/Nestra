import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CheckCheck, ListTodo, ChevronDown, ChevronRight, X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { mutateStore, store, touchWidget } from '@/stores/state';
import { useTodoDraft } from '@/composables/useTodoDraft';
import { cn } from '@/lib/utils';
import type { TodoItem, Widget } from '@/types';
export default function TodoList({widget,className}: {widget:Widget;className?:string}) {
  const root=useRef<HTMLDivElement>(null),composer=useRef<HTMLInputElement>(null),editor=useRef<HTMLTextAreaElement>(null);
  const {draft,update}=useTodoDraft(widget.id);
  const [showCompleted,setShowCompleted]=useState(false),[removed,setRemoved]=useState<{item:TodoItem;index:number}|null>(null);
  const editedItem=widget.todos.find(item=>item.id===draft.editingId),missingEditedItem=Boolean(draft.editingId&&!editedItem),editConflict=Boolean(editedItem&&editedItem.text!==draft.editingOriginal);
  const pending=widget.todos.filter(item=>!item.completed),completed=widget.todos.filter(item=>item.completed);
  useEffect(()=>{setShowCompleted(false);setRemoved(null);},[widget.id]);
  useEffect(()=>{if(editedItem?.completed)setShowCompleted(true);},[editedItem?.completed]);
  useEffect(()=>{if(draft.editingId){editor.current?.focus({preventScroll:true});editor.current?.select();}},[draft.editingId]);
  const change=(fn:(current:Widget)=>void)=>{mutateStore(s=>{const current=s.widgets.find(w=>w.id===widget.id);if(current)fn(current);});touchWidget();};
  function focusTask(id:string){requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>(`[data-todo-id="${CSS.escape(id)}"] .todo-label`)?.focus({preventScroll:true}));}
  function addTodo(){const value=draft.text.trim();if(!value)return;const id=crypto.randomUUID();change(w=>{w.todos.push({id,text:value,completed:false});});update({text:''});requestAnimationFrame(()=>{root.current?.querySelector(`[data-todo-id="${CSS.escape(id)}"]`)?.scrollIntoView({block:'nearest'});composer.current?.focus({preventScroll:true});});}
  function beginEdit(item:TodoItem){if(draft.editingId&&draft.editingId!==item.id){update({editError:'请先保存或取消当前编辑，再修改其他任务。'});return;}update({editingId:item.id,editingOriginal:item.text,editText:item.text,editError:''});}
  function saveEdit(){
    const item=store.widgets.find(w=>w.id===widget.id)?.todos.find(todo=>todo.id===draft.editingId);
    if(!item){update({editError:'任务已被移除，草稿仍保留。请复制草稿或取消编辑。'});return;}
    const value=draft.editText.trim();if(!value){update({editError:'任务内容不能为空'});return;}
    if(item.text!==draft.editingOriginal&&value!==item.text){update({editError:'任务已在其他窗口修改，草稿仍保留。请复制草稿，再取消编辑以查看最新内容。'});return;}
    change(w=>{const current=w.todos.find(todo=>todo.id===draft.editingId);if(current)current.text=value;});update({editingId:'',editError:''});focusTask(item.id);
  }
  function cancelEdit(){const id=draft.editingId;update({editingId:'',editError:''});focusTask(id);}
  async function copyDraft(){try{await navigator.clipboard.writeText(draft.editText);update({editError:'草稿已复制，可取消编辑后查看最新内容。'});}catch{update({editError:'无法复制，请在编辑框中选中文字复制。'});}}
  function editorKey(event:KeyboardEvent){if(event.nativeEvent.isComposing||event.keyCode===229)return;if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();saveEdit();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelEdit();}}
  function complete(id:string,value:boolean){if(draft.editingId===id){update({editError:'请先保存或取消文字修改，再切换完成状态。'});return;}change(w=>{const item=w.todos.find(todo=>todo.id===id);if(item)item.completed=value;});if(value&&!showCompleted)requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>('.todo-completed-toggle')?.focus({preventScroll:true}));else focusTask(id);}
  function removeTodo(id:string){change(w=>{const index=w.todos.findIndex(todo=>todo.id===id);if(index<0)return;setRemoved({item:{...w.todos[index]!},index});w.todos.splice(index,1);});if(draft.editingId===id)update({editingId:''});requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>('.todo-undo button')?.focus({preventScroll:true}));}
  function undoRemove(){if(!removed)return;const {item,index}=removed,id=crypto.randomUUID();change(w=>{if(!w.todos.some(todo=>todo.id===item.id))w.todos.splice(Math.min(index,w.todos.length),0,{...item,id});});if(item.completed)setShowCompleted(true);setRemoved(null);focusTask(id);}
  const editorContent=(orphan=false)=><div className="todo-editor" onPointerDown={e=>e.stopPropagation()}><Textarea ref={editor} value={draft.editText} onChange={e=>update({editText:e.target.value})} rows={2} aria-label={orphan?'已移除任务的草稿':'编辑待办内容'} spellCheck={false} onKeyDown={editorKey}/><p className="todo-draft-status">尚未保存 · Enter 保存，Shift+Enter 换行</p>{editConflict&&<p className="todo-error">最新内容：{editedItem?.text}</p>}{draft.editError&&<p className="todo-error" role="alert">{draft.editError}</p>}<div className="todo-edit-actions">{(editConflict||orphan)&&<Button size="xs" variant="ghost" onClick={()=>void copyDraft()}>复制草稿</Button>}<Button size="xs" variant="ghost" onClick={cancelEdit}>取消</Button>{!orphan&&<Button size="xs" variant="secondary" onClick={saveEdit}>保存</Button>}</div></div>;
  return <div ref={root} className={cn('todo-list',className)} aria-label={`${widget.title}清单`}>
    <div className="todo-scroll">{missingEditedItem&&<div className="todo-orphan-draft"><p className="todo-error" role="alert">任务已被移除，尚未保存的草稿仍保留。</p>{editorContent(true)}</div>}{!pending.length&&<div className="todo-empty">{widget.todos.length?<CheckCheck/>:<ListTodo/>}<p>{widget.todos.length?'全部完成':'添加第一件要做的事'}</p></div>}
      {[{kind:'pending',items:pending},{kind:'completed',items:completed}].map(section=><section key={section.kind} className="todo-section">{section.kind==='completed'&&section.items.length>0&&<Button variant="ghost" className="todo-completed-toggle" aria-expanded={showCompleted} onClick={()=>setShowCompleted(!showCompleted)}>{showCompleted?<ChevronDown/>:<ChevronRight/>}已完成 <span>{section.items.length}</span></Button>}{(section.kind==='pending'||showCompleted)&&<ul className="todo-items" aria-label={section.kind==='pending'?'未完成任务':'已完成任务'}>{section.items.map(item=><li key={item.id} className={cn('todo-row',item.completed&&'is-completed',draft.editingId===item.id&&'is-editing')} data-todo-id={item.id}><Checkbox checked={item.completed} aria-label={`${item.completed?'恢复':'完成'}：${item.text}`} onCheckedChange={value=>complete(item.id,value===true)}/>{draft.editingId===item.id?editorContent():<button className="todo-label" aria-label={`编辑待办：${item.text}`} title="点击编辑" onClick={()=>beginEdit(item)}>{item.text}</button>}{draft.editingId!==item.id&&<Button className="todo-delete" size="icon-xs" variant="ghost" aria-label={`删除待办：${item.text}`} title="删除待办" onClick={()=>removeTodo(item.id)}><X/></Button>}</li>)}</ul>}</section>)}
    </div>{removed&&<div className="todo-undo" role="status"><span>已删除待办</span><Button size="xs" variant="link" onClick={undoRemove}>撤销</Button><Button size="icon-xs" variant="ghost" aria-label="关闭删除提示" onClick={()=>setRemoved(null)}><X/></Button></div>}
    <div className="todo-composer" role="group" aria-label="添加待办"><Input ref={composer} value={draft.text} onChange={e=>update({text:e.target.value})} placeholder="添加待办…" aria-label="新待办内容" spellCheck={false} onKeyDown={event=>{if(event.nativeEvent.isComposing||event.keyCode===229)return;if(event.key==='Enter'){event.preventDefault();addTodo();}}}/><Button size="icon-sm" variant="secondary" disabled={!draft.text.trim()} aria-label="添加待办" title="添加待办 · Enter" onClick={addTodo}><Plus/></Button></div>
  </div>;
}
