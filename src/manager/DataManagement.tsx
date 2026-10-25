import { useEffect, useState } from 'react';
import { Download, FileUp, FolderOutput, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { backupConfiguration, listStorageZones, exportConfiguration, listConfigurationBackups, pickFile, pickFolder, readConfiguration, type ConfigurationBackup, type StorageZone } from '@/lib/tauri';
import { migrateConfiguration, validateConfiguration } from '@/domain/configuration';
import { currentConfiguration, flushState, restoreConfiguration, showStatus, registerStorageZone, useNestra } from '@/stores/state';
import type { PersistedState } from '@/types';
import FileMoveHistory from './FileMoveHistory';
import { Field, FormSelect, Modal, PageHeading, Section } from './primitives';

export default function DataManagement() {
  const store = useNestra();
  const [zones, setZones] = useState<StorageZone[]>([]);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [backups, setBackups] = useState<ConfigurationBackup[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imported, setImported] = useState<PersistedState>();
  const [expected, setExpected] = useState<PersistedState>();
  const [selected, setSelected] = useState('');
  const orphanZones = zones.filter(zone => !store.customGroups.some(group => !group.mappedPath && group.sourceKind !== 'category' && group.dirName.toLowerCase() === zone.dirName.toLowerCase()));
  const missingZones = imported?.customGroups.filter(group => !group.mappedPath && group.sourceKind !== 'category' && !store.customGroups.some(current => current.id === group.id) && !zones.some(zone => zone.dirName.toLowerCase() === group.dirName.toLowerCase())) ?? [];
  const unresolved = missingZones.some(group => !bindings[group.id]);
  const preserved = store.customGroups.filter(group => !group.mappedPath && group.sourceKind !== 'category' && !imported?.customGroups.some(item => item.id === group.id));
  const refresh = async () => { try { const [backups, zones] = await Promise.all([listConfigurationBackups(), listStorageZones()]); setBackups(backups); setZones(zones); } catch (error) { setError(String(error)); } };
  const backup = async () => { if (busy) return; setBusy(true); setError(''); try { await flushState(); const path = await backupConfiguration(); showStatus(`备份已保存：${path}`); await refresh(); } catch (error) { setError(String(error)); } finally { setBusy(false); } };
  const exportFile = async () => { if (busy) return; setBusy(true); setError(''); try { const folder = await pickFolder(); if (!folder) return; await flushState(); showStatus(`已导出：${await exportConfiguration(folder)}`); } catch (error) { setError(String(error)); } finally { setBusy(false); } };
  const read = async (path?: string) => {
    if (busy) return; setBusy(true); setError('');
    try { const picked = path ?? await pickFile(); if (!picked) return; const value = await readConfiguration(picked); validateConfiguration(value); await flushState(); setExpected(structuredClone(currentConfiguration())); setZones(await listStorageZones()); setBindings({}); setImported(migrateConfiguration(value)); setSelected(picked); setPreviewOpen(true); } catch (error) { setError(`无法打开配置：${error}`); } finally { setBusy(false); }
  };
  const restore = async () => {
    if (!imported || !expected || busy || unresolved) return; setBusy(true); setError('');
    try { const configured = structuredClone(imported); for (const group of configured.customGroups) if (bindings[group.id]) group.dirName = bindings[group.id]!; await restoreConfiguration(configured, expected); setPreviewOpen(false); showStatus('配置已恢复；恢复前的配置已自动备份。'); await refresh(); } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  const register = async (dirName: string) => { if (busy) return; setBusy(true); setError(''); try { await registerStorageZone(dirName); await refresh(); } catch (error) { setError(`无法关联收纳目录：${error}`); } finally { setBusy(false); } };
  useEffect(() => { void refresh(); }, []);
  return <><PageHeading title="数据与恢复" description="备份布局、快捷入口和小组件内容，在恢复前检查影响。"><Button disabled={busy} onClick={() => void backup()}><Download/>{busy ? '正在处理…' : '备份当前配置'}</Button></PageHeading>
    <div className="info-callout">配置备份包含来源定义、布局、快捷引用、便签和待办。原文件与剪贴板历史不包含在内。恢复不会移动文件。</div>
    <div className="page-toolbar"><Button variant="outline" disabled={busy} onClick={() => void exportFile()}><FolderOutput/>导出配置到文件夹</Button><Button variant="outline" disabled={busy} onClick={() => void read()}><FileUp/>导入配置并预览</Button><Button variant="ghost" disabled={busy} onClick={() => void refresh()}><RefreshCw/>刷新列表</Button></div>
    {error && <p className="error-text" role="alert">{error}</p>}
    {orphanZones.length > 0 && <Section title="磁盘上未关联的收纳目录" description="恢复关联后即可在控制中心管理，文件保持原位。">{orphanZones.map(zone => <div className="source-row" key={zone.path}><div className="row-content"><strong>{zone.dirName} · {zone.itemCount} 项</strong><small>{zone.path}</small></div><Button variant="outline" size="sm" disabled={busy} onClick={() => void register(zone.dirName)}>恢复到控制中心</Button></div>)}</Section>}
    <Section title="本机配置备份" action={<span className="muted-text">{backups.length} 份</span>}>{backups.map(item => <div className="source-row" key={item.path}><div className="row-content"><strong>{item.name}</strong><small>{item.createdAt} · {item.path}</small></div><Button variant="outline" size="sm" disabled={busy} onClick={() => void read(item.path)}>预览恢复</Button></div>)}{!backups.length && <p className="card-note">手动备份、版本迁移和每次恢复前，都会在这里留下配置副本。</p>}</Section>
    <FileMoveHistory/>
    <Modal open={previewOpen} onOpenChange={setPreviewOpen} title="恢复配置预览" description="确认后先备份当前配置，再替换设置。" busy={busy} wide footer={<><Button variant="outline" disabled={busy} onClick={() => setPreviewOpen(false)}>取消</Button><Button disabled={busy || unresolved} onClick={() => void restore()}>{busy ? '正在恢复…' : '备份当前配置并恢复'}</Button></>}>
      {imported && <div className="form-stack"><p className="path-text muted-text">{selected}</p><dl className="restore-summary"><div><dt>来源定义</dt><dd>{imported.customGroups.length}</dd></div><div><dt>快捷入口</dt><dd>{imported.launcherIds.length}</dd></div><div><dt>小组件（含内容）</dt><dd>{imported.widgets.length}</dd></div></dl><div className="info-callout">已有收纳区目录保持原位，当前未包含在备份中的 {preserved.length} 个收纳区会保留。缺失显示器上的布局会恢复到可用屏幕。Windows 启动设置保持当前值。</div><div className="plan-list">{imported.customGroups.map(group => <div className="plan-row" key={group.id}><strong>{group.name}</strong><small>{group.mappedPath ?? (group.sourceKind === 'category' ? '桌面分类视图' : `桌面\\.nestra\\${group.dirName}`)}</small>{group.mappedPath && <span className="muted-text">外部路径按原配置绑定；不可访问时可在文件与收纳中重新绑定。</span>}</div>)}</div>{missingZones.length > 0 && <div className="info-callout form-stack"><strong>收纳目录在本机不存在，恢复前需要绑定。</strong>{missingZones.map(group => <Field label={group.name} key={group.id}><FormSelect label={`为${group.name}绑定本机目录`} value={bindings[group.id]} options={orphanZones.filter(zone => !Object.entries(bindings).some(([id, name]) => id !== group.id && name === zone.dirName)).map(zone => ({ label: `${zone.dirName} · ${zone.itemCount} 项`, value: zone.dirName }))} placeholder="选择本机未关联的收纳目录" disabled={busy} onValueChange={value => setBindings(current => ({ ...current, [group.id]: value }))}/></Field>)}<p>如果没有可绑定目录，请先在文件与收纳中新建收纳区，或使用当前机器的备份。</p></div>}{error && <p className="error-text" role="alert">{error}</p>}</div>}
    </Modal>
  </>;
}
