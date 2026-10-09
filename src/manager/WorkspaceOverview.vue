<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UIcon from '@nuxt/ui/components/Icon.vue';
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue';
import { cachedIconUrl, itemsByPanel, launcherEntries, viewSurface, store } from '@/stores/state';
import { surfaceAppearance, surfaceVariables } from '@/domain/presentation';
import type { DesktopEntry, PanelLayout, Widget } from '@/types';

const emit = defineEmits<{ navigate: [module: string, objectId?: string]; add: [kind?: 'zone' | 'folder'] }>();
interface Surface { key: string; title: string; groupId?: string; layout: PanelLayout; entries: DesktopEntry[]; widget?: Widget }
const surfaces = computed<Surface[]>(() => [
  ...store.panels.filter(panel => !store.tabGroups.some(tabs => tabs.groupIds.includes(panel.groupId)))
    .filter(panel => store.panelLayouts[panel.key])
    .map(panel => ({ ...panel, layout: store.panelLayouts[panel.key]!, entries: panel.key === 'system:launcher' ? launcherEntries.value : itemsByPanel.value[panel.key] ?? [] }))
    .filter(surface => surface.key !== 'system:launcher' || surface.layout.visible || surface.entries.length > 0),
  ...store.widgets.map(widget => ({ key: `widget:${widget.id}`, title: widget.title, layout: widget.layout, entries: [], widget })),
]);
const selectedKey = ref('');
watch(surfaces, list => { if (!list.some(surface => surface.key === selectedKey.value)) selectedKey.value = list[0]?.key ?? ''; }, { immediate: true });
const selected = computed(() => surfaces.value.find(surface => surface.key === selectedKey.value));
// A composed overview, independent of physical monitor coordinates. It never writes desktop layouts.
const companions = computed(() => surfaces.value.filter(surface => surface.key !== selectedKey.value && surface.layout.visible).sort((a, b) => Number(!!b.widget) - Number(!!a.widget)).slice(0, 2));
const previews = computed(() => selected.value ? [selected.value, ...companions.value] : []);
const addItems = [[{ label: '收纳区或文件来源', icon: 'i-lucide-folder-plus', onSelect: () => emit('add') }, { label: '便签、待办与组件', icon: 'i-lucide-panels-top-left', onSelect: () => emit('navigate', 'widgets') }]];
function manage(surface: Surface) { emit('navigate', surface.widget ? 'widgets' : surface.key === 'system:launcher' ? 'launcher' : 'files', store.customGroups.some(group => group.id === surface.groupId) ? surface.groupId : undefined); }
function summary(surface: Surface) {
  if (!surface.layout.visible) return '已隐藏 · 点击后可恢复';
  if (!surface.widget) return `${surface.entries.length} 个项目`;
  if (surface.widget.kind === 'todo') return `${surface.widget.todos.filter(todo => !todo.completed).length} 项待完成`;
  if (surface.widget.kind === 'note') return surface.widget.content || '写下你的灵感';
  return surface.widget.kind === 'clock' ? '时间与日期' : '剪贴板历史';
}
function icon(surface: Surface) { return surface.widget ? ({note: 'i-lucide-sticky-note', todo: 'i-lucide-list-todo', clock: 'i-lucide-clock', clipboard: 'i-lucide-clipboard-list'}[surface.widget.kind]) : surface.key === 'system:launcher' ? 'i-lucide-layout-grid' : 'i-lucide-folder'; }
function entryIcon(entry: DesktopEntry) { return entry.kind === 'folder' ? 'i-lucide-folder' : entry.isApplication ? 'i-lucide-app-window' : /\.(png|jpe?g|webp|gif)$/i.test(entry.name) ? 'i-lucide-image' : 'i-lucide-file-text'; }
</script>

