<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { ResizeDirection } from "@/composables/useSurfaceDrag";
import { startMove, startResize } from "@/composables/useSurfaceDrag";
import {
  confirmDialog,
  nextZ,
  store,
  touchWidget,
  setWidgetVisible,
  showStatus,
} from "@/stores/state";
import {
  CLIPBOARD_CHANGED_EVENT,
  clipClear,
  clipCopy,
  clipLoad,
  clipRemove,
} from "@/lib/tauri";
import type { ClipItem, Widget } from "@/types";
import { surfaceAppearance, surfaceVariables } from "@/domain/presentation";
import TodoList from "@/components/TodoList.vue";

const props = defineProps<{
  widget: Widget;
}>();

const MIN_W = 220;
const MIN_H = 150;

const layout = computed(() => props.widget.layout);
const appearance = computed(() => surfaceAppearance(layout.value, store.appearance));

/* 移动与缩放 ----------------------------------------------------------- */

function onHeaderPointerDown(event: PointerEvent): void {
  if (!layout.value || (event.target as HTMLElement).closest("button,input")) return;
  bringToFrontSurface();
  startMove(event, layout.value, { minWidth: MIN_W, minHeight: MIN_H });
}

function bringToFrontSurface(): void {
  if (layout.value) {
    // 与面板共用同一个 zIndex 计数器，谁最后被点谁在最上。
    layout.value.zIndex = nextZ();
    touchWidget();
  }
}

const resizeHandles: { direction: ResizeDirection; className: string }[] = [
  { direction: "n", className: "left-2 right-2 top-0 h-1.5 cursor-n-resize" },
  { direction: "s", className: "left-2 right-2 bottom-0 h-1.5 cursor-s-resize" },
  { direction: "w", className: "top-2 bottom-2 left-0 w-1.5 cursor-w-resize" },
  { direction: "e", className: "top-2 bottom-2 right-0 w-1.5 cursor-e-resize" },
  { direction: "nw", className: "left-0 top-0 h-3 w-3 cursor-nw-resize" },
  { direction: "ne", className: "right-0 top-0 h-3 w-3 cursor-ne-resize" },
  { direction: "sw", className: "bottom-0 left-0 h-3 w-3 cursor-sw-resize" },
  { direction: "se", className: "bottom-0 right-0 h-3 w-3 cursor-se-resize" },
];

function onResizePointerDown(event: PointerEvent, direction: ResizeDirection): void {
  if (!layout.value) return;
  bringToFrontSurface();
  startResize(event, direction, layout.value, { minWidth: MIN_W, minHeight: MIN_H });
}

/* 剪贴板历史 ------------------------------------------------------------ */

const clips = ref<ClipItem[]>([]);
let unlistenClip: (() => void) | undefined;

async function loadClips(): Promise<void> {
  try {
    clips.value = await clipLoad();
  } catch {
    clips.value = [];
  }
}

async function onCopy(item: ClipItem): Promise<void> {
  try {
    await clipCopy(item.id);
    showStatus("已复制到剪贴板");
  } catch {
    showStatus("复制失败");
  }
}

function onRemove(item: ClipItem): void {
  void clipRemove(item.id);
}

async function onClear(): Promise<void> {
  if (await confirmDialog("清空全部剪贴板历史？")) void clipClear();
}

onMounted(() => {
  if (props.widget.kind === "clipboard") {
    void loadClips();
    getCurrentWebview()
      .listen(CLIPBOARD_CHANGED_EVENT, () => void loadClips())
      .then((unlisten) => (unlistenClip = unlisten));
  }
});

const now = ref(new Date());
const clockTimer = window.setInterval(() => { now.value = new Date(); }, 1000);
onBeforeUnmount(() => { unlistenClip?.(); window.clearInterval(clockTimer); });

