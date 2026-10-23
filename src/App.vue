<script setup lang="ts">
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { defineAsyncComponent } from "vue";
import UApp from "@nuxt/ui/components/App.vue";
import FileMoveResults from '@/components/FileMoveResults.vue';

const label = getCurrentWebviewWindow().label;
const DesktopLayer = defineAsyncComponent(() => import("@/desktop/DesktopLayer.vue"));
const ManagerApp = defineAsyncComponent(() => import("@/manager/ManagerApp.vue"));
const SearchWindow = defineAsyncComponent(() => import("@/features/SearchWindow.vue"));
</script>

<template>
  <UApp :toaster="null">
    <ManagerApp v-if="label === 'manager'" />
    <SearchWindow v-else-if="label === 'search'" />
    <DesktopLayer v-else />
    <FileMoveResults />
  </UApp>
</template>
