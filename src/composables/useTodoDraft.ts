import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export interface TodoDraft {
  text: string;
  editingId: string;
  editText: string;
  editingOriginal: string;
  editError: string;
}

const emptyDraft: TodoDraft = Object.freeze({
  text: '', editingId: '', editText: '', editingOriginal: '', editError: '',
});
// Draft text belongs to this WebView session. It survives navigation, but is
// intentionally absent from the file-backed application configuration.
const drafts = createStore<Record<string, TodoDraft>>(() => ({}));

export function getTodoDraft(widgetId: string): TodoDraft {
  return drafts.getState()[widgetId] ?? emptyDraft;
}

export function updateTodoDraft(widgetId: string, patch: Partial<TodoDraft>): void {
  drafts.setState(state => ({ ...state, [widgetId]: { ...(state[widgetId] ?? emptyDraft), ...patch } }), true);
}

export function discardTodoDraft(widgetId: string): void {
  drafts.setState(state => {
    const next = { ...state };
    delete next[widgetId];
    return next;
  }, true);
}

export function useTodoDraft(widgetId: string) {
  const draft = useStore(drafts, state => state[widgetId] ?? emptyDraft);
  return { draft, update: (patch: Partial<TodoDraft>) => updateTodoDraft(widgetId, patch) };
}
