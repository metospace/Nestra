<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { fileMoves, retryFailedMoves } from '@/composables/fileMoveReports';
const report = computed(() => fileMoves.reports.find(item => item.id === fileMoves.activeId));
const failed = computed(() => report.value?.items.filter(item => item.state === 'failed').length ?? 0);
const dialog = ref<HTMLElement>();
let previousFocus: HTMLElement | null = null;
watch(() => fileMoves.open, async open => {
  if (open) { previousFocus = document.activeElement as HTMLElement; await nextTick(); dialog.value?.focus(); }
  else if (previousFocus?.isConnected) previousFocus.focus();
});
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const items = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled)') ?? []);
  const current = items.indexOf(document.activeElement as HTMLElement);
  event.preventDefault();
  items[(current + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
}
</script>
<template>
  <Teleport to="body"><div v-if="fileMoves.open && report" class="move-results-backdrop nestra-hit" @keydown.esc="fileMoves.open=false">
    <section ref="dialog" class="move-results nestra-hit" role="dialog" aria-modal="true" aria-labelledby="move-results-title" tabindex="-1" @keydown="trapFocus">
      <header><div><h2 id="move-results-title">本次整理结果</h2><p>目标：{{report.destination}}</p></div><button aria-label="关闭整理结果" @click="fileMoves.open=false">关闭</button></header>
      <label>本窗口操作记录<select v-model="fileMoves.activeId" :disabled="fileMoves.busy" aria-label="选择整理记录"><option v-for="item in fileMoves.reports" :key="item.id" :value="item.id">第 {{item.id}} 次 · {{item.destination}} · {{item.items.length}} 项</option></select></label>
      <p role="status">{{fileMoves.busy?'正在处理…':`成功 ${report.items.filter(item=>item.state==='success').length} 项，失败 ${failed} 项`}}</p>
      <p v-if="report.warning" role="alert">{{report.warning}}</p>
      <ul><li v-for="(item,index) in report.items" :key="index"><strong>{{item.name}} · {{item.state==='success'?'成功':item.state==='failed'?'失败':'等待处理'}}</strong><small>{{item.path}}</small><p v-if="item.error" class="error-text">{{item.error}}</p></li></ul>
      <footer><small>记录保留到关闭本窗口或退出程序。重试只处理失败项。</small><button :disabled="fileMoves.busy||!failed" @click="retryFailedMoves">仅重试失败项（{{failed}}）</button></footer>
    </section>
  </div></Teleport>
</template>
<style scoped>
.move-results-backdrop{position:fixed;inset:0;z-index:9600;background:#0005;display:grid;place-items:center;padding:24px}.move-results{background:var(--nestra-panel-bg,#fff);color:var(--nestra-text,#222);border:1px solid var(--nestra-line,#ddd);border-radius:16px;padding:24px;width:min(640px,100%);max-height:85vh;overflow:auto;box-shadow:0 20px 80px #0003}.move-results header,.move-results footer{display:flex;justify-content:space-between;align-items:center;gap:16px}.move-results h2{font-size:20px;font-weight:600}.move-results p{margin:8px 0}.move-results label{display:flex;gap:12px;align-items:center;margin:16px 0}.move-results select{max-width:75%;padding:6px;background:var(--nestra-panel-bg,#fff)}.move-results ul{margin:16px 0;max-height:38vh;overflow:auto}.move-results li{padding:12px 0;border-top:1px solid var(--nestra-line,#ddd);overflow-wrap:anywhere}.move-results small{display:block;color:var(--nestra-text-secondary,#666);overflow-wrap:anywhere}.move-results button{padding:7px 12px;border:1px solid var(--nestra-line,#bbb);border-radius:8px;cursor:pointer}.move-results button:disabled{opacity:.45;cursor:default}
.move-results,.move-results select{background:var(--nestra-surface,#fff)}
.move-results footer{flex-wrap:wrap}.move-results label{flex-wrap:wrap}
</style>
