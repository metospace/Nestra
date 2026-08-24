<script setup lang="ts">
import { computed, ref } from "vue";
import type { ResizeDirection } from "@/composables/useSurfaceDrag";
import { startMove, startResize } from "@/composables/useSurfaceDrag";
import {
  bringToFront,
  foldItem,
  moveItem,
  rescan,
  showStatus,
  store,
  toggleFoldVisibility,
} from "@/stores/state";
import type { DesktopEntry, Panel } from "@/types";
import ItemTile from "./ItemTile.vue";

const props = defineProps<{
  panel: Panel;
  items: DesktopEntry[];
}>();

const MIN_W = 264;
const MIN_H = 176;

const layout = computed(() => store.panelLayouts[props.panel.key]);

/* 折叠区 -------------------------------------------------------------- */

const showFolded = ref(false);

const foldedIds = computed(() => new Set(store.foldedItems[props.panel.key] ?? []));

const foldedEntries = computed(() =>
  props.items.filter((entry) => foldedIds.value.has(entry.id)),
);

const visibleEntries = computed(() =>
  showFolded.value
    ? props.items
    : props.items.filter((entry) => !foldedIds.value.has(entry.id)),
);

function onFoldChipClick(): void {
  showFolded.value = !showFolded.value;
  if (foldedEntries.value.length === 0) {
    toggleFoldVisibility(props.panel.key);
  }
}

function onFoldDrop(event: DragEvent): void {
  const itemId = event.dataTransfer?.getData("text/nestra-item");
  if (itemId) {
    foldItem(props.panel.key, itemId);
    showStatus(`已折叠到「${props.panel.title}」`);
  }
}

/* 拖放 ---------------------------------------------------------------- */

function onBodyDrop(event: DragEvent): void {
  const itemId = event.dataTransfer?.getData("text/nestra-item");
  if (!itemId) return;
  if (!foldedIds.value.has(itemId)) {
    moveItem(itemId, props.panel.groupId);
  }
}

/* 移动与缩放 ----------------------------------------------------------- */

function onHeaderPointerDown(event: PointerEvent): void {
  if (!layout.value || (event.target as HTMLElement).closest("button")) return;
  bringToFront(props.panel.key);
  startMove(event, layout.value, { minWidth: MIN_W, minHeight: MIN_H });
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
  bringToFront(props.panel.key);
  startResize(event, direction, layout.value, { minWidth: MIN_W, minHeight: MIN_H });
}

function onRefresh(): void {
  void rescan().then(() => showStatus(`「${props.panel.title}」已刷新`));
}
</script>

<template>
  <section
    v-if="layout"
    class="nestra-panel is-draggable"
    :data-material="store.appearance.surfaceMaterial"
    :data-border="store.appearance.borderStyle"
    :style="{
      left: `${layout.x}px`,
      top: `${layout.y}px`,
      width: `${layout.width}px`,
      height: `${layout.height}px`,
      zIndex: layout.zIndex,
      borderRadius: 'var(--panel-radius)',
    }"
    @pointerdown="bringToFront(panel.key)"
  >
    <!-- 标题栏：拖拽移动 -->
    <header class="panel-header select-none" @pointerdown="onHeaderPointerDown">
      <span class="glyph-badge shrink-0" style="width: 26px; height: 26px; font-size: 13px">
        {{ panel.glyph }}
      </span>

      <h2 class="truncate text-[13px] font-semibold tracking-[0.01em]">
        {{ panel.title }}
      </h2>
      <span class="text-[11px]" style="color: var(--nestra-text-faint)">
        {{ items.length }}
      </span>

      <div class="flex-1" />

      <button
        class="fold-chip"
        :class="{ 'is-active': foldedEntries.length > 0 }"
        title="把项目拖到这里折叠；单击展开或收起"
        @pointerdown.stop
        @click="onFoldChipClick"
        @dragover.prevent
        @drop.prevent="onFoldDrop"
      >
        <span class="text-[11px]">折叠</span>
        <span
          v-if="foldedEntries.length > 0"
          class="rounded-full px-1.5 text-[10px] leading-4"
          style="background: rgba(122, 162, 247, 0.25); color: var(--nestra-accent-strong)"
        >
          {{ foldedEntries.length }}
        </span>
      </button>

      <button
        class="icon-button"
        title="刷新该分区"
        @pointerdown.stop
        @click="onRefresh"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M13.5 8a5.5 5.5 0 1 1-1.62-3.9M13.5 1.8v2.7h-2.7"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </header>

    <!-- 折叠预览条 -->
    <div
      v-if="foldedEntries.length > 0 && !showFolded"
      class="flex items-center gap-1 border-b px-3 py-1.5"
      style="border-color: rgba(255, 255, 255, 0.06)"
    >
      <span
        v-for="entry in foldedEntries.slice(0, 4)"
        :key="entry.id"
        class="glyph-badge"
        style="width: 18px; height: 18px; font-size: 10px; opacity: 0.85"
      >
        {{ entry.glyph }}
      </span>
      <span class="ml-1 text-[10.5px]" style="color: var(--nestra-text-faint)">
        已收纳 {{ foldedEntries.length }} 项
      </span>
    </div>

    <!-- 内容网格 -->
    <div
      class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2"
      @dragover.prevent
      @drop.prevent="onBodyDrop"
    >
      <div v-if="visibleEntries.length > 0" class="flex flex-wrap content-start justify-start gap-0.5">
        <ItemTile
          v-for="entry in visibleEntries"
          :key="entry.id"
          :entry="entry"
        />
      </div>

      <div
        v-else
        class="flex h-full flex-col items-center justify-center gap-1 pb-6 text-center"
      >
        <p class="text-xs" style="color: var(--nestra-text-faint)">
          {{ foldedEntries.length > 0 ? "项目都已折叠" : "暂无项目" }}
        </p>
        <p class="text-[11px]" style="color: rgba(190, 200, 222, 0.28)">
          从其他分区拖入，或刷新桌面索引
        </p>
      </div>
    </div>

    <!-- 缩放手柄 -->
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
.fold-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid transparent;
  color: var(--nestra-text-secondary);
  background: rgba(255, 255, 255, 0.05);
  transition: background-color 120ms ease, border-color 120ms ease;
  cursor: pointer;
}

.fold-chip:hover {
  background: rgba(122, 162, 247, 0.14);
  border-color: rgba(122, 162, 247, 0.35);
}

.fold-chip.is-dragover,
.fold-chip.is-active {
  border-color: rgba(122, 162, 247, 0.45);
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  color: var(--nestra-text-secondary);
  transition: background-color 120ms ease, color 120ms ease;
  cursor: pointer;
}

.icon-button:hover {
  background: rgba(255, 255, 255, 0.09);
  color: var(--nestra-text);
}
</style>
