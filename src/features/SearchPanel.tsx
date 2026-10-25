import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Search, X, Pin, FolderOpen, Copy, AppWindow, Folder, File, LoaderCircle } from 'lucide-react';
import { motion } from 'motion/react';
import StatusNotice from '@/components/StatusNotice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cachedIconUrl, mutateStore, pinEntry, searchWithDetails, showStatus, useNestra } from '@/stores/state';
import { launchEntry, revealEntry, recentLaunches, scanApplications, searchEverything } from '@/lib/tauri';
import type { SearchScope, SearchResult } from '@/lib/search';
import type { DesktopEntry } from '@/types';
const scopes: {label:string;value:SearchScope}[] = [{label:'全部',value:'all'},{label:'应用',value:'applications'},{label:'桌面',value:'desktop'},{label:'收纳区',value:'zones'},{label:'映射文件夹',value:'mappings'},{label:'全盘文件',value:'everything'}];
export default function SearchPanel({compact = false, initialQuery = '', focusSignal = 0, onClose}: {compact?:boolean;initialQuery?:string;focusSignal?:number;onClose?:()=>void}) {
  const state = useNestra();
  const [query,setQuery]=useState(initialQuery),[scope,setScope]=useState<SearchScope>('all');
  const [results,setResults]=useState<DesktopEntry[]>([]),[message,setMessage]=useState(''),[loading,setLoading]=useState(false),[active,setActive]=useState(0),[visibleCount,setVisibleCount]=useState(24),[provider,setProvider]=useState('正在检测…'),[refresh,setRefresh]=useState(0);
  const input=useRef<HTMLInputElement>(null),root=useRef<HTMLDivElement>(null),resultsRef=useRef(results),activeRef=useRef(active),revision=useRef(0);
  resultsRef.current=results;activeRef.current=active;
  useEffect(()=>setQuery(initialQuery),[initialQuery]);
  useEffect(()=>{setVisibleCount(24);setResults([]);setActive(0);},[query,scope]);
  useEffect(()=>{
    const current=++revision.current;setLoading(true);setMessage('');
    const timer=window.setTimeout(async()=>{
      const apply=(found:SearchResult)=>{if(current!==revision.current)return;const selected=resultsRef.current[activeRef.current]?.id;const next=Math.max(0,found.entries.findIndex(entry=>entry.id===selected));resultsRef.current=found.entries;activeRef.current=next;setResults(found.entries);setMessage(found.message);setActive(next);setVisibleCount(value=>Math.max(value,next+1));};
      try{apply(await searchWithDetails(query,scope,apply));}catch(error){if(current===revision.current)setMessage(`搜索失败：${error}`);}finally{if(current===revision.current)setLoading(false);}
    },140);
    return()=>{window.clearTimeout(timer);revision.current++;};
  },[query,scope,refresh,state.applications.length]);
  async function detect(){try{setProvider((await searchEverything('')).message);}catch{setProvider('Everything 连接失败');}}
  async function refreshApps(){try{const apps=await scanApplications();mutateStore(s=>{s.applications=apps;});showStatus(`应用目录已刷新：${apps.length} 项`);setRefresh(v=>v+1);}catch(error){showStatus(`应用目录刷新失败：${error}`);}}
  useEffect(()=>{void detect();},[]);
  useEffect(()=>{
    let live=true;
    void recentLaunches().then(paths=>{if(live){mutateStore(s=>{s.recentLaunchPaths=paths;});setRefresh(v=>v+1);}}).catch(()=>{});
    if(compact){input.current?.focus();input.current?.select();}
    return()=>{live=false;};
  },[focusSignal,compact]);
  useEffect(()=>{root.current?.querySelector('[data-search-active="true"]')?.scrollIntoView({block:'nearest'});},[active]);
  async function open(entry:DesktopEntry){try{await launchEntry(entry);if(compact)onClose?.();}catch(error){showStatus(`无法打开「${entry.name}」：${error}`);}}
  async function reveal(entry:DesktopEntry){try{await revealEntry(entry.path);}catch(error){showStatus(`无法定位：${error}`);}}
  async function copy(entry:DesktopEntry){try{await navigator.clipboard.writeText(entry.path);showStatus('路径已复制');}catch{showStatus('无法复制路径');}}
  function onKey(event:KeyboardEvent){
    if(event.nativeEvent.isComposing||event.keyCode===229)return;
    if(event.key==='Escape'){event.preventDefault();onClose?.();}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      if((event.target as HTMLElement).closest('[role="tablist"],button'))return;
      event.preventDefault();const next=Math.max(0,Math.min(results.length-1,active+(event.key==='ArrowDown'?1:-1)));setActive(next);setVisibleCount(v=>Math.max(v,next+1));
    }
    if(event.key==='Enter'&&!(event.target as HTMLElement).closest('button')&&results[active]){event.preventDefault();void open(results[active]);}
  }
  return <div ref={root} className={`navigation-panel ${compact?'is-compact':''}`} onKeyDown={onKey}>
    <div className="navigation-input"><Search className="size-5 text-muted-foreground"/><Input ref={input} data-search-input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索文件、文件夹和应用…" aria-label="搜索文件、文件夹和应用" className="h-10 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"/>{compact&&<Button variant="ghost" size="icon-sm" aria-label="关闭搜索" onClick={onClose}><X/></Button>}</div>
    <Tabs value={scope} onValueChange={value=>setScope(value as SearchScope)} className="navigation-scopes"><TabsList variant="line" aria-label="搜索范围">{scopes.map(item=><TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}</TabsList></Tabs>
    <p className="navigation-status" role="status">{loading&&<motion.span animate={{rotate:360}} transition={{repeat:Infinity,duration:1,ease:'linear'}}><LoaderCircle className="size-3.5"/></motion.span>}{message||'准备搜索'}{!query.trim()&&state.recentLaunchPaths.length>0&&<span> · 本次运行最近打开的项目优先</span>}</p>
    {state.statusAction&&<StatusNotice inline/>}
    <div className="navigation-results" role="list" aria-label="搜索结果">{results.slice(0,visibleCount).map((entry,index)=>{
      const icon=cachedIconUrl(entry.path),Icon=entry.isApplication?AppWindow:entry.kind==='folder'?Folder:File;
      return <div key={entry.id} role="listitem" data-search-active={index===active} className={`navigation-result ${index===active?'is-active':''}`} onMouseEnter={()=>setActive(index)}>{icon?<img src={icon} className="search-icon" alt=""/>:<Icon className="result-icon"/>}<button className="result-main" onClick={()=>void open(entry)}><strong>{entry.name}</strong><small title={entry.path}>{entry.path}</small></button><span className="source-badge">{entry.sourceLabel}</span><div className="result-actions"><Button size="icon-xs" variant="ghost" aria-label="固定到快捷启动" title="固定到快捷启动" onClick={()=>pinEntry(entry)}><Pin/></Button>{entry.kind!=='shell'&&<Button size="icon-xs" variant="ghost" aria-label="打开所在位置" title="打开所在位置" onClick={()=>void reveal(entry)}><FolderOpen/></Button>}<Button size="icon-xs" variant="ghost" aria-label="复制路径" title="复制路径" onClick={()=>void copy(entry)}><Copy/></Button></div></div>;
    })}{visibleCount<results.length&&<div className="search-load-more"><Button variant="secondary" onClick={()=>setVisibleCount(v=>v+24)}>继续显示（还有 {results.length-visibleCount} 项）</Button></div>}{!loading&&!results.length&&<div className="manager-empty"><Search/><h3>没有找到匹配项目</h3><p>调整关键词或范围。全盘文件需要 Everything 已运行并建立索引。</p></div>}</div>
    {!compact&&<div className="settings-row"><div><strong>搜索来源</strong><p>{provider} · 应用目录 {state.applications.length} 项</p></div><div className="flex gap-2"><Button variant="outline" onClick={()=>void detect()}>重新检测</Button><Button variant="outline" onClick={()=>void refreshApps()}>刷新应用目录</Button></div></div>}
    <footer className="navigation-footer"><span>↑↓ 选择　Enter 打开　Esc 关闭</span><span>{Math.min(visibleCount,results.length)} / {results.length} 个已加载结果</span></footer>
  </div>;
}
