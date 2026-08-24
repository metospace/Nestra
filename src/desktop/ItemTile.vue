<script setup lang="ts">
import { computed, ref } from "vue";
import { openEntry, revealEntry } from "@/lib/tauri";
import { cachedIconUrl, isLauncher, store, toggleLauncher } from "@/stores/state";
import type { DesktopEntry } from "@/types";

const props = defineProps<{
  entry: DesktopEntry;
}>();

// 图标走内存缓存（两段式加载）；未命中时渲染字形徽章。
const image = computed(() => cachedIconUrl(props.entry.path));

/* 右键菜单 ------------------------------------------------------------- */

const menu = ref<{ x: number; y: number } | null>(null);

function onContextMenu(event: MouseEvent): void {
  event.preventDefault();
  menu.value = {
    x: Math.min(event.clientX, window.innerWidth - 180),
    y: Math.min(event.clientY, window.innerHeight - 120),
  };
}

function menuOpen(): void {
  menu.value = null;
  void openEntry(props.entry.target, props.entry.launchKind);
}

function menuReveal(): void {
  menu.value = null;
  if (props.entry.kind === "file" || props.entry.kind === "folder") {
    void revealEntry(props.entry.path);
  }
}

function menuToggleLauncher(): void {
  menu.value = null;
  toggleLauncher(props.entry.id);
}

function onSelect(): void {
  store.selectedItemId = props.entry.id;
}

function onOpen(): void {
  void openEntry(props.entry.target, props.entry.launchKind);
}

function onDragStart(event: DragEvent): void {
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/nestra-item", props.entry.id);
}
</script>

<template>
  <div
    class="tile"
    :class="{ 'is-selected': store.selectedItemId === entry.id }"
    draggable="true"
    :title="`${entry.name}\n${entry.sourceLabel}`"
    @dragstart="onDragStart"
    @click="onSelect"
    @dblclick="onOpen"
    @contextmenu="onContextMenu"
  >
    <span v-if="entry.isFresh" class="fresh-dot" />

    <img v-if="image" :src="image" alt="" draggable="false" />
    <span v-else class="glyph-badge" style="width: 42px; height: 42px; font-size: 19px">
      {{ entry.glyph }}
    </span>

    <span class="tile-label">{{ entry.name }}</span>

    <!-- 快捷启动角标 -->
    <Transition name="fade">
      <span v-if="isLauncher(entry.id)" class="launcher-pin" title="已在快捷启动中">▶</span>
    </Transition>
  </div>

  <!-- 右键菜单 -->
  <Teleport to="body">
    <div
      v-if="menu"
      class="fixed inset-0"
      style="z-index: 500"
      @click="menu = null"
      @contextmenu.prevent="menu = null"
    >
      <div class="tile-context-menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop>
        <button class="menu-row" @click="menuOpen">打开</button>
        <button
          v-if="entry.kind === 'file' || entry.kind === 'folder'"
          class="menu-row"
          @click="menuReveal"
        >在资源管理器中显示</button>
        <button class="menu-row" @click="menuToggleLauncher">
          {{ isLauncher(entry.id) ? "移出快捷启动" : "添加到快捷启动" }}
        </button>
      </div>
    </div>
  </Teleport>
</template>
