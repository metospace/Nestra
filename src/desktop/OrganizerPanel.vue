<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import UIcon from "@nuxt/ui/components/Icon.vue";
import { surfaceAppearance, surfaceVariables } from "@/domain/presentation";
import type { ResizeDirection } from "@/composables/useSurfaceDrag";
import { startMove, startResize } from "@/composables/useSurfaceDrag";
import {
  bringToFront,
  dropTargetId,
  foldItem,
  moveItem,
  placeItem,
  rescan,
  setPanelVisible,
  selectPanelItems,
  selectedEntries,
  batchMoveItems,
  pinEntry,
  moveEntryToDesktop,
  showStatus,
  store,
  setActiveTab,
  toggleFoldVisibility,
  unfoldItem,
} from "@/stores/state";
import type { CustomGroupDefinition, DesktopEntry, Panel } from "@/types";
import { showManager } from "@/lib/tauri";
import ItemTile from "./ItemTile.vue";
import Select from "@/ui/Select.vue";
import { sourceFor, dropDescription } from "@/domain/sources";
import { fileFilters, matchesFilter } from "@/lib/organizer";
import { itemsByPanel, mappingErrors, updateGroupView } from "@/stores/state";

const props = defineProps<{
  panel: Panel;
  items: DesktopEntry[];
}>();

const rootGroup = computed(() => store.customGroups.find(g => g.id === props.panel.groupId));
const tabModel = computed(() => store.tabGroups.find(tabs => `tabs:${tabs.id}` === props.panel.key));
const tabGroups = computed(() => (tabModel.value?.groupIds ?? [])
  .map(id => store.customGroups.find(group => group.id === id))
  .filter((group): group is CustomGroupDefinition => Boolean(group)));
const aggregate = computed(() => tabModel.value?.activeGroupId === "__all__");
const activeGroup = computed(() => aggregate.value ? undefined : tabGroups.value.find(g => g.id === tabModel.value?.activeGroupId)
  ?? tabGroups.value[0]
  ?? rootGroup.value);
const panel = computed(() => store.panels.find(p => p.groupId === activeGroup.value?.id) ?? props.panel);
const items = computed(() => itemsByPanel.value[panel.value.key] ?? props.items);
const localQuery = ref("");
const aggregateFilter = ref<CustomGroupDefinition["filter"]>("all");
const filteredItems = computed(() => items.value.filter(e => matchesFilter(e, aggregate.value ? aggregateFilter.value : activeGroup.value?.filter) && e.name.toLowerCase().includes(localQuery.value.toLowerCase())));
const writable = computed(() => Boolean(activeGroup.value && sourceFor(activeGroup.value).writable));
const dropLabel = computed(() => activeGroup.value ? dropDescription(activeGroup.value) : "全部来源只供浏览；请选择一个可接收文件的来源");

const MIN_W = 264;
const MIN_H = 176;

const layout = computed(() => store.panelLayouts[props.panel.key]);
const appearance = computed(() => surfaceAppearance(layout.value!, store.appearance));
const variables = computed(() => surfaceVariables(layout.value!, store.appearance));
const searchVisible = ref(false), searchInput = ref<HTMLInputElement | null>(null);
const more = ref<{x:number;y:number}|null>(null);
function toggleMore(event:MouseEvent){more.value=more.value?null:{x:Math.max(8,Math.min(event.clientX-200,window.innerWidth-250)),y:Math.max(8,Math.min(event.clientY+8,window.innerHeight-370))};}
function settings(){more.value=null;void showManager('surfaces',props.panel.key);}
async function toggleSearch(){searchVisible.value=!searchVisible.value;if(searchVisible.value){await nextTick();searchInput.value?.focus();}else localQuery.value='';}
const selected = computed(()=>store.selectionPanel===panel.value.key?selectedEntries.value.filter(e=>visibleEntries.value.some(v=>v.id===e.id)):[]);
const moveTarget=ref(''), batchBusy=ref(false);
const targets=computed(()=>store.customGroups.filter(g=>g.id!==activeGroup.value?.id&&sourceFor(g).writable).map(g=>({label:g.name,value:g.id})));
async function moveSelected(){if(!moveTarget.value||batchBusy.value)return;batchBusy.value=true;try{await batchMoveItems(selected.value.map(e=>e.id),moveTarget.value);more.value=null;}finally{batchBusy.value=false;}}
async function returnSelected(){if(batchBusy.value)return;batchBusy.value=true;try{for(const e of [...selected.value])await moveEntryToDesktop(e.id);}finally{batchBusy.value=false;}}
const selectionBox=ref<{x:number;y:number;width:number;height:number}|null>(null);
function startBox(event:PointerEvent){
  if(event.button!==0||(event.target as HTMLElement).closest('.tile,button,input,select'))return;
  const root=event.currentTarget as HTMLElement, start={x:event.clientX,y:event.clientY};
  const original=event.ctrlKey&&store.selectionPanel===panel.value.key?store.selectedItemIds.slice():[];
  const move=(next:PointerEvent)=>{if(next.pointerId!==event.pointerId)return;document.body.classList.add('is-gesturing');const box={x:Math.min(start.x,next.clientX),y:Math.min(start.y,next.clientY),width:Math.abs(next.clientX-start.x),height:Math.abs(next.clientY-start.y)};selectionBox.value=box;const ids=[...root.querySelectorAll<HTMLElement>('[data-item-id]')].filter(el=>{const r=el.getBoundingClientRect();return r.right>=box.x&&r.left<=box.x+box.width&&r.bottom>=box.y&&r.top<=box.y+box.height}).map(el=>el.dataset.itemId!);selectPanelItems(panel.value.key,[...new Set([...original,...ids])]);};
  const end=()=>{document.body.classList.remove('is-gesturing');selectionBox.value=null;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);window.removeEventListener('blur',end);if(root.hasPointerCapture(event.pointerId))root.releasePointerCapture(event.pointerId);};
  selectPanelItems(panel.value.key,original);root.setPointerCapture(event.pointerId);window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);window.addEventListener('blur',end);
}

