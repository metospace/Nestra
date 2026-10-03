<script setup lang="ts">
import { computed, ref } from 'vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UInput from '@nuxt/ui/components/Input.vue';
import UModal from '@nuxt/ui/components/Modal.vue';
import UIcon from '@nuxt/ui/components/Icon.vue';
import USwitch from '@nuxt/ui/components/Switch.vue';
import { clipClear, setClipboardEnabled } from '@/lib/tauri';
import { confirmDialog, createWidget, locateSurface, removeWidget, scheduleSave, setWidgetVisible, showStatus, store, touchWidget } from '@/stores/state';
import type { WidgetKind } from '@/types';
const kinds:{kind:WidgetKind;title:string;icon:string;description:string}[]=[{kind:'note',title:'便签',icon:'i-lucide-sticky-note',description:'记录临时想法与常用信息'},{kind:'todo',title:'待办',icon:'i-lucide-list-checks',description:'追踪今天要完成的事'},{kind:'clipboard',title:'剪贴板',icon:'i-lucide-clipboard',description:'保存本次运行的最近 50 条文本'},{kind:'clock',title:'时钟',icon:'i-lucide-clock',description:'在桌面查看时间与日期'}];
const selected=ref(''),editOpen=ref(false),text=ref('');
const widget=computed(()=>store.widgets.find(w=>w.id===selected.value));
function edit(id:string){selected.value=id;editOpen.value=true;text.value=''}
async function enabled(value:boolean){try{await setClipboardEnabled(value);store.clipboardEnabled=value;scheduleSave()}catch(e){showStatus(`设置失败：${e}`)}}
async function clear(){if(await confirmDialog('清空本次运行的全部剪贴板历史？'))await clipClear()}
function addTodo(){if(!widget.value||!text.value.trim())return;widget.value.todos.push({id:crypto.randomUUID(),text:text.value.trim(),completed:false});text.value='';touchWidget()}
</script>
<template>
<div class="page-heading"><div><h1>小组件</h1><p>内容与显示状态独立保存，隐藏后可以随时恢复。</p></div></div>
<div class="widget-catalog"><button v-for="kind in kinds" :key="kind.kind" class="manager-card widget-choice" @click="createWidget(kind.kind)"><UIcon :name="kind.icon"/><h3>{{kind.title}}</h3><p>{{kind.description}}</p><span>添加到桌面 +</span></button></div>
<div class="manager-card"><div class="card-heading"><h2>我的小组件</h2><span>{{store.widgets.length}} 个</span></div><div v-for="item in store.widgets" :key="item.id" class="source-row"><div class="source-icon"><UIcon :name="kinds.find(k=>k.kind===item.kind)?.icon??'i-lucide-square'"/></div><div class="row-content"><strong>{{item.title}}</strong><small>{{kinds.find(k=>k.kind===item.kind)?.title}} · {{item.layout.visible?'桌面可见':'已隐藏'}}{{item.kind==='todo'?` · ${item.todos.filter(t=>!t.completed).length} 项待办`:''}}</small></div><UButton variant="ghost" size="sm" @click="setWidgetVisible(item.id,!item.layout.visible)">{{item.layout.visible?'隐藏':'恢复显示'}}</UButton><UButton variant="outline" size="sm" @click="locateSurface(`widget:${item.id}`)">显示并定位</UButton><UButton variant="outline" size="sm" @click="edit(item.id)">编辑</UButton></div><p v-if="!store.widgets.length" class="card-note">选择上方的小组件，把信息留在桌面。</p></div>
<div class="manager-card"><div class="settings-row"><div><h2>剪贴板记录</h2><p>仅记录文本，最多 50 条；历史保存在内存中，退出后清空。暂停时不采集。</p></div><USwitch :model-value="store.clipboardEnabled" aria-label="记录剪贴板文本" @update:model-value="enabled"/></div><UButton variant="outline" @click="clear">清空历史</UButton></div>
<UModal v-model:open="editOpen" :title="widget?.title??'编辑小组件'" description="内容会自动保存。"><template #body><div v-if="widget" class="form-stack"><label>标题<UInput v-model="widget.title" @change="touchWidget"/></label><textarea v-if="widget.kind==='note'" v-model="widget.content" class="manager-textarea" rows="9" @input="touchWidget"/><template v-if="widget.kind==='todo'"><form class="flex gap-2" @submit.prevent="addTodo"><UInput v-model="text" class="flex-1" placeholder="添加待办"/><UButton type="submit">添加</UButton></form><div v-for="todo in widget.todos" :key="todo.id" class="flex items-center gap-2"><input v-model="todo.completed" type="checkbox" @change="touchWidget"/><UInput v-model="todo.text" class="flex-1" @change="touchWidget"/><UButton variant="ghost" color="error" @click="widget.todos=widget.todos.filter(t=>t.id!==todo.id);touchWidget()">移除</UButton></div></template><div class="danger-section"><p>删除会移除该小组件及其便签或待办内容。</p><UButton color="error" variant="soft" @click="async()=>{await removeWidget(widget!.id);if(!widget)editOpen=false}">删除小组件</UButton></div></div></template></UModal>
</template>
