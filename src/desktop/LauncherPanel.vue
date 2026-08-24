<script setup lang="ts">
/** 快捷启动面板：引用语义（只存条目引用，不动文件）。
 * 单击即启动（区别于普通磁贴的双击），支持批量启动与逐项移除。 */

import { computed } from "vue";
import type { ResizeDirection } from "@/composables/useSurfaceDrag";
import { startMove, startResize } from "@/composables/useSurfaceDrag";
import {
  bringToFront,
  cachedIconUrl,
  LAUNCHER_PANEL_KEY,
  launchAll,
  launcherEntries,
  setPanelVisible,
  store,
  toggleLauncher,
} from "@/stores/state";
import { openEntry } from "@/lib/tauri";

const MIN_W = 240;
const MIN_H = 160;

const layout = computed(() => store.panelLayouts[LAUNCHER_PANEL_KEY]);
const items = launcherEntries;

function onHeaderPointerDown(event: PointerEvent): void {
  if (!layout.value || (event.target as HTMLElement).closest("button")) return;
  bringToFront(LAUNCHER_PANEL_KEY);
  startMove(event, layout.value, { minWidth: MIN_W, minHeight: MIN_H });
}

const resizeHandles: { direction: ResizeDirection; className: string }[] = [
  { direction: "s", className: "left-2 right-2 bottom-0 h-1.5 cursor-s-resize" },
  { direction: "e", className: "top-2 bottom-2 right-0 w-1.5 cursor-e-resize" },
  { direction: "se", className: "bottom-0 right-0 h-3 w-3 cursor-se-resize" },
];

function onResizePointerDown(event: PointerEvent, direction: ResizeDirection): void {
  if (!layout.value) return;
  bringToFront(LAUNCHER_PANEL_KEY);
  startResize(event, direction, layout.value, { minWidth: MIN_W, minHeight: MIN_H });
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
    }"
    @pointerdown="bringToFront(LAUNCHER_PANEL_KEY)"
  >
    <header class="panel-header select-none" @pointerdown="onHeaderPointerDown">
      <span class="glyph-badge shrink-0" style="width: 22px; height: 22px; font-size: 11px">快</span>
      <span
        class="flex-1 truncate text-[12px] font-semibold"
        style="color: var(--nestra-text-secondary)"
      >
        快捷启动
        <span class="ml-1 font-normal" style="color: var(--nestra-text-faint)">{{ items.length }}</span>
      </span>

      <button
        class="icon-button"
        title="全部启动"
        :disabled="items.length === 0"
        :style="{ opacity: items.length === 0 ? 0.4 : 1 }"
        @pointerdown.stop
        @click="launchAll()"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 3l14 9-14 9V3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
        </svg>
      </button>

      <button
        class="icon-button"
        title="隐藏该面板（在管理器「分区与分组」里可恢复）"
        @pointerdown.stop
        @click="setPanelVisible(LAUNCHER_PANEL_KEY, false)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c7 0 10 7 10 7a17.4 17.4 0 0 1-2.9 4M6.1 6.1C3.6 7.9 2 12 2 12s3 7 10 7c1.8 0 3.4-.5 4.7-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-1">
      <div
        v-for="entry in items"
        :key="entry.id"
        class="launcher-row group"
        :title="`${entry.name}\n单击启动`"
        @click="openEntry(entry.target, entry.launchKind)"
      >
        <img
          v-if="cachedIconUrl(entry.path)"
          :src="cachedIconUrl(entry.path) ?? ''"
          alt=""
          draggable="false"
          class="launcher-icon"
        />
        <span
          v-else
          class="glyph-badge shrink-0"
          style="width: 18px; height: 18px; font-size: 10px"
        >{{ entry.glyph }}</span>

        <span class="min-w-0 flex-1 truncate text-[12px]">{{ entry.name }}</span>

        <button
          class="icon-button shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          title="移出快捷启动"
          @click.stop="toggleLauncher(entry.id)"
        >
          <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div v-if="items.length === 0" class="empty-hint">
        右键任意桌面磁贴<br />选择「添加到快捷启动」
      </div>
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
.launcher-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 9px;
  cursor: pointer;
  transition: background-color 140ms ease;
}

.launcher-row:hover {
  background: rgba(255, 255, 255, 0.07);
}

.launcher-icon {
  width: 18px;
  height: 18px;
  object-fit: contain;
  flex-shrink: 0;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
}

.launcher-remove:hover {
  color: var(--nestra-danger);
}
</style>