/* 折叠区 -------------------------------------------------------------- */

const showFolded = ref(false);

const foldedIds = computed(() => new Set(store.foldedItems[panel.value.key] ?? []));

const foldedEntries = computed(() =>
  filteredItems.value.filter((entry) => foldedIds.value.has(entry.id)),
);

const visibleEntries = computed(() =>
  showFolded.value
    ? filteredItems.value
    : filteredItems.value.filter((entry) => !foldedIds.value.has(entry.id)),
);

watch(()=>visibleEntries.value.map(e=>e.id),ids=>{if(store.selectionPanel===panel.value.key)selectPanelItems(panel.value.key,store.selectedItemIds.filter(id=>ids.includes(id)));});

function onFoldChipClick(): void {
  showFolded.value = !showFolded.value;
  if (foldedEntries.value.length === 0) {
    toggleFoldVisibility(panel.value.key);
  }
}

function readItemId(event: DragEvent): string {
  return (
    event.dataTransfer?.getData("text/nestra-item") ||
    event.dataTransfer?.getData("text/plain") ||
    ""
  );
}

async function onFoldDrop(event: DragEvent): Promise<void> {
  event.stopPropagation();
  dropOver.value = false;
  const itemId = readItemId(event);
  if (!itemId) return;
  // 真实移动完成后条目 id 会变（路径变了），折叠要用新 id。
  const newId = await moveItem(itemId, panel.value.groupId);
  if (!newId) return;
  foldItem(panel.value.key, newId);
  showStatus(`已收进「${panel.value.title}」折叠区`);
}

/* 拖放 ---------------------------------------------------------------- */

const dropOver = ref(false);
let dropDepth = 0;

function onDragEnter(): void {
  dropDepth += 1;
  dropOver.value = true;
}

function onDragLeave(): void {
  dropDepth = Math.max(0, dropDepth - 1);
  if (dropDepth === 0) dropOver.value = false;
}

function onBodyDrop(event: DragEvent): void {
  event.stopPropagation();
  dropDepth = 0;
  dropOver.value = false;
  const itemId = readItemId(event);
  if (!itemId) return;
  if (foldedIds.value.has(itemId)) {
    unfoldItem(panel.value.key, itemId);
    showStatus("已从折叠放到分区");
    return;
  }
  // 落在某个磁贴上 = 插到它前面；空白处 = 末尾。同区拖动只改顺序，
  // 跨区拖入 = 文件真实移入收纳区目录。
  const beforeId = dropTargetId(event);
  if (beforeId === itemId) return;
  void placeItem(itemId, panel.value.groupId, beforeId);
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
  void rescan().then(() => showStatus(`「${panel.value.title}」已刷新`));
}
</script>

