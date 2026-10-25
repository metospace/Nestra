import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute production functions against deterministic IPC barriers, never user files.
const source = readFileSync(new URL('../src/stores/state.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('state.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['snapshotFromStore', 'mergePersisted', 'equivalent', 'applyPersisted',
  'flushState', 'applyRemoteState', 'restoreConfiguration', 'zonePanelKey', 'renameCustomGroup',
  'removeCustomGroup', 'rebindMapping', 'migrateItemId', 'migratePathReferences', 'remappedId',
  'sanitizeZoneDir', 'uniqueZoneDir', 'performFileChange', 'prepareExit', 'cancelExitPreparation', 'runStateMutation', 'isExitFrozen', 'refreshDisplays', 'recoverDesktopLayouts', 'rescan', 'createWidget', 'addCustomGroup', 'dropPaths', 'setAppearance']);
const selected = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.has(n.name?.text));
assert.equal(selected.length, names.size);
const code = ts.transpile(selected.map(n => n.getText(ast).replace(/^export /, '')).join('\n'), { target: ts.ScriptTarget.ES2022 });
const plain = value => JSON.parse(JSON.stringify(value));
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const settle = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await Promise.resolve(); } throw Error('barrier not reached'); };
const canonical = value => JSON.parse(JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
  ? Object.fromEntries(Object.keys(nested).sort().map(key => [key, nested[key]])) : nested));

function setup() {
  let disk, writes = 0;
  const statuses = [], acknowledgements = [];
  const context = vm.createContext({
    store: { ready: true, entries: [], customGroups: [], tabGroups: [], panelLayouts: {}, foldedItems: {}, itemOrders: {},
      widgets: [], appearance: { styleVersion: 1, theme: 'dark', panelOpacity: .88 }, launcherIds: [], launcherReferences: {},
      launchCollections: [], startWithWindows: false, hideNativeIcons: false },
    DEFAULT_APPEARANCE: {}, publishState() {}, zCounter: 0, lastSynced: null,
    persistChain: Promise.resolve(), saveTimer: undefined, fileChangeDepth: 0,
    pendingStateMutations: 0, preparingExit: null, previousBodyInert: false, exitInputFrozen: false, fileMoves: { busy: false },
    document: { body: { inert: false } }, window: { clearTimeout() {}, setTimeout },
    getCurrentWebviewWindow: () => ({ label: 'desktop' }),
    desktopGestureActive: () => context.fileChangeDepth > 0, isEditingText: () => false,
    nextZ: () => 2, isLauncher: id => context.store.launcherIds.includes(id), ensurePanels() {}, ensureLayouts() {}, ensureLauncherLayout() {}, scheduleSave() {}, scheduleHitRectSync() {},
    applyAppearanceToCss() {}, syncMappingWatches: async () => {}, rescan: async () => {},
    backupConfiguration: async () => {}, setHideNativeIconsNative: async () => {}, setClipboardEnabled: async () => {},
    refreshDesktop: async () => {}, displayRefreshRunning: false, canRecoverDisplays: false, displayRecoveryReady: () => true,
    listDisplays: async () => [], recoverSurfaces: () => false, crypto: { randomUUID: () => "test-uuid-12345678" },
    confirmDialog: async () => true, scanFolder: async () => [], renameZoneDir: async () => {},
    showStatus: message => statuses.push(message), prepareRestore: (_current, imported) => plain(imported),
    acknowledgeExit: async (...args) => acknowledgements.push(args),
    loadPersistedState: async () => plain(disk),
    savePersistedState: async (value, _label, expected) => {
      assert.deepEqual(plain(expected), disk); disk = canonical(value); writes++;
    },
  });
  vm.runInContext(code, context);
  disk = canonical(context.snapshotFromStore()); context.lastSynced = plain(disk);
  return { c: context, statuses, acknowledgements, get disk() { return disk; }, set disk(value) { disk = canonical(value); }, get writes() { return writes; } };
}
const note = id => ({ id, kind: 'note', content: 'keep me', title: 'Note', todos: [], layout: { x: 20, y: 40, width: 310, height: 320, visible: true, zIndex: 1 } });

