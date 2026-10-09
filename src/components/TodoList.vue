<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UCheckbox from '@nuxt/ui/components/Checkbox.vue';
import UIcon from '@nuxt/ui/components/Icon.vue';
import UInput from '@nuxt/ui/components/Input.vue';
import UTextarea from '@nuxt/ui/components/Textarea.vue';
import { touchWidget } from '@/stores/state';
import { useTodoDraft } from '@/composables/useTodoDraft';
import type { TodoItem, Widget } from '@/types';

const props = defineProps<{ widget: Widget }>();
const root = ref<HTMLElement | null>(null);
const composer = ref<{ inputRef?: HTMLInputElement } | null>(null);
const editor = ref<{ textareaRef?: HTMLTextAreaElement } | null>(null);
const { text, editingId, editText, editingOriginal, editError } = useTodoDraft(() => props.widget.id);
const editedItem = computed(() => props.widget.todos.find(item => item.id === editingId.value));
const missingEditedItem = computed(() => Boolean(editingId.value && !editedItem.value));
const editConflict = computed(() => Boolean(editedItem.value && editedItem.value.text !== editingOriginal.value));
const showCompleted = ref(false);
const removed = ref<{ item: TodoItem; index: number } | null>(null);
const pending = computed(() => props.widget.todos.filter(item => !item.completed));
const completed = computed(() => props.widget.todos.filter(item => item.completed));
function setEditor(value: unknown) { editor.value = value as { textareaRef?: HTMLTextAreaElement } | null; }
const sections = computed(() => [
  { kind: 'pending', items: pending.value },
  { kind: 'completed', items: completed.value },
]);

watch(() => props.widget.id, () => {
  showCompleted.value = false; removed.value = null;
});
watch(editedItem, item => {
  if (item?.completed) showCompleted.value = true;
}, { immediate: true });

