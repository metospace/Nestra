<script setup lang="ts">
import StatusNotice from '@/components/StatusNotice.vue';
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { onBeforeUnmount, onMounted, ref } from "vue";
import Button from "@/ui/Button.vue";
import { itemDrag, type DragAction } from "@/composables/useItemDrag";
import { grantDesktopInput, releaseDesktopInput, showManager } from "@/lib/tauri";
import DesktopSearch from './DesktopSearch.vue';
import ConfirmDialog from "./ConfirmDialog.vue";
import SurfaceSettings from "./SurfaceSettings.vue";
import LauncherPanel from "./LauncherPanel.vue";
import OrganizerPanel from "./OrganizerPanel.vue";
import SearchOverlay from "./SearchOverlay.vue";
import WidgetFrame from "./WidgetFrame.vue";
import {
  addCustomGroup,
  createWidget,
  dropPaths,
  initialize,
  itemsByPanel,
  LAUNCHER_PANEL_KEY,
  moveEntryToDesktop,

  rescan,
  showStatus,
  scheduleHitRectSync,
  store,
  visibleDesktopPanels,
} from "@/stores/state";

let unlisten: (() => void) | undefined;
let surfaceObserver: MutationObserver | undefined;
let unlistenDrag: (() => void) | undefined;
const externalHint = ref<{x: number; y: number; text: string; kind: DragAction; valid: boolean} | null>(null);
const creatingZone = ref(false);

async function createZone(): Promise<void> {
  if (creatingZone.value) return;
  creatingZone.value = true;
  try { await addCustomGroup(`收纳区 ${store.customGroups.length + 1}`); }
  finally { creatingZone.value = false; }
}

function groupAtPoint(clientX: number, clientY: number): string | null {
  const hit = document.elementFromPoint(clientX, clientY);
  const node = hit?.closest<HTMLElement>("[data-group-id]");
  return node?.dataset.groupId ?? null;
}

function readItemId(event: DragEvent): string {
  return (
    event.dataTransfer?.getData("text/nestra-item") ||
    event.dataTransfer?.getData("text/plain") ||
    ""
  );
}

function onDesktopDragOver(event: DragEvent): void {
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function onDesktopDrop(event: DragEvent): void {
  const target = event.target as HTMLElement;
  if (target.closest(".nestra-panel")) return;
  const itemId = readItemId(event);
  if (!itemId) return;
  // 拖出收纳区 = 文件移回桌面顶层，原生图标重新出现。
  void moveEntryToDesktop(itemId);
}

/** 层窗口带 WS_EX_NOACTIVATE、永不激活——任何输入控件拿到 DOM 焦点时，
 * 都要向前台线程"借"键盘焦点，离开输入控件即归还。 */
const TEXT_INPUT_SELECTOR = "input, textarea, select, [contenteditable]";
let focusRevision = 0;

async function focusTextControl(el: HTMLElement): Promise<void> {
  const revision = ++focusRevision;
  try {
    await grantDesktopInput();
    // WebView2's MoveFocus can return DOM focus to the document. Restore the
    // requested editor only after the native focus operation has completed.
    if (revision === focusRevision && el.isConnected) el.focus({ preventScroll: true });
  } catch { showStatus("暂时无法获取键盘焦点，请重新点击输入框"); }
}

function onFocusIn(event: FocusEvent): void {
  const el = event.target as HTMLElement | null;
  if (el?.matches?.(TEXT_INPUT_SELECTOR)) void focusTextControl(el);
}

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget as HTMLElement | null;
  if (next?.matches?.(TEXT_INPUT_SELECTOR)) return;
  window.requestAnimationFrame(() => {
    if (!(document.activeElement instanceof HTMLElement) || !document.activeElement.matches(TEXT_INPUT_SELECTOR)) {
      void releaseDesktopInput();
    }
  });
}

// 兜底：输入框已持有 DOM 焦点时再点它不会触发 focusin，但此时焦点可能
// 已随点击桌面而归还——pointerdown 阶段再补一次 grant。
function onPointerDown(event: PointerEvent): void {
  const el = event.target as HTMLElement | null;
  if (el?.matches?.(TEXT_INPUT_SELECTOR)) void focusTextControl(el);
  else focusRevision += 1;
}

