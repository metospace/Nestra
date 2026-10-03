<script setup lang="ts">
import { onMounted, ref } from 'vue';
import UButton from '@nuxt/ui/components/Button.vue';
import { listFileMoves } from '@/lib/tauri';
import type { FileMove } from '@/lib/tauri';
import { confirmDialog, undoRecordedMove } from '@/stores/state';
const moves=ref<FileMove[]>([]),error=ref(''),busy=ref(false);
async function refresh(){try{moves.value=await listFileMoves();}catch(e){error.value=String(e)}}
async function undo(move:FileMove){if(busy.value||!await confirmDialog(`将「${move.name}」放回原位置？\n${move.fromPath}\n原位置被占用或文件已修改时会停止。`))return;busy.value=true;error.value='';try{await undoRecordedMove(move.id);await refresh();}catch(e){error.value=String(e)}finally{busy.value=false}}
onMounted(refresh);
</script>
<template><section class="manager-card"><div class="card-heading"><h2>本次运行的文件移动</h2><UButton variant="ghost" size="sm" :disabled="busy" @click="refresh">刷新记录</UButton></div><p class="muted-text">最近 50 次成功移动；退出后清空。撤销保留文件内容，不覆盖同名项目；已修改、被替换或再次移动的文件需手动处理。</p><p v-if="error" class="error-text" role="alert">{{error}}</p><div v-for="move in moves" :key="move.id" class="source-row"><div class="row-content"><strong>{{move.name}} · {{move.undone?'已撤销':new Date(move.createdAt).toLocaleTimeString()}}</strong><small>原位置：{{move.fromPath}}</small><small>移动到：{{move.toPath}}</small></div><UButton variant="outline" size="sm" :disabled="busy||move.undone" @click="undo(move)">{{move.undone?'已撤销':'撤销移动'}}</UButton></div><p v-if="!moves.length" class="card-note">拖入收纳区、放回桌面或执行整理后，移动记录会显示在这里。</p></section></template>
