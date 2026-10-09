<script setup lang="ts">
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import DesktopLayer from "@/desktop/DesktopLayer.vue";
import ManagerApp from "@/manager/ManagerApp.vue";
import UApp from "@nuxt/ui/components/App.vue";
import SearchWindow from "@/features/SearchWindow.vue";
import FileMoveResults from '@/components/FileMoveResults.vue';

const label = getCurrentWebviewWindow().label;
</script>

<template>
  <UApp :toaster="null">
    <ManagerApp v-if="label === 'manager'" />
    <SearchWindow v-else-if="label === 'search'" />
    <DesktopLayer v-else />
    <FileMoveResults />
  </UApp>
</template>
