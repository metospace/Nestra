import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const actualRequire = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../src/stores/everythingSetup.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const status = (patch = {}) => ({
  installed: false, running: false, installPath: null, defaultInstallDir: 'D:\\Apps\\Everything',
  phase: 'idle', downloadedBytes: 0, totalBytes: null, message: 'Everything 未安装', ...patch,
});
const stopped = () => status({ installed: true, installPath: 'D:\\Apps\\Everything\\Everything.exe', message: 'Everything 未运行' });
const ready = () => ({ ...stopped(), running: true, phase: 'ready', message: 'Everything 已连接' });

function setup(overrides = {}) {
  let nextTimer = 0;
  const timers = new Map(), listeners = new Map(), calls = { status: 0, install: [], start: 0 };
  const native = {
    getEverythingStatus: async () => status(),
    installEverything: async () => ready(),
    startEverything: async () => ready(),
    ...overrides,
  };
  const ipc = {
    getEverythingStatus: () => { calls.status++; return native.getEverythingStatus(); },
    installEverything: path => { calls.install.push(path); return native.installEverything(path); },
    startEverything: () => { calls.start++; return native.startEverything(); },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: name => name === '@/lib/tauri' ? ipc : actualRequire(name),
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    window: {
      addEventListener: (event, callback) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(callback);
      },
      removeEventListener: (event, callback) => listeners.get(event)?.delete(callback),
    },
  });
  return {
    m: module.exports, native, calls, timers, listeners,
    snapshot: () => module.exports.everythingSetupStore.getState(),
    focus: () => { for (const callback of listeners.get('focus') ?? []) callback(); },
    tick: () => {
      assert.equal(timers.size, 1, 'one shared poll must be scheduled');
      const [id, timer] = timers.entries().next().value;
      timers.delete(id); timer.callback();
    },
  };
}

test('detection distinguishes missing, installed but stopped, and connected without installing', async () => {
  const t = setup();
  await t.m.refreshEverythingStatus();
  assert.equal(t.snapshot().status.installed, false);
  t.native.getEverythingStatus = async () => stopped();
  await t.m.refreshEverythingStatus();
  assert.equal(t.snapshot().status.installed, true);
  assert.equal(t.snapshot().status.running, false);
  t.native.getEverythingStatus = async () => ready();
  await t.m.refreshEverythingStatus();
  assert.equal(t.snapshot().status.running, true);
  assert.deepEqual(t.calls.install, [], 'detection cannot download or install without an explicit action');
  assert.equal(t.calls.start, 0);
});

test('overlapping status checks share one request and report detection errors without rejecting', async () => {
  const pending = deferred(), t = setup({ getEverythingStatus: () => pending.promise });
  const first = t.m.refreshEverythingStatus(), second = t.m.refreshEverythingStatus();
  assert.equal(first, second);
  await flush();
  assert.equal(t.calls.status, 1);
  assert.equal(t.snapshot().checking, true);
  pending.reject(new Error('IPC disconnected'));
  await Promise.all([first, second]);
  assert.equal(t.snapshot().checking, false);
  assert.match(t.snapshot().error, /IPC disconnected/);
  assert.equal(t.snapshot().status, null);
  t.native.getEverythingStatus = async () => stopped();
  await t.m.refreshEverythingStatus(true);
  assert.equal(t.snapshot().status.installed, true);
  assert.equal(t.snapshot().error, null);
});

test('a synchronous IPC failure clears checking and permits a fresh detection', async () => {
  const t = setup({ getEverythingStatus: () => { throw new Error('native bridge unavailable'); } });
  await t.m.refreshEverythingStatus();
  assert.equal(t.snapshot().checking, false);
  assert.match(t.snapshot().error, /native bridge unavailable/);
  t.native.getEverythingStatus = async () => ready();
  await t.m.refreshEverythingStatus();
  assert.equal(t.calls.status, 2);
  assert.equal(t.snapshot().status.running, true);
  assert.equal(t.snapshot().error, null);
});

test('the frontend serializes install and start clicks while one native action is pending', async () => {
  const job = deferred(), t = setup({ installEverything: () => job.promise, getEverythingStatus: async () => ready() });
  const installing = t.m.installEverythingFromStore('E:\\Software\\Everything');
  assert.equal(t.snapshot().pending, true);
  await t.m.installEverythingFromStore('D:\\Apps\\Everything');
  await t.m.startEverythingFromStore();
  assert.deepEqual(t.calls.install, ['E:\\Software\\Everything']);
  assert.equal(t.calls.start, 0);
  job.resolve(ready()); await installing;
  assert.equal(t.snapshot().pending, false);
  assert.equal(t.snapshot().status.running, true);
});

test('a job reported by another window blocks a duplicate action until polling observes completion', async () => {
  const t = setup({ getEverythingStatus: async () => status({ phase: 'installing', message: '正在安装' }) });
  await t.m.refreshEverythingStatus();
  assert.equal(t.m.isEverythingBusy(t.snapshot().status), true);
  await t.m.installEverythingFromStore('D:\\Apps\\Everything');
  await t.m.startEverythingFromStore();
  assert.deepEqual(t.calls.install, []);
  assert.equal(t.calls.start, 0);
  t.native.getEverythingStatus = async () => stopped();
  await t.m.refreshEverythingStatus();
  t.native.getEverythingStatus = async () => ready();
  await t.m.startEverythingFromStore();
  assert.equal(t.calls.start, 1);
  assert.equal(t.snapshot().status.running, true);
});

