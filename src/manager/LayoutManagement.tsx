import { Grid2X2, Layers, Monitor, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { arrangePanels, locateSurface, mutateStore, refreshDisplays, resetLayouts, useNestra } from '@/stores/state';
import type { PanelLayout } from '@/types';
import { FormSelect, PageHeading, Section } from './primitives';

export default function LayoutManagement() {
  const store = useNestra();
  const layoutFor = (key: string) => key.startsWith('widget:') ? store.widgets.find(widget => `widget:${widget.id}` === key)?.layout : store.panelLayouts[key];
  const surfaces = [...store.panels.filter(panel => !store.tabGroups.some(tabs => tabs.groupIds.includes(panel.groupId))).map(panel => ({ key: panel.key, title: panel.title })), ...store.widgets.map(widget => ({ key: `widget:${widget.id}`, title: widget.title }))].filter(surface => layoutFor(surface.key));
  const displays = store.displays.map(display => ({ label: `${display.name}${display.isPrimary ? ' · 主屏幕' : ''}`, value: display.id }));
  const update = (key: string, patch: Partial<PanelLayout>) => mutateStore(draft => { const layout = key.startsWith('widget:') ? draft.widgets.find(widget => `widget:${widget.id}` === key)?.layout : draft.panelLayouts[key]; if (layout) Object.assign(layout, patch); });
  const move = (key: string, id: string) => mutateStore(draft => { const display = draft.displays.find(item => item.id === id); const layout = key.startsWith('widget:') ? draft.widgets.find(widget => `widget:${widget.id}` === key)?.layout : draft.panelLayouts[key]; if (!display || !layout) return; delete layout.displacedFrom; Object.assign(layout, { monitorId: id, monitorBounds: { x: display.x, y: display.y }, x: display.x + 24, y: display.y + 76, width: Math.max(1, Math.min(layout.width, display.width - 48)), height: Math.max(1, Math.min(layout.height, display.height - 100)) }); });
  return <><PageHeading title="布局与显示器" description="管理面板位置与锁定，找回隐藏或屏幕外的内容。"><Button variant="outline" onClick={() => void refreshDisplays()}><RefreshCw/>刷新显示器</Button></PageHeading>
    <div className="display-map">{store.displays.map(display => <div key={display.id} className="display-preview"><Monitor/><div><strong>{display.name}</strong><span>{display.width} × {display.height} · {display.isPrimary ? '主屏幕' : '扩展屏幕'}</span><small>坐标 {display.x}, {display.y}</small></div></div>)}</div>
    <div className="page-toolbar"><Button variant="outline" onClick={() => arrangePanels('grid')}><Grid2X2/>平铺面板</Button><Button variant="outline" onClick={() => arrangePanels('cascade')}><Layers/>层叠面板</Button><Button variant="ghost" onClick={() => void resetLayouts()}>重置面板布局…</Button></div>
    <Section title="桌面内容" description="文件组拥有独立的位置与大小。">{surfaces.map(surface => { const layout = layoutFor(surface.key)!; return <div key={surface.key} className="layout-row"><div className="row-content"><strong>{surface.title}</strong><small>{Math.round(layout.x)}, {Math.round(layout.y)} · {Math.round(layout.width)} × {Math.round(layout.height)}{layout.displacedFrom ? ' · 原屏幕暂时离线' : ''}</small></div><FormSelect label={`${surface.title}所在显示器`} value={layout.monitorId ?? store.displays.find(display => display.isPrimary)?.id} options={displays} onValueChange={value => move(surface.key, value)}/><label className="inline-setting"><Switch checked={layout.visible} aria-label={`显示${surface.title}`} onCheckedChange={value => update(surface.key, { visible: value })}/>显示</label><label className="inline-setting"><Switch checked={layout.locked ?? false} aria-label={`锁定${surface.title}`} onCheckedChange={value => update(surface.key, { locked: value })}/>锁定</label><Button size="sm" variant="outline" onClick={() => locateSurface(surface.key)}>定位</Button></div>; })}{!surfaces.length && <p className="card-note">添加来源或小组件后，在这里管理位置。</p>}</Section>
  </>;
}
