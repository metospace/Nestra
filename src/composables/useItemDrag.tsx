import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core';
import { ArrowRight, CornerUpLeft, Link, Ban } from 'lucide-react';
import type { DesktopEntry } from '@/types';
import { foldItem, isExitFrozen, moveEntryToDesktop, moveItem, placeItem, scheduleHitRectSync, showStatus, store, unfoldItem } from '@/stores/state';

export type DragAction = 'move' | 'reference' | 'return' | 'blocked';
export interface ItemDropTarget { groupId?: string; beforeId: string | null; fold: boolean; kind: DragAction; label: string }
interface DragData { entry: DesktopEntry; panelKey: string }
interface DropData { groupId?: string; beforeId?: string; fold?: boolean; mode?: DragAction; label?: string }
interface Feedback { name: string; x: number; y: number; target: ItemDropTarget }

/** dnd-kit owns internal pointer/keyboard sensors; Explorer retains Tauri's OLE path. */
export function useItemDrag(entry: DesktopEntry, panelKey = '') {
  return useDraggable({ id: `drag:${panelKey}:${entry.id}`, data: { entry, panelKey } satisfies DragData, disabled: isExitFrozen() });
}
export function useItemDrop(id: string, data: DropData, disabled = false) { return useDroppable({ id, data, disabled }); }
export function itemDropTarget(hit: Element | null, entry: DesktopEntry, inside = true): ItemDropTarget {
  const group = hit?.closest<HTMLElement>('[data-group-id]');
  const desktop = !group && inside && Boolean(entry.zone) && Boolean(hit?.hasAttribute('data-desktop-background'));
  const mode = group?.dataset.dropMode;
  const kind: DragAction = mode === 'blocked' ? 'blocked' : mode === 'reference' ? 'reference' : group ? 'move' : desktop ? 'return' : 'blocked';
  return { groupId: group?.dataset.groupId, beforeId: hit?.closest<HTMLElement>('[data-item-id]')?.dataset.itemId ?? null,
    fold: Boolean(hit?.closest('[data-fold-target]')), kind,
    label: group?.dataset.dropLabel || (desktop ? '放回桌面（移动文件）' : group ? '移动到此收纳区' : '此处不能放置') };
}
export async function finishItemDrop(id: string, groupId: string, beforeId: string | null, fold: boolean): Promise<void> {
  if (fold && groupId !== 'launcher') {
    const newId = await moveItem(id, groupId);
    if (newId) foldItem(`zone:${groupId}`, newId);
  } else {
    await placeItem(id, groupId, beforeId);
    if (groupId !== 'launcher') unfoldItem(`zone:${groupId}`, id);
  }
}
export async function commitItemDrop(ids: string[], target: ItemDropTarget): Promise<void> {
  if (target.kind === 'blocked' || ids.includes(target.beforeId ?? '')) return;
  for (const id of ids) {
    if (target.kind === 'return') await moveEntryToDesktop(id);
    else if (target.groupId) await finishItemDrop(id, target.groupId, target.beforeId, target.fold);
  }
}
export function ItemDragProvider({ children }: { children: ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const ids = useRef<string[]>([]), cancelled = useRef(false), highlighted = useRef<Element | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  function cleanup() {
    highlighted.current?.classList.remove('is-native-drop-target'); highlighted.current = null;
    document.body.classList.remove('is-gesturing', 'is-item-dragging');
    setFeedback(null); scheduleHitRectSync();
  }
  useEffect(() => {
    const cancel = () => { cancelled.current = true; cleanup(); };
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('blur', cancel); document.body.classList.remove('is-gesturing', 'is-item-dragging'); highlighted.current?.classList.remove('is-native-drop-target'); scheduleHitRectSync(); };
  }, []);
  function targetAt(event: DragMoveEvent | DragEndEvent) {
    const entry = (event.active.data.current as DragData).entry;
    const origin = event.activatorEvent;
    if ('clientX' in origin && 'clientY' in origin) {
      const x = Number(origin.clientX) + event.delta.x, y = Number(origin.clientY) + event.delta.y;
      const inside = x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight;
      const hit = inside ? document.elementFromPoint(x, y) : null;
      return { x, y, hit, target: itemDropTarget(hit, entry, inside) };
    }
    const data = event.over?.data.current as DropData | undefined;
    const rect = event.over?.rect;
    return { x: rect?.left ?? 0, y: rect?.top ?? 0, hit: null,
      target: { groupId: data?.groupId, beforeId: data?.beforeId ?? null, fold: Boolean(data?.fold),
        kind: data?.mode === 'return' && !entry.zone ? 'blocked' : data?.mode ?? 'blocked', label: data?.label ?? '使用方向键选择目标，空格放置，Esc 取消' } as ItemDropTarget };
  }
  function start(event: DragStartEvent) {
    if (isExitFrozen()) { cancelled.current = true; return; }
    cancelled.current = false;
    const { entry } = event.active.data.current as DragData;
    ids.current = store.selectedItemIds.includes(entry.id) ? [...store.selectedItemIds] : [entry.id];
    document.body.classList.add('is-gesturing', 'is-item-dragging'); scheduleHitRectSync();
  }
  function move(event: DragMoveEvent) {
    if (cancelled.current) return;
    const { x, y, target, hit } = targetAt(event);
    highlighted.current?.classList.remove('is-native-drop-target'); highlighted.current = hit?.closest('[data-group-id]') ?? null;
    highlighted.current?.classList.add('is-native-drop-target');
    const { entry } = event.active.data.current as DragData;
    setFeedback({ name: ids.current.length > 1 ? `${ids.current.length} 个项目` : entry.name, x, y, target });
  }
  function end(event: DragEndEvent) {
    const target = targetAt(event).target; cleanup();
    if (cancelled.current || isExitFrozen()) return;
    const suppress = (click: MouseEvent) => { click.preventDefault(); click.stopImmediatePropagation(); };
    window.addEventListener('click', suppress, true);
    window.setTimeout(() => window.removeEventListener('click', suppress, true), 0);
    void commitItemDrop(ids.current, target).catch(error => showStatus(`拖放失败：${error}`));
  }
  const Icon = feedback?.target.kind === 'reference' ? Link : feedback?.target.kind === 'return' ? CornerUpLeft : feedback?.target.kind === 'move' ? ArrowRight : Ban;
  return <DndContext sensors={sensors} collisionDetection={args => {
    const hits = pointerWithin(args), collisions = hits.length ? hits : rectIntersection(args);
    // Nested tiles and zones precede the full-screen desktop return target.
    // Otherwise keyboard drops can resolve to the background even inside a zone.
    const priority = (id: string | number) => {
      const data = args.droppableContainers.find(container => container.id === id)?.data.current as DropData | undefined;
      return data?.beforeId ? 3 : data?.fold ? 2 : data?.groupId ? 1 : 0;
    };
    return collisions.sort((a, b) => priority(b.id) - priority(a.id));
  }} onDragStart={start} onDragMove={move} onDragOver={move} onDragEnd={end} onDragCancel={cleanup} accessibility={{ screenReaderInstructions: { draggable: '按空格开始拖动，用方向键选择目标，再按空格放置。按 Escape 取消。' } }}>
    {children}
    {feedback && <div className={`drag-feedback is-${feedback.target.kind}`} style={{ left: feedback.x + 14, top: feedback.y + 14 }} role="status"><Icon size={18} /><span><b>{feedback.name}</b><small>{feedback.target.label}</small></span></div>}
  </DndContext>;
}