test('a stale detection response cannot erase a completed installation', async () => {
  const oldDetection = deferred(), job = deferred();
  const t = setup({ getEverythingStatus: () => oldDetection.promise, installEverything: () => job.promise });
  const detecting = t.m.refreshEverythingStatus();
  await flush();
  const installing = t.m.installEverythingFromStore('D:\\Apps\\Everything');
  t.native.getEverythingStatus = async () => ready();
  job.resolve(ready()); await installing;
  oldDetection.resolve(status()); await detecting;
  assert.equal(t.snapshot().status.running, true);
  assert.equal(t.snapshot().status.phase, 'ready');
  assert.equal(t.snapshot().checking, false);
  assert.equal(t.snapshot().pending, false);
});

test('a progress poll started during installation cannot overwrite the finished state', async () => {
  const progress = deferred(), job = deferred();
  const t = setup({ getEverythingStatus: () => progress.promise, installEverything: () => job.promise });
  const installing = t.m.installEverythingFromStore('D:\\Apps\\Everything');
  const polling = t.m.refreshEverythingStatus();
  await flush();
  t.native.getEverythingStatus = async () => ready();
  job.resolve(ready()); await installing;
  progress.resolve(status({ phase: 'downloading', downloadedBytes: 1024 })); await polling;
  assert.equal(t.snapshot().status.running, true);
  assert.equal(t.snapshot().status.phase, 'ready');
});

test('an immediately accepted native background job stays busy and receives progress until a later poll connects', async () => {
  let nativeStatus = status();
  const t = setup({
    getEverythingStatus: async () => nativeStatus,
    installEverything: async () => {
      nativeStatus = status({ phase: 'downloading', message: '正在下载', totalBytes: 2048 });
      return nativeStatus;
    },
  });
  const release = t.m.retainEverythingMonitor();
  await flush();
  await t.m.installEverythingFromStore('D:\\Apps\\Everything');
  assert.equal(t.snapshot().pending, false, 'the launch IPC finishes before the native job');
  assert.equal(t.m.isEverythingBusy(t.snapshot().status), true);
  assert.equal(t.timers.values().next().value.delay, 1000);
  await t.m.installEverythingFromStore('D:\\Apps\\Everything');
  assert.equal(t.calls.install.length, 1, 'native downloading state still disables another launch');
  nativeStatus = { ...nativeStatus, downloadedBytes: 1024 };
  t.tick(); await flush();
  assert.equal(t.snapshot().status.downloadedBytes, 1024);
  nativeStatus = status({ phase: 'installing', message: '正在安装', downloadedBytes: 2048, totalBytes: 2048 });
  t.tick(); await flush();
  assert.equal(t.snapshot().status.phase, 'installing');
  nativeStatus = ready();
  t.tick(); await flush();
  assert.equal(t.snapshot().status.running, true);
  assert.equal(t.m.isEverythingBusy(t.snapshot().status), false);
  assert.equal(t.timers.values().next().value.delay, 10000);
  release();
  assert.equal(t.timers.size, 0);
});

test('installation failures remain visible through background detection and allow an explicit retry', async () => {
  const t = setup({ installEverything: async () => { throw new Error('管理员确认已取消'); } });
  await t.m.installEverythingFromStore('D:\\Apps\\Everything');
  assert.equal(t.snapshot().pending, false);
  assert.match(t.snapshot().error, /管理员确认已取消/);
  await t.m.refreshEverythingStatus();
  assert.match(t.snapshot().error, /管理员确认已取消/);
  t.native.installEverything = async () => ready();
  t.native.getEverythingStatus = async () => ready();
  await t.m.installEverythingFromStore('D:\\Apps\\Everything');
  assert.equal(t.calls.install.length, 2);
  assert.equal(t.snapshot().error, null);
  assert.equal(t.snapshot().status.running, true);
});

test('mounted consumers share polling and unmounting the last one removes timers and focus listeners', async () => {
  const t = setup();
  const releaseFirst = t.m.retainEverythingMonitor(), releaseSecond = t.m.retainEverythingMonitor();
  await flush();
  assert.equal(t.calls.status, 1);
  assert.equal(t.listeners.get('focus').size, 1);
  assert.equal(t.timers.size, 1);
  t.tick(); await flush();
  assert.equal(t.calls.status, 2);
  releaseFirst(); releaseFirst();
  assert.equal(t.listeners.get('focus').size, 1, 'cleanup is idempotent while another consumer remains');
  assert.equal(t.timers.size, 1);
  releaseSecond();
  assert.equal(t.listeners.get('focus').size, 0);
  assert.equal(t.timers.size, 0);
  t.focus(); await flush();
  assert.equal(t.calls.status, 2);
});

test('an in-flight status response cannot resurrect polling after the final consumer unmounts', async () => {
  const pending = deferred(), t = setup({ getEverythingStatus: () => pending.promise });
  const release = t.m.retainEverythingMonitor();
  await flush();
  release();
  pending.resolve(status({ phase: 'downloading' })); await flush();
  assert.equal(t.timers.size, 0);
  assert.equal(t.listeners.get('focus').size, 0);
  const releaseAgain = t.m.retainEverythingMonitor();
  await flush();
  assert.equal(t.calls.status, 2, 'a later route mount starts a fresh detection');
  assert.equal(t.timers.size, 1);
  assert.equal(t.timers.values().next().value.delay, 1000, 'active work uses the progress polling interval');
  releaseAgain();
});
