<script setup lang="ts">
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import DesktopLayer from "@/desktop/DesktopLayer.vue";
import ManagerApp from "@/manager/ManagerApp.vue";

const label = getCurrentWebviewWindow().label;
</script>

<template>
  <ManagerApp v-if="label === 'manager'" />
  <DesktopLayer v-else />
</template>
