<script setup lang="ts">
import { computed } from 'vue';
import UButton from '@nuxt/ui/components/Button.vue';
import USelect from '@nuxt/ui/components/Select.vue';
import USwitch from '@nuxt/ui/components/Switch.vue';
import { arrangePanels, layoutFor, locateSurface, refreshDisplays, resetLayouts, scheduleHitRectSync, scheduleSave, store } from '@/stores/state';
const surfaces=computed(()=>[...store.panels.filter(p=>!store.tabGroups.some(t=>t.groupIds.includes(p.groupId))).map(p=>({key:p.key,title:p.title})),...store.widgets.map(w=>({key:`widget:${w.id}`,title:w.title}))].filter(s=>layoutFor(s.key)));
const displays=computed(()=>store.displays.map(d=>({label:`${d.name}${d.isPrimary?' · 主屏幕':''}`,value:d.id})));
function update(key:string,patch:object){const layout=layoutFor(key);if(layout){Object.assign(layout,patch);scheduleSave();scheduleHitRectSync()}}
function move(key:string,id:string){const display=store.displays.find(d=>d.id===id),layout=layoutFor(key);if(!display||!layout)return;delete layout.displacedFrom;Object.assign(layout,{monitorId:id,monitorBounds:{x:display.x,y:display.y},x:display.x+24,y:display.y+76,width:Math.min(layout.width,display.width-48),height:Math.min(layout.height,display.height-100)});scheduleSave();scheduleHitRectSync()}
</script>
<template>
<div class="page-heading"><div><h1>布局与显示器</h1><p>管理面板位置与锁定，找回隐藏或屏幕外的内容。</p></div><UButton variant="outline" icon="i-lucide-refresh-cw" @click="refreshDisplays">刷新显示器</UButton></div>
<div class="display-map"><div v-for="display in store.displays" :key="display.id" class="display-preview"><strong>{{display.name}}</strong><span>{{display.width}} × {{display.height}} · {{display.isPrimary?'主屏幕':'扩展屏幕'}}</span><small>{{display.x}}, {{display.y}}</small></div></div>
<div class="page-toolbar"><UButton variant="outline" @click="arrangePanels('grid')">平铺面板</UButton><UButton variant="outline" @click="arrangePanels('cascade')">层叠面板</UButton><UButton color="neutral" variant="ghost" @click="resetLayouts">重置面板布局…</UButton></div>
<div class="manager-card"><div class="card-heading"><h2>桌面内容</h2><span>文件组拥有独立位置与大小</span></div><div v-for="surface in surfaces" :key="surface.key" class="layout-row"><div class="row-content"><strong>{{surface.title}}</strong><small>{{Math.round(layoutFor(surface.key)!.x)}}, {{Math.round(layoutFor(surface.key)!.y)}} · {{Math.round(layoutFor(surface.key)!.width)}} × {{Math.round(layoutFor(surface.key)!.height)}}{{layoutFor(surface.key)!.displacedFrom?' · 原屏幕暂时离线':''}}</small></div><USelect :model-value="layoutFor(surface.key)!.monitorId??store.displays.find(d=>d.isPrimary)?.id" :items="displays" aria-label="所在显示器" @update:model-value="value=>move(surface.key,String(value))"/><label class="inline-setting"><USwitch size="sm" :model-value="layoutFor(surface.key)!.visible" @update:model-value="v=>update(surface.key,{visible:v})"/>显示</label><label class="inline-setting"><USwitch size="sm" :model-value="layoutFor(surface.key)!.locked??false" @update:model-value="v=>update(surface.key,{locked:v})"/>锁定</label><UButton size="sm" variant="outline" @click="locateSurface(surface.key)">定位</UButton></div><p v-if="!surfaces.length" class="card-note">添加来源或小组件后在这里管理位置。</p></div>
</template>
