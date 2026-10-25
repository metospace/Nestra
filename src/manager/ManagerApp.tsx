import { useEffect, useRef, useState } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { ArchiveRestore, ChevronRight, FileText, Folders, House, LoaderCircle, Monitor, Palette, PanelsTopLeft, RefreshCw, Rocket, Search, Settings2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import NestraLogo from '@/components/NestraLogo';
import SearchPanel from '@/features/SearchPanel';
import EverythingSetup from '@/features/EverythingSetup';
import { refreshEverythingStatus } from '@/stores/everythingSetup';
import StatusNotice from '@/components/StatusNotice';
import { confirmDialog, useGlobalAppearanceForAll, initialize, refreshDisplays, rescan, setAppearance, setHideNativeIcons, setPaused, setStartWithWindows, showStatus, useNestra } from '@/stores/state';
import { requestOpenSearch } from '@/lib/tauri';
import WorkspaceOverview from './WorkspaceOverview';
import FileManagement from './FileManagement';
import LauncherManagement from './LauncherManagement';
import WidgetManagement from './WidgetManagement';
import LayoutManagement from './LayoutManagement';
import DataManagement from './DataManagement';
import { Field, FormSelect, PageHeading, Section } from './primitives';
import type { AppearanceSettings } from '@/types';
import './manager.css';

const sections = [
  { id: 'overview', label: '桌面空间', icon: House, group: '工作空间' },
  { id: 'files', label: '文件与收纳', icon: Folders, group: '工作空间' },
  { id: 'launcher', label: '快捷启动', icon: Rocket, group: '工作空间' },
  { id: 'widgets', label: '小组件', icon: PanelsTopLeft, group: '工作空间' },
  { id: 'search', label: '搜索', icon: Search, group: '工作空间' },
  { id: 'appearance', label: '全局外观', icon: Palette, group: '偏好设置' },
  { id: 'layout', label: '布局与显示器', icon: Monitor, group: '偏好设置' },
  { id: 'data', label: '数据与恢复', icon: ArchiveRestore, group: '偏好设置' },
  { id: 'system', label: '系统', icon: Settings2, group: '偏好设置' },
] as const;
type SectionId = typeof sections[number]['id'];
const materials = [{ label: '磨砂', value: 'matte' }, { label: '清透', value: 'clear' }, { label: '玻璃', value: 'glass' }, { label: '亚克力', value: 'acrylic' }];

export default function ManagerApp() {
  const store = useNestra();
  const [section, setSection] = useState<SectionId>('overview');
  const [initialId, setInitialId] = useState('');
  const [addSignal, setAddSignal] = useState(0);
  const [creationKind, setCreationKind] = useState<'zone' | 'folder'>();
  const [refreshing, setRefreshing] = useState(false);
  const reducedMotion = useReducedMotion();
  const main = useRef<HTMLElement>(null);
  const currentWindow = getCurrentWebviewWindow();
  const navigate = (id: string, objectId?: string) => { if (sections.some(item => item.id === id)) setSection(id as SectionId); setInitialId(objectId ?? ''); setAddSignal(0); };
  const add = (kind?: 'zone' | 'folder') => { setCreationKind(kind); setInitialId(''); setSection('files'); setAddSignal(value => value + 1); };
  const refresh = async () => { setRefreshing(true); try { await rescan(); await refreshDisplays(); await refreshEverythingStatus(true); } catch (error) { showStatus(`刷新失败：${error}`); } finally { setRefreshing(false); } };
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      await initialize();
      if (cancelled) return;
      void refresh();
      const stop = await currentWindow.listen<{ module: string; objectId?: string }>('nestra://manager-route', event => navigate(event.payload.module === 'surfaces' ? 'appearance' : event.payload.module, event.payload.objectId));
      if (cancelled) stop(); else unlisten = stop;
    })().catch(error => showStatus(`初始化失败：${error}`));
    return () => { cancelled = true; unlisten?.(); };
  }, []);
  useEffect(() => { main.current?.scrollTo({ top: 0 }); }, [section]);
  const appearance = (key: keyof AppearanceSettings, value: unknown) => setAppearance({ [key]: value });
  const independentCount = Object.values(store.panelLayouts).filter(layout => layout.appearance).length;
  const unifyAppearance = async () => { if (await confirmDialog('将所有收纳栏恢复为全局风格？已有独立样式将被替换，位置和文件显示布局保留。')) useGlobalAppearanceForAll(); };
  const current = sections.find(item => item.id === section)!;
  return <div className="control-center">
    <header className="manager-titlebar">
      <Button variant="ghost" className="manager-brand" onClick={() => navigate('overview')} aria-label="返回桌面空间"><NestraLogo className="manager-logo"/><strong>Nestra</strong><span>控制中心</span></Button>
      <Button size="sm" variant="ghost" className="manager-global-search" aria-label="搜索文件和应用" onClick={() => void requestOpenSearch()}><Search/><span>搜索文件、应用</span><kbd>Ctrl Alt F</kbd></Button>
    </header>
    <ResizablePanelGroup orientation="horizontal" className="manager-workspace">
      <ResizablePanel defaultSize="205px" minSize="175px" maxSize="280px" className="manager-navigation-panel">
        <aside className="manager-sidebar"><nav aria-label="控制中心导航">{['工作空间', '偏好设置'].map(group => <div className="nav-group" key={group}><span className="nav-group-label">{group}</span>{sections.filter(item => item.group === group).map(item => <Button key={item.id} variant="ghost" className={`manager-nav-item ${section === item.id ? 'is-active' : ''}`} aria-current={section === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon/><span>{item.label}</span>{section === item.id && <ChevronRight className="nav-active-arrow"/>}</Button>)}</div>)}</nav><div className="sidebar-caption"><span className={`status-dot ${store.paused ? 'is-paused' : ''}`}/><span>{store.paused ? '桌面内容已暂停' : '桌面内容运行中'}</span></div></aside>
      </ResizablePanel>
      <ResizableHandle aria-label="调整导航栏宽度"/>
      <ResizablePanel minSize="480px"><main ref={main} className="manager-main" aria-label={current.label}>
        {store.persistenceBlocked && <div className="error-callout" role="alert">配置加载失败或版本不兼容，已阻止写入以保护原配置。请检查数据与恢复，或使用与配置版本一致的程序。</div>}
        {!store.ready ? <div className="manager-empty" role="status"><LoaderCircle className="animate-spin"/><p>正在加载工作空间…</p></div> : <motion.div key={section} initial={reducedMotion ? false : { opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .14 }} className="manager-page">
          {section === 'overview' && <WorkspaceOverview onNavigate={navigate} onAdd={add}/>}
          {section === 'files' && <FileManagement initialId={initialId} addSignal={addSignal} initialKind={creationKind}/>}
          {section === 'launcher' && <LauncherManagement/>}
          {section === 'widgets' && <WidgetManagement/>}
          {section === 'layout' && <LayoutManagement/>}
          {section === 'data' && <DataManagement/>}
          {section === 'search' && <><PageHeading title="搜索" description="查找桌面、收纳区、映射目录、已安装应用和全盘索引中的内容。"/><SearchPanel/></>}
          {section === 'appearance' && <><PageHeading title="全局外观" description="统一桌面面板的默认风格，也可以为单个收纳栏保留独立样式。"><Button variant="outline" disabled={!independentCount} onClick={() => void unifyAppearance()}>统一所有收纳栏</Button></PageHeading><div className="appearance-columns"><Section title="默认样式" description={independentCount ? `${independentCount} 个收纳栏设有独立样式。` : '所有收纳栏均跟随全局风格。'}><div className="form-stack"><Field label="主题"><FormSelect label="主题" value={store.appearance.theme ?? 'light'} options={[{ label: '浅色', value: 'light' }, { label: '深色', value: 'dark' }]} onValueChange={value => appearance('theme', value)}/></Field><Field label="桌面材质"><FormSelect label="桌面材质" value={store.appearance.surfaceMaterial} options={materials} onValueChange={value => appearance('surfaceMaterial', value)}/></Field><Field label="圆角"><FormSelect label="圆角" value={store.appearance.cornerStyle} options={[{ label: '方正', value: 'square' }, { label: '紧凑', value: 'compact' }, { label: '标准', value: 'standard' }, { label: '圆润', value: 'rounded' }]} onValueChange={value => appearance('cornerStyle', value)}/></Field><Field label="边界"><FormSelect label="边界" value={store.appearance.borderStyle} options={[{ label: '无边框', value: 'none' }, { label: '细线', value: 'subtle' }, { label: '清晰边框', value: 'strong' }, { label: '阴影', value: 'shadow' }]} onValueChange={value => appearance('borderStyle', value)}/></Field><Field label={`面板不透明度 · ${Math.round(store.appearance.panelOpacity * 100)}%`}><Slider value={[store.appearance.panelOpacity]} min={.45} max={1} step={.01} aria-label="面板不透明度" onValueChange={value => appearance('panelOpacity', value[0])}/></Field></div></Section><div className="appearance-preview"><span className="field-label">实时预览</span><div className="nestra-panel preview-surface" data-material={store.appearance.surfaceMaterial} data-border={store.appearance.borderStyle}><header className="panel-header"><strong>项目资料</strong><span>3 项</span></header><div className="preview-files">{['设计稿', '项目文档', '待处理'].map(name => <div key={name}><FileText/><span>{name}</span></div>)}</div></div><p className="field-hint">默认风格同步到桌面；已独立设置的项目保持自己的样式。</p></div></div></>}
          {section === 'system' && <><PageHeading title="系统" description="管理桌面层、Windows 启动行为与搜索服务。"/><Section title="桌面与启动"><div className="settings-row"><div><h3>显示桌面内容</h3><p>暂停时隐藏面板和小组件，配置与内容保留。</p></div><Switch checked={!store.paused} aria-label="显示桌面内容" onCheckedChange={value => void setPaused(!value)}/></div><div className="settings-row"><div><h3>随 Windows 启动</h3><p>登录后自动恢复桌面工作空间。</p></div><Switch checked={store.startWithWindows} aria-label="随 Windows 启动" onCheckedChange={value => void setStartWithWindows(value)}/></div><div className="settings-row"><div><h3>隐藏原生桌面图标</h3><p>开启后由 Nestra 接管显示。暂停或退出时恢复原生图标。</p></div><Switch checked={store.hideNativeIcons} aria-label="隐藏原生桌面图标" onCheckedChange={value => void setHideNativeIcons(value)}/></div></Section><Section title="全局搜索" action={<kbd>Ctrl + Alt + F</kbd>}><EverythingSetup/><Button className="mt-3" variant="outline" onClick={() => void requestOpenSearch()}><Search/>打开全局搜索</Button></Section><Section title="关于 Nestra"><p className="muted-text">桌面工作空间 · 配置格式 v2</p><p className="muted-text">关闭控制中心会隐藏窗口；完全退出请使用系统托盘菜单。</p></Section></>}
        </motion.div>}
      </main></ResizablePanel>
    </ResizablePanelGroup>
    <footer className="manager-footer"><span>{current.group}<ChevronRight size={12}/>{current.label}</span><Button size="sm" variant="ghost" disabled={refreshing} onClick={() => void refresh()}><RefreshCw className={refreshing ? 'animate-spin' : ''}/>{refreshing ? '正在刷新' : '刷新内容'}</Button></footer>
    {(section !== 'search' || !store.statusAction) && <StatusNotice/>}
  </div>;
}
