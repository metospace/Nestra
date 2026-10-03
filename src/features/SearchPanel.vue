<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import UButton from "@nuxt/ui/components/Button.vue";
import UInput from "@nuxt/ui/components/Input.vue";
import UIcon from "@nuxt/ui/components/Icon.vue";
import { cachedIconUrl, pinEntry, searchWithDetails, showStatus, store } from "@/stores/state";
import { launchEntry, revealEntry, recentLaunches, scanApplications, searchEverything } from "@/lib/tauri";
import type { SearchScope } from "@/lib/search";
import type { DesktopEntry } from "@/types";
const props = defineProps<{ compact?: boolean; initialQuery?: string; focusSignal?: number }>();
const emit = defineEmits<{ close: [] }>();
const query = ref(props.initialQuery ?? ""), scope = ref<SearchScope>("all");
const results = ref<DesktopEntry[]>([]), message = ref(""), loading = ref(false), active = ref(0);
const visibleCount=ref(24);
const visibleResults=computed(()=>results.value.slice(0,visibleCount.value));
const provider = ref("正在检测…");
const scopes: {label:string; value:SearchScope}[] = [{label:"全部",value:"all"},{label:"应用",value:"applications"},{label:"桌面",value:"desktop"},{label:"收纳区",value:"zones"},{label:"映射文件夹",value:"mappings"},{label:"全盘文件",value:"everything"}];
let revision = 0, timer: number | undefined;
function queue() {
  visibleCount.value=24;results.value=[];active.value=0;message.value='';window.clearTimeout(timer); const current = ++revision; loading.value = true;
  timer = window.setTimeout(async () => {
    const selected = results.value[active.value]?.id;
    const apply = (found: Awaited<ReturnType<typeof searchWithDetails>>) => {
      if (current !== revision) return;
      results.value = found.entries; message.value = found.message;
      active.value = Math.max(0, found.entries.findIndex(entry => entry.id === selected));
    };
    try { apply(await searchWithDetails(query.value, scope.value, apply)); }
    catch (error) { if (current === revision) message.value = `搜索失败：${error}`; }
    finally { if (current === revision) loading.value = false; }
  }, 140);
}
async function detect() { try { const found = await searchEverything(""); provider.value = found.message; } catch { provider.value = "Everything 连接失败"; } }
async function refreshApps() { try { store.applications = await scanApplications(); showStatus(`应用目录已刷新：${store.applications.length} 项`); queue(); } catch(error) { showStatus(`应用目录刷新失败：${error}`); } }
function focus() { void nextTick(() => { const input=document.querySelector<HTMLInputElement>('input[data-search-input]'); input?.focus(); input?.select(); }); }
watch([query, scope, () => store.applications.length], queue);
watch(() => props.focusSignal, () => {focus();void refreshRecent();});
watch(() => props.initialQuery, value => { query.value = value ?? ""; });
async function refreshRecent(){try{store.recentLaunchPaths=await recentLaunches();queue();}catch{/* Search still works without session history. */}}
onMounted(() => { queue(); void detect();void refreshRecent(); if (props.compact) focus(); });
onUnmounted(() => { window.clearTimeout(timer); revision++; });
async function open(entry: DesktopEntry) { try { await launchEntry(entry); if (props.compact) emit("close"); } catch(error) { showStatus(`无法打开「${entry.name}」：${error}`); } }
async function reveal(entry: DesktopEntry) { try { await revealEntry(entry.path); } catch(error) { showStatus(`无法定位：${error}`); } }
async function copy(entry: DesktopEntry) { try { await navigator.clipboard.writeText(entry.path); showStatus("路径已复制"); } catch { showStatus("无法复制路径"); } }
function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); emit("close"); }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); active.value = Math.max(0, Math.min(results.value.length - 1, active.value + (event.key === "ArrowDown" ? 1 : -1))); visibleCount.value=Math.max(visibleCount.value,active.value+1);void nextTick(() => document.querySelector('[data-search-active="true"]')?.scrollIntoView({ block: "nearest" })); }
  if (event.key === "Enter" && !(event.target as HTMLElement).closest("button") && !event.isComposing && results.value[active.value]) { event.preventDefault(); void open(results.value[active.value]!); }
}
</script>
<template>
  <div class="navigation-panel" :class="{'is-compact':compact}" @keydown="onKey">
    <div class="navigation-input"><UInput data-search-input v-model="query" icon="i-lucide-search" placeholder="搜索文件、文件夹和应用…" aria-label="搜索文件、文件夹和应用" size="xl" class="flex-1" :ui="{base:'w-full'}" /><UButton v-if="compact" icon="i-lucide-x" variant="ghost" color="neutral" aria-label="关闭搜索" @click="emit('close')" /></div>
    <div class="navigation-scopes" role="tablist" aria-label="搜索范围"><button v-for="item in scopes" :key="item.value" role="tab" :aria-selected="scope===item.value" :class="{active:scope===item.value}" @click="scope=item.value">{{item.label}}</button></div>
    <p class="navigation-status" role="status"><UIcon v-if="loading" name="i-lucide-loader-circle" class="animate-spin" />{{ message || '准备搜索' }}<span v-if="!query.trim()&&store.recentLaunchPaths.length" class="muted-text"> · 本次运行最近打开的项目优先</span></p>
    <div class="navigation-results" role="listbox" aria-label="搜索结果">
      <div v-for="(entry,index) in visibleResults" :key="entry.id" class="navigation-result" role="option" :aria-selected="index===active" :data-search-active="index===active" :class="{'is-active':index===active}" @mouseenter="active=index">
        <img v-if="cachedIconUrl(entry.path)" :src="cachedIconUrl(entry.path)!" class="search-icon" alt="" /><UIcon v-else :name="entry.isApplication?'i-lucide-app-window':entry.kind==='folder'?'i-lucide-folder':'i-lucide-file'" class="result-icon" />
        <button class="result-main" @click="open(entry)"><strong>{{entry.name}}</strong><small :title="entry.path">{{entry.path}}</small></button><span class="source-badge">{{entry.sourceLabel}}</span>
        <div class="result-actions"><UButton icon="i-lucide-pin" size="xs" variant="ghost" aria-label="固定到快捷启动" title="固定到快捷启动" @click="pinEntry(entry)"/><UButton v-if="entry.kind!=='shell'" icon="i-lucide-folder-open" size="xs" variant="ghost" aria-label="打开所在位置" title="打开所在位置" @click="reveal(entry)"/><UButton icon="i-lucide-copy" size="xs" variant="ghost" aria-label="复制路径" title="复制路径" @click="copy(entry)"/></div>
      </div>
      <div v-if="visibleCount<results.length" class="search-load-more"><UButton variant="soft" color="neutral" @click="visibleCount+=24">继续显示（还有 {{results.length-visibleResults.length}} 项）</UButton></div>
      <div v-if="!loading&&!results.length" class="manager-empty"><UIcon name="i-lucide-search"/><h3>没有找到匹配项目</h3><p>调整关键词或范围。全盘文件需要 Everything 已运行并建立索引。</p></div>
    </div>
    <div v-if="!compact" class="settings-row"><div><strong>搜索来源</strong><p>{{provider}} · 应用目录 {{store.applications.length}} 项</p></div><div class="flex gap-2"><UButton variant="outline" size="sm" @click="detect">重新检测</UButton><UButton variant="outline" size="sm" @click="refreshApps">刷新应用目录</UButton></div></div>
    <footer class="navigation-footer"><span>↑↓ 选择　Enter 打开　Esc 关闭</span><span>{{visibleResults.length}} / {{ results.length }} 个已加载结果</span></footer>
  </div>
</template>
