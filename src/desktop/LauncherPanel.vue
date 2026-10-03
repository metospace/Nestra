<script setup lang="ts">
/** 快捷启动面板：引用语义（只存条目引用，不动文件）。
 * 单击即启动（区别于普通磁贴的双击），支持批量启动与逐项移除。 */

import UIcon from "@nuxt/ui/components/Icon.vue";
import { surfaceAppearance, surfaceVariables } from "@/domain/presentation";
import { computed, ref } from "vue";
import type { ResizeDirection } from "@/composables/useSurfaceDrag";
import { startMove, startResize } from "@/composables/useSurfaceDrag";
import {
  bringToFront,
  openSurfaceSettings,
  cachedIconUrl,
  confirmDialog,
  LAUNCHER_PANEL_KEY,
  launchAll,
  launchEntries,
  launcherEntries,
  moveItem,
  setPanelVisible,
  store,
  showStatus,
  toggleLauncher,
} from "@/stores/state";
import { launchEntry, showManager } from "@/lib/tauri";
import type { DesktopEntry } from "@/types";

async function launch(entry: DesktopEntry): Promise<void> {
  try { await launchEntry(entry); }
  catch (error) { showStatus(`无法打开「${entry.name}」：${error}`); }
}

const MIN_W = 240;
const MIN_H = 160;

const layout = computed(() => store.panelLayouts[LAUNCHER_PANEL_KEY]);
const items = launcherEntries;
const appearance=computed(()=>surfaceAppearance(layout.value!,store.appearance));
const variables=computed(()=>surfaceVariables(layout.value!,store.appearance));
const collectionBusy=ref(false);
async function launchCollection(ids:string[]){if(collectionBusy.value)return;const entries=items.value.filter(e=>ids.includes(e.id));if(entries.length>1&&!await confirmDialog(`启动集合中的 ${entries.length} 个入口？`))return;collectionBusy.value=true;try{await launchEntries(entries);}finally{collectionBusy.value=false;}}

function onHeaderPointerDown(event: PointerEvent): void {
  if (!layout.value || (event.target as HTMLElement).closest("button")) return;
  bringToFront(LAUNCHER_PANEL_KEY);
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

const dropOver = ref(false);

function onDrop(event: DragEvent): void {
  event.stopPropagation();
  dropOver.value = false;
  const itemId =
    event.dataTransfer?.getData("text/nestra-item") ||
    event.dataTransfer?.getData("text/plain") ||
    "";
  if (itemId) void moveItem(itemId, "launcher");
}

async function onLaunchAll(): Promise<void> {
  if (items.value.length > 1 && !(await confirmDialog(`启动这 ${items.value.length} 个项目？`))) {
    return;
  }
  void launchAll();
}

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
    :class="{ 'is-drop-target': dropOver }"
    data-group-id="launcher"
    data-drop-label="添加到快捷启动（仅引用，原文件不移动）"
    data-drop-mode="reference"
    :data-material="appearance.surfaceMaterial"
    :data-border="appearance.borderStyle"
    :style="{
      left: `${layout.x}px`,
      top: `${layout.y}px`,
      width: `${layout.width}px`,
      height: `${layout.height}px`,
      zIndex: layout.zIndex,
      ...variables,
    }"
    @pointerdown="bringToFront(LAUNCHER_PANEL_KEY)"
  >
    <header class="panel-header organizer-heading select-none" @pointerdown="onHeaderPointerDown">
      <div class="organizer-title"><h2>快捷启动</h2><small>{{items.length}} 个入口 · 原文件保持原位</small></div>
      <button class="icon-button" title="管理快捷入口" aria-label="管理快捷入口" @pointerdown.stop @click="showManager('launcher')"><UIcon name="i-lucide-plus"/></button>
      <button class="icon-button" data-surface-settings-trigger title="快捷启动样式与布局" aria-label="快捷启动样式与布局" @pointerdown.stop @click="openSurfaceSettings(LAUNCHER_PANEL_KEY)"><UIcon name="i-lucide-sliders-horizontal"/></button>
      <button class="icon-button" title="隐藏快捷启动（控制中心可恢复）" aria-label="隐藏快捷启动" @pointerdown.stop @click="setPanelVisible(LAUNCHER_PANEL_KEY,false)"><UIcon name="i-lucide-eye-off"/></button>
    </header>
    <div v-if="store.launchCollections.length" class="launcher-collections"><button v-for="collection in store.launchCollections" :key="collection.id" :disabled="collectionBusy" :title="`打开集合：${collection.name}`" @click="launchCollection(collection.entryIds)"><UIcon name="i-lucide-layers-2"/>{{collection.name}}</button></div>
    <div class="min-h-0 flex-1 overflow-auto p-2" @dragover.prevent="dropOver=true" @dragleave="dropOver=false" @drop.prevent="onDrop">
      <div class="surface-item-grid launcher-grid" :class="{'is-list':layout.viewMode==='list'}" :style="{gridTemplateColumns:layout.viewMode==='list'?'1fr':`repeat(${layout.columns??4},minmax(0,1fr))`}">
        <div v-for="entry in items" :key="entry.id" class="launcher-entry" :class="{'is-list':layout.viewMode==='list'}"><button class="tile" :class="{'is-list':layout.viewMode==='list'}" :title="`${entry.name}\n${entry.path}\n单击打开`" @click="launch(entry)"><img v-if="cachedIconUrl(entry.path)" :src="cachedIconUrl(entry.path)!" alt="" draggable="false"/><span v-else class="glyph-badge">{{entry.glyph}}</span><span class="tile-label">{{entry.name}}</span></button><button class="launcher-remove icon-button" title="移除引用，保留原文件" :aria-label="`移除引用：${entry.name}`" @click="toggleLauncher(entry.id)"><UIcon name="i-lucide-x"/></button></div>
      </div>
      <div v-if="!items.length" class="empty-hint"><UIcon name="i-lucide-pin"/><p>拖入常用文件或应用</p><button @click="showManager('launcher')">添加快捷入口</button></div>
    </div>
    <footer class="organizer-footer"><span><UIcon name="i-lucide-link"/>仅保存引用，不移动文件</span><button :disabled="!items.length" @click="onLaunchAll">启动全部</button></footer>
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
.launcher-entry{position:relative;min-width:0}.launcher-remove{position:absolute;top:2px;right:2px;opacity:0;background:var(--nestra-surface);width:20px;height:20px}.launcher-entry:hover .launcher-remove,.launcher-entry:focus-within .launcher-remove{opacity:1}.launcher-remove:hover{color:var(--nestra-danger)}.launcher-entry.is-list .tile{padding-right:25px}.launcher-collections{display:flex;gap:6px;overflow:auto;padding:0 12px 8px}.launcher-collections button{display:flex;align-items:center;gap:5px;white-space:nowrap;padding:5px 8px;border:1px solid var(--nestra-line);border-radius:6px;font-size:10px;color:var(--nestra-text-secondary)}.launcher-collections button:hover{background:var(--nestra-hover)}
</style>
