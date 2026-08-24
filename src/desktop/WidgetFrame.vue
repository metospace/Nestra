<script setup lang="ts">
import { computed } from "vue";
import type { ResizeDirection } from "@/composables/useSurfaceDrag";
import { startMove, startResize } from "@/composables/useSurfaceDrag";
import {
  removeWidget,
  store,
  touchWidget,
} from "@/stores/state";
import type { TodoItem, Widget } from "@/types";

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
        {{ widget.kind === "note" ? "签" : "办" }}
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
    <div v-else class="flex min-h-0 flex-1 flex-col">
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