async function addTodo() {
  const value = text.value.trim();
  if (!value) return;
  const id = crypto.randomUUID();
  props.widget.todos.push({ id, text: value, completed: false });
  text.value = '';
  touchWidget();
  await nextTick();
  root.value?.querySelector(`[data-todo-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  composer.value?.inputRef?.focus({ preventScroll: true });
}
function composerKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter') { event.preventDefault(); void addTodo(); }
}
async function beginEdit(item: TodoItem) {
  if (editingId.value && editingId.value !== item.id) {
    editError.value = '请先保存或取消当前编辑，再修改其他任务。';
    return;
  }
  editingId.value = item.id;
  editingOriginal.value = item.text;
  editText.value = item.text;
  editError.value = '';
  await nextTick();
  editor.value?.textareaRef?.focus({ preventScroll: true });
  editor.value?.textareaRef?.select();
}
function focusTask(id: string) {
  void nextTick(() => root.value?.querySelector<HTMLButtonElement>(`[data-todo-id="${CSS.escape(id)}"] .todo-label`)?.focus({ preventScroll: true }));
}
function saveEdit(restoreFocus = true): boolean {
  const item = props.widget.todos.find(item => item.id === editingId.value);
  if (!item) { editError.value = '任务已被移除，草稿仍保留。请复制草稿或取消编辑。'; return false; }
  const value = editText.value.trim();
  if (!value) { editError.value = '任务内容不能为空'; return false; }
  if (item.text !== editingOriginal.value && value !== item.text) {
    editError.value = '任务已在其他窗口修改，草稿仍保留。请复制草稿，再取消编辑以查看最新内容。';
    return false;
  }
  if (item.text !== value) { item.text = value; touchWidget(); }
  editingId.value = '';
  editError.value = '';
  if (restoreFocus) focusTask(item.id);
  return true;
}
async function copyDraft() {
  try { await navigator.clipboard.writeText(editText.value); editError.value = '草稿已复制，可取消编辑后查看最新内容。'; }
  catch { editError.value = '无法复制，请在编辑框中选中文字复制。'; }
}
function cancelEdit() {
  const id = editingId.value;
  editingId.value = ''; editError.value = '';
  focusTask(id);
}
function editorKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); saveEdit(); }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelEdit(); }
}
function complete(id: string, value: boolean) {
  if (editingId.value === id) {
    editError.value = '请先保存或取消文字修改，再切换完成状态。';
    return;
  }
  const item = props.widget.todos.find(item => item.id === id);
  if (!item) return;
  item.completed = value;
  touchWidget();
  if (value && !showCompleted.value) {
    void nextTick(() => root.value?.querySelector<HTMLButtonElement>('.todo-completed-toggle')?.focus({ preventScroll: true }));
  } else focusTask(id);
}
function removeTodo(id: string) {
  const index = props.widget.todos.findIndex(item => item.id === id);
  if (index < 0) return;
  removed.value = { item: { ...props.widget.todos[index]! }, index };
  props.widget.todos.splice(index, 1);
  if (editingId.value === id) editingId.value = '';
  touchWidget();
  void nextTick(() => root.value?.querySelector<HTMLButtonElement>('.todo-undo button')?.focus({ preventScroll: true }));
}
function undoRemove() {
  if (!removed.value) return;
  const { item, index } = removed.value;
  // Restoring is an explicit new addition, so a concurrent old deletion cannot erase it.
  if (!props.widget.todos.some(todo => todo.id === item.id)) {
    const id = crypto.randomUUID();
    props.widget.todos.splice(Math.min(index, props.widget.todos.length), 0, { ...item, id });
    if (item.completed) showCompleted.value = true;
    touchWidget();
    focusTask(id);
  }
  removed.value = null;
}
</script>

<template>
  <div ref="root" class="todo-list" :aria-label="`${widget.title}清单`">
    <div class="todo-scroll">
      <div v-if="missingEditedItem" class="todo-editor todo-orphan-draft">
        <p class="todo-error" role="alert">任务已被移除，尚未保存的草稿仍保留。</p>
        <UTextarea :ref="setEditor" v-model="editText" :rows="2" autoresize aria-label="已移除任务的草稿" :ui="{ base: 'todo-edit-input' }" />
        <div class="todo-edit-actions"><UButton size="xs" color="neutral" variant="ghost" @click="cancelEdit">取消编辑</UButton><UButton size="xs" color="neutral" variant="soft" @click="copyDraft">复制草稿</UButton></div>
      </div>
      <div v-if="!pending.length" class="todo-empty">
        <UIcon :name="widget.todos.length ? 'i-lucide-check-check' : 'i-lucide-list-todo'" />
        <p>{{ widget.todos.length ? '全部完成' : '添加第一件要做的事' }}</p>
      </div>
      <section v-for="section in sections" :key="section.kind" class="todo-section">
        <button v-if="section.kind === 'completed' && section.items.length" class="todo-completed-toggle" :aria-expanded="showCompleted" @click="showCompleted = !showCompleted">
          <UIcon :name="showCompleted ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
          已完成 <span>{{ section.items.length }}</span>
        </button>
        <ul v-if="section.kind === 'pending' || showCompleted" class="todo-items" :aria-label="section.kind === 'pending' ? '未完成任务' : '已完成任务'">
          <li v-for="item in section.items" :key="item.id" class="todo-row" :class="{ 'is-completed': item.completed, 'is-editing': editingId === item.id }" :data-todo-id="item.id">
            <UCheckbox :model-value="item.completed" :aria-label="`${item.completed ? '恢复' : '完成'}：${item.text}`" :ui="{ base: 'todo-checkbox', container: 'pt-0.5' }" @update:model-value="value => complete(item.id, value === true)" />
            <div v-if="editingId === item.id" class="todo-editor" @pointerdown.stop>
              <UTextarea :ref="setEditor" v-model="editText" class="w-full" :rows="2" :maxrows="5" autoresize :aria-label="'编辑待办内容'" :ui="{ base: 'todo-edit-input' }" spellcheck="false" @keydown="editorKey" />
              <p class="todo-draft-status" role="status">尚未保存 · 点击保存或按 Enter；离开后可继续编辑</p>
              <p v-if="editConflict" class="todo-error">最新内容：{{ editedItem?.text }}</p>
              <p v-if="editError" class="todo-error" role="alert">{{ editError }}</p>
              <div class="todo-edit-actions"><UButton v-if="editConflict" size="xs" color="neutral" variant="ghost" @click="copyDraft">复制草稿</UButton><UButton size="xs" color="neutral" variant="ghost" @click="cancelEdit">取消</UButton><UButton size="xs" color="neutral" variant="soft" @click="saveEdit()">保存</UButton></div>
            </div>
            <button v-else class="todo-label" :aria-label="`编辑待办：${item.text}`" title="点击编辑" @click="beginEdit(item)">{{ item.text }}</button>
            <UButton v-if="editingId !== item.id" class="todo-delete" size="xs" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="`删除待办：${item.text}`" title="删除待办" @click="removeTodo(item.id)" />
          </li>
        </ul>
      </section>
    </div>
    <div v-if="removed" class="todo-undo" role="status"><span>已删除待办</span><UButton size="xs" variant="link" color="neutral" @click="undoRemove">撤销</UButton><UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" aria-label="关闭删除提示" @click="removed = null" /></div>
    <div class="todo-composer" role="group" aria-label="添加待办">
      <UInput ref="composer" v-model="text" class="todo-new-input" variant="none" placeholder="添加待办…" aria-label="新待办内容" :ui="{ base: 'todo-compose-input' }" spellcheck="false" @keydown="composerKey" />
      <UButton class="todo-add" icon="i-lucide-plus" color="neutral" variant="soft" size="sm" :disabled="!text.trim()" aria-label="添加待办" title="添加待办 · Enter" @click="addTodo" />
    </div>
  </div>
</template>

<style scoped>
.todo-list { display:flex; flex-direction:column; flex:1; min-height:0; min-width:0; color:var(--nestra-text); }
.todo-scroll { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding:3px 12px 10px; scrollbar-width:none; }
.todo-scroll::-webkit-scrollbar { display:none; }
.todo-items { margin:0; padding:0; list-style:none; }
.todo-row { display:flex; align-items:flex-start; gap:10px; padding:11px 4px; border-bottom:1px solid var(--nestra-line); }
.todo-row:last-child { border-bottom:0; }
.todo-row :deep(.todo-checkbox) { width:19px; height:19px; border:1px solid var(--nestra-line-strong); border-radius:5px; cursor:pointer; color:var(--frost-button-text); box-shadow:none; background:transparent; }
.todo-row :deep(.todo-checkbox[data-state="checked"]) { background:var(--nestra-accent); border-color:var(--nestra-accent); }
.todo-label { flex:1; min-width:0; padding:1px 0; border-radius:3px; text-align:left; white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; line-height:1.6; cursor:text; user-select:text; }
.is-completed .todo-label { color:var(--nestra-text-faint); text-decoration:line-through; }
.todo-delete { flex-shrink:0; width:24px; height:24px; padding:4px; margin-top:-1px; opacity:0; color:var(--nestra-text-faint); }
.todo-row:hover .todo-delete, .todo-row:focus-within .todo-delete { opacity:1; }
.todo-completed-toggle { display:flex; align-items:center; gap:6px; width:100%; padding:14px 4px 6px; color:var(--nestra-text-secondary); font-size:11px; text-align:left; }
.todo-completed-toggle svg { width:13px; height:13px; }
.todo-completed-toggle span { margin-left:auto; font-variant-numeric:tabular-nums; color:var(--nestra-text-faint); }
.todo-empty { padding:24px 8px 16px; text-align:center; color:var(--nestra-text-faint); }
.todo-empty svg { display:block; margin:0 auto; width:27px; height:27px; color:var(--nestra-accent); opacity:.65; }
.todo-empty p { margin:9px 0 0; font-size:12px; }
.todo-composer { display:flex; align-items:center; gap:8px; margin:0 12px 12px; padding:4px 4px 4px 9px; border:1px solid var(--nestra-line); border-radius:10px; background:color-mix(in srgb, var(--nestra-surface) 35%, transparent); }
.todo-composer:focus-within { border-color:var(--nestra-accent); }
.todo-new-input { flex:1; min-width:0; }
.todo-new-input :deep(.todo-compose-input) { width:100%; padding:6px 0; font-size:12px; color:var(--nestra-text); background:transparent; box-shadow:none; outline:none; }
.todo-new-input :deep(input::placeholder) { color:var(--nestra-text-faint); }
.todo-add { width:28px; height:28px; justify-content:center; padding:5px; flex-shrink:0; background:var(--nestra-hover); color:var(--nestra-accent); border-radius:7px; }
.todo-add:disabled { opacity:.35; }
.todo-editor { flex:1; min-width:0; }
.todo-editor :deep(.todo-edit-input) { width:100%; font-size:13px; line-height:1.6; color:var(--nestra-text); background:transparent; border:1px solid var(--nestra-line-strong); box-shadow:none; resize:none; }
.todo-edit-actions { display:flex; justify-content:flex-end; gap:4px; margin-top:6px; }
.todo-error { color:var(--nestra-danger); font-size:11px; margin:6px 0; }
.todo-draft-status { color:var(--nestra-text-secondary); font-size:11px; margin:6px 0; }
.todo-orphan-draft { padding:8px 4px; }
.todo-undo { display:flex; align-items:center; gap:4px; margin:0 12px 8px; padding:2px 6px 2px 10px; border-radius:7px; background:var(--nestra-hover); font-size:11px; color:var(--nestra-text-secondary); }
.todo-undo>span { flex:1; }
.todo-list button:focus-visible { outline:2px solid var(--nestra-accent); outline-offset:2px; }
.todo-list.manager-todo-list { height:360px; flex:none; border:1px solid var(--nestra-line); border-radius:12px; }
@media (hover:none) { .todo-delete { opacity:1; } }
</style>
