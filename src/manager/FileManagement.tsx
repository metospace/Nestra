import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronRight, Folder, FolderOpen, FolderPlus, ListChecks, ListFilter, PanelsTopLeft, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { sourceFor, sourceLabel } from '@/domain/sources';
import { fileFilters, matchesFilter } from '@/lib/organizer';
import { pickFolder } from '@/lib/tauri';
import { addCustomGroup, addFolderMapping, assignGroupToTabs, clearOperationResults, createCategoryView, createTabGroup, executeOrganization, getItemsByPanel, locateSurface, moveTab, mutateStore, rebindMapping, removeCustomGroup, removeTabGroup, renameCustomGroup, renameTabGroup, setPanelVisible, showStatus, store as serviceStore, updateGroupView, useNestra } from '@/stores/state';
import { openMoveResults, useFileMoves } from '@/composables/fileMoveReports';
import type { CustomGroupDefinition } from '@/types';
import { CheckLabel, EditableName, EmptyState, Field, FormSelect, Modal, PageHeading, Section } from './primitives';

const typeOptions = [{ label: '全部类型', value: 'all' }, { label: '收纳区', value: 'zone' }, { label: '文件夹映射', value: 'folder' }, { label: '分类视图', value: 'category' }];
const kinds = [
  { id: 'zone', name: '新建收纳区', icon: FolderPlus, description: '创建真实目录，拖入会移动文件' },
  { id: 'folder', name: '显示已有文件夹', icon: FolderOpen, description: '默认只浏览，原文件位置不变' },
  { id: 'category', name: '按类型查看桌面', icon: ListFilter, description: '只改变显示范围，不移动文件' },
  { id: 'group', name: '组合多个来源', icon: PanelsTopLeft, description: '以文件组标签页访问多个来源' },
];
type FileFilter = CustomGroupDefinition['filter'];
type PlanEntry = { id: string; path: string; name: string };
export default function FileManagement({ initialId, addSignal, initialKind }: { initialId?: string; addSignal?: number; initialKind?: 'zone' | 'folder' }) {
  const store = useNestra();
  const fileMoves = useFileMoves();
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [kind, setKind] = useState('');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [typeFilter, setTypeFilter] = useState<FileFilter>('documents');
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [detailId, setDetailId] = useState('');
  const [detailName, setDetailName] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState('');
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleSource, setRuleSource] = useState('desktop');
  const [ruleTarget, setRuleTarget] = useState('');
  const [ruleFilter, setRuleFilter] = useState<FileFilter>('documents');
  const [ruleQuery, setRuleQuery] = useState('');
  const [previewTarget, setPreviewTarget] = useState('');
  const [plan, setPlan] = useState<PlanEntry[]>([]);
  const [executing, setExecuting] = useState(false);
  const detail = store.customGroups.find(group => group.id === detailId);
  const groups = store.customGroups.filter(group => filter === 'all' || sourceFor(group).kind === filter);
  const itemsByPanel = getItemsByPanel();
  const target = store.customGroups.find(group => group.id === ruleTarget);
  const targetOptions = store.customGroups.filter(group => sourceFor(group).kind === 'zone').map(group => ({ label: group.name, value: group.id }));
  const sourceOptions = [{ label: '个人桌面', value: 'desktop' }, ...targetOptions];
  const groupOptions = [{ label: '独立面板', value: '__standalone' }, ...store.tabGroups.map(tabs => ({ label: tabs.name, value: tabs.id }))];
  const add = (initial = '') => { setCreateOpen(true); setKind(initial); setName(''); setPath(''); setError(''); setSelectedSources([]); };
  const openDetail = (id: string) => { setDetailId(id); setDetailName(store.customGroups.find(group => group.id === id)?.name ?? ''); setDetailOpen(true); setError(''); };
  useEffect(() => { if (addSignal) add(initialKind ?? ''); }, [addSignal, initialKind]);
  useEffect(() => { if (initialId) openDetail(initialId); }, [initialId]);
  useEffect(() => { if (detailId && !detail) setDetailOpen(false); }, [detailId, detail]);
  useEffect(() => { setPlan([]); }, [ruleSource, ruleTarget, ruleFilter, ruleQuery]);
  const browse = async () => { try { const selected = await pickFolder(); if (selected) { setPath(selected); if (!name) setName(selected.split(/[\\/]/).pop() ?? ''); } } catch (error) { setError(String(error)); } };
  const submit = async () => {
    if (!name.trim() || creating) return;
    setCreating(true); setError('');
    try {
      let success = true;
      if (kind === 'zone') success = await addCustomGroup(name.trim());
      if (kind === 'folder') success = await addFolderMapping(name.trim(), path);
      if (kind === 'category') createCategoryView(name.trim(), typeFilter);
      if (kind === 'group') { const id = createTabGroup(name.trim()); selectedSources.forEach(source => assignGroupToTabs(source, id)); }
      if (success) setCreateOpen(false); else setError(serviceStore.statusMessage || '未能创建来源，请检查目录。');
    } catch (error) { setError(String(error)); } finally { setCreating(false); }
  };
  const detailAction = async (operation: () => Promise<void>) => { if (detailBusy) return; setDetailBusy(true); setError(''); try { await operation(); } catch (error) { setError(String(error)); } finally { setDetailBusy(false); } };
  const repair = (id: string) => detailAction(async () => { const selected = await pickFolder(); if (selected) await rebindMapping(id, selected); });
  const saveName = () => detailAction(async () => { const name = detailName.trim(); if (!name) return; await renameCustomGroup(detailId, name); const current = serviceStore.customGroups.find(group => group.id === detailId); if (current && current.name !== name) setError(serviceStore.statusMessage || '名称未能保存，请重试。'); else setDetailName(name); });
  const surfaceKey = (id: string) => { const tabs = store.tabGroups.find(item => item.groupIds.includes(id)); return tabs ? `tabs:${tabs.id}` : `zone:${id}`; };
  const membership = (id: string) => store.tabGroups.find(tabs => tabs.groupIds.includes(id))?.id ?? '__standalone';
  const preview = () => {
    setPreviewTarget(target?.dirName ?? '');
    clearOperationResults();
    const entries = ruleSource === 'desktop' ? store.entries.filter(entry => entry.canManage && !entry.zone) : itemsByPanel[`zone:${ruleSource}`] ?? [];
    setPlan(entries.filter(entry => entry.canManage && !entry.isHidden && matchesFilter(entry, ruleFilter) && entry.name.toLowerCase().includes(ruleQuery.trim().toLowerCase())).map(entry => ({ id: entry.id, path: entry.path, name: entry.name })));
  };
  const execute = async (retry = false) => {
    if (executing) return;
    if (target?.dirName !== previewTarget) { setPlan([]); showStatus('目标目录在预览后发生变化，请重新生成预览'); return; }
    setExecuting(true);
    try { await executeOrganization(retry ? plan.filter(item => store.operationResults.some(result => !result.ok && result.path === item.path)) : plan, ruleTarget); } catch (error) { showStatus(`整理失败：${error}`); } finally { setExecuting(false); }
  };
  return <><PageHeading title="文件与收纳" description="按来源组织文件，让每次移动都有明确目标。"><Button onClick={() => add()}><Plus/>添加桌面内容</Button></PageHeading>
    <div className="page-toolbar"><FormSelect label="来源类型" value={filter} options={typeOptions} onValueChange={setFilter}/><Button variant="outline" onClick={() => setRuleOpen(true)}><ListChecks/>整理预览</Button>{fileMoves.reports.length > 0 && <Button variant="ghost" onClick={openMoveResults}>本次整理结果</Button>}</div>
    <Section title="文件来源与视图" action={<span className="muted-text">{groups.length} 个</span>}>
      {groups.map(group => { const key = surfaceKey(group.id); const hidden = store.panelLayouts[key]?.visible === false; const Icon = group.sourceKind === 'category' ? ListFilter : group.mappedPath ? FolderOpen : Folder; return <div key={group.id} className="source-row"><div className="source-icon"><Icon/></div><div className="row-content"><strong>{group.name}</strong><small>{group.sourceKind === 'category' ? '个人桌面 · 分类视图' : group.mappedPath ?? `桌面\\.nestra\\${group.dirName}`}</small>{store.mappingErrors[group.id] && <p className="error-text">{store.mappingErrors[group.id]}</p>}</div><Badge variant="secondary">{sourceLabel(group)}</Badge><span className="count-text">{itemsByPanel[`zone:${group.id}`]?.length ?? 0} 项</span><Button size="sm" variant="ghost" onClick={() => setPanelVisible(key, hidden)}>{hidden ? '显示' : '隐藏'}</Button><Button size="sm" variant="outline" onClick={() => openDetail(group.id)}>管理</Button></div>; })}
      {!groups.length && <EmptyState icon={FolderPlus} title="从一个文件来源开始" description="新建收纳区，或把已有文件夹显示到桌面。"><Button variant="outline" onClick={() => add()}>添加桌面内容</Button></EmptyState>}
    </Section>
    <Section title="文件组" description="通过标签页组合多个来源，文件保持原位。">{store.tabGroups.map(tabs => <div className="file-group" key={tabs.id}><div className="settings-row"><EditableName value={tabs.name} label="文件组名称" onCommit={value => renameTabGroup(tabs.id, value)}/><div className="page-actions"><Button variant="ghost" size="sm" onClick={() => locateSurface(`tabs:${tabs.id}`)}>显示并定位</Button><Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeTabGroup(tabs.id)}>解散文件组</Button></div></div><div className="source-chips">{tabs.groupIds.map((id, index) => <div key={id} className="source-chip"><span>{store.customGroups.find(group => group.id === id)?.name}</span><Button variant="ghost" size="icon" disabled={index === 0} aria-label="来源左移" onClick={() => moveTab(tabs.id, id, -1)}><ArrowLeft/></Button><Button variant="ghost" size="icon" disabled={index === tabs.groupIds.length - 1} aria-label="来源右移" onClick={() => moveTab(tabs.id, id, 1)}><ArrowRight/></Button><Button variant="ghost" size="icon" aria-label="移出文件组" onClick={() => assignGroupToTabs(id, null)}><X/></Button></div>)}{!tabs.groupIds.length && <span className="muted-text">在来源详情中加入此组。</span>}</div></div>)}{!store.tabGroups.length && <p className="card-note">将工作资料与待处理收纳区组合在一个面板中，通过标签页或“全部来源”查看。</p>}</Section>
    <Modal open={createOpen} onOpenChange={setCreateOpen} title="添加桌面内容" description="选择一种内容来源，再设置显示方式。" busy={creating} footer={<><Button variant="outline" disabled={creating} onClick={() => kind ? setKind('') : setCreateOpen(false)}>{kind ? '返回' : '取消'}</Button>{kind && <Button disabled={creating || !name.trim() || (kind === 'folder' && !path.trim()) || (kind === 'group' && !selectedSources.length)} onClick={() => void submit()}>{creating ? '正在创建…' : '创建'}</Button>}</>}>
      {!kind ? <div className="creation-choices">{kinds.map(item => <Button variant="outline" key={item.id} className="creation-choice" onClick={() => setKind(item.id)}><item.icon/><span><strong>{item.name}</strong><small>{item.description}</small></span><ChevronRight/></Button>)}</div> : <div className="form-stack"><div className="info-callout">{kinds.find(item => item.id === kind)?.description}{kind === 'zone' && <p>目录：桌面\.nestra\{name || '收纳区名称'}</p>}</div><Field label="显示名称"><Input value={name} onChange={event => setName(event.target.value)} placeholder="例如：项目资料" aria-label="显示名称"/></Field>{kind === 'folder' && <Field label="已有文件夹"><div className="inline-form"><Input value={path} onChange={event => setPath(event.target.value)} placeholder="选择已有目录" aria-label="已有文件夹"/><Button variant="outline" onClick={() => void browse()}>选择…</Button></div></Field>}{kind === 'category' && <Field label="显示类型"><FormSelect label="显示类型" value={typeFilter} options={fileFilters} onValueChange={value => setTypeFilter(value as FileFilter)}/></Field>}{kind === 'group' && <div className="form-stack">{store.customGroups.map(source => <CheckLabel key={source.id} label={source.name}><Checkbox checked={selectedSources.includes(source.id)} onCheckedChange={value => setSelectedSources(current => value === true ? [...current, source.id] : current.filter(id => id !== source.id))}/></CheckLabel>)}<p className="muted-text">加入新文件组会从原文件组移出，文件保持原位。</p></div>}{error && <p className="error-text" role="alert">{error}</p>}</div>}
    </Modal>
    <Modal open={detailOpen} onOpenChange={setDetailOpen} title={detail?.name ?? '来源管理'} description="显示方式与文件存放位置分别管理。" busy={detailBusy}>
      {detail && <div className="form-stack"><Field label="名称"><div className="inline-form"><Input value={detailName} disabled={detailBusy} onChange={event => setDetailName(event.target.value)} aria-label="来源名称"/><Button variant="outline" disabled={detailBusy || !detailName.trim() || detailName.trim() === detail.name} onClick={() => void saveName()}>保存名称</Button></div></Field><Field label="筛选"><FormSelect label="来源筛选" disabled={detailBusy} value={detail.filter ?? 'all'} options={fileFilters} onValueChange={value => updateGroupView(detail.id, { filter: value as FileFilter })}/></Field><Field label="加入文件组"><FormSelect label="加入文件组" disabled={detailBusy} value={membership(detail.id)} options={groupOptions} onValueChange={value => assignGroupToTabs(detail.id, value === '__standalone' ? null : value)}/></Field>{detail.mappedPath && <Field label="拖入策略"><FormSelect label="拖入策略" disabled={detailBusy} value={detail.dropPolicy ?? 'move'} options={[{ label: '只浏览 · 不接收拖入', value: 'none' }, { label: '接收文件 · 真实移动到此目录', value: 'move' }]} onValueChange={value => mutateStore(draft => { const group = draft.customGroups.find(item => item.id === detail.id); if (group) group.dropPolicy = value as 'none' | 'move'; })}/></Field>}<p className="path-text muted-text">{detail.mappedPath ?? (detail.sourceKind === 'category' ? '只筛选个人桌面' : `桌面\\.nestra\\${detail.dirName}`)}</p><div className="page-actions"><Button variant="outline" disabled={detailBusy} onClick={() => locateSurface(surfaceKey(detail.id))}>显示并定位</Button>{detail.mappedPath && <Button variant="outline" disabled={detailBusy} onClick={() => void repair(detail.id)}>重新绑定目录</Button>}</div>{error && <p className="error-text" role="alert">{error}</p>}<div className="danger-section"><p>{sourceFor(detail).kind === 'zone' ? '解散会先把全部文件放回桌面，失败时保留收纳区。' : '移除只删除此视图，原文件不移动、不删除。'}</p><Button variant="destructive" disabled={detailBusy} onClick={() => void detailAction(() => removeCustomGroup(detail.id))}>{detailBusy ? '正在处理…' : sourceFor(detail).kind === 'zone' ? '解散收纳区' : '移除视图'}</Button></div></div>}
    </Modal>
    <Modal open={ruleOpen} onOpenChange={setRuleOpen} title="整理预览" description="先查看将移动的文件，再执行本次整理。自动移动未启用。" busy={executing} wide footer={<><Button variant="outline" disabled={executing} onClick={() => setRuleOpen(false)}>关闭</Button>{store.operationResults.some(result => !result.ok) && <Button variant="outline" disabled={executing} onClick={() => void execute(true)}>重试失败项</Button>}<Button disabled={executing || !plan.length || !ruleTarget || store.operationResults.length > 0} onClick={() => void execute()}>{executing ? '正在整理…' : `执行本次移动（${plan.length} 项）`}</Button></>}>
      <div className="form-stack"><div className="form-columns"><Field label="来源"><FormSelect label="整理来源" value={ruleSource} options={sourceOptions} onValueChange={setRuleSource} disabled={executing}/></Field><Field label="目标收纳区"><FormSelect label="目标收纳区" value={ruleTarget} options={targetOptions} onValueChange={setRuleTarget} disabled={executing}/></Field><Field label="文件类型"><FormSelect label="整理文件类型" value={ruleFilter} options={fileFilters} onValueChange={value => setRuleFilter(value as FileFilter)} disabled={executing}/></Field><Field label="名称包含"><Input value={ruleQuery} onChange={event => setRuleQuery(event.target.value)} placeholder="可留空" aria-label="名称包含" disabled={executing}/></Field></div><div className="info-callout">移动目标：桌面\.nestra\{target?.dirName ?? '请选择'}。同名保留两份，失败项留在原位。</div><Button variant="outline" disabled={!ruleTarget || ruleTarget === ruleSource || executing} onClick={preview}>生成本次移动预览</Button><div className="plan-list">{plan.map(item => <div key={item.id} className="plan-row"><strong>{item.name}</strong><small>{item.path}</small></div>)}</div>{store.operationResults.length > 0 && <div className="plan-list">{store.operationResults.map(result => <div key={result.path} className={`plan-row ${!result.ok ? 'error-text' : ''}`}><strong>{result.name} · {result.ok ? '成功' : '失败'}</strong><small>{result.message}</small></div>)}</div>}</div>
    </Modal>
  </>;
}