<template>
  <div class="workspace-overview">
    <section class="workspace-stage" aria-label="桌面空间预览">
      <div class="workspace-heading"><div><h1>桌面空间</h1><p>所有常用内容，近在手边</p></div><UDropdownMenu :items="addItems"><UButton class="graphite-button" color="neutral" icon="i-lucide-plus">添加内容</UButton></UDropdownMenu></div>
      <div v-if="selected" class="spatial-canvas">
        <article v-for="(surface, index) in previews" :key="surface.key" class="spatial-surface nestra-panel" :class="{'is-selected':index===0, 'is-companion':index>0}" :data-widget-kind="surface.widget?.kind" :style="surfaceVariables(surface.layout,store.appearance)" :data-material="surfaceAppearance(surface.layout,store.appearance).surfaceMaterial" :data-border="surfaceAppearance(surface.layout,store.appearance).borderStyle">
          <header><button class="surface-select" :aria-pressed="selectedKey===surface.key" @click="selectedKey=surface.key"><UIcon class="surface-symbol" :name="icon(surface)"/><span><strong>{{surface.title}}</strong><small>{{surface.widget?.kind==='todo'?summary(surface):!surface.widget?`${surface.entries.length} 个项目${surface.layout.visible?'':' · 已隐藏'}`:''}}</small></span></button><UButton color="neutral" variant="ghost" icon="i-lucide-ellipsis" size="xs" :aria-label="`管理${surface.title}`" @click="manage(surface)"/></header>
          <div v-if="!surface.widget" class="spatial-files" :class="{'is-list':surface.layout.viewMode==='list'}"><div v-for="entry in surface.entries.slice(0,index===0?6:3)" :key="entry.id" class="spatial-file"><img v-if="cachedIconUrl(entry.path)" :src="cachedIconUrl(entry.path)!" alt=""/><UIcon v-else :name="entryIcon(entry)"/><span>{{entry.name}}</span></div><p v-if="!surface.entries.length" class="spatial-empty">{{surface.key==='system:launcher'?'固定常用入口，随时打开':'拖入文件，让桌面井然有序'}}</p></div>
          <p v-else-if="surface.widget.kind==='note'" class="spatial-note">{{surface.widget.content || '写点什么，让灵感留在桌面。'}}</p>
          <ul v-else-if="surface.widget.kind==='todo'" class="spatial-todos"><li v-for="todo in surface.widget.todos.slice(0,4)" :key="todo.id" :class="{'is-completed':todo.completed}"><UIcon :name="todo.completed?'i-lucide-square-check':'i-lucide-square'"/><span>{{todo.text}}</span></li><li v-if="!surface.widget.todos.length" class="muted-text">还没有待办，在桌面添加第一项。</li></ul>
          <div v-else class="spatial-widget-placeholder"><UIcon :name="icon(surface)"/><p>{{summary(surface)}}</p><small>在桌面查看与使用</small></div>
        </article>
        <span class="canvas-caption">桌面内容预览 · 位置与尺寸请在桌面调整</span>
      </div>
      <div v-else class="spatial-welcome"><UIcon name="i-lucide-panels-top-left"/><h2>为你的桌面留一点空间</h2><p>新建收纳区后，拖入会移动文件；显示已有文件夹默认只浏览。</p><div class="flex gap-3 justify-center"><UButton class="graphite-button" color="neutral" @click="emit('add','zone')">新建收纳区</UButton><UButton color="neutral" variant="outline" @click="emit('add','folder')">显示已有文件夹</UButton></div></div>
      <nav v-if="surfaces.length" class="surface-dock" aria-label="选择桌面内容"><button v-for="surface in surfaces" :key="surface.key" :class="{active:selectedKey===surface.key,'is-hidden':!surface.layout.visible}" :aria-pressed="selectedKey===surface.key" @click="selectedKey=surface.key"><span class="dock-icon"><UIcon :name="icon(surface)"/></span><span><strong>{{surface.title}}</strong><small>{{summary(surface)}}</small></span></button></nav>
    </section>
    <aside class="workspace-inspector" aria-label="当前选择">
      <template v-if="selected"><div class="inspector-top"><span>当前选择</span><UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-ellipsis" aria-label="管理当前内容" @click="manage(selected)"/></div><div class="inspector-heading"><UIcon :name="icon(selected)"/><h2>{{selected.title}}</h2></div><p class="inspector-status"><span class="status-dot" :class="{'is-paused':!selected.layout.visible || store.paused}"/>{{!selected.layout.visible?'已隐藏':store.paused?'桌面已暂停':'桌面显示中'}}</p>
        <div class="inspector-content"><h3>{{selected.widget?summary(selected):`${selected.entries.length} 个项目`}}</h3><ul v-if="!selected.widget" class="inspector-files"><li v-for="entry in selected.entries" :key="entry.id"><img v-if="cachedIconUrl(entry.path)" :src="cachedIconUrl(entry.path)!" alt=""/><UIcon v-else :name="entryIcon(entry)"/><span :title="entry.name">{{entry.name}}</span></li></ul><p v-else-if="selected.widget.kind==='note'" class="inspector-note">{{selected.widget.content || '便签内容为空'}}</p><ul v-else-if="selected.widget.kind==='todo'" class="spatial-todos"><li v-for="todo in selected.widget.todos" :key="todo.id" :class="{'is-completed':todo.completed}"><UIcon :name="todo.completed?'i-lucide-square-check':'i-lucide-square'"/><span>{{todo.text}}</span></li></ul><p v-else class="muted-text">{{selected.widget.kind==='clock'?'查看桌面上的时间与日期。':'复制的文本会记录在桌面组件中。'}}</p><p v-if="!selected.widget&&!selected.entries.length" class="muted-text">暂无内容，可在桌面拖入文件或管理文件来源。</p></div>
        <div class="inspector-actions"><UButton class="graphite-button" color="neutral" icon="i-lucide-square-arrow-out-up-right" @click="viewSurface(selected.key)">{{selected.layout.visible?'在桌面查看':'恢复到桌面'}}</UButton><UButton class="pearl-button" color="neutral" variant="outline" @click="manage(selected)">管理内容</UButton></div>
        <div class="inspector-material"><div><strong>{{selected.layout.appearance?'独立风格':'跟随全局风格'}}</strong><small>单栏样式在桌面中调整</small><UButton color="neutral" variant="link" size="xs" @click="emit('navigate','appearance')">全局外观</UButton></div><div class="material-swatch" aria-hidden="true"/></div>
      </template><template v-else><div class="inspector-top">你的工作空间</div><h2>从桌面开始</h2><p class="muted-text">选择一个收纳区或组件，即可在这里查看它的内容。</p><UButton color="neutral" variant="outline" @click="emit('navigate','widgets')">探索桌面组件</UButton></template>
      <UButton class="inspector-bottom-link" color="neutral" variant="ghost" icon="i-lucide-folders" @click="emit('navigate','files')">所有文件来源</UButton>
    </aside>
  </div>
</template>
