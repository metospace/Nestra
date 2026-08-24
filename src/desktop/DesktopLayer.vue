<script setup lang="ts">
import { listen } from "@tauri-apps/api/event";
import { onBeforeUnmount, onMounted } from "vue";
import OrganizerPanel from "./OrganizerPanel.vue";
import WidgetFrame from "./WidgetFrame.vue";
import { createWidget, initialize, itemsByPanel, rescan, showStatus, store } from "@/stores/state";

let unlisten: (() => void) | undefined;

onMounted(async () => {
  await initialize();

  unlisten = await listen<string>("nestra://tray", (event) => {
    switch (event.payload) {
      case "new-note":
        createWidget("note");
        break;
      case "new-todo":
        createWidget("todo");
        break;
      case "refresh":
        void rescan().then(() => showStatus("桌面索引已刷新"));
        break;
    }
  });
});

onBeforeUnmount(() => {
  unlisten?.();
});
</script>

<template>
  <div class="fixed inset-0 overflow-hidden">
    <!-- 分区面板 -->
    <template v-if="store.ready">
      <OrganizerPanel
        v-for="panel in store.panels"
        :key="panel.key"
        :panel="panel"
        :items="itemsByPanel[panel.key] ?? []"
      />

      <WidgetFrame
        v-for="widget in store.widgets"
        :key="widget.id"
        :widget="widget"
      />
    </template>

    <Transition name="fade">
      <div v-if="store.statusMessage" class="status-toast">
        {{ store.statusMessage }}
      </div>
    </Transition>

    <Transition name="fade">
      <div
        v-if="store.ready && store.entries.length === 0"
        class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center"
      >
        <p class="text-[15px]" style="color: var(--nestra-text-secondary)">
          桌面上暂时没有可以整理的项目
        </p>
        <p class="mt-2 text-xs" style="color: var(--nestra-text-faint)">
          放几个文件或快捷方式到桌面，然后从托盘图标选择「刷新分类」
        </p>
      </div>
    </Transition>
  </div>
</template>
