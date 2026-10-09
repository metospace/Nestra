<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import UButton from '@nuxt/ui/components/Button.vue';
import UIcon from '@nuxt/ui/components/Icon.vue';
import USelect from '@nuxt/ui/components/Select.vue';
import USwitch from '@nuxt/ui/components/Switch.vue';
import USlider from '@nuxt/ui/components/Slider.vue';
import UTabs from '@nuxt/ui/components/Tabs.vue';
import WorkspaceOverview from './WorkspaceOverview.vue';
import NestraLogo from '@/components/NestraLogo.vue';
import FileManagement from './FileManagement.vue';
import LauncherManagement from './LauncherManagement.vue';
import WidgetManagement from './WidgetManagement.vue';
import LayoutManagement from './LayoutManagement.vue';
import DataManagement from './DataManagement.vue';
import SearchPanel from '@/features/SearchPanel.vue';
import StatusNotice from '@/components/StatusNotice.vue';
import { confirmDialog, useGlobalAppearanceForAll, initialize, refreshDisplays, rescan, setAppearance, setHideNativeIcons, setPaused, setStartWithWindows, showStatus, store } from '@/stores/state';
import { requestOpenSearch, searchEverything } from '@/lib/tauri';
import type { AppearanceSettings } from '@/types';
const currentWindow=getCurrentWebviewWindow();
const sections=[{id:'overview',label:'概览',icon:'i-lucide-house'},{id:'files',label:'文件与收纳',icon:'i-lucide-folders'},{id:'launcher',label:'快捷启动',icon:'i-lucide-rocket'},{id:'search',label:'搜索',icon:'i-lucide-search'},{id:'widgets',label:'小组件',icon:'i-lucide-panels-top-left'},{id:'layout',label:'布局与显示器',icon:'i-lucide-monitor'},{id:'appearance',label:'全局外观',icon:'i-lucide-palette'},{id:'data',label:'数据与恢复',icon:'i-lucide-archive-restore'},{id:'system',label:'系统',icon:'i-lucide-settings-2'}];
const section=ref('overview'),addSignal=ref(0),initialId=ref(''),provider=ref('正在检测 Everything…'),refreshing=ref(false);
const creationKind=ref<'zone'|'folder'|undefined>();
let unlisten:(()=>void)|undefined;
async function refresh(){refreshing.value=true;try{await rescan();await refreshDisplays();provider.value=(await searchEverything('')).message}catch(e){showStatus(`刷新失败：${e}`)}finally{refreshing.value=false}}
function goto(id:string,objectId?:string){initialId.value=objectId??'';addSignal.value=0;section.value=id}
const contentTabs=[{label:'文件与收纳',value:'files'},{label:'快捷启动',value:'launcher'},{label:'小组件',value:'widgets'},{label:'搜索',value:'search'}];
const primaryTabs=[{label:'桌面空间',value:'overview'},{label:'内容管理',value:'content'},{label:'设置',value:'settings'}];
const primarySection=computed(()=>inSettings.value?'settings':contentTabs.some(tab=>tab.value===section.value)?'content':'overview');
function navigatePrimary(value:string){goto(value==='settings'?'appearance':value==='content'?'files':'overview')}
const settingsTabs=[{label:'全局外观',value:'appearance'},{label:'布局与显示器',value:'layout'},{label:'数据与恢复',value:'data'},{label:'系统',value:'system'}];
const inSettings=computed(()=>settingsTabs.some(tab=>tab.value===section.value));
function add(kind?:'zone'|'folder'){creationKind.value=kind;section.value='files';addSignal.value++}
function appearance(key:keyof AppearanceSettings,value:unknown){setAppearance({[key]:value})}
const independentCount=computed(()=>Object.values(store.panelLayouts).filter(layout=>layout.appearance).length);
async function unifyAppearance(){if(await confirmDialog('将所有收纳栏恢复为全局风格？已有独立样式将被替换，位置和文件显示布局保留。'))useGlobalAppearanceForAll();}
const materialItems=[{label:'磨砂',value:'matte'},{label:'清透',value:'clear'},{label:'玻璃',value:'glass'},{label:'亚克力',value:'acrylic'}];
onMounted(async()=>{await initialize();void refresh();unlisten=await currentWindow.listen<{module:string;objectId?:string}>('nestra://manager-route',event=>{const module=event.payload.module==='surfaces'?'appearance':event.payload.module;if(sections.some(s=>s.id===module))section.value=module;initialId.value=event.payload.objectId??''})});
onUnmounted(()=>unlisten?.());
</script>
<template>
<div class="control-center">
  <header class="product-topbar">
    <button class="product-brand" aria-label="返回桌面空间" @click="goto('overview')"><NestraLogo class="product-logo"/><strong>Nestra</strong></button>
    <UTabs :items="primaryTabs" :model-value="primarySection" :content="false" :ui="{list:'product-nav',trigger:'product-nav-trigger',indicator:'product-nav-indicator'}" aria-label="主导航" @update:model-value="value=>navigatePrimary(String(value))"/>
    <div class="product-topbar-actions"><UButton class="product-search" color="neutral" variant="outline" icon="i-lucide-search" aria-label="全局搜索文件和应用" @click="requestOpenSearch"><span>搜索文件、应用…</span></UButton><UButton color="neutral" :variant="inSettings?'soft':'ghost'" icon="i-lucide-settings-2" aria-label="打开设置" @click="goto('appearance')"/><span class="window-action-divider"/><UButton color="neutral" variant="ghost" icon="i-lucide-minus" aria-label="最小化控制中心" @click="currentWindow.minimize()"/><UButton color="neutral" variant="ghost" icon="i-lucide-x" aria-label="隐藏控制中心" @click="currentWindow.hide()"/></div>
  </header>
  <div class="product-body" :class="{'is-overview':section==='overview'}">
  <div v-if="inSettings || primarySection==='content'" class="product-settings-navigation"><UButton color="neutral" variant="ghost" icon="i-lucide-arrow-left" size="sm" @click="goto('overview')">桌面空间</UButton><UTabs :items="inSettings?settingsTabs:contentTabs" :model-value="section" :content="false" variant="link" @update:model-value="value=>goto(String(value))"/></div>
  <main class="manager-content" :class="{'is-overview':section==='overview'}"><div v-if="store.persistenceBlocked" class="error-callout" role="alert">配置加载失败或版本不兼容，已阻止写入以保护原配置。请检查数据与恢复，或使用与配置版本一致的程序。</div><div v-if="!store.ready" class="manager-empty">正在加载工作空间…</div><template v-else>
  <WorkspaceOverview v-if="section==='overview'" @navigate="goto" @add="add"/>
  <FileManagement v-else-if="section==='files'" :initial-id="initialId" :add-signal="addSignal" :initial-kind="creationKind"/>
  <LauncherManagement v-else-if="section==='launcher'"/>
  <template v-else-if="section==='search'"><div class="page-heading"><div><h1>搜索</h1><p>从桌面、收纳区、映射目录、已安装应用和全盘索引中查找。</p></div></div><SearchPanel/></template>
  <WidgetManagement v-else-if="section==='widgets'"/>
  <LayoutManagement v-else-if="section==='layout'"/>
  <DataManagement v-else-if="section==='data'"/>
  <template v-else-if="section==='appearance'"><div class="page-heading"><div><h1>全局外观</h1><p>默认应用到所有收纳栏。单栏样式与布局请在桌面标题上的设置按钮中调整。</p></div><UButton variant="outline" :disabled="!independentCount" @click="unifyAppearance">统一所有收纳栏</UButton></div><p class="muted-text">{{independentCount?`${independentCount} 个收纳栏有独立样式，仅已覆盖的项目不跟随全局。`:"所有收纳栏均跟随全局风格。"}}</p><div class="appearance-columns"><div class="manager-card form-stack"><label>主题<USelect :model-value="store.appearance.theme??'light'" :items="[{label:'浅色',value:'light'},{label:'深色',value:'dark'}]" @update:model-value="v=>appearance('theme',v)"/></label><label>桌面材质<USelect :model-value="store.appearance.surfaceMaterial" :items="materialItems" @update:model-value="v=>appearance('surfaceMaterial',v)"/></label><label>圆角<USelect :model-value="store.appearance.cornerStyle" :items="[{label:'方正',value:'square'},{label:'紧凑',value:'compact'},{label:'标准',value:'standard'},{label:'圆润',value:'rounded'}]" @update:model-value="v=>appearance('cornerStyle',v)"/></label><label>边界<USelect :model-value="store.appearance.borderStyle" :items="[{label:'无边框',value:'none'},{label:'细线',value:'subtle'},{label:'清晰边框',value:'strong'},{label:'阴影',value:'shadow'}]" @update:model-value="v=>appearance('borderStyle',v)"/></label><label>面板不透明度 · {{Math.round(store.appearance.panelOpacity*100)}}%<USlider :model-value="store.appearance.panelOpacity" :min=".45" :max="1" :step=".01" aria-label="面板不透明度" @update:model-value="v=>appearance('panelOpacity',v)"/></label></div><div class="appearance-preview"><span class="muted-text">实时预览</span><div class="nestra-panel preview-surface" :data-material="store.appearance.surfaceMaterial" :data-border="store.appearance.borderStyle"><header class="panel-header"><strong>项目资料</strong><span class="muted-text">3 项</span></header><div class="preview-files"><div v-for="name in ['设计稿','项目文档','待处理']" :key="name"><UIcon name="i-lucide-file-text"/><span>{{name}}</span></div></div></div><small class="muted-text">默认风格同步到桌面；独立设置的项目保持自己的样式。</small></div></div></template>
  <template v-else-if="section==='system'"><div class="page-heading"><div><h1>系统</h1><p>控制桌面层、启动行为与搜索依赖。</p></div></div><div class="manager-card"><div class="settings-row"><div><h2>显示桌面内容</h2><p>暂停时隐藏面板和小组件，配置与内容保留。</p></div><USwitch :model-value="!store.paused" aria-label="显示桌面内容" @update:model-value="v=>setPaused(!v)"/></div><div class="settings-row"><div><h2>随 Windows 启动</h2><p>登录后自动恢复桌面工作空间。</p></div><USwitch :model-value="store.startWithWindows" aria-label="随 Windows 启动" @update:model-value="setStartWithWindows"/></div><div class="settings-row"><div><h2>隐藏原生桌面图标</h2><p>默认保留原生图标；开启后由 Nestra 接管显示。暂停或退出会恢复。</p></div><USwitch :model-value="store.hideNativeIcons" aria-label="隐藏原生桌面图标" @update:model-value="setHideNativeIcons"/></div></div><div class="manager-card"><div class="card-heading"><h2>全局搜索</h2><kbd>Ctrl + Alt + F</kbd></div><p>{{provider}}</p><p class="muted-text">Everything 是本机文件索引程序。运行后 Nestra 通过本机 IPC 查询全盘文件；未运行时仍可搜索桌面、收纳区、映射目录和应用。</p><UButton variant="outline" @click="requestOpenSearch">打开全局搜索</UButton></div><div class="manager-card"><h2>关于 Nestra</h2><p class="muted-text">桌面工作空间 · Nuxt UI · 配置格式 v2</p><p class="muted-text">关闭控制中心会隐藏窗口；完全退出请使用系统托盘菜单。</p></div></template>
  </template></main></div>
  <footer class="product-footer"><span><span class="status-dot" :class="{'is-paused':store.paused}"/>{{store.paused?'桌面内容已暂停':'桌面内容运行中'}}</span><UButton v-if="section==='overview'" color="neutral" variant="ghost" size="xs" icon="i-lucide-refresh-cw" :loading="refreshing" @click="refresh">刷新内容</UButton><UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-palette" @click="goto('appearance')">全局外观</UButton></footer>
  <StatusNotice v-if="section!=='search'||!store.statusAction" />
</div>
</template>
