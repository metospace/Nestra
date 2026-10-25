import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { settingsPosition, surfaceAppearance } from '@/domain/presentation';
import { displayAtPoint } from '@/lib/layout';
import { clearSurfaceBackground, mutateStore, setPanelPresentation, setSurfaceAppearance, updateLayout, useNestra } from '@/stores/state';
import type { PanelLayout } from '@/types';

const materials = [{ label: '清透', value: 'clear' }, { label: '磨砂', value: 'matte' }, { label: '玻璃', value: 'glass' }, { label: '亚克力', value: 'acrylic' }];
const corners = [{ label: '方正', value: 'square' }, { label: '紧凑', value: 'compact' }, { label: '标准', value: 'standard' }, { label: '圆润', value: 'rounded' }];
const borders = [{ label: '无边框', value: 'none' }, { label: '细线', value: 'subtle' }, { label: '清晰', value: 'strong' }, { label: '阴影', value: 'shadow' }];
const colors = ['#ffffff', '#edf4ff', '#eaf4ee', '#fff2df', '#172337', '#292632'];
function FieldSelect({ label, value, options, onChange }: { label: string; value: string; options: { label: string; value: string }[]; onChange: (value: string) => void }) {
  return <div className="grid gap-2"><span className="text-xs font-medium">{label}</span><Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className="w-full"><SelectValue /></SelectTrigger><SelectContent className="nestra-hit">{options.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>;
}
function Range({ label, value, min, max, step = 1, display, onChange }: { label: string; value: number; min: number; max: number; step?: number; display?: string; onChange: (value: number) => void }) {
  return <div className="grid gap-3"><div className="flex items-center justify-between text-xs"><span>{label}</span><output className="text-muted-foreground tabular-nums">{display ?? value}</output></div><Slider aria-label={label} min={min} max={max} step={step} value={[value]} onValueChange={values => { if (values[0] !== undefined) onChange(values[0]); }} /></div>;
}
export default function SurfaceSettings({ panelKey }: { panelKey: string }) {
  const state = useNestra(), layout = state.panelLayouts[panelKey];
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => { const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight }); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  if (!layout) return null;
  const display = state.displays.length ? displayAtPoint(layout.x + layout.width / 2, layout.y + layout.height / 2, state.displays) : undefined;
  const appearance = surfaceAppearance(layout, state.appearance), position = settingsPosition(layout, viewport, display?.workArea ?? display);
  const title = state.tabGroups.find(group => `tabs:${group.id}` === panelKey)?.name ?? state.panels.find(panel => panel.key === panelKey)?.title ?? '快捷启动';
  const close = () => mutateStore(draft => { draft.surfaceSettingsKey = ''; });
  const style = (key: keyof NonNullable<PanelLayout['appearance']>, value: unknown) => setSurfaceAppearance(panelKey, { [key]: value });
  const presentation = (patch: Parameters<typeof setPanelPresentation>[1]) => setPanelPresentation(panelKey, patch);
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="desktop-surface-settings nestra-hit gap-4 overflow-y-auto" style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight, transform: 'none', translate: 'none' }}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>仅调整此栏 · 修改自动保存</DialogDescription></DialogHeader>
      <Tabs defaultValue="style"><TabsList className="w-full"><TabsTrigger value="style" className="flex-1">样式</TabsTrigger><TabsTrigger value="layout" className="flex-1">布局</TabsTrigger>{panelKey !== 'system:launcher' && <TabsTrigger value="visibility" className="flex-1">显示</TabsTrigger>}</TabsList>
        <TabsContent value="style" className="grid gap-5 pt-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{layout.appearance ? '已设置独立样式；未修改的项目仍跟随全局。' : '跟随全局风格。在这里修改后，仅此栏生效。'}</p>
          <FieldSelect label="材质" value={appearance.surfaceMaterial} options={materials} onChange={value => style('surfaceMaterial', value)} />
          <div className="grid grid-cols-2 gap-3"><FieldSelect label="圆角" value={appearance.cornerStyle} options={corners} onChange={value => style('cornerStyle', value)} /><FieldSelect label="边界" value={appearance.borderStyle} options={borders} onChange={value => style('borderStyle', value)} /></div>
          <Range label="此栏不透明度" value={appearance.panelOpacity} display={`${Math.round(appearance.panelOpacity * 100)}%`} min={.45} max={1} step={.01} onChange={value => style('panelOpacity', value)} />
          <div className="grid gap-3"><span className="text-xs font-medium">背景颜色</span><div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" aria-pressed={!layout.appearance?.backgroundColor} onClick={() => clearSurfaceBackground(panelKey)}>跟随主题</Button>{colors.map(color => <Button key={color} variant="outline" size="icon" className="size-6 rounded-sm" style={{ background: color, outline: layout.appearance?.backgroundColor === color ? '2px solid var(--ring)' : undefined, outlineOffset: 2 }} aria-label={`背景颜色 ${color}`} aria-pressed={layout.appearance?.backgroundColor === color} onClick={() => style('backgroundColor', color)} />)}</div>
            {layout.appearance?.backgroundColor && <Input aria-label="自定义背景颜色" defaultValue={layout.appearance.backgroundColor} key={layout.appearance.backgroundColor} maxLength={7} spellCheck={false} onBlur={event => { const value = event.target.value; if (/^#[0-9a-f]{6}$/i.test(value)) { style('backgroundColor', value); event.target.setCustomValidity(''); } else { event.target.setCustomValidity('请输入 # 开头的六位颜色值'); event.target.reportValidity(); } }} />}
          </div>
          <Button variant="outline" disabled={!layout.appearance} onClick={() => setSurfaceAppearance(panelKey, null)}><RotateCcw />恢复全局风格</Button>
        </TabsContent>
        {panelKey !== 'system:launcher' && <TabsContent value="visibility" className="grid gap-5 pt-3"><label className="flex items-center justify-between gap-3 text-sm font-medium">自动隐藏<Switch aria-label="自动隐藏此收纳区" checked={Boolean(layout.autoHide)} onCheckedChange={autoHide => presentation({ autoHide })}/></label><p className="text-xs leading-relaxed text-muted-foreground">仅此收纳区生效。关闭时始终显示；开启后，鼠标悬停到原位置显示，移出后隐藏。隐藏时点击可穿透到桌面。</p>{layout.autoHide && <Range label="移出后隐藏延迟" min={200} max={5000} step={100} value={layout.autoHideDelay ?? 800} display={`${((layout.autoHideDelay ?? 800) / 1000).toFixed(1)} 秒`} onChange={autoHideDelay => presentation({ autoHideDelay })}/>}</TabsContent>}
        <TabsContent value="layout" className="grid gap-5 pt-3">
          {panelKey !== 'system:launcher' && <div className="grid gap-3 border-b pb-4"><label className="flex items-center justify-between gap-3 text-xs">自动适应内容<Switch aria-label="自动适应收纳区内容" checked={layout.autoSize !== false} onCheckedChange={autoSize => presentation({ autoSize })}/></label><p className="text-xs leading-relaxed text-muted-foreground">拖动边缘或四角可切换为手动大小。手动大小会保存，图标随宽度换列，多余项目按下方设置显示。</p></div>}
          {panelKey !== 'system:launcher' && <div className="grid gap-2"><FieldSelect label="空间不足时" value={layout.overflowMode ?? 'pages'} options={[{ label: '分页显示', value: 'pages' }, { label: '合并到最后一项（文件夹）', value: 'folder' }]} onChange={value => presentation({ overflowMode: value as 'pages' | 'folder' })}/><p className="text-xs leading-relaxed text-muted-foreground">文件夹模式将剩余项目收进最后一格，点击查看。仅折叠显示，不移动文件。</p></div>}
          <div className="grid grid-cols-2 gap-3"><FieldSelect label="排列" value={layout.viewMode ?? 'grid'} options={[{ label: '网格', value: 'grid' }, { label: '列表', value: 'list' }]} onChange={value => presentation({ viewMode: value as 'grid' | 'list' })} /><FieldSelect label="密度" value={layout.density ?? 'comfortable'} options={[{ label: '舒适', value: 'comfortable' }, { label: '紧凑', value: 'compact' }]} onChange={value => presentation({ density: value as 'comfortable' | 'compact' })} /></div>
          {layout.viewMode !== 'list' && (panelKey === 'system:launcher' || layout.autoSize !== false) && <Range label={panelKey === 'system:launcher' ? '网格列数' : '首选列数'} value={layout.columns ?? 4} min={2} max={8} onChange={value => presentation({ columns: value })} />}
          <Range label="图标大小" value={layout.iconSize ?? (layout.density === 'compact' ? 32 : 42)} min={24} max={64} step={2} onChange={value => presentation({ iconSize: value })} />
          <Range label="项目间距" value={layout.itemGap ?? (layout.density === 'compact' ? 2 : 8)} min={0} max={24} onChange={value => presentation({ itemGap: value })} />
          <FieldSelect label="文件名行数" value={String(layout.labelLines ?? 2)} options={[{ label: '一行', value: '1' }, { label: '两行', value: '2' }, { label: '三行', value: '3' }]} onChange={value => presentation({ labelLines: Number(value) })} />
          {panelKey !== 'system:launcher' && <p className="text-xs leading-relaxed text-muted-foreground">{layout.autoSize === false ? '当前使用手动大小，完整图标按可用空间排列。' : '宽高自动适应完整图标；也可直接拖动边缘改为手动大小。'}</p>}
          <label className="flex items-center justify-between gap-3 text-xs">{panelKey === 'system:launcher' || layout.autoSize === false ? '锁定此栏位置和大小' : '锁定此栏位置'}<Switch checked={Boolean(layout.locked)} onCheckedChange={locked => updateLayout(panelKey, { locked })} /></label>
        </TabsContent>
      </Tabs>
      <p className="border-t pt-3 text-xs text-muted-foreground">直接查看桌面上的变化，文件保持原位。</p>
    </DialogContent>
  </Dialog>;
}