test('light theme chosen after the one-time visual migration survives save and remote reread', async () => {
  const t = setup(), { c } = t;
  const legacy = plain(t.disk);
  delete legacy.appearance.styleVersion;
  Object.assign(legacy.appearance, { theme: 'light', surfaceMaterial: 'clear', cornerStyle: 'standard', borderStyle: 'subtle', panelOpacity: .95 });
  t.disk = legacy; c.lastSynced = plain(legacy);
  // Exactly the state pair restoreState establishes: migrated live state and
  // the untouched old disk document as the three-way baseline.
  c.applyPersisted({ ...legacy, appearance: { styleVersion: 1, theme: 'dark', surfaceMaterial: 'glass', cornerStyle: 'rounded', borderStyle: 'subtle', panelOpacity: .88 } });
  c.setAppearance({ theme: 'light' });
  await c.flushState(); await c.applyRemoteState(); await c.flushState();
  assert.equal(t.disk.appearance.theme, 'light');
  assert.equal(t.disk.appearance.styleVersion, 1);
  assert.equal(c.store.appearance.theme, 'light');
});

test('theme changed while an older save is in flight remains light after that save completes', async () => {
  const t = setup(), { c } = t, writeGate = gate();
  const write = c.savePersistedState; let started = false;
  c.savePersistedState = async (...args) => { started = true; await writeGate.promise; await write(...args); };
  const oldSave = c.flushState(); await settle(() => started);
  c.setAppearance({ theme: 'light' });
  writeGate.release(); await oldSave;
  assert.equal(c.store.appearance.theme, 'light');
  await c.flushState(); await c.applyRemoteState();
  assert.equal(c.store.appearance.theme, 'light');
  assert.equal(t.disk.appearance.theme, 'light');
});

for (const change of ['add', 'modify', 'delete', 'layout']) {
  test(`queued remote ${change} while save reads cannot overwrite newer disk state`, async () => {
    const t = setup(), { c } = t;
    c.store.widgets = [note('existing')]; c.store.panelLayouts.zone = { x: 100, y: 100, width: 336, height: 432 };
    t.disk = c.snapshotFromStore(); c.lastSynced = plain(t.disk);
    const remote = plain(t.disk);
    if (change === 'add') remote.widgets.push(note('new-note'));
    if (change === 'modify') remote.widgets[0].content = 'remote update';
    if (change === 'delete') remote.widgets = [];
    if (change === 'layout') remote.panelLayouts.zone = { x: 640, y: 240, width: 480, height: 560 };
    t.disk = remote;
    c.store.launcherIds.push('local-entry');
    const readGate = gate(); let reads = 0;
    c.loadPersistedState = async () => { if (++reads === 1) await readGate.promise; return plain(t.disk); };
    const saving = c.flushState(); await settle(() => reads === 1);
    const syncing = c.applyRemoteState();
    await Promise.resolve(); assert.equal(reads, 1, 'remote load waits for the active save');
    readGate.release(); await Promise.all([saving, syncing]);
    assert.deepEqual(t.disk.widgets, remote.widgets);
    assert.deepEqual(t.disk.panelLayouts, remote.panelLayouts);
    assert.deepEqual(t.disk.launcherIds, ['local-entry']);
    c.applyPersisted(t.disk);
    assert.deepEqual(plain(c.store.widgets), remote.widgets);
    assert.deepEqual(plain(c.store.panelLayouts), remote.panelLayouts);
  });
}

test('two remote reads serialize; an older read cannot roll the baseline back', async () => {
  const t = setup(), { c } = t, firstRead = gate(); let reads = 0;
  c.loadPersistedState = async () => { const value = plain(t.disk); if (++reads === 1) await firstRead.promise; return value; };
  const first = c.applyRemoteState(); await settle(() => reads === 1);
  const next = plain(t.disk); next.widgets.push(note('latest')); t.disk = next;
  const second = c.applyRemoteState(); firstRead.release(); await Promise.all([first, second]);
  assert.deepEqual(plain(c.lastSynced.widgets), [note('latest')]);
  assert.deepEqual(plain(c.store.widgets), [note('latest')]);
});

test('CAS retry preserves local edits made during the first failed write and new remote notes', async () => {
  const t = setup(), { c } = t; let attempts = 0;
  const write = c.savePersistedState;
  c.store.launcherIds = ['first'];
  c.savePersistedState = async (...args) => {
    if (++attempts === 1) {
      c.store.launcherIds.push('second');
      const remote = plain(t.disk); remote.widgets.push(note('concurrent')); t.disk = remote;
      throw Error('STATE_CONFLICT');
    }
    await write(...args);
  };
  await c.flushState();
  assert.deepEqual(t.disk.launcherIds, ['first', 'second']);
  assert.deepEqual(t.disk.widgets, [note('concurrent')]);
});