<template>
  <section
    v-if="layout"
    class="nestra-panel is-draggable"
    :class="{ 'is-drop-target': dropOver }"
    :data-group-id="activeGroup?.id"
    :data-drop-label="dropLabel"
    :data-drop-mode="writable ? 'move' : 'blocked'"
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
    @pointerdown="bringToFront(props.panel.key)"
    @dragenter.prevent="onDragEnter"
    @dragleave="onDragLeave"
  >
    <header class="panel-header organizer-heading select-none" @pointerdown="onHeaderPointerDown">
      <span class="organizer-symbol"><UIcon :name="tabModel?'i-lucide-panels-top-left':'i-lucide-folder'"/></span>
      <div class="organizer-title"><h2>{{tabModel?.name??panel.title}}</h2><small>{{items.length}} 项 · {{writable?'真实收纳':activeGroup?.mappedPath?'文件夹映射':'浏览视图'}}</small></div>
      <button class="icon-button" :class="{'is-active':searchVisible}" title="搜索此栏" aria-label="搜索此栏" @pointerdown.stop @click="toggleSearch"><UIcon name="i-lucide-search"/></button>
      <button class="icon-button" title="此栏样式与布局" aria-label="此栏样式与布局" @pointerdown.stop @click="settings"><UIcon name="i-lucide-sliders-horizontal"/></button>
      <button class="icon-button" title="更多操作" aria-label="更多操作" @pointerdown.stop @click="toggleMore"><UIcon name="i-lucide-ellipsis"/></button>
    </header>
    <div v-if="tabModel" class="flex shrink-0 gap-1 overflow-x-auto px-2 pt-2" role="tablist" :aria-label="tabModel?.name ?? '收纳区标签页'">
      <button role="tab" :aria-selected="aggregate" class="shrink-0 rounded px-3 py-2 text-xs" @pointerdown.stop @click="tabModel && setActiveTab(tabModel.id, '__all__')">全部来源</button>
      <button v-for="group in tabGroups" :key="group.id" role="tab" :aria-selected="activeGroup?.id === group.id"
        :data-group-id="group.id" :data-drop-label="dropDescription(group)"
        :data-drop-mode="sourceFor(group).writable ? 'move' : 'blocked'"
        class="shrink-0 rounded px-3 py-2 text-xs" :style="{ background: activeGroup?.id === group.id ? 'rgba(122,162,247,.22)' : 'transparent' }"
        @pointerdown.stop @click="tabModel && setActiveTab(tabModel.id, group.id)">{{ group.name }}</button>
    </div>
    <div v-if="searchVisible" class="organizer-search"><input ref="searchInput" v-model="localQuery" placeholder="搜索此栏中的文件…" aria-label="搜索此栏中的文件" @pointerdown.stop @keydown.escape="searchVisible=false;localQuery=''"/><button class="icon-button" aria-label="关闭栏内搜索" @click="searchVisible=false;localQuery=''"><UIcon name="i-lucide-x"/></button></div>
    <div v-if="selected.length" class="organizer-selection"><span>已选 {{selected.length}} 项</span><button :disabled="batchBusy" @click="selected.forEach(e=>pinEntry(e));showStatus('已添加快捷引用，文件未移动')">固定</button><button :disabled="batchBusy" @click="toggleMore">移动到…</button><button v-if="selected.some(e=>e.zone)" :disabled="batchBusy" @click="returnSelected">放回桌面</button><button aria-label="清除选择" @click="selectPanelItems(panel.key,[])"><UIcon name="i-lucide-x"/></button></div>
    <p v-if="mappingErrors[panel.groupId]" role="status" class="m-0 px-3 pb-2 text-xs text-amber-300">{{ mappingErrors[panel.groupId] }}</p>
    <p v-else-if="items.length && !filteredItems.length" class="m-0 px-3 pb-2 text-xs">没有符合此分类的项目</p>
    <!-- 折叠预览条：可直接拖回分区或桌面 -->
    <div
      v-if="foldedEntries.length > 0 && !showFolded"
      class="fold-strip"
      data-fold-target
      title="拖到分区或桌面上即可取出"
      @dragover.prevent
      @drop.prevent="onFoldDrop"
    >
      <ItemTile
        v-for="entry in foldedEntries"
        :key="entry.id"
        :entry="entry"
        compact
        folded
        :panel-key="panel.key"
      />
    </div>

    <!-- 内容网格 -->
    <div
      class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2"
      @pointerdown="startBox"
      @dragover.prevent
      @drop.prevent.stop="onBodyDrop"
    >
      <div v-if="visibleEntries.length > 0" class="items-layout surface-item-grid"
        :class="{ 'is-list': layout.viewMode === 'list' }"
        :style="layout.viewMode === 'list' ? undefined : { gridTemplateColumns: `repeat(${layout.columns ?? 4}, minmax(0, 1fr))` }">
        <ItemTile
          v-for="entry in visibleEntries"
          :key="entry.id"
          :entry="entry"
          :folded="foldedIds.has(entry.id)"
          :panel-key="panel.key"
          :list="layout.viewMode === 'list'"
          :selection-order="visibleEntries.map(e=>e.id)"
        />
      </div>

      <div
        v-else
        class="flex h-full flex-col items-center justify-center gap-1 pb-6 text-center"
      >
        <p class="text-xs" style="color: var(--nestra-text-faint)">
          {{ items.length && !filteredItems.length ? '没有符合此分类的项目' : foldedEntries.length > 0 ? '项目都已折叠' : activeGroup?.mappedPath ? '文件夹为空' : '空收纳区' }}
        </p>
        <p class="text-[11px]" style="color: rgba(190, 200, 222, 0.28)">
          {{ items.length && !filteredItems.length ? '切换到「全部」查看其他项目' : writable ? '拖入文件会移动到此目录' : '选择其他来源，或调整筛选条件' }}
        </p>
      </div>
    </div>

    <footer class="organizer-footer"><span :title="dropLabel"><UIcon :name="writable?'i-lucide-move-right':'i-lucide-eye'"/>{{writable?'拖入文件会移动到此目录':'只浏览 · 原文件保持原位'}}</span><button v-if="foldedEntries.length" data-fold-target @click="onFoldChipClick">已折叠 {{foldedEntries.length}}</button><span v-else-if="localQuery">{{visibleEntries.length}} 个匹配</span></footer>
    <Teleport to="body"><div v-if="more" class="nestra-hit surface-menu-backdrop" @pointerdown.stop @click="more=null"><div class="nestra-hit surface-menu" :style="{left:`${more.x}px`,top:`${more.y}px`}" @click.stop>
      <strong>{{tabModel?.name??panel.title}}</strong>
      <button @click="settings"><UIcon name="i-lucide-sliders-horizontal"/>样式与布局</button><button @click="more=null;showManager('files',activeGroup?.id)"><UIcon name="i-lucide-folder-cog"/>管理内容与来源</button>
      <label>文件筛选<Select :model-value="aggregate?aggregateFilter:activeGroup?.filter??'all'" :options="[...fileFilters]" optionLabel="label" optionValue="value" overlayClass="nestra-hit nestra-select-overlay" @update:model-value="(v:CustomGroupDefinition['filter'])=>aggregate?aggregateFilter=v:updateGroupView(panel.groupId,{filter:v})"/></label>
      <div v-if="selected.length" class="surface-menu-batch"><label>移动选中的 {{selected.length}} 项<Select v-model="moveTarget" :options="targets" optionLabel="label" optionValue="value" overlayClass="nestra-hit nestra-select-overlay"/></label><button :disabled="!moveTarget||batchBusy" @click="moveSelected">{{batchBusy?'正在移动…':'执行移动'}}</button></div>
      <button @click="selectPanelItems(panel.key,visibleEntries.map(e=>e.id));more=null"><UIcon name="i-lucide-check-check"/>选择全部可见项目</button>
      <button data-fold-target @dragover.prevent @drop.prevent.stop="onFoldDrop" @click="onFoldChipClick();more=null"><UIcon name="i-lucide-panel-top-close"/>{{showFolded?'收起折叠项目':'展开折叠项目'}}</button>
      <button @click="more=null;showManager('data')"><UIcon name="i-lucide-history"/>查看移动记录</button><button @click="onRefresh();more=null"><UIcon name="i-lucide-refresh-cw"/>刷新文件</button><button @click="setPanelVisible(props.panel.key,false);more=null"><UIcon name="i-lucide-eye-off"/>隐藏此栏</button>
    </div></div><div v-if="selectionBox" class="selection-box" :style="{left:`${selectionBox.x}px`,top:`${selectionBox.y}px`,width:`${selectionBox.width}px`,height:`${selectionBox.height}px`}"/></Teleport>
    <!-- 缩放手柄 -->
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

.fold-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  min-height: 44px;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(122, 162, 247, 0.06);
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

.view-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--nestra-text-secondary);
}
.view-button:hover,
.view-button.active { background: rgba(122, 162, 247, 0.16); color: var(--nestra-accent-strong); }
.items-layout { display: grid; align-items: start; gap: 2px; }
.items-layout.is-list { grid-template-columns: 1fr; gap: 2px; }
</style>
