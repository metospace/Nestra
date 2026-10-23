<script setup lang="ts">
import { sourceFor } from "@/domain/sources";
import { computed, ref } from "vue";
import { startItemDrag } from "@/composables/useItemDrag";
import { launchEntry, revealEntry, showShellMenu } from "@/lib/tauri";
import {
  cachedIconUrl,
  canManageEntry,
  foldItem,
  isLauncher,
  moveEntryToDesktop,
  moveItem,
  recycleDesktopItem,
  renameDesktopItem,
  rescan,
  showStatus,
  store,
  selectItem,
  selectPanelItems,
  toggleLauncher,
  unfoldItem,
} from "@/stores/state";
import type { DesktopEntry } from "@/types";

const props = defineProps<{
  entry: DesktopEntry;
  folded?: boolean;
  panelKey?: string;
  compact?: boolean;
  list?: boolean;
  hit?: boolean;
  selectionOrder?: string[];
}>();

// 图标走内存缓存（两段式加载）；未命中时渲染字形徽章。
const image = computed(() => cachedIconUrl(props.entry.path));
const managed = computed(() => canManageEntry(props.entry));
const singleClickLaunch = computed(() => Boolean(props.panelKey) && props.entry.isApplication);
const opening = ref(false);

/* 右键菜单 ------------------------------------------------------------- */

const menu = ref<{ x: number; y: number } | null>(null);
const renaming = ref(false);
const renameValue = ref("");

function onContextMenu(event: MouseEvent): void {
  event.preventDefault(); event.stopPropagation(); openFallbackMenu(event);
}

async function onSystemMenu(event: MouseEvent): Promise<void> {
  menu.value = null;
  event.preventDefault();
  event.stopPropagation();

  if (props.entry.kind === "shell") {
    openFallbackMenu(event);
    return;
  }

  try {
    const dpr = window.devicePixelRatio || 1;
    const result = await showShellMenu({
      path: props.entry.path,
      x: Math.round(event.screenX * dpr),
      y: Math.round(event.screenY * dpr),
      toDesktop: Boolean(props.entry.zone) && managed.value,
      inLauncher: isLauncher(props.entry.id),
      canFold: Boolean(props.panelKey) && !props.folded,
      canRename: managed.value,
    });
    if (result === "desktop") void moveEntryToDesktop(props.entry.id);
    else if (result === "launcher") toggleLauncher(props.entry.id);
    else if (result === "fold" && props.panelKey) {
      foldItem(props.panelKey, props.entry.id);
    } else if (result === "rename") {
      menuRename();
    } else if (result === "invoked") {
      window.setTimeout(() => void rescan(), 500);
    }
  } catch {
    openFallbackMenu(event);
  }
}

function openFallbackMenu(event: MouseEvent): void {
  menu.value = {
    x: Math.min(event.clientX, window.innerWidth - 200),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 360)),
  };
}

async function safeOpen(): Promise<void> {
  if (opening.value) return;
  opening.value = true;
  try {
    await launchEntry(props.entry);
  } catch (error) {
    showStatus(`无法打开：${props.entry.name}`);
    void error;
  } finally {
    opening.value = false;
  }
}

function menuOpen(): void {
  menu.value = null;
  void safeOpen();
}

function menuReveal(): void {
  menu.value = null;
  void revealEntry(props.entry.path).catch(() => {
    showStatus("无法在资源管理器中显示");
  });
}

function menuToggleLauncher(): void {
  menu.value = null;
  toggleLauncher(props.entry.id);
}

function menuUnfold(): void {
  menu.value = null;
  if (props.panelKey) unfoldItem(props.panelKey, props.entry.id);
}

function menuRename(): void {
  menu.value = null;
  renameValue.value = props.entry.name;
  renaming.value = true;
}

function closeRename(): void {
  renaming.value = false;
  // The desktop input coordinator observes removal and releases the session.
}

function submitRename(): void {
  const name = renameValue.value.trim();
  closeRename();
  if (!name || name === props.entry.name) return;
  void renameDesktopItem(props.entry, name);
}