test('gesture started during save finishes before applying; its later placement wins on the next save', async () => {
  const t = setup(), { c } = t, saveGate = gate(); let started = false;
  c.store.panelLayouts.zone = { x: 100, y: 100, width: 336, height: 432 };
  t.disk = c.snapshotFromStore(); c.lastSynced = plain(t.disk);
  const remote = plain(t.disk); remote.panelLayouts.zone.x = 400; t.disk = remote;
  const write = c.savePersistedState;
  c.savePersistedState = async (...args) => { started = true; await saveGate.promise; await write(...args); };
  const saving = c.flushState(); await settle(() => started);
  c.fileChangeDepth = 1; c.store.panelLayouts.zone.x = 700;
  saveGate.release(); await settle(() => t.writes === 1);
  assert.equal(c.store.panelLayouts.zone.x, 700);
  c.store.panelLayouts.zone.x = 750; c.fileChangeDepth = 0;
  await saving; assert.equal(c.store.panelLayouts.zone.x, 750);
  await c.flushState(); assert.equal(t.disk.panelLayouts.zone.x, 750);
});

test('restore accepts reordered JSON properties and rejects actual changes', async () => {
  const t = setup(), { c } = t;
  await c.flushState(); const expected = plain(c.snapshotFromStore());
  const imported = plain(expected); imported.widgets.push(note('restored'));
  await c.restoreConfiguration(imported, expected);
  assert.deepEqual(t.disk.widgets, [note('restored')]);
  c.store.appearance.panelOpacity = .7;
  await assert.rejects(c.restoreConfiguration(imported, expected), /配置在预览后发生变化/);
});

test('restore aborts edits during backup and preserves edits made during the write', async () => {
  const t = setup(), { c } = t, expected = plain(c.snapshotFromStore());
  c.backupConfiguration = async () => { c.store.launcherIds.push('new edit'); };
  await assert.rejects(c.restoreConfiguration(expected, expected), /配置在预览后发生变化/);
  assert.equal(t.writes, 0);
  c.backupConfiguration = async () => {};
  const preview = plain(c.snapshotFromStore()), imported = plain(preview); imported.widgets.push(note('restore'));
  imported.appearance.panelOpacity = .5;
  const write = c.savePersistedState;
  c.savePersistedState = async (...args) => { await write(...args); c.store.launcherIds.push('during write'); c.store.appearance.panelOpacity = .7; };
  await c.restoreConfiguration(imported, preview);
  assert.deepEqual(Array.from(c.store.launcherIds), ['new edit', 'during write']);
  assert.deepEqual(plain(c.store.widgets), [note('restore')]);
  assert.equal(c.store.appearance.panelOpacity, .7);
});

test('native rename commits to live group after snapshot replacement and migrates references', async () => {
  const t = setup(), { c } = t, renameGate = gate(); let started = false;
  const path = 'C:\\Desktop\\.nestra\\Old\\a.txt', id = `file:${path}`;
  c.store.customGroups = [{ id: 'zone', name: 'Old', dirName: 'Old' }];
  c.store.entries = [{ id, path, zone: 'Old', kind: 'file' }];
  c.store.launcherIds = [id]; c.store.launchCollections = [{ id: 'set', entryIds: [id] }];
  c.renameZoneDir = async () => { started = true; await renameGate.promise; };
  const renaming = c.renameCustomGroup('zone', 'New'); await settle(() => started);
  c.applyPersisted(c.snapshotFromStore()); renameGate.release(); await renaming;
  assert.equal(c.store.customGroups[0].dirName, 'New'); assert.equal(c.store.customGroups[0].name, 'New');
  assert.deepEqual(Array.from(c.store.launcherIds), ['file:C:\\Desktop\\.nestra\\New\\a.txt']);
  assert.equal(c.store.launchCollections[0].entryIds[0], c.store.launcherIds[0]);
  assert.equal(c.fileChangeDepth, 0);
});

test('rebind mapping reacquires live object and respects deletion during scan', async () => {
  for (const deleted of [false, true]) {
    const t = setup(), { c } = t, scan = gate();
    c.store.customGroups = [{ id: 'map', name: 'Map', dirName: 'D:\\Old', mappedPath: 'D:\\Old' }];
    c.scanFolder = async () => { await scan.promise; return []; };
    const binding = c.rebindMapping('map', 'D:\\New');
    c.applyPersisted(c.snapshotFromStore()); if (deleted) c.store.customGroups = [];
    scan.release();
    if (deleted) await assert.rejects(binding, /映射已被移除/);
    else { await binding; assert.equal(c.store.customGroups[0].mappedPath, 'D:\\New'); }
  }
});

