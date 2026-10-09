<script setup lang="ts">
import { computed, ref } from 'vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UInput from '@nuxt/ui/components/Input.vue';
import UModal from '@nuxt/ui/components/Modal.vue';
import UIcon from '@nuxt/ui/components/Icon.vue';
import USwitch from '@nuxt/ui/components/Switch.vue';
import { clipClear, setClipboardEnabled } from '@/lib/tauri';
import { confirmDialog, createWidget, DESKTOP_SEARCH_KEY, locateSurface, removeWidget, scheduleSave, setPanelVisible, setWidgetVisible, showStatus, store, touchWidget } from '@/stores/state';
import type { WidgetKind } from '@/types';
import TodoList from '@/components/TodoList.vue';
const kinds:{kind:WidgetKind;title:string;icon:string;description:string}[]=[{kind:'note',title:'便签',icon:'i-lucide-sticky-note',description:'记录临时想法与常用信息'},{kind:'todo',title:'待办',icon:'i-lucide-list-checks',description:'追踪今天要完成的事'},{kind:'clipboard',title:'剪贴板',icon:'i-lucide-clipboard',description:'保存本次运行的最近 50 条文本'},{kind:'clock',title:'时钟',icon:'i-lucide-clock',description:'在桌面查看时间与日期'}];
const selected=ref(''),editOpen=ref(false);
const widget=computed(()=>store.widgets.find(w=>w.id===selected.value));
function edit(id:string){selected.value=id;editOpen.value=true}
async function enabled(value:boolean){try{await setClipboardEnabled(value);store.clipboardEnabled=value;scheduleSave()}catch(e){showStatus(`设置失败：${e}`)}}
async function clear(){if(await confirmDialog('清空本次运行的全部剪贴板历史？'))await clipClear()}

</script>
<template>
<div class="page-heading"><div><h1>小组件</h1><p>内容与显示状态独立保存，隐藏后可以随时恢复。</p></div></div>
<div v-if="store.panelLayouts[DESKTOP_SEARCH_KEY]" class="manager-card source-row"><div class="source-icon"><UIcon name="i-lucide-search"/></div><div class="row-content"><strong>桌面搜索</strong><small>搜索文件和应用 · 可独立拖动</small></div><UButton variant="ghost" size="sm" @click="setPanelVisible(DESKTOP_SEARCH_KEY,store.panelLayouts[DESKTOP_SEARCH_KEY]!.visible===false)">{{store.panelLayouts[DESKTOP_SEARCH_KEY]!.visible===false?'恢复显示':'隐藏'}}</UButton><UButton variant="outline" size="sm" @click="locateSurface(DESKTOP_SEARCH_KEY)">显示并定位</UButton></div>
<div class="widget-catalog"><button v-for="kind in kinds" :key="kind.kind" class="manager-card widget-choice" @click="createWidget(kind.kind)"><UIcon :name="kind.icon"/><h3>{{kind.title}}</h3><p>{{kind.description}}</p><span>添加到桌面 +</span></button></div>
<div class="manager-card"><div class="card-heading"><h2>我的小组件</h2><span>{{store.widgets.length}} 个</span></div><div v-for="item in store.widgets" :key="item.id" class="source-row"><div class="source-icon"><UIcon :name="kinds.find(k=>k.kind===item.kind)?.icon??'i-lucide-square'"/></div><div class="row-content"><strong>{{item.title}}</strong><small>{{kinds.find(k=>k.kind===item.kind)?.title}} · {{item.layout.visible?'桌面可见':'已隐藏'}}{{item.kind==='todo'?` · ${item.todos.filter(t=>!t.completed).length} 项待办`:''}}</small></div><UButton variant="ghost" size="sm" @click="setWidgetVisible(item.id,!item.layout.visible)">{{item.layout.visible?'隐藏':'恢复显示'}}</UButton><UButton variant="outline" size="sm" @click="locateSurface(`widget:${item.id}`)">显示并定位</UButton><UButton variant="outline" size="sm" @click="edit(item.id)">编辑</UButton></div><p v-if="!store.widgets.length" class="card-note">选择上方的小组件，把信息留在桌面。</p></div>
<div class="manager-card"><div class="settings-row"><div><h2>剪贴板记录</h2><p>仅记录文本，最多 50 条；历史保存在内存中，退出后清空。暂停时不采集。</p></div><USwitch :model-value="store.clipboardEnabled" aria-label="记录剪贴板文本" @update:model-value="enabled"/></div><UButton variant="outline" @click="clear">清空历史</UButton></div>
<UModal v-model:open="editOpen" :title="widget?.title??'编辑小组件'" :description="widget?.kind==='todo'?'新增和完成状态自动保存；修改文字请点击保存或按 Enter。未提交的草稿在本窗口保留到退出。':'内容会自动保存。'"><template #body><div v-if="widget" class="form-stack"><label>标题<UInput v-model="widget.title" @change="touchWidget"/></label><textarea v-if="widget.kind==='note'" v-model="widget.content" class="manager-textarea" rows="9" @input="touchWidget"/><TodoList v-if="widget.kind==='todo'" :key="widget.id" :widget="widget" class="manager-todo-list" /><div class="danger-section"><p>删除会移除该小组件及其便签或待办内容。</p><UButton color="error" variant="soft" @click="async()=>{await removeWidget(widget!.id);if(!widget)editOpen=false}">删除小组件</UButton></div></div></template></UModal>
</template>
