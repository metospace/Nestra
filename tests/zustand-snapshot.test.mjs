import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';

const source = readFileSync(new URL('../src/stores/state.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('state.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['snapshotEntries', 'viewSnapshot', 'publishState', 'mutateStore', 'scheduleSave',
  'confirmDialog', 'showStatus', 'dismissStatus', 'setPaused', 'setHideNativeIcons']);
const code = ts.transpile(ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
  .map(node => node.getText(ast).replace(/^export /, '')).join('\n'), { target: ts.ScriptTarget.ES2022 });

function setup() {
  let timer, saves = 0, hitSyncs = 0;
  const context = vm.createContext({
    structuredClone, revision: 0, saveTimer: undefined, statusTimer: undefined, scanSnapshots: new WeakMap(),
    store: { persistenceBlocked: false, confirmRequest: null, statusMessage: '', statusAction: null,
      paused: false, hideNativeIcons: false,
      entries: [{ id: 'file:a', path: 'a' }], applications: [],
      widgets: [{ id: 'note', content: 'before', layout: { x: 10 } }],
      panelLayouts: { zone: { x: 20, appearance: { panelOpacity: .8 } } } },
    iconUrls: new Map(), mappingErrors: {}, operationResults: [],
    isExitFrozen: () => false, applyAppearanceToCss() {},
    runStateMutation: operation => operation(), setPausedNative: async () => {}, setHideNativeIconsNative: async () => {},
    scheduleHitRectSync: () => hitSyncs++,
    window: { clearTimeout() {}, setTimeout(callback) { timer = callback; return 1; } },
    flushState: async () => { saves++; },
  });
  vm.runInContext(code, context);
  context.nestraStore = createStore(() => context.viewSnapshot());
  return { c: context, snapshot: () => context.nestraStore.getState(),
    tick: () => timer(), saves: () => saves, hitSyncs: () => hitSyncs };
}

test('Zustand renders detached immutable snapshots across nested asynchronous service edits', () => {
  const t = setup(), before = t.snapshot();
  t.c.store.widgets[0].content = 'after';
  t.c.store.panelLayouts.zone.appearance.panelOpacity = .3;
  t.c.iconUrls.set('file', 'asset:test');
  t.c.mappingErrors.folder = 'unavailable';
  t.c.operationResults.push({ name: 'A', path: 'A', ok: true, message: 'done' });
  t.c.publishState();
  assert.equal(before.widgets[0].content, 'before');
  assert.equal(before.panelLayouts.zone.appearance.panelOpacity, .8);
  assert.equal(before.iconUrls.size, 0);
  assert.equal(before.operationResults.length, 0);
  assert.equal(t.snapshot().widgets[0].content, 'after');
  assert.equal(t.snapshot().iconUrls.get('file'), 'asset:test');
  assert.equal(t.snapshot().mappingErrors.folder, 'unavailable');
  assert.ok(t.snapshot().revision > before.revision);
  assert.equal(t.saves(), 0, 'publishing remote/native changes cannot echo persistence');
});

test('layout frames reuse scanner snapshots while a new native scan replaces the file rows', () => {
  const t = setup(), before = t.snapshot();
  t.c.mutateStore(state => { state.panelLayouts.zone.x = 40; });
  assert.equal(t.snapshot().entries, before.entries);
  assert.equal(t.snapshot().applications, before.applications);
  assert.notEqual(t.snapshot().panelLayouts, before.panelLayouts);
  t.c.store.entries = [...t.c.store.entries, { id: 'file:b', path: 'b' }];
  t.c.publishState();
  assert.notEqual(t.snapshot().entries, before.entries);
  assert.equal(before.entries.length, 1);
  assert.equal(t.snapshot().entries.length, 2);
});

test('UI mutation publishes once through the save boundary and schedules hit regions', async () => {
  const t = setup(); let notifications = 0;
  t.c.nestraStore.subscribe(() => notifications++);
  t.c.mutateStore(state => { state.widgets[0].content = 'edited'; });
  assert.equal(t.snapshot().widgets[0].content, 'edited');
  assert.equal(notifications, 1);
  assert.equal(t.hitSyncs(), 1);
  t.tick(); await Promise.resolve();
  assert.equal(t.saves(), 1);
  t.c.isExitFrozen = () => true;
  t.c.mutateStore(state => { state.widgets[0].content = 'ignored'; });
  assert.equal(t.snapshot().widgets[0].content, 'edited');
});

test('confirmation callback and status timer publish without writing configuration', async () => {
  const t = setup();
  const first = t.c.confirmDialog('first');
  const firstSnapshot = t.snapshot();
  const second = t.c.confirmDialog('second');
  assert.equal(await first, false);
  assert.equal(firstSnapshot.confirmRequest.message, 'first');
  assert.equal(t.snapshot().confirmRequest.message, 'second');
  t.snapshot().confirmRequest.resolve(true);
  assert.equal(await second, true);
  assert.equal(t.snapshot().confirmRequest, null);
  t.c.showStatus('temporary');
  assert.equal(t.snapshot().statusMessage, 'temporary');
  t.tick();
  assert.equal(t.snapshot().statusMessage, '');
  assert.equal(t.saves(), 0);
});

test('failed native visibility switches keep the last confirmed UI value and do not save a lie', async () => {
  for (const [action, native, key] of [['setPaused', 'setPausedNative', 'paused'],
    ['setHideNativeIcons', 'setHideNativeIconsNative', 'hideNativeIcons']]) {
    const t = setup(); let reject;
    t.c[native] = () => new Promise((_resolve, fail) => { reject = fail; });
    const pending = t.c[action](true);
    assert.equal(t.snapshot()[key], false, 'pending IPC has not confirmed the requested change');
    reject(new Error('native unavailable')); await pending;
    assert.equal(t.snapshot()[key], false);
    assert.match(t.snapshot().statusMessage, /无法切换/);
    assert.equal(t.saves(), 0);
    t.c[native] = async () => {};
    await t.c[action](true);
    assert.equal(t.snapshot()[key], true);
  }
});

test('file result subscriptions publish progress while prior renders retain their state', async () => {
  const module = { exports: {} }, actualRequire = createRequire(import.meta.url);
  const moveCode = ts.transpileModule(readFileSync(new URL('../src/composables/fileMoveReports.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(moveCode, { module, exports: module.exports,
    require: name => name === 'zustand' ? { useStore: api => api.getState() } : actualRequire(name) });
  const m = module.exports;
  let release; const gate = new Promise(resolve => { release = resolve; });
  const operation = m.trackFileMoves('zone', [{ name: 'A', path: 'A', run: () => gate }], async () => {});
  const pending = m.useFileMoves();
  assert.equal(pending.busy, true);
  assert.equal(pending.reports[0].items[0].state, 'pending');
  release(); await operation;
  assert.equal(pending.busy, true);
  assert.equal(pending.reports[0].items[0].state, 'pending');
  assert.equal(m.useFileMoves().reports[0].items[0].state, 'success');
  assert.equal(m.useFileMoves().busy, false);
  assert.equal(m.useFileMoves().open, false);
  m.setMoveResultsOpen(true);
  assert.equal(m.useFileMoves().open, true);
});