for (const partial of [false, true]) {
  test(`dissolve migrates successful destinations before scan, including ${partial ? 'partial failure' : 'name conflicts'}`, async () => {
    const t = setup(), { c } = t;
    const from = 'C:\\Desktop\\.nestra\\Zone\\doc.txt', target = 'C:\\Desktop\\doc (2).txt', oldId = `file:${from}`;
    c.store.customGroups = [{ id: 'zone', name: 'Zone', dirName: 'Zone' }];
    c.store.entries = [{ id: oldId, path: from, kind: 'file' }]; c.store.launcherIds = [oldId];
    c.store.launcherReferences[oldId] = c.store.entries[0]; c.store.launchCollections = [{ id: 'set', entryIds: [oldId] }];
    c.dissolveZone = async () => ({ moves: [{ fromPath: from, newPath: target }], error: partial ? 'locked' : null });
    c.rescan = async () => {
      assert.equal(c.fileChangeDepth, 0);
      assert.deepEqual(Array.from(c.store.launcherIds), [`file:${target}`]);
      assert.equal(c.store.launcherReferences[`file:${target}`].path, target);
      assert.equal(c.store.launchCollections[0].entryIds[0], `file:${target}`);
    };
    await c.removeCustomGroup('zone');
    assert.equal(c.store.customGroups.length, partial ? 1 : 0);
  });
}

test('renaming extension reclassifies IDs, while folder names remain folders', () => {
  const { c } = setup();
  assert.equal(c.remappedId({ id: 'file:C:\\a.txt', kind: 'file' }, 'C:\\a.cmd'), 'app:shortcut:C:\\a.cmd');
  assert.equal(c.remappedId({ id: 'app:shortcut:C:\\a.cmd', kind: 'file' }, 'C:\\a.txt'), 'file:C:\\a.txt');
  assert.equal(c.remappedId({ id: 'file:C:\\folder', kind: 'folder' }, 'C:\\folder.exe'), 'file:C:\\folder.exe');
});

test('exit drains pending edits before acknowledgement and unfreezes on cancellation', async () => {
  const t = setup(), { c } = t, saving = gate(); let started = false;
  c.store.widgets.push(note('last keystroke'));
  const save = c.savePersistedState;
  c.savePersistedState = async (...args) => { started = true; await saving.promise; await save(...args); };
  const exiting = c.prepareExit(1); await settle(() => started);
  assert.deepEqual(t.acknowledgements, []); assert.equal(c.document.body.inert, true);
  saving.release(); await exiting;
  assert.deepEqual(t.disk.widgets, [note('last keystroke')]);
  assert.deepEqual(t.acknowledgements, [[1, null]]);
  c.cancelExitPreparation(); assert.equal(c.document.body.inert, false);
});

test('exit refuses failed saves and restores input without success acknowledgement', async () => {
  const t = setup(), { c } = t;
  c.savePersistedState = async () => { throw Error('disk full'); };
  await c.prepareExit(2);
  assert.equal(c.document.body.inert, false);
  assert.equal(t.acknowledgements.length, 1); assert.match(t.acknowledgements[0][1], /disk full/);
});

test('exit waits for active file transaction; cancellation prevents late success', async () => {
  const t = setup(), { c } = t;
  c.fileChangeDepth = 1;
  const exiting = c.prepareExit(3); await Promise.resolve();
  assert.equal(c.document.body.inert, false); assert.equal(t.writes, 0);
  c.cancelExitPreparation(); c.fileChangeDepth = 0; await exiting;
  assert.deepEqual(t.acknowledgements, []);
});

test('exit waits for an already accepted zone creation and persists its result before ACK', async () => {
  const t = setup(), { c } = t, create = gate();
  c.createZone = async name => { await create.promise; return name; };
  const creating = c.addCustomGroup('Accepted zone');
  const exiting = c.prepareExit(11);
  await Promise.resolve();
  assert.equal(c.pendingStateMutations, 1); assert.deepEqual(t.acknowledgements, []);
  assert.equal(c.document.body.inert, false);
  create.release(); await creating; await exiting;
  assert.equal(t.disk.customGroups[0].name, 'Accepted zone');
  assert.deepEqual(t.acknowledgements, [[11, null]]);
  await assert.rejects(c.addCustomGroup('Too late'), /正在退出/);
  assert.equal(c.store.customGroups.length, 1);
});

