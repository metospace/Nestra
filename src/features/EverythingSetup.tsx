import { useEffect, useId, useState } from 'react';
import { CheckCircle2, Download, FolderOpen, LoaderCircle, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { pickFolder } from '@/lib/tauri';
import { installEverythingFromStore, isEverythingBusy, refreshEverythingStatus, startEverythingFromStore, useEverythingSetup } from '@/stores/everythingSetup';
import './everything-setup.css';

export default function EverythingSetup({ compact = false, hideWhenReady = false }: { compact?: boolean; hideWhenReady?: boolean }) {
  const { status, checking, pending, error } = useEverythingSetup();
  const [directory, setDirectory] = useState('');
  const [edited, setEdited] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const pathId = useId();
  const busy = pending || isEverythingBusy(status);
  useEffect(() => {
    if (!edited && status?.defaultInstallDir) setDirectory(status.defaultInstallDir);
  }, [edited, status?.defaultInstallDir]);
  async function chooseFolder() {
    setChoosing(true); setFolderError(null);
    try {
      const folder = await pickFolder();
      if (folder) { setDirectory(folder); setEdited(true); }
    } catch (reason) { setFolderError(`无法选择安装目录：${String(reason)}`); }
    finally { setChoosing(false); }
  }
  const validDirectory = /^[a-bd-z]:[\\/].+/i.test(directory.trim()) && !/["\r\n]/.test(directory);
  const progress = status?.totalBytes ? Math.min(100, Math.round(status.downloadedBytes / status.totalBytes * 100)) : undefined;
  const phaseLabels = { downloading: '正在下载', verifying: '正在校验安装包', installing: '正在安装', starting: '正在启动 Everything', idle: '正在准备', ready: '已连接', error: '安装未完成' };
  if (hideWhenReady && status?.running && !busy && !error) return null;
  return <div className={`everything-setup ${compact ? 'is-compact' : ''}`} data-everything-setup>
    <div className="everything-setup-heading"><div>
      <strong>{busy ? phaseLabels[status?.phase ?? 'idle'] : status?.running ? 'Everything 已运行' : status?.installed ? 'Everything 已安装，尚未运行' : status ? '安装 Everything，启用全盘搜索' : error && !checking ? 'Everything 检测失败' : '正在检测 Everything…'}</strong>
      <p>{status?.running ? '全盘搜索使用 Everything 的本地索引，首次加载可能需要一些时间。' : '桌面、收纳区和应用可直接搜索；全盘文件搜索需要 Everything。'}</p>
    </div>{status?.running && !busy && <CheckCircle2 className="size-4 shrink-0 text-primary"/>}</div>
    {!status?.installed && status && !status.running && <>
      <p className="everything-setup-source">官方稳定版 1.4.1.1032 · 约 2 MB · 来源：voidtools.com</p>
      <div className="everything-install-path"><label htmlFor={pathId}>安装目录（C 盘以外）</label><div><Input id={pathId} value={directory} onChange={event => { setDirectory(event.target.value); setEdited(true); setFolderError(null); }} disabled={busy || choosing} placeholder="例如 D:\Apps\Everything" spellCheck={false}/><Button variant="outline" disabled={busy || choosing} onClick={() => void chooseFolder()}><FolderOpen/>{choosing ? '正在选择' : '选择目录'}</Button></div></div>
      <p className="everything-setup-hint">从 voidtools 官方下载到上述目录，安装索引服务并随 Windows 启动。Windows 可能请求管理员权限，请在系统提示中允许。</p>
      {!!directory && !validDirectory && <p className="everything-setup-error">请选择 C 盘以外的本地完整目录，例如 D:\Apps\Everything。</p>}
    </>}
    {busy && <div className="everything-setup-progress" role="status"><span><LoaderCircle className="size-3.5 animate-spin"/>{status?.message || '正在准备…'}{status?.phase === 'downloading' && progress !== undefined && ` · ${progress}%`}</span>{status?.phase === 'downloading' && progress !== undefined && <Progress value={progress} aria-label="Everything 下载进度"/>}</div>}
    {!busy && status && !error && <p className={status.phase === 'error' ? 'everything-setup-error' : 'everything-setup-hint'} role={status.phase === 'error' ? 'alert' : 'status'}>{status.message}</p>}
    {(error || folderError) && <p className="everything-setup-error" role="alert">{folderError || error}</p>}
    <div className="everything-setup-actions">
      {!status?.running && status && <Button disabled={busy || choosing || (!status.installed && !validDirectory)} onClick={() => { setFolderError(null); void (status.installed ? startEverythingFromStore() : installEverythingFromStore(directory.trim())); }}>{busy ? <LoaderCircle className="animate-spin"/> : status.installed ? <Play/> : <Download/>}{busy ? '正在处理…' : status.installed ? '启动 Everything' : status.phase === 'error' || error ? '重试下载并安装' : '下载并安装 Everything'}</Button>}
      <Button size="sm" variant="ghost" disabled={busy || checking} onClick={() => void refreshEverythingStatus(true)}><RefreshCw className={checking ? 'animate-spin' : ''}/>{checking && !status ? '正在检测' : '重新检测'}</Button>
    </div>
  </div>;
}
