import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { AppWindow, ArrowLeft, Boxes, ChevronRight, ExternalLink, File, Folder, FolderOpen, LayoutGrid, Link2, Monitor, Search, X } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { desktopQuickAppearance, desktopQuickResults, desktopQuickStep, orderQuickLocation, quickItemKind, quickLocationEntries, quickLocations, quickPathKey, quickScanBudget, quickResultIndex, quickEnterResult, type QuickItemKind, type QuickLocation } from '@/lib/desktopQuick';
import { iconSrc, launchEntry, listStorageZones, loadPersistedState, openEntry, resolveIconPairs, scanDesktop, scanFolder, type StorageZone } from '@/lib/tauri';
import type { DesktopEntry, PersistedState } from '@/types';

const PAGE_SIZE = 48;
const kinds = [['all', '全部'], ['folder', '文件夹'], ['file', '文件'], ['app', '应用']] as const;
const sections = [
  { key: 'desktop', title: '桌面', icon: Monitor },
  { key: 'zones', title: '收纳区', icon: Boxes },
  { key: 'category', title: '分类面板', icon: LayoutGrid },
  { key: 'mappings', title: '映射目录', icon: Link2 },
] as const;
const typeInfo = {
  folder: { label: '文件夹', icon: Folder },
  file: { label: '文件', icon: File },
  app: { label: '应用', icon: AppWindow },
  system: { label: '系统', icon: Monitor },
};
type Crumb = { name: string; path: string };
type Directory = { entries: DesktopEntry[]; error?: boolean };

