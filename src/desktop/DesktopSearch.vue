<script setup lang="ts">
import { computed } from 'vue';
import UIcon from '@nuxt/ui/components/Icon.vue';
import { startMove } from '@/composables/useSurfaceDrag';
import { requestOpenSearch } from '@/lib/tauri';
import { surfaceVariables } from '@/domain/presentation';
import { bringToFront, DESKTOP_SEARCH_KEY, showStatus, store } from '@/stores/state';
const layout = computed(() => store.panelLayouts[DESKTOP_SEARCH_KEY]);
function move(event: PointerEvent) {
  if (!layout.value) return;
  bringToFront(DESKTOP_SEARCH_KEY);
  startMove(event, layout.value, { minWidth: 220, minHeight: 46 });
}
async function search() { try { await requestOpenSearch(); } catch { showStatus('暂时无法打开搜索，请重试'); } }
</script>
<template>
  <section v-if="layout && layout.visible !== false" class="desktop-search nestra-hit" aria-label="桌面搜索组件"
    :style="{ ...surfaceVariables(layout, store.appearance), left:`${layout.x}px`,top:`${layout.y}px`,width:`${layout.width}px`,height:`${layout.height}px`,zIndex:layout.zIndex }">
    <button class="search-grip" aria-label="拖动搜索组件" title="拖动搜索组件" @pointerdown="move"><UIcon name="i-lucide-grip-vertical" /></button>
    <button class="search-entry" aria-label="搜索文件和应用" title="Ctrl+Alt+F" @click="search"><UIcon name="i-lucide-search" /><span>搜索文件和应用</span></button>
  </section>
</template>
<style scoped>
.desktop-search{position:absolute;display:flex;align-items:center;background:var(--product-glass);border:1px solid var(--nestra-line-strong);border-radius:var(--panel-radius);box-shadow:var(--product-shadow);backdrop-filter:blur(24px);color:var(--nestra-text);overflow:hidden}
.search-grip{width:24px;height:100%;display:grid;place-items:center;flex-shrink:0;color:var(--nestra-text-faint);cursor:grab}.search-grip:active{cursor:grabbing}.search-grip svg{width:13px;height:13px}
.search-entry{display:flex;gap:9px;align-items:center;padding:0 12px 0 3px;flex:1;height:100%;min-width:0;text-align:left;font-size:12px;color:var(--nestra-text-secondary)}.search-entry svg{width:17px;height:17px;flex-shrink:0}.search-entry span{flex:1}.search-entry kbd{border:0;padding:0;font-size:18px;color:var(--nestra-text-faint)}
button:focus-visible{outline:2px solid var(--nestra-accent);outline-offset:-3px}
</style>
