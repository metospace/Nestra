<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import UIcon from '@nuxt/ui/components/Icon.vue';
import { settingsPosition, surfaceAppearance } from '@/domain/presentation';
import { clearSurfaceBackground, scheduleSave, setPanelPresentation, setSurfaceAppearance, store } from '@/stores/state';
import type { PanelLayout } from '@/types';

const props=defineProps<{panelKey:string}>();
const root=ref<HTMLElement|null>(null), tab=ref('style');
const viewport=ref({width:window.innerWidth,height:window.innerHeight});
const layout=computed(()=>store.panelLayouts[props.panelKey]);
const title=computed(()=>store.panels.find(p=>p.key===props.panelKey)?.title??'快捷启动');
const appearance=computed(()=>layout.value?surfaceAppearance(layout.value,store.appearance):store.appearance);
const position=computed(()=>{if(!layout.value)return {};const p=settingsPosition(layout.value,viewport.value);return {left:`${p.left}px`,top:`${p.top}px`,width:`${p.width}px`,maxHeight:`${p.maxHeight}px`};});
const materials=[{label:'清透',value:'clear'},{label:'磨砂',value:'matte'},{label:'玻璃',value:'glass'},{label:'亚克力',value:'acrylic'}];
const corners=[{label:'方正',value:'square'},{label:'紧凑',value:'compact'},{label:'标准',value:'standard'},{label:'圆润',value:'rounded'}];
const borders=[{label:'无边框',value:'none'},{label:'细线',value:'subtle'},{label:'清晰',value:'strong'},{label:'阴影',value:'shadow'}];
const colors=['#ffffff','#edf4ff','#eaf4ee','#fff2df','#172337','#292632'];
function style(key:keyof NonNullable<PanelLayout['appearance']>,value:unknown){setSurfaceAppearance(props.panelKey,{[key]:value});}
function presentation(patch:Parameters<typeof setPanelPresentation>[1]){setPanelPresentation(props.panelKey,patch);}
function numeric(event:Event){return Number((event.target as HTMLInputElement).value);}
function close(){store.surfaceSettingsKey='';}
function outside(event:PointerEvent){const target=event.target as HTMLElement;if(!root.value?.contains(target)&&!target.closest('[data-surface-settings-trigger]'))close();}
function escape(event:KeyboardEvent){if(event.key==='Escape'){event.stopPropagation();close();}}
function resize(){viewport.value={width:window.innerWidth,height:window.innerHeight};}
function hex(event:Event){const input=event.target as HTMLInputElement;if(/^#[0-9a-f]{6}$/i.test(input.value)){style('backgroundColor',input.value);input.setCustomValidity('');}else{input.setCustomValidity('请输入 # 开头的六位颜色值');input.reportValidity();}}
onMounted(()=>{document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);window.addEventListener('resize',resize);});
onBeforeUnmount(()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',resize);const active=document.activeElement;if(active instanceof HTMLElement&&root.value?.contains(active)){active.blur();}});
</script>

<template>
  <Teleport to="body">
    <div v-if="layout" class="desktop-settings-dismiss nestra-hit" aria-hidden="true" @pointerdown="close" />
    <section v-if="layout" ref="root" class="desktop-surface-settings nestra-hit" :style="position" role="region" :aria-label="`${title}的设置`" @dragover.stop.prevent @drop.stop.prevent>
      <header><div><strong>{{title}}</strong><small>仅调整此栏 · 修改自动保存</small></div><button class="settings-close" aria-label="关闭此栏设置" @click="close"><UIcon name="i-lucide-x"/></button></header>
      <nav aria-label="此栏设置分类"><button :class="{active:tab==='style'}" @click="tab='style'">样式</button><button :class="{active:tab==='layout'}" @click="tab='layout'">布局</button></nav>
      <div class="desktop-settings-body">
        <template v-if="tab==='style'">
          <p class="settings-note">{{layout.appearance?'已设置独立样式；未修改的项目仍跟随全局。':'跟随全局风格。在这里修改后，仅此栏生效。'}}</p>
          <label>材质<select :value="appearance.surfaceMaterial" @change="style('surfaceMaterial',($event.target as HTMLSelectElement).value)"><option v-for="item in materials" :key="item.value" :value="item.value">{{item.label}}</option></select></label>
          <div class="desktop-settings-pair"><label>圆角<select :value="appearance.cornerStyle" @change="style('cornerStyle',($event.target as HTMLSelectElement).value)"><option v-for="item in corners" :key="item.value" :value="item.value">{{item.label}}</option></select></label><label>边界<select :value="appearance.borderStyle" @change="style('borderStyle',($event.target as HTMLSelectElement).value)"><option v-for="item in borders" :key="item.value" :value="item.value">{{item.label}}</option></select></label></div>
          <label>不透明度 <output>{{Math.round(appearance.panelOpacity*100)}}%</output><input type="range" aria-label="此栏不透明度" min=".45" max="1" step=".01" :value="appearance.panelOpacity" @input="style('panelOpacity',numeric($event))"/></label>
          <div class="desktop-settings-colors"><span>背景颜色</span><div><button class="follow-color" :aria-pressed="!layout.appearance?.backgroundColor" @click="clearSurfaceBackground(props.panelKey)">跟随主题</button><button v-for="color in colors" :key="color" class="color-swatch" :style="{background:color}" :aria-label="`背景颜色 ${color}`" :aria-pressed="layout.appearance?.backgroundColor===color" @click="style('backgroundColor',color)"/></div><input v-if="layout.appearance?.backgroundColor" aria-label="自定义背景颜色" :value="layout.appearance.backgroundColor" maxlength="7" spellcheck="false" @change="hex"/></div>
          <button class="settings-reset" :disabled="!layout.appearance" @click="setSurfaceAppearance(props.panelKey,null)"><UIcon name="i-lucide-rotate-ccw"/>恢复全局风格</button>
        </template>
        <template v-else>
          <div class="desktop-settings-pair"><label>排列<select :value="layout.viewMode??'grid'" @change="presentation({viewMode:($event.target as HTMLSelectElement).value as 'grid'|'list'})"><option value="grid">网格</option><option value="list">列表</option></select></label><label>密度<select :value="layout.density??'comfortable'" @change="presentation({density:($event.target as HTMLSelectElement).value as 'comfortable'|'compact'})"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label></div>
          <label v-if="layout.viewMode!=='list'">网格列数 <output>{{layout.columns??4}}</output><input type="range" aria-label="网格列数" min="2" max="8" step="1" :value="layout.columns??4" @input="presentation({columns:numeric($event)})"/></label>
          <label>图标大小 <output>{{layout.iconSize??(layout.density==='compact'?32:42)}} px</output><input type="range" aria-label="图标大小" min="24" max="64" step="2" :value="layout.iconSize??(layout.density==='compact'?32:42)" @input="presentation({iconSize:numeric($event)})"/></label>
          <label>项目间距 <output>{{layout.itemGap??(layout.density==='compact'?2:8)}} px</output><input type="range" aria-label="项目间距" min="0" max="24" step="1" :value="layout.itemGap??(layout.density==='compact'?2:8)" @input="presentation({itemGap:numeric($event)})"/></label>
          <label>文件名行数<select :value="layout.labelLines??2" @change="presentation({labelLines:numeric($event)})"><option :value="1">一行</option><option :value="2">两行</option><option :value="3">三行</option></select></label>
          <label class="desktop-settings-check"><input type="checkbox" :checked="layout.locked" @change="layout!.locked=($event.target as HTMLInputElement).checked;scheduleSave()"/>锁定此栏位置和大小</label>
        </template>
      </div>
      <footer>直接查看桌面上的变化，文件保持原位。</footer>
    </section>
  </Teleport>
</template>

<style scoped>
.desktop-settings-dismiss{position:fixed;inset:0;z-index:9499;background:transparent}
.desktop-surface-settings{position:fixed;z-index:9500;display:flex;flex-direction:column;background:var(--product-glass);backdrop-filter:blur(28px);color:var(--nestra-text);border:1px solid var(--product-edge);border-radius:16px;box-shadow:var(--product-shadow);overflow:hidden;font-size:12px}
header{display:flex;align-items:center;padding:16px 18px 12px;gap:14px}header>div{flex:1;min-width:0}strong{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}small{display:block;font-size:11px;color:var(--nestra-text-faint);margin-top:5px}.settings-close{display:grid;place-items:center;width:28px;height:28px;border-radius:6px;font-size:18px}
nav{display:flex;gap:18px;padding:0 18px;border-bottom:1px solid var(--nestra-line)}nav button{padding:10px 2px;border-bottom:2px solid transparent;color:var(--nestra-text-secondary)}nav .active{color:var(--nestra-accent);border-color:var(--nestra-accent)}.desktop-settings-body{padding:16px 18px;display:grid;gap:16px;overflow:auto;min-height:0}.settings-note{font-size:11px;line-height:1.6;margin:0;color:var(--nestra-text-secondary)}label{display:grid;grid-template-columns:1fr auto;gap:8px;font-size:12px}label select,label input[type=range]{grid-column:1/-1}select,input:not([type=range],[type=checkbox]){padding:7px 9px;width:100%;border:1px solid var(--nestra-line-strong);border-radius:6px;background:var(--nestra-surface);color:var(--nestra-text);font-size:12px}input[type=range]{width:100%;accent-color:var(--nestra-accent);height:20px;cursor:pointer}output{color:var(--nestra-text-secondary);font-variant-numeric:tabular-nums}.desktop-settings-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.desktop-settings-colors{display:grid;gap:9px}.desktop-settings-colors>div{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.color-swatch{width:23px;height:23px;border:1px solid #80808070;border-radius:6px}.color-swatch[aria-pressed=true]{outline:2px solid var(--nestra-accent);outline-offset:2px}.follow-color{font-size:11px;border:1px solid var(--nestra-line-strong);padding:5px 7px;border-radius:6px}.follow-color[aria-pressed=true]{color:var(--nestra-accent)}.settings-reset{display:flex;align-items:center;justify-content:center;gap:7px;padding:8px;border:1px solid var(--nestra-line-strong);border-radius:7px;color:var(--nestra-accent)}button:hover{background:var(--nestra-hover)}button:disabled{opacity:.45;cursor:default}.desktop-settings-check{display:flex;align-items:center;gap:8px;font-size:12px}.desktop-settings-check input{accent-color:var(--nestra-accent)}footer{padding:11px 18px;border-top:1px solid var(--nestra-line);font-size:10px;color:var(--nestra-text-faint)}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--nestra-accent);outline-offset:2px}
</style>
