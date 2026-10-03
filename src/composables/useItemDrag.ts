import { reactive } from "vue";
import type { DesktopEntry } from "@/types";
import { foldItem, moveEntryToDesktop, moveItem, placeItem, scheduleHitRectSync, showStatus, store, unfoldItem } from "@/stores/state";

export type DragAction = "move" | "reference" | "return" | "blocked";
export const itemDrag = reactive({ id: "", name: "", action: "", kind: "blocked" as DragAction, valid: false, x: 0, y: 0 });

/** WebView2's native OLE target is kept for Explorer drops. Internal tiles use
 * pointer capture, so they do not depend on HTML drag/drop reaching that target. */
export function startItemDrag(event: PointerEvent, entry: DesktopEntry): void {
  if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return;
  const target = event.currentTarget;
  const dragIds = typeof store !== 'undefined' && store.selectedItemIds?.includes(entry.id) ? [...store.selectedItemIds] : [entry.id];
  const pointerId = event.pointerId;
  const originX = event.clientX;
  const originY = event.clientY;
  let dragging = false;
  let highlighted: Element | null = null;

  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    if (!dragging && Math.hypot(next.clientX - originX, next.clientY - originY) < 6) return;
    dragging = true;
    document.body.classList.add("is-gesturing", "is-item-dragging");
    Object.assign(itemDrag, { id: entry.id, name: dragIds.length>1?`${dragIds.length} 个项目`:entry.name, x: next.clientX, y: next.clientY });
    highlighted?.classList.remove("is-native-drop-target");
    const hit = document.elementFromPoint(next.clientX, next.clientY);
    highlighted = hit?.closest("[data-group-id]") ?? null;
    const targetNode = highlighted as HTMLElement | null;
    const label = targetNode?.dataset.dropLabel;
    const desktopReturn = !highlighted && hit?.hasAttribute("data-desktop-background") && Boolean(entry.zone);
    itemDrag.kind = targetNode?.dataset.dropMode === "blocked" ? "blocked" : targetNode?.dataset.dropMode === "reference" ? "reference" : desktopReturn ? "return" : highlighted ? "move" : "blocked";
    itemDrag.valid = itemDrag.kind !== "blocked";
    itemDrag.action = label || (highlighted ? "移动到此收纳区" : desktopReturn ? "放回桌面（移动文件）" : "此处不能放置");
    highlighted?.classList.add("is-native-drop-target");
    scheduleHitRectSync();
    next.preventDefault();
  };

  const cleanup = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key);
    window.removeEventListener("blur", cancel);
    target.removeEventListener("lostpointercapture", cancel);
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    highlighted?.classList.remove("is-native-drop-target");
    document.body.classList.remove("is-gesturing", "is-item-dragging");
    Object.assign(itemDrag, { id: "", valid: false, kind: "blocked" });
    scheduleHitRectSync();
  };
  const cancel = () => cleanup();
  const key = (next: KeyboardEvent) => { if (next.key === "Escape") cleanup(); };
  const up = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    const hit = document.elementFromPoint(next.clientX, next.clientY);
    const groupId = hit?.closest<HTMLElement>("[data-group-id]")?.dataset.groupId;
    const beforeId = hit?.closest<HTMLElement>("[data-item-id]")?.dataset.itemId ?? null;
    const fold = Boolean(hit?.closest("[data-fold-target]"));
    const inViewport = next.clientX >= 0 && next.clientY >= 0
      && next.clientX < window.innerWidth && next.clientY < window.innerHeight;
    cleanup();
    if (!dragging) return;
    // The pointerup-generated click must not select/open the drop target.
    const suppressClick = (click: MouseEvent) => { click.preventDefault(); click.stopImmediatePropagation(); };
    window.addEventListener("click", suppressClick, true);
    window.setTimeout(() => window.removeEventListener("click", suppressClick, true), 0);
    if (groupId && !dragIds.includes(beforeId??'') && hit?.closest<HTMLElement>("[data-group-id]")?.dataset.dropMode !== "blocked") {
      void (async()=>{for(const id of dragIds)await finishItemDrop(id,groupId,beforeId,fold);})().catch((error) => showStatus(`拖放失败：${error}`));
    } else if (!groupId && inViewport && hit?.hasAttribute("data-desktop-background") && entry.zone) {
      void (async()=>{for(const id of dragIds)await moveEntryToDesktop(id);})();
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key);
  window.addEventListener("blur", cancel);
  target.addEventListener("lostpointercapture", cancel);
  target.setPointerCapture(pointerId);
}

export async function finishItemDrop(id: string, groupId: string, beforeId: string | null, fold: boolean): Promise<void> {
  if (fold && groupId !== "launcher") {
    const newId = await moveItem(id, groupId);
    if (newId) foldItem(`zone:${groupId}`, newId);
  } else {
    await placeItem(id, groupId, beforeId);
    if (groupId !== "launcher") unfoldItem(`zone:${groupId}`, id);
  }
}
