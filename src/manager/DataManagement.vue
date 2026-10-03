<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import FileMoveHistory from './FileMoveHistory.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import USelect from '@nuxt/ui/components/Select.vue';
import UModal from '@nuxt/ui/components/Modal.vue';
import { backupConfiguration, listStorageZones, exportConfiguration, listConfigurationBackups, pickFile, pickFolder, readConfiguration } from '@/lib/tauri';
import type { ConfigurationBackup, StorageZone } from '@/lib/tauri';
import { migrateConfiguration, validateConfiguration } from '@/domain/configuration';
import { currentConfiguration, flushState, restoreConfiguration, showStatus, store, registerStorageZone } from '@/stores/state';
import type { PersistedState } from '@/types';
const zones=ref<StorageZone[]>([]), bindings=ref<Record<string,string>>({});
const orphanZones=computed(()=>zones.value.filter(z=>!store.customGroups.some(g=>!g.mappedPath&&g.sourceKind!=='category'&&g.dirName.toLowerCase()===z.dirName.toLowerCase())));
const missingZones=computed(()=>imported.value?.customGroups.filter(g=>!g.mappedPath&&g.sourceKind!=='category'&&!store.customGroups.some(c=>c.id===g.id)&&!zones.value.some(z=>z.dirName.toLowerCase()===g.dirName.toLowerCase()))??[]);
const unresolved=computed(()=>missingZones.value.some(g=>!bindings.value[g.id]));
const backups=ref<ConfigurationBackup[]>([]), error=ref(''), busy=ref(false), previewOpen=ref(false), imported=ref<PersistedState>(), expected=ref<PersistedState>(), selected=ref('');
const preserved=computed(()=>store.customGroups.filter(g=>!g.mappedPath&&g.sourceKind!=='category'&&!imported.value?.customGroups.some(i=>i.id===g.id)));
async function refresh(){try{backups.value=await listConfigurationBackups();zones.value=await listStorageZones()}catch(e){error.value=String(e)}}
async function backup(){busy.value=true;try{await flushState();const path=await backupConfiguration();showStatus(`备份已保存：${path}`);await refresh()}catch(e){error.value=String(e)}finally{busy.value=false}}
async function exportFile(){busy.value=true;try{const folder=await pickFolder();if(!folder)return;await flushState();showStatus(`已导出：${await exportConfiguration(folder)}`)}catch(e){error.value=String(e)}finally{busy.value=false}}
async function read(path?:string){error.value='';try{const picked=path??await pickFile();if(!picked)return;const value=await readConfiguration(picked);validateConfiguration(value);await flushState();expected.value=structuredClone(currentConfiguration());zones.value=await listStorageZones();bindings.value={};imported.value=migrateConfiguration(value);selected.value=picked;previewOpen.value=true}catch(e){error.value=`无法打开配置：${e}`}}
async function restore(){if(!imported.value||!expected.value)return;busy.value=true;error.value='';try{const configured=JSON.parse(JSON.stringify(imported.value)) as PersistedState;for(const group of configured.customGroups){if(bindings.value[group.id])group.dirName=bindings.value[group.id]!;}await restoreConfiguration(configured,expected.value);previewOpen.value=false;showStatus('配置已恢复；恢复前的配置已自动备份。');await refresh()}catch(e){error.value=String(e)}finally{busy.value=false}}
onMounted(refresh);
</script>
<template>
<div class="page-heading"><div><h1>数据与恢复</h1><p>备份布局、入口和小组件内容，在恢复前检查影响。</p></div><UButton icon="i-lucide-download" :loading="busy" @click="backup">备份当前配置</UButton></div>
<FileMoveHistory/>
<div class="info-callout">配置备份包含来源定义、布局、快捷引用、便签和待办。原文件与剪贴板历史不包含在内。恢复不会移动文件。</div>
<div class="page-toolbar"><UButton variant="outline" :disabled="busy" @click="exportFile">导出配置到文件夹</UButton><UButton variant="outline" :disabled="busy" @click="read()">导入配置并预览</UButton><UButton variant="ghost" @click="refresh">刷新备份列表</UButton></div>
<p v-if="error" class="error-text" role="alert">{{error}}</p>
<div v-if="orphanZones.length" class="manager-card"><div class="card-heading"><h2>磁盘上未关联的收纳目录</h2><span>文件保持原位</span></div><div v-for="zone in orphanZones" :key="zone.path" class="source-row"><div class="row-content"><strong>{{zone.dirName}} · {{zone.itemCount}} 项</strong><small>{{zone.path}}</small></div><UButton variant="outline" size="sm" @click="registerStorageZone(zone.dirName)">恢复到控制中心</UButton></div></div>
<div class="manager-card"><div class="card-heading"><h2>本机配置备份</h2><span>{{backups.length}} 份</span></div><div v-for="item in backups" :key="item.path" class="source-row"><div class="row-content"><strong>{{item.name}}</strong><small>{{item.createdAt}} · {{item.path}}</small></div><UButton variant="outline" size="sm" :disabled="busy" @click="read(item.path)">预览恢复</UButton></div><p v-if="!backups.length" class="card-note">手动备份、版本迁移和每次恢复前都会在这里留下配置副本。</p></div>
<UModal v-model:open="previewOpen" title="恢复配置预览" description="确认后先备份当前配置，再替换设置。" :dismissible="!busy" :ui="{content:'max-w-2xl'}"><template #body><div v-if="imported" class="form-stack"><p class="muted-text">{{selected}}</p><div class="metric-grid"><div><strong>{{imported.customGroups.length}}</strong><small>来源定义</small></div><div><strong>{{imported.launcherIds.length}}</strong><small>快捷入口</small></div><div><strong>{{imported.widgets.length}}</strong><small>小组件（含内容）</small></div></div><div class="info-callout">已有收纳区目录保持原位，当前未包含在备份中的 {{preserved.length}} 个收纳区会保留。缺失显示器上的布局会恢复到可用屏幕。Windows 启动设置保持当前值。</div><div v-for="group in imported.customGroups" :key="group.id" class="plan-row"><strong>{{group.name}}</strong><small>{{group.mappedPath??(group.sourceKind==='category'?'桌面分类视图':`桌面\\.nestra\\${group.dirName}`)}}</small><span v-if="group.mappedPath" class="muted-text">外部路径按原配置绑定；若不可访问，可在文件与收纳中重新绑定。</span></div><div v-if="missingZones.length" class="info-callout"><strong>收纳目录在本机不存在，恢复前需要绑定。</strong><label v-for="group in missingZones" :key="group.id" class="form-stack">{{group.name}}<USelect :model-value="bindings[group.id]" :items="orphanZones.filter(z=>!Object.entries(bindings).some(([id,name])=>id!==group.id&&name===z.dirName)).map(z=>({label:`${z.dirName} · ${z.itemCount} 项`,value:z.dirName}))" placeholder="选择本机未关联的收纳目录" @update:model-value="v=>bindings[group.id]=String(v)"/></label><p>如果没有可绑定目录，请先在文件与收纳中新建收纳区，或使用当前机器的备份。</p></div><p v-if="error" class="error-text" role="alert">{{error}}</p></div></template><template #footer><UButton variant="ghost" :disabled="busy" @click="previewOpen=false">取消</UButton><UButton :loading="busy" :disabled="unresolved" @click="restore">备份当前配置并恢复</UButton></template></UModal>
</template>
