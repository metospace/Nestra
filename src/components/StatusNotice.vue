<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue';
import { dismissStatus, setLauncherVisible, store } from '@/stores/state';

defineProps<{ inline?: boolean; desktop?: boolean }>();
</script>

<template>
  <div v-if="store.statusMessage" class="status-notice nestra-hit" :class="inline ? 'status-notice-inline' : desktop ? 'status-toast' : 'manager-toast'" role="status">
    <span>{{ store.statusMessage }}</span>
    <template v-if="store.statusAction === 'show-launcher'">
      <UButton size="xs" color="neutral" variant="soft" @click="setLauncherVisible(true)">显示桌面启动栏</UButton>
      <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" aria-label="关闭固定提示" @click="dismissStatus" />
    </template>
  </div>
</template>

<style scoped>
.status-notice { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.status-notice>span { flex:1; min-width:120px; }
.status-notice-inline { flex:none; margin:0 16px 8px; padding:10px 12px; border:1px solid var(--nestra-line); border-radius:9px; background:var(--nestra-hover); color:var(--nestra-text); font-size:12px; }
</style>
