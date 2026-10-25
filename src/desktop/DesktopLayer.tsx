import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Ban, Link, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StatusNotice from '@/components/StatusNotice';
import { installDesktopInputFocus } from '@/composables/desktopInputFocus';
import { revealAutoHidePanel } from '@/composables/desktopPointer';
import { useItemDrop, type DragAction } from '@/composables/useItemDrag';
import { grantDesktopInput, releaseDesktopInput, showManager } from '@/lib/tauri';
import { addCustomGroup, createWidget, dropPaths, getItemsByPanel, getVisibleDesktopPanels, initialize, isExitFrozen, LAUNCHER_PANEL_KEY, rescan, scheduleHitRectSync, showStatus, store, useNestra } from '@/stores/state';
import DesktopSearch from './DesktopSearch';
import LauncherPanel from './LauncherPanel';
import OrganizerPanel from './OrganizerPanel';
import SearchOverlay from './SearchOverlay';
import SurfaceSettings from './SurfaceSettings';
import WidgetFrame from './WidgetFrame';
import './desktop.css';

interface ExternalHint { x: number; y: number; text: string; kind: DragAction; valid: boolean }
export default function DesktopLayer() {
  const state = useNestra(), [externalHint, setExternalHint] = useState<ExternalHint | null>(null), [creatingZone, setCreatingZone] = useState(false);
  const creatingRef = useRef(false);
  const desktopDrop = useItemDrop('desktop-return', { mode: 'return', label: '放回桌面（移动文件）' });
  async function createZone() { if (creatingRef.current || isExitFrozen()) return; creatingRef.current = true; setCreatingZone(true); try { await addCustomGroup(`收纳区 ${store.customGroups.length + 1}`); } finally { creatingRef.current = false; setCreatingZone(false); } }
  useEffect(() => {
    let disposed = false, unlisten: (() => void) | undefined, unlistenDrag: (() => void) | undefined, unlistenReveal: (() => void) | undefined;
    const disposeInput = installDesktopInputFocus(grantDesktopInput, releaseDesktopInput, () => showStatus('暂时无法获取键盘焦点，请重新点击输入框'));
    const observer = new MutationObserver(() => scheduleHitRectSync());
    async function whenReady(action: () => void) { while (!store.ready && !disposed) await new Promise(resolve => window.setTimeout(resolve, 120)); if (!disposed && !isExitFrozen()) action(); }
    function tray(action: string) {
      if (action === 'new-note') createWidget('note');
      else if (action === 'new-todo') createWidget('todo');
      else if (action === 'new-clipboard') createWidget('clipboard');
      else if (action === 'new-zone') void createZone();
      else if (action === 'refresh') void rescan().then(() => showStatus('桌面索引已刷新'));
    }
    void (async () => {
      const stopReveal = await listen<string>('nestra://reveal-surface', event => revealAutoHidePanel(event.payload));
      if (disposed) { stopReveal(); return; } unlistenReveal = stopReveal;
      const stopTray = await listen<string>('nestra://tray', event => { void whenReady(() => tray(event.payload)); });
      if (disposed) { stopTray(); return; } unlisten = stopTray;
      const stopDrag = await getCurrentWebview().onDragDropEvent(event => {
        if (disposed) return;
        if (isExitFrozen()) { document.body.classList.remove('is-external-dragging'); setExternalHint(null); return; }
        document.body.classList.toggle('is-external-dragging', event.payload.type === 'enter' || event.payload.type === 'over');
        document.querySelectorAll('.is-native-drop-target').forEach(element => element.classList.remove('is-native-drop-target'));
        if (event.payload.type === 'leave') { setExternalHint(null); return; }
        const point = event.payload.position, scale = window.devicePixelRatio || 1;
        const target = document.elementFromPoint(point.x / scale, point.y / scale)?.closest<HTMLElement>('[data-group-id]');
        if (event.payload.type !== 'drop') {
          const kind: DragAction = target?.dataset.dropMode === 'reference' ? 'reference' : target?.dataset.dropMode === 'blocked' ? 'blocked' : target ? 'move' : 'blocked';
          setExternalHint({ x: point.x / scale, y: point.y / scale, text: target?.dataset.dropLabel ?? '拖到收纳区或快捷启动内松手', kind, valid: kind !== 'blocked' }); target?.classList.add('is-native-drop-target'); return;
        }
        const paths = event.payload.paths ?? []; setExternalHint(null);
        // Capture the actual native drop target before an async refresh can change the DOM.
        const groupId = target?.dataset.groupId ?? null;
        void whenReady(() => { void dropPaths(paths, groupId); });
      });
      if (disposed) { stopDrag(); return; } unlistenDrag = stopDrag;
      await initialize(); if (disposed) return;
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] }); scheduleHitRectSync();
    })().catch(error => { if (!disposed) showStatus(`桌面初始化失败：${error}`); });
    return () => { disposed = true; document.body.classList.remove('is-external-dragging'); disposeInput(); observer.disconnect(); unlisten?.(); unlistenDrag?.(); unlistenReveal?.(); };
  }, []);
  useEffect(() => { scheduleHitRectSync(); }, [state]);
  const items = getItemsByPanel(), HintIcon = externalHint?.kind === 'reference' ? Link : externalHint?.kind === 'move' ? ArrowRight : Ban;
  return <div ref={desktopDrop.setNodeRef} className="desktop-layer fixed inset-0 overflow-hidden" data-desktop-background>
    {externalHint && <div className={`drag-feedback is-${externalHint.kind}`} style={{ left: externalHint.x + 14, top: externalHint.y + 14 }} role="status"><HintIcon size={18} /><span><small>{externalHint.text}</small></span></div>}
    {state.ready && <><DesktopSearch />{getVisibleDesktopPanels().filter(panel => panel.groupId !== 'launcher').map(panel => <OrganizerPanel key={panel.key} panel={panel} items={items[panel.key] ?? []} />)}
      {state.panelLayouts[LAUNCHER_PANEL_KEY]?.visible !== false && <LauncherPanel />}
      {state.widgets.filter(widget => widget.layout.visible !== false).map(widget => <WidgetFrame key={widget.id} widget={widget} />)}
      <SearchOverlay />{state.surfaceSettingsKey && <SurfaceSettings key={state.surfaceSettingsKey} panelKey={state.surfaceSettingsKey} />}
    </>}
    {(!state.searchOpen || !state.statusAction) && <StatusNotice desktop />}
    <AnimatePresence>{state.ready && !state.customGroups.length && !state.persistenceBlocked && <motion.div className="desktop-welcome nestra-hit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .15 }}><div className="mb-3 grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Plus size={18} /></div><h2>从一个收纳区开始</h2><p>新建后，把桌面文件拖入面板。双击打开，拖出即可放回桌面。</p><Button size="sm" disabled={creatingZone} onClick={() => void createZone()}>{creatingZone ? '正在创建…' : '新建收纳区'}</Button></motion.div>}</AnimatePresence>
    {state.ready && state.persistenceBlocked && <div className="desktop-welcome nestra-hit" role="alert"><h2>配置暂时无法读取</h2><p>已停止保存以保护原数据。收纳文件仍保存在桌面的 .nestra 目录中。</p><Button size="sm" onClick={() => { void showManager('data'); }}>打开数据与恢复</Button></div>}
  </div>;
}
