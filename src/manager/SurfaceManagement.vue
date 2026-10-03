<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UIcon from '@nuxt/ui/components/Icon.vue';
import USelect from '@nuxt/ui/components/Select.vue';
import USlider from '@nuxt/ui/components/Slider.vue';
import USwitch from '@nuxt/ui/components/Switch.vue';
import { surfaceAppearance, surfaceVariables } from '@/domain/presentation';
import { itemsByPanel, locateSurface, scheduleSave, setPanelPresentation, setSurfaceAppearance, store } from '@/stores/state';
import type { PanelLayout } from '@/types';
const props = defineProps<{initialId?: string}>();
const emit = defineEmits<{manageContent:[id:string]}>();
const selected = ref(''), tab = ref('style');
const surfaces = computed(() => store.panels.filter(p => !store.tabGroups.some(t => t.groupIds.includes(p.groupId))).map(p => ({label:p.title,value:p.key,groupId:p.groupId})));
watch(()=>props.initialId,id=>{if(id&&surfaces.value.some(s=>s.value===id))selected.value=id;},{immediate:true});
watch(surfaces,()=>{if(!surfaces.value.some(s=>s.value===selected.value))selected.value=surfaces.value[0]?.value??'';},{immediate:true});
const surface = computed(()=>surfaces.value.find(s=>s.value===selected.value));
const layout = computed(()=>store.panelLayouts[selected.value]);
const appearance = computed(()=>layout.value ? surfaceAppearance(layout.value,store.appearance):store.appearance);
const previewStyle = computed(()=>layout.value ? surfaceVariables(layout.value,store.appearance):{});
const previewNames = computed(()=>(itemsByPanel.value[selected.value]??[]).slice(0,6).map(e=>e.name));
const tabs=[{id:'content',label:'内容'},{id:'style',label:'样式'},{id:'layout',label:'布局'}];
const materials=[{label:'磨砂',value:'matte'},{label:'清透',value:'clear'},{label:'玻璃',value:'glass'},{label:'亚克力',value:'acrylic'}];
const corners=[{label:'方正',value:'square'},{label:'紧凑',value:'compact'},{label:'标准',value:'standard'},{label:'圆润',value:'rounded'}];
const borders=[{label:'无边框',value:'none'},{label:'细线',value:'subtle'},{label:'清晰边框',value:'strong'},{label:'阴影',value:'shadow'}];
function style(key:string,value:unknown){setSurfaceAppearance(selected.value,{[key]:value});}
function presentation(patch:Parameters<typeof setPanelPresentation>[1]){setPanelPresentation(selected.value,patch);}
function restore(){setSurfaceAppearance(selected.value,null);}
function update(patch:Partial<PanelLayout>){if(layout.value){Object.assign(layout.value,patch);scheduleSave();}}
</script>
<template>
  <div class="page-heading"><div><h1>收纳栏设置</h1><p>分别调整每个桌面栏，修改自动保存并同步到桌面。</p></div><UButton v-if="surface" variant="outline" icon="i-lucide-locate-fixed" @click="locateSurface(selected)">显示并定位</UButton></div>
  <div v-if="!surfaces.length" class="manager-empty">先添加一个文件来源，即可设置桌面收纳栏。</div>
  <template v-else>
    <div class="surface-settings-toolbar"><USelect v-model="selected" :items="surfaces" aria-label="选择桌面栏" class="min-w-60"/><span class="source-badge">{{layout?.appearance?'独立样式':'跟随全局样式'}}</span></div>
    <nav class="surface-setting-tabs" aria-label="收纳栏设置分类"><button v-for="item in tabs" :key="item.id" :class="{active:tab===item.id}" @click="tab=item.id">{{item.label}}</button></nav>
    <div v-if="layout" class="surface-settings-columns">
      <div class="manager-card form-stack">
        <template v-if="tab==='style'">
          <div class="card-heading"><h2>此栏的外观</h2><UButton variant="ghost" size="sm" :disabled="!layout.appearance" @click="restore">恢复全局默认</UButton></div>
          <label>材质<USelect :model-value="appearance.surfaceMaterial" :items="materials" @update:model-value="v=>style('surfaceMaterial',v)"/></label>
          <div class="form-columns"><label>圆角<USelect :model-value="appearance.cornerStyle" :items="corners" @update:model-value="v=>style('cornerStyle',v)"/></label><label>边界<USelect :model-value="appearance.borderStyle" :items="borders" @update:model-value="v=>style('borderStyle',v)"/></label></div>
          <label>不透明度 · {{Math.round(appearance.panelOpacity*100)}}%<USlider :model-value="appearance.panelOpacity" :min=".45" :max="1" :step=".01" aria-label="此栏不透明度" @update:model-value="v=>style('panelOpacity',v)"/></label>
          <div class="settings-row"><div><h2>自定义背景颜色</h2><p>关闭后跟随全局主题。</p></div><USwitch :model-value="!!layout.appearance?.backgroundColor" aria-label="自定义背景颜色" @update:model-value="v=>{if(v)style('backgroundColor',store.appearance.theme==='dark'?'#172337':'#ffffff');else{delete layout!.appearance?.backgroundColor;scheduleSave();}}"/></div>
          <label v-if="layout.appearance?.backgroundColor" class="surface-color-picker">背景颜色<input type="color" :value="layout.appearance.backgroundColor" aria-label="此栏背景颜色" @input="style('backgroundColor',($event.target as HTMLInputElement).value)"/><small>{{layout.appearance.backgroundColor}}</small></label>
        </template>
        <template v-else-if="tab==='layout'">
          <h2>文件显示</h2>
          <div class="form-columns"><label>排列<USelect :model-value="layout.viewMode??'grid'" :items="[{label:'网格',value:'grid'},{label:'列表',value:'list'}]" @update:model-value="v=>presentation({viewMode:v as 'grid'|'list'})"/></label><label>密度<USelect :model-value="layout.density??'comfortable'" :items="[{label:'舒适',value:'comfortable'},{label:'紧凑',value:'compact'}]" @update:model-value="v=>presentation({density:v as 'compact'|'comfortable'})"/></label></div>
          <label v-if="layout.viewMode!=='list'">网格列数 · {{layout.columns??4}}<USlider :model-value="layout.columns??4" :min="2" :max="8" :step="1" aria-label="网格列数" @update:model-value="v=>presentation({columns:v})"/></label>
          <label>图标大小 · {{layout.iconSize??(layout.density==='compact'?32:42)}} px<USlider :model-value="layout.iconSize??(layout.density==='compact'?32:42)" :min="24" :max="64" :step="2" aria-label="图标大小" @update:model-value="v=>presentation({iconSize:v})"/></label>
          <label>项目间距 · {{layout.itemGap??(layout.density==='compact'?2:8)}} px<USlider :model-value="layout.itemGap??(layout.density==='compact'?2:8)" :min="0" :max="24" :step="1" aria-label="项目间距" @update:model-value="v=>presentation({itemGap:v})"/></label>
          <label>文件名行数<USelect :model-value="layout.labelLines??2" :items="[{label:'一行',value:1},{label:'两行',value:2},{label:'三行',value:3}]" @update:model-value="v=>presentation({labelLines:Number(v)})"/></label>
          <div class="settings-row"><div><h2>锁定位置和大小</h2><p>避免拖动标题时误改布局。</p></div><USwitch :model-value="layout.locked??false" @update:model-value="v=>update({locked:v})"/></div>
        </template>
        <template v-else><h2>{{surface?.label}}</h2><p>来源、筛选和收纳目录在文件管理中设置，外观与布局属于此桌面栏。</p><UButton variant="outline" icon="i-lucide-folder-cog" @click="emit('manageContent',surface?.groupId??'')">管理内容与来源</UButton><div class="settings-row"><div><h2>在桌面显示</h2><p>隐藏后仍保留内容和设置。</p></div><USwitch :model-value="layout.visible" @update:model-value="v=>update({visible:v})"/></div></template>
      </div>
      <div class="surface-live-preview"><span class="muted-text">此栏实时预览</span><div class="nestra-panel surface-preview" :data-material="appearance.surfaceMaterial" :data-border="appearance.borderStyle" :style="previewStyle"><header class="panel-header"><UIcon name="i-lucide-folder"/><strong>{{surface?.label}}</strong><span class="muted-text">{{previewNames.length}} 项</span></header><div class="surface-item-grid" :class="{'is-list':layout.viewMode==='list'}" :style="{gridTemplateColumns:layout.viewMode==='list'?'1fr':`repeat(${Math.min(layout.columns??4,4)},minmax(0,1fr))`}"><div v-for="(name,index) in previewNames.length?previewNames:['项目文档','设计资料','待处理文件']" :key="index" class="tile" :class="{'is-list':layout.viewMode==='list'}"><UIcon name="i-lucide-file-text" class="preview-file-icon"/><span class="tile-label">{{name}}</span></div></div></div><small class="muted-text">文件保持原位，仅调整显示方式。</small></div>
    </div>
  </template>
</template>
