import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { AppWindow, File, Folder, Monitor, Search, X } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { desktopQuickAppearance, desktopQuickResults, desktopQuickStep, type DesktopQuickScope, type QuickEntry } from '@/lib/desktopQuick';
import { iconSrc, launchEntry, loadPersistedState, resolveIconPairs, scanDesktop, scanFolder } from '@/lib/tauri';
import type { AppearanceSettings, DesktopEntry, PersistedState } from '@/types';

const scopes = [
  ['all', '全部'], ['desktop', '桌面'], ['zones', '收纳区'], ['mappings', '映射文件夹'],
] as const;
const PAGE_SIZE = 40;

export default function DesktopQuickWindow() {
  const [items, setItems] = useState<QuickEntry[]>([]);
  const [scope, setScope] = useState<DesktopQuickScope>('all');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [appearance, setAppearance] = useState<AppearanceSettings>();
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const iconCache = useRef(new Map<string, string | null>());
  const iconPending = useRef(new Set<string>());
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const opening = useRef(false);
  const results = useMemo(() => desktopQuickResults(items, scope, query), [items, scope, query]);
  const theme = desktopQuickAppearance(appearance);
  const selected = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    let live = true, revision = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function refresh() {
      input.current?.focus();
      if (timer !== undefined) clearTimeout(timer);
      const current = ++revision;
      setQuery(''); setScope('all'); setActive(0); setLimit(PAGE_SIZE);
      setItems([]); setFailure(''); setNotice(''); setLoading(true);
      timer = setTimeout(async () => {
        const fresh = () => live && current === revision;
        const local = scanDesktop().then(entries => {
          if (fresh()) setItems(currentItems => [...entries.map((entry): QuickEntry => ({
            entry, scope: entry.zone ? 'zones' : 'desktop', source: entry.zone || entry.sourceLabel,
          })), ...currentItems.filter(item => item.scope === 'mappings')]);
        }).catch(() => { if (fresh()) setNotice(currentNotice => currentNotice + '无法读取桌面或收纳区。'); });
        const mapped = loadPersistedState<PersistedState>().then(async state => {
          if (!fresh()) return;
          setAppearance(state?.appearance);
          const groups = new Map((state?.customGroups ?? []).flatMap(group =>
            group.mappedPath ? [[group.mappedPath.toLowerCase(), { name: group.name, path: group.mappedPath }]] as const : []));
          const loads = await Promise.allSettled([...groups.values()].map(async group =>
            (await scanFolder(group.path)).map((entry): QuickEntry => ({ entry, scope: 'mappings', source: group.name }))));
          if (!fresh()) return;
          setItems(currentItems => [...currentItems.filter(item => item.scope !== 'mappings'),
            ...loads.flatMap(result => result.status === 'fulfilled' ? result.value : [])]);
          if (loads.some(result => result.status === 'rejected')) setNotice(currentNotice => currentNotice + '部分映射文件夹无法读取。');
        }).catch(() => { if (fresh()) setNotice(currentNotice => currentNotice + '无法读取映射配置。'); });
        void Promise.allSettled([local, mapped]).then(() => { if (fresh()) setLoading(false); });
      }, 35);
    }
    const subscription = listen('nestra://desktop-quick-open', refresh);
    const onFocus = () => { input.current?.focus(); };
    window.addEventListener('focus', onFocus);
    // A cold WebView may mount after Rust emitted the first open event.
    void subscription.then(() => getCurrentWebviewWindow().isVisible()).then(visible => {
      if (live && visible && revision === 0) refresh();
    }).catch(() => {});
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      void subscription.then(dispose => dispose()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme.dark);
    return () => { document.documentElement.classList.remove('dark'); };
  }, [theme.dark]);

  useEffect(() => {
    // Only icon work, never block the scanner or clear search results.
    const missing = results.slice(0, limit).filter(({ entry }) => entry.kind !== 'shell'
      && !iconCache.current.has(entry.path) && !iconPending.current.has(entry.path)).slice(0, 24);
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
  }, [results, limit, icons]);

  useEffect(() => {
    list.current?.querySelector('[data-quick-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, limit]);

  const close = () => getCurrentWebviewWindow().hide().catch(() => setFailure('无法关闭窗口，请重试。'));
  async function open(entry: DesktopEntry) {
    if (opening.current) return;
    opening.current = true;
    setFailure('');
    try { await launchEntry(entry); await close(); }
    catch (error) { setFailure(`无法打开「${entry.name}」：${String(error)}`); }
    finally { opening.current = false; }
  }
  function handleKey(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); void close(); return; }
    if (event.target !== input.current) return;
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)
        && (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !query)) {
      event.preventDefault();
      const columns = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(' ').length : 1;
      const next = desktopQuickStep(selected, results.length, Math.max(1, columns), event.key);
      setActive(next); setLimit(value => Math.max(value, next + 1));
    } else if (event.key === 'Enter' && results[selected]) {
      event.preventDefault(); void open(results[selected].entry);
    }
  }
  function resetSelection() {
    setActive(0); setLimit(PAGE_SIZE);
    if (list.current) list.current.scrollTop = 0;
  }
  return <main className="search-window desktop-quick-window" onKeyDown={handleKey} aria-labelledby="desktop-quick-title"
    data-material={theme.material} style={{ '--quick-radius': theme.radius, '--quick-opacity': theme.opacity } as CSSProperties}>
    <header className="desktop-quick-heading">
      <span className="desktop-quick-brand" aria-hidden="true"><Monitor size={17}/></span><h1 id="desktop-quick-title">桌面快开</h1><kbd>Ctrl + Alt + Space</kbd>
      <Button variant="ghost" size="icon-sm" aria-label="关闭桌面快开" onClick={() => void close()}><X/></Button>
    </header>
    <div className="navigation-input">
      <Search className="size-4 text-muted-foreground" aria-hidden="true"/>
      <Input ref={input} autoFocus value={query} onChange={event => { setQuery(event.target.value); resetSelection(); }}
        aria-label="查找桌面内容" placeholder="查找文件、文件夹或程序快捷方式…" className="flex-1"/>
    </div>
    <Tabs value={scope} onValueChange={value => { setScope(value as DesktopQuickScope); resetSelection(); }} className="navigation-scopes">
      <TabsList variant="default" aria-label="桌面内容范围">{scopes.map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}</TabsList>
    </Tabs>
    {notice && <p className="navigation-status" role="status">{notice}</p>}
    {failure && <p className="navigation-status" role="alert">{failure}</p>}
    <div ref={list} className="desktop-quick-scroll">
      <div ref={grid} className="desktop-quick-grid" role="list" aria-label="桌面项目">
      {results.slice(0, limit).map(({ entry, source }, index) => {
        const Icon = entry.isApplication || entry.kind === 'shortcut' ? AppWindow : entry.kind === 'folder' ? Folder : entry.kind === 'shell' ? Monitor : File;
        return <div key={entry.id} role="listitem">
          <button type="button" className={`desktop-quick-result ${selected === index ? 'is-active' : ''}`}
            data-quick-active={selected === index} title={entry.path} onClick={() => void open(entry)}>
            <span className="desktop-quick-icon" aria-hidden="true">
              {icons[entry.path] ? <img src={icons[entry.path]!} alt="" onError={() => {
                iconCache.current.set(entry.path, null);
                setIcons(current => ({ ...current, [entry.path]: null }));
              }}/> : <Icon size={25}/>}
            </span>
            <strong>{entry.name}</strong>
            <span className="desktop-quick-source" title={source}>{source}</span>
          </button>
        </div>;
      })}
      </div>
      {results.length > limit && <div className="search-load-more"><Button variant="secondary" onClick={() => setLimit(value => value + PAGE_SIZE)}>继续显示（剩余 {results.length - limit} 项）</Button></div>}
      {results.length === 0 && <p className="desktop-quick-empty">{loading ? '正在读取桌面内容…' : query.trim() ? '没有找到匹配的项目' : '这个范围没有可显示的项目'}</p>}
    </div>
    <footer className="navigation-footer"><span>方向键选择　Enter 打开　Esc 关闭</span><span role="status">{results.length} 项{loading ? ' · 正在读取' : ''}</span></footer>
  </main>;
}