function menuDelete(): void {
  menu.value = null;
  void recycleDesktopItem(props.entry);
}

function onSelect(event: MouseEvent): void {
  if (singleClickLaunch.value && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    selectPanelItems(props.panelKey ?? '', []);
    // The second click and dblclick must not launch an application twice.
    if (event.detail <= 1) void safeOpen();
    return;
  }
  selectItem(props.entry.id,props.panelKey??'',props.selectionOrder??[props.entry.id],event.ctrlKey||event.metaKey,event.shiftKey);
}

function onOpen(event: MouseEvent): void {
  if (singleClickLaunch.value || event.ctrlKey || event.metaKey || event.shiftKey) return;
  void safeOpen();
}

function menuToDesktop(): void {
  menu.value = null;
  void moveEntryToDesktop(props.entry.id);
}

function menuFold(): void {
  menu.value = null;
  if (props.panelKey) foldItem(props.panelKey, props.entry.id);
}
</script>

<template>
  <div
    class="tile"
    :class="{
      'is-selected': store.selectionPanel === (panelKey??'') && store.selectedItemIds.includes(entry.id),
      'is-folded': folded,
      compact,
      'is-list': list,
      'nestra-hit': hit,
    }"
    :data-item-id="entry.id"
    draggable="false"
    :title="`${entry.name}\n${entry.sourceLabel}`"
    @dragstart.prevent
    @pointerdown="startItemDrag($event, entry)"
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

  <!-- 右键菜单：全屏覆盖层带 nestra-hit，否则菜单伸出面板矩形外的部分
       会被 WS_EX_TRANSPARENT 切走，点击穿透到真桌面。z-index 必须高于
       小组件（1000+）与不断增长的 panel zIndex。 -->
  <Teleport to="body">
    <div
      v-if="menu"
      class="nestra-hit fixed inset-0"
      style="z-index: 9500"
      @click="menu = null"
      @contextmenu.prevent="menu = null"
    >
      <div class="tile-context-menu max-h-[min(360px,80vh)] overflow-y-auto" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop>
        <button class="menu-row" @click="menuOpen">打开</button>
        <button
          v-if="entry.kind !== 'shell'"
          class="menu-row"
          @click="menuReveal"
        >在资源管理器中显示</button>
        <button v-for="group in store.customGroups.filter(g => sourceFor(g).writable && g.dirName !== entry.zone)" :key="group.id" class="menu-row"
          @click="menu = null; moveItem(entry.id, group.id)">移动到「{{ group.name }}」</button>
        <button v-if="entry.zone && managed" class="menu-row" @click="menuToDesktop">放回桌面</button>
        <button v-if="folded && panelKey" class="menu-row" @click="menuUnfold">取消折叠</button>
        <button v-if="panelKey && !folded" class="menu-row" @click="menuFold">收入折叠</button>
        <button class="menu-row" @click="menuToggleLauncher">
          {{ isLauncher(entry.id) ? "移出快捷启动" : "添加到快捷启动" }}
        </button>
        <button v-if="managed" class="menu-row" @click="menuRename">重命名</button>
        <button v-if="entry.kind !== 'shell'" class="menu-row" @click="onSystemMenu">更多系统操作…</button>
        <button v-if="managed" class="menu-row menu-row-danger" @click="menuDelete">移到回收站</button>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="renaming" class="nestra-hit fixed inset-0" style="z-index: 9600" @click="closeRename">
      <form
        class="rename-pop"
        :style="{ left: '50%', top: '42%' }"
        @click.stop
        @submit.prevent="submitRename"
      >
        <p class="m-0 mb-2 text-[12px]" style="color: var(--nestra-text-secondary)">重命名</p>
        <input
          v-model="renameValue"
          class="search-input"
          autofocus
          @keyup.escape="closeRename"
        />
        <div class="mt-2 flex justify-end gap-2">
          <button type="button" class="menu-row" style="width: auto" @click="closeRename">取消</button>
          <button type="submit" class="menu-row" style="width: auto; color: var(--nestra-accent-strong)">确定</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