export default function DesktopQuickWindow() {
  const [snapshot, setSnapshot] = useState<PersistedState | null>(null);
  const [storage, setStorage] = useState<StorageZone[]>([]);
  const [desktop, setDesktop] = useState<DesktopEntry[]>([]);
  const [directories, setDirectories] = useState<Record<string, Directory>>({});
  const [epoch, setEpoch] = useState(0);
  const [placeId, setPlaceId] = useState('overview');
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | QuickItemKind>('all');
  const [activePath, setActivePath] = useState<string | null>(null);
  const [scanSettled, setScanSettled] = useState(0);
  const [launching, setLaunching] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const iconCache = useRef(new Map<string, string | null>());
  const iconPending = useRef(new Set<string>());
  const pending = useRef(new Map<string, number>());
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const opening = useRef(false);
  const places = useMemo(() => quickLocations(snapshot?.customGroups ?? [], desktop, storage), [snapshot, desktop, storage]);
  const tabSections = (snapshot?.tabGroups ?? []).map(tab => ({
    id: tab.id, title: tab.name, places: tab.groupIds.flatMap(id => places.find(p => p.group?.id === id) ?? []),
  })).filter(section => section.places.length > 0);
  const tabPlaceIds = new Set(tabSections.flatMap(section => section.places.map(p => p.id)));
  const place = places.find(p => p.id === placeId);
  const currentFolder = trail.at(-1);
  const currentPath = currentFolder?.path ?? place?.path;
  const explorerPath = currentPath ?? place?.physicalPath;
  const allSearch = !place && !!query.trim();
  const searchPaths = useMemo(() => {
    if (currentPath) return [currentPath];
    return allSearch ? places.flatMap(p => p.path ? [p.path] : []) : [];
  }, [currentPath, allSearch, places]);
  const resolvedPath = (path: string) => directories[quickPathKey(path)];
  const dirPending = searchPaths.some(path => !resolvedPath(path));
  const dirError = currentPath && resolvedPath(currentPath)?.error;
  const partialError = allSearch && searchPaths.some(path => resolvedPath(path)?.error);
  const theme = desktopQuickAppearance(snapshot?.appearance);
  const results = useMemo(() => {
    const read = (path: string) => directories[quickPathKey(path)]?.entries ?? [];
    if (!place && !allSearch) return [];
    const from = (p: QuickLocation, path?: string) => (path ? read(path) : quickLocationEntries(p, desktop))
      .filter(entry => !entry.isHidden && (kind === 'all' || quickItemKind(entry) === kind))
      .map(entry => ({ entry, source: p.title, locationId: p.id, scope: p.kind === 'category' ? 'desktop' as const : p.kind }));
    if (!place) {
      const sources = places.filter(p => p.kind !== 'category');
      return desktopQuickResults(sources.flatMap(p => from(p, p.path)), 'all', query);
    }
    const local = from(place, currentPath);
    if (query.trim()) return desktopQuickResults(local, 'all', query);
    const byId = new Map(local.map(item => [item.entry.id, item]));
    return orderQuickLocation(local.map(item => item.entry), !currentFolder && place.group ? snapshot?.itemOrders?.[place.group.id] ?? [] : [])
      .map(entry => byId.get(entry.id)!);
  }, [place, currentPath, currentFolder, allSearch, places, directories, desktop, kind, query, snapshot]);
  const selected = quickResultIndex(results, activePath);
  const visibleLimit = Math.max(limit, selected + 1);

  useEffect(() => {
    let live = true;
    function refresh() {
      const run = ++generation.current;
      const fresh = () => live && run === generation.current;
      setPlaceId('overview'); setTrail([]); setQuery(''); setKind('all'); setActivePath(null); setLimit(PAGE_SIZE);
      setDirectories({}); setEpoch(run);
      setFailure(''); setNotice(''); setLoading(true); setLaunching(null);
      input.current?.focus();
      const config = loadPersistedState<PersistedState>().then(state => { if (fresh()) setSnapshot(state); })
        .catch(() => { if (fresh()) { setSnapshot(null); setNotice('未能读取收纳区设置；仍可浏览桌面文件。'); } });
      const files = scanDesktop(true).then(entries => { if (fresh()) setDesktop(entries); })
        .catch(() => { if (fresh()) { setDesktop([]); setNotice('暂时无法读取桌面。'); } });
      const zones = listStorageZones(true).then(entries => { if (fresh()) setStorage(entries); })
        .catch(() => { if (fresh()) setStorage([]); });
      void Promise.allSettled([config, files, zones]).then(() => { if (fresh()) setLoading(false); });
    }
    const unlisten = listen('nestra://desktop-quick-open', refresh);
    const onFocus = () => { input.current?.focus(); };
    window.addEventListener('focus', onFocus);
    void unlisten.then(() => getCurrentWebviewWindow().isVisible()).then(visible => {
      if (live && visible && generation.current === 0) refresh();
    }).catch(() => {});
    return () => {
      live = false; ++generation.current;
      window.removeEventListener('focus', onFocus);
      void unlisten.then(dispose => dispose()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (epoch !== generation.current || epoch === 0) return;
    const wanted = [...new Map(searchPaths.map(path => [quickPathKey(path), path])).entries()]
      .filter(([key]) => !directories[key] && !pending.current.has(`${epoch}:${key}`));
    const slots = quickScanBudget(pending.current.size, !!currentPath);
    for (const [key, path] of wanted.slice(0, slots)) {
      const token = `${epoch}:${key}`;
      pending.current.set(token, epoch);
      void scanFolder(path, true).then(entries => ({ entries })).catch(() => ({ entries: [], error: true })).then(value => {
        pending.current.delete(token);
        if (epoch === generation.current) setDirectories(current => ({ ...current, [key]: value }));
        else setScanSettled(value => value + 1);
      });
    }
  }, [directories, epoch, searchPaths, currentPath, scanSettled]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme.dark);
    return () => { document.documentElement.classList.remove('dark'); };
  }, [theme.dark]);

  useEffect(() => {
    if (iconPending.current.size) return;
    const missing = results.slice(0, visibleLimit).filter(({ entry, scope }) => entry.kind !== 'shell'
      && (scope !== 'mappings' || quickItemKind(entry) === 'app')
      && !iconCache.current.has(entry.path)).slice(0, 8);
    if (!missing.length) return;
    for (const { entry } of missing) iconPending.current.add(entry.path);
    void resolveIconPairs(missing.map(({ entry }) => [entry.path, entry.target || entry.path]))
      .catch((): Record<string, string | null> => ({})).then(resolved => {
        for (const { entry } of missing) {
          iconPending.current.delete(entry.path);
          iconCache.current.set(entry.path, iconSrc(resolved[entry.path] ?? null));
        }
        setIcons(Object.fromEntries(iconCache.current));
      });
  }, [results, visibleLimit, icons]);

  useEffect(() => {
    if (selected >= 0) list.current?.querySelector('[data-quick-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, visibleLimit]);

  const close = () => getCurrentWebviewWindow().hide().catch(() => setFailure('无法关闭窗口，请重试。'));
  function resetSelection() {
    setActivePath(null); setLimit(PAGE_SIZE);
    if (list.current) list.current.scrollTop = 0;
  }
  function navigate(id: string, crumbs: Crumb[] = []) {
    setPlaceId(id); setTrail(crumbs); setQuery(''); setKind('all'); setFailure(''); resetSelection();
    input.current?.focus();
  }
  function back() {
    if (trail.length) navigate(placeId, trail.slice(0, -1));
    else if (place || allSearch) navigate('overview');
  }
  function retry(path: string) {
    const key = quickPathKey(path);
    setDirectories(prev => { const next = { ...prev }; delete next[key]; return next; });
  }
  async function launch(action: () => Promise<void>, name: string) {
    if (opening.current) return;
    opening.current = true;
    const job = generation.current;
    setFailure('');
    setLaunching(name);
    try { await action(); if (job === generation.current) await close(); }
    catch { if (job === generation.current) setFailure(`无法打开「${name}」，请确认它仍然可用。`); }
    finally { opening.current = false; if (job === generation.current) setLaunching(null); }
  }
  function activate(entry: DesktopEntry, locationId?: string) {
    if (entry.kind === 'folder') {
      const root = place ?? places.find(p => p.id === locationId);
      if (root) navigate(root.id, [...trail, { name: entry.name, path: entry.path }]);
      return;
    }
    void launch(() => launchEntry(entry, true), entry.name);
  }
  function handleKey(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); void close(); return; }
    if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); back(); return; }
    if (event.target !== input.current) return;
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)
        && (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !query)) {
      if (!results.length) return;
      event.preventDefault();
      const columns = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(' ').length : 1;
      const next = selected < 0 ? (event.key === 'ArrowUp' ? results.length - 1 : 0)
        : desktopQuickStep(selected, results.length, Math.max(1, columns), event.key);
      setActivePath(quickPathKey(results[next].entry.path)); setLimit(value => Math.max(value, next + 1));
    } else if (event.key === 'Enter') {
      const item = quickEnterResult(results, activePath);
      if (!item) return;
      event.preventDefault();
      if (event.altKey && item.entry.kind === 'folder')
        void launch(() => openEntry(item.entry.path, 'path', true), item.entry.name);
      else activate(item.entry, item.locationId);
    }
  }
  const overview = !place && !allSearch;
  const title = currentFolder?.name ?? place?.title ?? (allSearch ? '搜索结果' : '位置总览');
  return <main className="search-window desktop-quick-window" onKeyDown={handleKey} aria-labelledby="desktop-quick-title"
    data-material={theme.material} style={{ '--quick-radius': theme.radius, '--quick-opacity': theme.opacity } as CSSProperties}>
    <header className="desktop-quick-heading">
      <span className="desktop-quick-brand" aria-hidden="true"><Monitor size={17}/></span>
      <h1 id="desktop-quick-title">桌面快开</h1>
      <div className="desktop-quick-search"><Search size={16} aria-hidden="true"/>
        <Input ref={input} autoFocus value={query} onChange={event => { setQuery(event.target.value); resetSelection(); }}
          aria-label="查找桌面内容" placeholder={place ? `在「${title}」中查找` : '查找桌面、收纳区和映射目录中的项目'} />
        {query && <button type="button" aria-label="清空搜索" className="desktop-quick-search-clear" onClick={() => { setQuery(''); resetSelection(); input.current?.focus(); }}><X size={14}/></button>}
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="关闭桌面快开" onClick={() => void close()}><X/></Button>
    </header>
    <div className="desktop-quick-browser">
      <nav className="desktop-quick-sidebar" aria-label="浏览位置">
        <button type="button" className="desktop-quick-nav-item" aria-current={!place ? 'page' : undefined} onClick={() => navigate('overview')}><LayoutGrid size={16}/>位置总览</button>
        {sections.map(({ key, title: label, icon: Icon }) => {
          const group = places.filter(p => p.kind === key && !tabPlaceIds.has(p.id));
          if (!group.length) return null;
          return <section key={key} className="desktop-quick-nav-group" aria-label={label}>
            {key !== 'desktop' && <p>{label}</p>}
            {group.map(p => <button type="button" key={p.id} className="desktop-quick-nav-item"
              aria-current={placeId === p.id ? 'page' : undefined} title={p.path || p.title} onClick={() => navigate(p.id)}>
              <Icon size={15}/><span>{p.title}</span>
            </button>)}
          </section>;
        })}
        {tabSections.map(section => <section key={section.id} className="desktop-quick-nav-group" aria-label={section.title}>
          <p>{section.title}</p>
          {section.places.map(p => <button key={p.id} type="button" className="desktop-quick-nav-item"
            aria-current={placeId === p.id ? 'page' : undefined} onClick={() => navigate(p.id)} title={p.path || p.title}>
            <Folder size={15}/><span>{p.title}</span>
          </button>)}
        </section>)}
      </nav>
      <section className="desktop-quick-content" aria-label={title}>
        <div className="desktop-quick-context">
          <nav className="desktop-quick-crumbs" aria-label="当前位置">
            {(place || allSearch) && <Button variant="ghost" size="icon-xs" aria-label="返回上一级" title="Alt + ←" onClick={back}><ArrowLeft/></Button>}
            {place && trail.length > 0 && <>
              <button type="button" onClick={() => navigate(place.id)} title={place.title}>{place.title}</button><ChevronRight size={12}/>
              {trail.slice(0, -1).map((crumb, i) => <span className="desktop-quick-crumb-part" key={crumb.path}><button type="button" onClick={() => navigate(place.id, trail.slice(0, i + 1))} title={crumb.name}>{crumb.name}</button><ChevronRight size={12}/></span>)}
            </>}
            <h2 title={currentPath || title}>{title}</h2>
          </nav>
          {explorerPath && <Button variant="ghost" size="icon-xs" title="在资源管理器中打开此文件夹" aria-label="在资源管理器中打开此文件夹"
            onClick={() => void launch(() => openEntry(explorerPath, 'path', true), title)}><ExternalLink/></Button>}
        </div>
        {!overview && <div className="desktop-quick-toolbar" role="group" aria-label="项目类型">
          {kinds.map(([value, label]) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => { setKind(value); resetSelection(); }}>{label}</button>)}
          <span className="desktop-quick-count" role="status">{dirPending || loading ? `${results.length} 项 · 读取中` : `${results.length} 项`}</span>
        </div>}
        {notice && <p className="navigation-status" role="status">{notice}</p>}
        {launching && <p className="navigation-status" role="status">正在打开「{launching}」…</p>}
        {failure && <p className="navigation-status" role="alert">{failure}</p>}
        {partialError && <p className="navigation-status" role="status">部分映射目录未能读取，已显示可用结果。</p>}
        <div ref={list} className="desktop-quick-scroll">
          {overview ? <>
            <p className="desktop-quick-intro">按桌面位置浏览，或直接搜索常用文件和应用。</p>
            {sections.map(({ key, title: label, icon: Icon }) => {
              const group = places.filter(p => p.kind === key && !tabPlaceIds.has(p.id));
              if (!group.length) return null;
              return <section key={key} className="desktop-quick-location-section" aria-label={label}>
                <h3>{label}</h3>
                <div className="desktop-quick-locations">{group.map(p => <button type="button" key={p.id} onClick={() => navigate(p.id)} title={p.path || p.title}>
                  <span className="desktop-quick-location-icon" data-location={key}><Icon size={19}/></span>
                  <span className="desktop-quick-location-label"><strong>{p.title}</strong><small>{p.path || `${quickLocationEntries(p, desktop).length} 项`}</small></span>
                  <ChevronRight size={13} className="desktop-quick-chevron"/>
                </button>)}</div>
              </section>;
            })}
            {tabSections.map(section => <section key={section.id} className="desktop-quick-location-section" aria-label={section.title}>
              <h3>{section.title}</h3><div className="desktop-quick-locations">{section.places.map(p => <button key={p.id} type="button" onClick={() => navigate(p.id)} title={p.path || p.title}>
                <span className="desktop-quick-location-icon" data-location={p.kind}><Folder size={19}/></span>
                <span className="desktop-quick-location-label"><strong>{p.title}</strong><small>{p.path || `${quickLocationEntries(p, desktop).length} 项`}</small></span>
                <ChevronRight size={13} className="desktop-quick-chevron"/>
              </button>)}</div>
            </section>)}
          </> : <>
            <div ref={grid} className="desktop-quick-grid" role="list" aria-label="桌面项目">
              {results.slice(0, visibleLimit).map(({ entry, source, locationId }, index) => {
                const type = quickItemKind(entry); const { icon: Icon, label } = typeInfo[type];
                const extension = type === 'file' ? entry.name.match(/\.([a-z\d]{1,7})$/i)?.[1]?.toUpperCase() : undefined;
                return <div key={entry.id} className="desktop-quick-result-cell" role="listitem">
                  <button type="button" className={`desktop-quick-result ${selected === index ? 'is-active' : ''}`} data-kind={type}
                    data-quick-active={selected === index} title={entry.path} onClick={() => activate(entry, locationId)}>
                    <span className="desktop-quick-icon" aria-hidden="true">
                      {icons[entry.path] ? <img src={icons[entry.path]!} alt="" onError={() => {
                        iconCache.current.set(entry.path, null); setIcons(current => ({ ...current, [entry.path]: null }));
                      }}/> : <Icon size={27}/>}
                    </span>
                    <strong>{entry.name}</strong>
                    <span className="desktop-quick-source">{allSearch ? source : extension || label}</span>
                  </button>
                  {type === 'folder' && <Button variant="ghost" size="icon-xs" className="desktop-quick-folder-open"
                    aria-label={`在资源管理器中打开「${entry.name}」`} title="在资源管理器中打开 (Alt+Enter)"
                    onClick={() => void launch(() => openEntry(entry.path, 'path', true), entry.name)}><ExternalLink/></Button>}
                </div>;
              })}
            </div>
            {results.length > visibleLimit && <div className="search-load-more"><Button variant="secondary" onClick={() => setLimit(visibleLimit + PAGE_SIZE)}>显示剩余 {results.length - visibleLimit} 项</Button></div>}
            {results.length === 0 && <div className="desktop-quick-empty"><FolderOpen size={24}/><strong>{dirPending || loading ? '正在读取…' : dirError ? '暂时无法读取这个文件夹' : query.trim() ? '没有匹配的项目' : '这里还没有可显示的项目'}</strong>
              {dirError && currentPath && <Button variant="outline" size="sm" onClick={() => retry(currentPath)}>重试</Button>}
            </div>}
          </>}
        </div>
      </section>
    </div>
    <footer className="desktop-quick-footer"><span><kbd>↑↓←→</kbd> 选择 <kbd>Enter</kbd> 打开 <kbd>Alt+Enter</kbd> 用资源管理器打开文件夹 <kbd>Esc</kbd> 关闭</span><span><kbd>Ctrl + Alt + Space</kbd> 呼出</span></footer>
  </main>;
}