function preview(text: string): string {
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
</script>

<template>
  <section
    v-if="layout"
    class="nestra-panel"
    :data-widget-kind="widget.kind"
    :data-material="appearance.surfaceMaterial"
    :data-border="appearance.borderStyle"
    :style="{
      ...surfaceVariables(layout, store.appearance),
      left: `${layout.x}px`,
      top: `${layout.y}px`,
      width: `${layout.width}px`,
      height: `${layout.height}px`,
      zIndex: layout.zIndex,
    }"
    @pointerdown="bringToFrontSurface"
  >
    <header
      class="panel-header select-none"
      :style="{ cursor: 'grab', gap: '8px' }"
      @pointerdown="onHeaderPointerDown"
    >
      <input
        v-model="widget.title"
        aria-label="小组件名称"
        class="min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none"
        :style="{ color: 'var(--nestra-text)' }"
        spellcheck="false"
        @pointerdown.stop
        @input="touchWidget"
      />

      <button class="icon-button" title="隐藏小组件（可在控制中心恢复）" @pointerdown.stop @click="setWidgetVisible(widget.id, false)">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </header>

    <!-- 便签正文 -->
    <textarea
      v-if="widget.kind === 'note'"
      v-model="widget.content"
      class="min-h-0 flex-1 resize-none bg-transparent p-3 text-[13px] leading-relaxed outline-none select-text"
      :style="{ color: 'var(--nestra-text)' }"
      placeholder="写点什么…内容会自动保存"
      spellcheck="false"
      @input="touchWidget"
    />

    <TodoList v-else-if="widget.kind === 'todo'" :widget="widget" />

    <div v-else-if="widget.kind === 'clock'" class="clock-content"><strong>{{ now.toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'}) }}</strong><span>{{ now.toLocaleDateString('zh-CN', {month:'long',day:'numeric',weekday:'long'}) }}</span></div>
    <!-- 剪贴板历史 -->
    <div v-else class="flex min-h-0 flex-1 flex-col">
      <div class="flex items-center gap-2 px-3 pt-2">
        <span class="flex-1 text-[10.5px]" style="color: var(--nestra-text-faint)">
          {{ store.clipboardEnabled ? "点按条目复制到剪贴板" : "记录已暂停 · 现有历史仍可使用" }}
        </span>
        <button class="icon-button" title="清空历史" @click.stop="onClear">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>

      <ul class="min-h-0 m-0 flex-1 list-none overflow-y-auto p-2.5">
        <li
          v-for="item in clips"
          :key="item.id"
          class="group flex items-start gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-white/5"
          @click="onCopy(item)"
        >
          <span class="min-w-0 flex-1 whitespace-pre-wrap break-all text-[12px] leading-snug" style="color: var(--nestra-text)">
            {{ preview(item.text) }}
          </span>
          <span class="shrink-0 pt-0.5 text-[9.5px] tabular-nums" style="color: var(--nestra-text-faint)">
            {{ item.createdLabel }}
          </span>
          <button
            class="icon-button shrink-0 opacity-0 group-hover:opacity-100"
            title="删除该条"
            @click.stop="onRemove(item)"
          >
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </button>
        </li>
      </ul>

      <footer
        class="border-t px-3 py-1.5 text-[11px]"
        :style="{ borderColor: 'rgba(255,255,255,0.07)', color: 'var(--nestra-text-faint)' }"
      >
        {{ clips.length === 0 ? "暂无历史 · 复制任意文本即可记录" : `${clips.length} 条记录` }}
      </footer>
    </div>

    <div
      v-for="handle in layout.locked ? [] : resizeHandles"
      :key="handle.direction"
      class="resize-handle"
      :class="handle.className"
      @pointerdown="onResizePointerDown($event, handle.direction)"
    />
  </section>
</template>

<style scoped>
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  color: var(--nestra-text-secondary);
  transition: background-color 120ms ease, color 120ms ease;
  cursor: pointer;
}

.icon-button:hover {
  background: rgba(255, 255, 255, 0.09);
  color: var(--nestra-text);
}

textarea::placeholder,
input::placeholder {
  color: var(--nestra-text-faint);
}
</style>
