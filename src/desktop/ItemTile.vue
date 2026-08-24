<script setup lang="ts">
import { computed } from "vue";
import { iconSrc, openEntry, revealEntry } from "@/lib/tauri";
import { store } from "@/stores/state";
import type { DesktopEntry } from "@/types";

const props = defineProps<{
  entry: DesktopEntry;
}>();

const image = computed(() => iconSrc(props.entry.iconPath));

function onSelect(): void {
  store.selectedItemId = props.entry.id;
}

function onOpen(): void {
  void openEntry(props.entry.target, props.entry.launchKind);
}

function onReveal(event: MouseEvent): void {
  event.preventDefault();
  if (props.entry.kind === "file" || props.entry.kind === "folder") {
    void revealEntry(props.entry.path);
  }
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
    @contextmenu="onReveal"
  >
    <span v-if="entry.isFresh" class="fresh-dot" />

    <img v-if="image" :src="image" alt="" draggable="false" />
    <span v-else class="glyph-badge" style="width: 42px; height: 42px; font-size: 19px">
      {{ entry.glyph }}
    </span>

    <span class="tile-label">{{ entry.name }}</span>
  </div>
</template>
