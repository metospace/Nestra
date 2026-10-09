import { computed, reactive } from 'vue';

interface TodoDraft {
  text: string;
  editingId: string;
  editText: string;
  editingOriginal: string;
  editError: string;
}

// Unsubmitted text belongs to this WebView session, not the persisted task list.
// Keeping it outside the component survives hiding widgets and manager navigation.
const drafts = reactive(new Map<string, TodoDraft>());

export function discardTodoDraft(widgetId: string): void {
  drafts.delete(widgetId);
}

export function useTodoDraft(widgetId: () => string) {
  const draft = computed(() => {
    const id = widgetId();
    if (!drafts.has(id)) drafts.set(id, {
      text: '', editingId: '', editText: '', editingOriginal: '', editError: '',
    });
    return drafts.get(id)!;
  });
  function field<K extends keyof TodoDraft>(key: K) {
    return computed({ get: () => draft.value[key], set: (value: TodoDraft[K]) => { draft.value[key] = value; } });
  }
  return {
    text: field('text'), editingId: field('editingId'), editText: field('editText'),
    editingOriginal: field('editingOriginal'), editError: field('editError'),
  };
}
