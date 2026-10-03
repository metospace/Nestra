<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { initialize, store } from "@/stores/state";
import SearchPanel from "./SearchPanel.vue";
const focusSignal = ref(0);
function onFocus(){focusSignal.value++}
window.addEventListener("focus",onFocus); let unlisten: (()=>void) | undefined;
onMounted(async () => { unlisten = await listen('nestra://search-focus',()=>focusSignal.value++); await initialize(); });
onUnmounted(()=>{unlisten?.();window.removeEventListener("focus",onFocus)});
</script>
<template><div class="search-window"><SearchPanel compact :focus-signal="focusSignal" @close="getCurrentWebviewWindow().hide()"/><p v-if="store.statusMessage" class="navigation-status" role="status">{{store.statusMessage}}</p></div></template>
