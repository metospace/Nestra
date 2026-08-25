<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { ResizeDirection } from "@/composables/useSurfaceDrag";
import { startMove, startResize } from "@/composables/useSurfaceDrag";
import {
  removeWidget,
  store,
  touchWidget,
} from "@/stores/state";
import {
  CLIPBOARD_CHANGED_EVENT,
  clipClear,
  clipCopy,
  clipLoad,
  clipRemove,
} from "@/lib/tauri";
import type { ClipItem, TodoItem, Widget } from "@/types";

const props = defineProps<{
  widget: Widget;
}>();

const MIN_W = 220;
const MIN_H = 150;

const layout = computed(() => props.widget.layout);

/* 移动与缩放 ----------------------------------------------------------- */

function onHeaderPointerDown(event: PointerEvent): void {
  if (!layout.value || (event.target as HTMLElement).closest("button,input")) return;
  bringToFrontSurface();
  startMove(event, layout.value, { minWidth: MIN_W, minHeight: MIN_H });
}

function bringToFrontSurface(): void {
  if (layout.value) {
    layout.value.zIndex = Math.max(layout.value.zIndex + 1, 1000);
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

/* 待办 ---------------------------------------------------------------- */

let todoCounter = 0;

function addTodo(event: Event): void {
  const input = event.target as HTMLInputElement;
  const text = input.value.trim();
  if (!text) return;

  const item: TodoItem = {
    id: `${Date.now()}-${todoCounter++}`,
    text,
    completed: false,
  };

  props.widget.todos.push(item);
  input.value = "";
  touchWidget();
}

function pendingCount(): number {
  return props.widget.todos.filter((item) => !item.completed).length;
}

function summary(): string {
  if (props.widget.todos.length === 0) return "还没有待办";
  const pending = pendingCount();
  return pending === 0 ? "全部完成" : `${pending} 项待完成`;
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
    store.statusMessage = "已复制到剪贴板";
    window.setTimeout(() => (store.statusMessage = ""), 1500);
  } catch {
    store.statusMessage = "复制失败";
    window.setTimeout(() => (store.statusMessage = ""), 1500);
  }
}

function onRemove(item: ClipItem): void {
  void clipRemove(item.id);
}

function onClear(): void {
  if (clipboardConfirm()) void clipClear();
}

function clipboardConfirm(): boolean {
  return window.confirm("清空全部剪贴板历史？");
}

onMounted(() => {
  if (props.widget.kind === "clipboard") {
    void loadClips();
    getCurrentWebview()
      .listen(CLIPBOARD_CHANGED_EVENT, () => void loadClips())
      .then((unlisten) => (unlistenClip = unlisten));
  }
});

onBeforeUnmount(() => unlistenClip?.());

function preview(text: string): string {
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
</script>

<template>
  <section
    v-if="layout"
    class="nestra-panel"
    :data-material="store.appearance.surfaceMaterial"
    :data-border="store.appearance.borderStyle"
    :style="{
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
      <span
        class="glyph-badge shrink-0"
        style="width: 24px; height: 24px; font-size: 12px"
      >
        {{ widget.kind === "note" ? "签" : widget.kind === "todo" ? "办" : "剪" }}
      </span>

      <input
        v-model="widget.title"
        class="min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none"
        :style="{ color: 'var(--nestra-text)' }"
        spellcheck="false"
        @pointerdown.stop
        @input="touchWidget"
      />

      <button class="icon-button" title="删除小组件" @pointerdown.stop @click="removeWidget(widget.id)">
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

    <!-- 待办清单 -->
    <div v-else-if="widget.kind === 'todo'" class="flex min-h-0 flex-1 flex-col">
      <form class="px-3 pt-2.5" @submit.prevent="addTodo">
        <input
          class="w-full rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none transition-colors"
          :style="{
            background: 'rgba(255,255,255,0.05)',
            borderColor: 'rgba(255,255,255,0.12)',
            color: 'var(--nestra-text)',
          }"
          placeholder="添加待办，回车确认"
          spellcheck="false"
          @pointerdown.stop
        />
      </form>

      <ul class="min-h-0 flex-1 list-none overflow-y-auto p-2.5 m-0">
        <li
          v-for="item in widget.todos"
          :key="item.id"
          class="group flex items-start gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-white/5"
        >
          <input
            type="checkbox"
            class="mt-0.5 accent-[#7aa2f7]"
            :checked="item.completed"
            @change="
              item.completed = !item.completed;
              touchWidget();
            "
          />
          <span
            class="flex-1 break-all text-[12.5px] leading-snug"
            :style="{
              color: item.completed
                ? 'var(--nestra-text-faint)'
                : 'var(--nestra-text)',
              textDecoration: item.completed ? 'line-through' : 'none',
            }"
          >
            {{ item.text }}
          </span>
          <button
            class="icon-button shrink-0 opacity-0 group-hover:opacity-100"
            title="删除该项"
            @click="
              widget.todos = widget.todos.filter((t) => t.id !== item.id);
              touchWidget();
            "
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </button>
        </li>
      </ul>

      <footer
        class="border-t px-3 py-1.5 text-[11px]"
        :style="{
          borderColor: 'rgba(255,255,255,0.07)',
          color: 'var(--nestra-text-faint)',
        }"
      >
        {{ summary() }}
      </footer>
    </div>

    <!-- 剪贴板历史 -->
    <div v-else class="flex min-h-0 flex-1 flex-col">
      <div class="flex items-center gap-2 px-3 pt-2">
        <span class="flex-1 text-[10.5px]" style="color: var(--nestra-text-faint)">
          点按条目复制到剪贴板
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
      v-for="handle in resizeHandles"
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
