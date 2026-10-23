import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';

const transpile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const draftModule = { exports: {} };
vm.runInNewContext(transpile(readFileSync(new URL('../src/composables/useTodoDraft.ts', import.meta.url), 'utf8')), {
  require: createRequire(import.meta.url), module: draftModule, exports: draftModule.exports,
});
const { useTodoDraft, discardTodoDraft } = draftModule.exports;

test('returning to a widget restores unsubmitted text and its original conflict baseline', () => {
  const first = useTodoDraft(() => 'navigation-test');
  first.text.value = 'new task draft';
  first.editingId.value = 'task';
  first.editText.value = 'my edited text';
  first.editingOriginal.value = 'text before remote edit';
  // A new consumer represents the editor remounting after navigation or hiding.
  const returned = useTodoDraft(() => 'navigation-test');
  assert.equal(returned.text.value, 'new task draft');
  assert.equal(returned.editingId.value, 'task');
  assert.equal(returned.editText.value, 'my edited text');
  assert.equal(returned.editingOriginal.value, 'text before remote edit');
  assert.equal(useTodoDraft(() => 'other-widget').editText.value, '');
  discardTodoDraft('navigation-test');
  assert.equal(useTodoDraft(() => 'navigation-test').editingId.value, '');
});

function declarations(path, names) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map(node => node.getText(ast)).join('\n');
}
const launcherCode = transpile([
  declarations('../src/stores/state.ts', ['pinEntry', 'setLauncherVisible', 'showStatus', 'dismissStatus']),
  declarations('../src/lib/layout.ts', ['recoverSurface', 'containSurface', 'displayAtPoint']),
].join('\n'));

function launcherTest() {
  const layout = { x: 480, y: 220, width: 336, height: 420, visible: false, locked: true, monitorId: 'main', zIndex: 5 };
  let saves = 0, hitSyncs = 0, zIndex = 20;
  const store = {
    panelLayouts: { 'system:launcher': layout }, launcherReferences: {}, launcherIds: [], paused: false,
    displays: [{ id: 'main', x: 0, y: 0, width: 1920, height: 1080, isPrimary: true }],
  };
  const context = vm.createContext({runStateMutation: fn => fn(), isExitFrozen: () => false,
    exports: {}, store, statusTimer: undefined, LAUNCHER_PANEL_KEY: 'system:launcher',
    scheduleSave: () => saves++, scheduleHitRectSync: () => hitSyncs++, ensureLauncherLayout() {},
    nextZ: () => ++zIndex,
    setPausedNative: async () => {}, window: { clearTimeout() {}, setTimeout() { return 1; } },
  });
  vm.runInContext(launcherCode, context);
  return { store, layout, context, saves: () => saves, hitSyncs: () => hitSyncs };
}

test('pinning offers visibility without moving files, changing layout or forcing display', async () => {
  const t = launcherTest(), before = { ...t.layout };
  const entry = { id: 'file:C:/test/report.txt', path: 'C:/test/report.txt', name: 'report.txt' };
  t.context.pinEntry(entry);
  assert.deepEqual(t.store.launcherIds, [entry.id]);
  assert.equal(t.store.launcherReferences[entry.id].path, entry.path);
  assert.equal(t.store.statusAction, 'show-launcher');
  assert.deepEqual(t.layout, before);
  await t.context.setLauncherVisible(true);
  assert.deepEqual(t.layout, { ...before, visible: true, zIndex: 21 });
  assert.equal(t.store.statusAction, null);
  assert.equal(t.hitSyncs(), 1);
  assert.equal(t.saves(), 2);
  t.context.pinEntry(entry);
  assert.equal(t.store.launcherIds.length, 1);
  assert.equal(t.store.statusAction, null);
  await t.context.setLauncherVisible(false);
  assert.deepEqual(t.layout, { ...before, zIndex: 21 });
});

test('showing an offscreen launcher safely recovers it while keeping lock and references', async () => {
  const t = launcherTest();
  t.layout.x = -3000;
  t.store.launcherIds.push('reference');
  await t.context.setLauncherVisible(true);
  assert.equal(t.layout.visible, true);
  assert.equal(t.layout.locked, true);
  assert.ok(t.layout.x >= 0 && t.layout.x + t.layout.width <= 1920);
  assert.deepEqual(t.store.launcherIds, ['reference']);
});

test('failure to resume the desktop does not report success or change launcher visibility', async () => {
  const t = launcherTest();
  t.store.paused = true;
  t.context.setPausedNative = async () => { throw new Error('unavailable'); };
  await t.context.setLauncherVisible(true);
  assert.equal(t.store.paused, true);
  assert.equal(t.layout.visible, false);
  assert.match(t.store.statusMessage, /无法显示快捷启动/);
  assert.equal(t.saves(), 0);
});