test('exit drains a delayed display recovery and blocks refreshes while another window has yet to ACK', async () => {
  const t = setup(), { c } = t, read = gate(); let reads = 0;
  c.store.panelLayouts.zone = { x: 2000, y: 100, width: 336, height: 432 };
  c.listDisplays = async () => { reads++; await read.promise; return [{ id: 'main', x: 0, y: 0, width: 1920, height: 1080 }]; };
  c.recoverSurfaces = layouts => { layouts[0].x = 800; return true; };
  const refreshing = c.refreshDisplays(), exiting = c.prepareExit(12);
  await Promise.resolve(); assert.deepEqual(t.acknowledgements, []);
  read.release(); await refreshing; await exiting;
  assert.equal(t.disk.panelLayouts.zone.x, 800);
  await c.refreshDisplays(); c.recoverDesktopLayouts();
  assert.equal(reads, 1); assert.equal(c.store.panelLayouts.zone.x, 800);
});

test('exit drains an in-flight rescan reference update, then ignores later scan events', async () => {
  const t = setup(), { c } = t, scan = gate(); let scans = 0;
  c.store.launcherIds = ['file:C:\\a.txt'];
  c.refreshDesktop = async () => {
    scans++; await scan.promise;
    c.store.launcherReferences['file:C:\\a.txt'] = { id: 'file:C:\\a.txt', path: 'C:\\a.txt', name: 'Scanned name' };
  };
  const scanning = c.rescan(), exiting = c.prepareExit(13);
  await Promise.resolve(); assert.deepEqual(t.acknowledgements, []);
  scan.release(); await scanning; await exiting;
  assert.equal(t.disk.launcherReferences['file:C:\\a.txt'].name, 'Scanned name');
  await c.rescan(); assert.equal(scans, 1);
});

test('delayed native launcher drop is committed before ACK and new drops are refused while frozen', async () => {
  const t = setup(), { c } = t, scan = gate();
  const entry = { id: 'file:C:\\a.txt', path: 'C:\\a.txt', kind: 'file' };
  c.scanPaths = async () => { await scan.promise; return [entry]; };
  const dropping = c.dropPaths([entry.path], 'launcher'), exiting = c.prepareExit(14);
  await Promise.resolve(); assert.deepEqual(t.acknowledgements, []);
  scan.release(); await dropping; await exiting;
  assert.deepEqual(t.disk.launcherIds, [entry.id]);
  await assert.rejects(c.dropPaths(['C:\\late.txt'], 'launcher'), /正在退出/);
});

test('tray event delivered after ACK cannot create unsaved notes while another window is saving; cancel restores dispatch', async () => {
  const t = setup(), { c } = t;
  const desktopSource = readFileSync(new URL('../src/desktop/DesktopLayer.tsx', import.meta.url), 'utf8');
  const desktopAst = ts.createSourceFile('DesktopLayer.tsx', desktopSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && ['whenReady', 'tray'].includes(node.name?.text)) handlers.push(node);
    ts.forEachChild(node, visit);
  }
  visit(desktopAst);
  assert.equal(handlers.length, 2);
  c.disposed = false;
  vm.runInContext(ts.transpile(handlers.map(node => node.getText(desktopAst)).join('\n'), { target: ts.ScriptTarget.ES2022 }), c);
  await c.prepareExit(15);
  await c.whenReady(() => c.tray('new-note')); c.createWidget('note');
  assert.equal(c.store.widgets.length, 0); assert.equal(t.disk.widgets.length, 0);
  c.cancelExitPreparation(); await c.whenReady(() => c.tray('new-note'));
  assert.equal(c.store.widgets.length, 1);
});

test('six default panels use full-height rows with no overlap on a 1080p monitor', () => {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ensureLayouts');
  const c = vm.createContext({ store: { displays: [{ id: 'main', x: 0, y: 0, width: 1920, height: 1080, isPrimary: true }],
    panels: Array.from({ length: 6 }, (_, i) => ({ key: `zone:${i}` })), panelLayouts: {} },
    window: { screen: { width: 1920 }, innerWidth: 1920 }, PANEL_WIDTH: 336, PANEL_HEIGHT: 432, PANEL_GAP: 14,
    SCREEN_MARGIN: 18, LAUNCHER_PANEL_KEY: 'system:launcher', zCounter: 0, scheduleSave() {},
  });
  vm.runInContext(ts.transpile(fn.getText(ast), { target: ts.ScriptTarget.ES2022 }), c);
  c.ensureLayouts();
  const layouts = Object.values(c.store.panelLayouts);
  for (let i = 0; i < layouts.length; i++) for (let j = i + 1; j < layouts.length; j++) {
    const a = layouts[i], b = layouts[j];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  }
  assert.equal(layouts[5].y, 18 + 432 + 14);
});
