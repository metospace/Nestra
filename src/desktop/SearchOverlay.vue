<script setup lang="ts">
import SearchPanel from '@/features/SearchPanel.vue';
import { closeSearch, store } from '@/stores/state';
</script>
<template><div v-if="store.searchOpen" class="nestra-hit search-scrim" @pointerdown.self="closeSearch"><div class="nestra-hit search-overlay"><SearchPanel compact :initial-query="store.searchQuery" @close="closeSearch"/></div></div></template>
<style scoped>.search-scrim{position:fixed;inset:0;z-index:9500;background:#10203b30;display:flex;justify-content:center;align-items:flex-start;padding-top:10vh}.search-overlay{width:min(760px,90vw);height:560px;max-height:80vh;border-radius:14px;overflow:hidden;box-shadow:0 24px 80px #10203b40}</style>