/** 托盘事件到达时层可能还在初始化——等 ready 再执行，否则事件被静默丢弃。 */
async function whenReady(): Promise<void> {
  while (!store.ready) {
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
}

function handleTrayAction(action: string): void {
  switch (action) {
    case "new-note":
      createWidget("note");
      break;
    case "new-todo":
      createWidget("todo");
      break;
    case "new-clipboard":
      createWidget("clipboard");
      break;
    case "new-zone":
      // 自动命名，用户可在管理器改名（目录名同步改）。
      void createZone();
      break;
    case "refresh":
      void rescan().then(() => showStatus("桌面索引已刷新"));
      break;
  }
}

onMounted(async () => {
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("pointerdown", onPointerDown);

  // 监听必须先于 initialize 绑定：冷启动期间到的托盘事件不再丢。
  unlisten = await listen<string>("nestra://tray", (event) => {
    void whenReady().then(() => handleTrayAction(event.payload));
  });

  unlistenDrag = await getCurrentWebview().onDragDropEvent((event) => {
    document.body.classList.toggle("is-external-dragging",
      event.payload.type === "enter" || event.payload.type === "over");
    document.querySelectorAll(".is-native-drop-target").forEach((el) => el.classList.remove("is-native-drop-target"));
    if (event.payload.type === "leave") { externalHint.value = null; return; }
    const point = event.payload.position;
    const scale = window.devicePixelRatio || 1;
    const target = document.elementFromPoint(point.x / scale, point.y / scale)?.closest("[data-group-id]");
    if (event.payload.type !== "drop") {
      externalHint.value = { x: point.x / scale, y: point.y / scale,
        text: (target as HTMLElement | null)?.dataset.dropLabel ?? '拖到收纳区或快捷启动内松手',
        kind: (target as HTMLElement | null)?.dataset.dropMode === 'reference' ? 'reference' : (target as HTMLElement | null)?.dataset.dropMode === 'blocked' ? 'blocked' : target ? 'move' : 'blocked',
        valid: Boolean(target) && (target as HTMLElement).dataset.dropMode !== "blocked" };
      target?.classList.add("is-native-drop-target");
      return;
    }
    const paths = event.payload.paths ?? [];
    externalHint.value = null;
    const position = event.payload.position;
    const dpr = window.devicePixelRatio || 1;
    void whenReady().then(() => {
      const groupId = position
        ? groupAtPoint(position.x / dpr, position.y / dpr)
        : null;
      void dropPaths(paths, groupId);
    });
  });

  await initialize();
  // Menus, confirmations, toasts and resized panels all change the native shape.
  surfaceObserver = new MutationObserver(() => scheduleHitRectSync());
  surfaceObserver.observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class"],
  });
  scheduleHitRectSync();
});

onBeforeUnmount(() => {
  document.body.classList.remove("is-external-dragging");
  document.removeEventListener("focusin", onFocusIn);
  document.removeEventListener("focusout", onFocusOut);
  document.removeEventListener("pointerdown", onPointerDown);
  surfaceObserver?.disconnect();
  unlisten?.();
  unlistenDrag?.();
});
</script>

<template>
  <div
    class="fixed inset-0 overflow-hidden"
    data-desktop-background
    @dragover.prevent="onDesktopDragOver"
    @drop.prevent="onDesktopDrop"
  >
    <!-- 分区面板 -->
    <div v-if="itemDrag.id" class="drag-feedback" :class="[`is-${itemDrag.kind}`, { 'is-invalid': !itemDrag.valid }]"
      :style="{ left: `${itemDrag.x + 14}px`, top: `${itemDrag.y + 14}px` }" role="status">
      <strong>{{ itemDrag.kind === 'reference' ? '＋' : itemDrag.kind === 'return' ? '↩' : itemDrag.kind === 'move' ? '→' : '×' }}</strong>
      <span><b>{{ itemDrag.name }}</b><small>{{ itemDrag.action }}</small></span>
    </div>
    <div v-if="externalHint" class="drag-feedback" :class="[`is-${externalHint.kind}`, { 'is-invalid': !externalHint.valid }]"
      :style="{left: `${externalHint.x + 14}px`, top: `${externalHint.y + 14}px`}" role="status">
      <strong>{{ externalHint.kind === 'reference' ? '＋' : externalHint.kind === 'move' ? '→' : '×' }}</strong>
      <span><small>{{ externalHint.text }}</small></span>
    </div>
    <template v-if="store.ready">
      <DesktopSearch />
      <OrganizerPanel
        v-for="panel in visibleDesktopPanels.filter((p) => p.groupId !== 'launcher')"
        :key="panel.key"
        :panel="panel"
        :items="itemsByPanel[panel.key] ?? []"
      />

      <!-- 快捷启动（特殊面板，独立渲染） -->
      <LauncherPanel
        v-if="store.panelLayouts[LAUNCHER_PANEL_KEY]?.visible !== false"
      />

      <WidgetFrame
        v-for="widget in store.widgets.filter(w => w.layout.visible !== false)"
        :key="widget.id"
        :widget="widget"
      />

      <SearchOverlay />
      <SurfaceSettings v-if="store.surfaceSettingsKey" :key="store.surfaceSettingsKey" :panel-key="store.surfaceSettingsKey" />
      <ConfirmDialog />
    </template>

    <Transition name="fade">
      <StatusNotice v-if="!store.searchOpen||!store.statusAction" desktop />
    </Transition>

    <Transition name="fade">
      <div
        v-if="store.ready && store.customGroups.length === 0 && !store.persistenceBlocked"
        class="desktop-welcome nestra-hit"
      >
        <p class="text-[15px]">从一个收纳区开始</p>
        <p class="mt-2 text-xs" style="color: var(--nestra-text-secondary)">
          新建后，把桌面文件拖入面板。双击打开，拖出即可放回桌面。
        </p>
        <Button class="mt-4" label="新建收纳区" size="small" :loading="creatingZone" @click="createZone" />
      </div>
    </Transition>
    <div v-if="store.ready && store.persistenceBlocked" class="desktop-welcome nestra-hit" role="alert">
      <p class="text-[15px]">配置暂时无法读取</p>
      <p class="mt-2 text-xs" style="color: var(--nestra-text-secondary)">
        已停止保存以保护原数据。收纳文件仍保存在桌面的 .nestra 目录中。
      </p>
      <Button class="mt-4" label="打开数据与恢复" size="small" @click="showManager('data')" />
    </div>
  </div>
</template>
