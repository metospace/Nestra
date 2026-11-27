import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const file = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const script = path => ts.transpile(file(path).replace(/^import .*$/gm, '').replace(/^export /gm, ''), { target: ts.ScriptTarget.ES2022 });
const context = vm.createContext({});
vm.runInContext(script('src/lib/search.ts') + script('src/lib/organizer.ts') + script('src/lib/desktopQuick.ts'), context);
const item = (name, path, scope, source, isHidden = false) => ({ entry: { name, path, isHidden }, scope, source });
const rows = [
  item('项目', 'C:/Desktop/项目.lnk', 'desktop', '个人桌面'),
  item('项目', 'c:/desktop/项目.lnk', 'mappings', '桌面映射'),
  item('报告.pdf', 'C:/Desktop/.nestra/客户资料/报告.pdf', 'zones', '客户资料'),
  item('作业.txt', 'D:/作业.txt', 'mappings', '仓库资料'),
  item('桌面配置', 'C:/Desktop/desktop.ini', 'desktop', '个人桌面', true),
];
const sources = (scope, query) => Array.from(context.desktopQuickResults(rows, scope, query), x => x.source);

test('blank query lists all three sources, hides system files and deduplicates Windows paths', () => {
  assert.deepEqual(new Set(sources('all', '')), new Set(['个人桌面', '客户资料', '仓库资料']));
  assert.equal(sources('all', '').length, 3);
});
test('search includes source name and exact names rank ahead of path-only matches', () => {
  assert.deepEqual(sources('zones', '  客户资料  '), ['客户资料']);
  assert.deepEqual(sources('mappings', '.LNK'), ['桌面映射']);
  assert.deepEqual(sources('desktop', '配置'), []);
  const matches = [item('旧版', 'D:/报告/旧版', 'mappings', '版本库'), ...rows];
  assert.equal(context.desktopQuickResults(matches, 'all', '报告')[0].entry.name, '报告.pdf');
});
test('dedicated global shortcut and tray route use a focusable popup, not the desktop layer or broad search', () => {
  const config = JSON.parse(file('src-tauri/tauri.conf.json'));
  const popup = config.app.windows.find(win => win.label === 'desktop-quick');
  assert.equal(popup.visible, false);
  assert.equal(popup.alwaysOnTop, true);
  assert.notEqual(popup.focus, false);
  assert.ok(JSON.parse(file('src-tauri/capabilities/default.json')).windows.includes(popup.label));
  assert.match(file('src/App.tsx'), /label === 'desktop-quick' \? <DesktopQuickWindow/);
  const native = file('src-tauri/src/lib.rs');
  assert.match(native, /HOTKEY_DESKTOP_QUICK: &str = "ctrl\+alt\+space"/);
  assert.match(native, /"desktop-quick" => session::open_desktop_quick\(&app\)/);
  assert.match(native, /"desktop-quick" => session::open_desktop_quick\(app\)/);
  assert.match(native, /HOTKEY_SEARCH: &str = "ctrl\+alt\+f"/);
});

test('card palette inherits theme/material/corners, has a dark default, and navigation is spatial', () => {
  assert.equal(context.desktopQuickAppearance().dark, true);
  const appearance = context.desktopQuickAppearance({ theme: 'light', cornerStyle: 'compact', surfaceMaterial: 'matte', panelOpacity: .75 });
  assert.equal(appearance.dark, false);
  assert.equal(appearance.radius, '8px');
  assert.equal(appearance.material, 'matte');
  assert.equal(appearance.opacity, .75);
  assert.equal(context.desktopQuickStep(1, 10, 4, 'ArrowDown'), 5);
  assert.equal(context.desktopQuickStep(5, 10, 4, 'ArrowRight'), 6);
  assert.equal(context.desktopQuickStep(9, 10, 4, 'ArrowDown'), 9);
});

test('real group identity, display name, empty groups and discovered storage stay independent', () => {
  const groups = [
    {id:'biz',name:'新版名称',dirName:'old-dir'},
    {id:'empty',name:'待整理',dirName:'empty-dir'},
    {id:'share',name:'共享资料',dirName:'',mappedPath:'D:/team'},
    {id:'docs',name:'桌面文档',dirName:'',sourceKind:'category',filter:'documents'},
  ];
  const desktop = [
    {id:'z1',name:'旧文件',path:'C:/Desktop/.nestra/OLD-DIR/a.txt',zone:'OLD-DIR',kind:'file'},
    {id:'z2',name:'恢复文件',path:'C:/Desktop/.nestra/recovered/a.txt',zone:'recovered',kind:'file'},
    {id:'t1',name:'桌面文件',path:'C:/Desktop/a.txt',kind:'file'},
    {id:'t2',name:'桌面文件夹',path:'C:/Desktop/abc',kind:'folder'},
  ];
  const locations = context.quickLocations(groups,desktop,[{dirName:'without-metadata',path:'C:/Desktop/.nestra/without-metadata'}]);
  const names = id => Array.from(context.quickLocationEntries(locations.find(p=>p.id===id),desktop),e=>e.name);
  assert.equal(locations.find(p=>p.id==='group:biz').title,'新版名称');
  assert.deepEqual(names('group:biz'),['旧文件']);
  assert.deepEqual(names('group:empty'),[]);
  assert.deepEqual(names('desktop'),['桌面文件','桌面文件夹']);
  assert.deepEqual(names('group:docs'),['桌面文件']);
  assert.equal(locations.find(p=>p.id==='group:share').path,'D:/team');
  assert.ok(locations.some(p=>p.id==='unconfigured:without-metadata'));
  assert.ok(locations.some(p=>p.id==='unconfigured:recovered'));
});
test('types and saved sort distinguish entering folders from launching entries', () => {
  const folder = {id:'folder',name:'Folder',kind:'folder'};
  const doc = {id:'doc',name:'A.txt',kind:'file'};
  const app = {id:'app',name:'A.lnk',kind:'shortcut'};
  assert.deepEqual([folder,doc,app,{kind:'shell'}].map(context.quickItemKind),['folder','file','app','system']);
  assert.equal(context.orderQuickLocation([doc,folder,app],[])[0].id,'folder');
  assert.equal(context.orderQuickLocation([doc,folder,app],['doc'])[0].id,'doc');
  assert.equal(context.quickPathKey('D:\\docs\\'),'d:/docs');
});

test('global searches leave capacity for explicitly entered folders', () => {
  assert.equal(context.quickScanBudget(0, false), 2);
  assert.equal(context.quickScanBudget(2, false), 0);
  assert.equal(context.quickScanBudget(2, true), 2);
  assert.equal(context.quickScanBudget(3, true), 1);
  assert.equal(context.quickScanBudget(4, true), 0);
});

test('keyboard Enter keeps the selected Windows path across late results', () => {
  const weak = item('2026 inventory.txt', 'X:/2026 inventory.txt', 'mappings', 'Archive');
  const strong = item('inventory.txt', 'Y:/inventory.txt', 'mappings', 'Inventory');
  const path = context.quickPathKey(weak.entry.path);
  const first = context.desktopQuickResults([weak], 'all', 'inventory');
  const reranked = context.desktopQuickResults([weak, strong], 'all', 'inventory');
  assert.equal(context.quickResultIndex(first, path), 0);
  assert.equal(context.quickResultIndex(reranked, path), 1);
  assert.equal(context.quickEnterResult(reranked, path).entry.path, weak.entry.path);
  assert.equal(context.quickEnterResult(reranked, null).entry.path, strong.entry.path);
  assert.equal(context.quickEnterResult([strong], path), undefined);
});

test('folder card clicks and Enter launch the original entry rather than scanning its children', async () => {
  const ui = file('src/features/DesktopQuickWindow.tsx');
  const activate = ui.match(/function activate\(entry: DesktopEntry\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(activate);
  assert.match(ui, /onClick=\{\(\) => activate\(entry\)\}/);
  assert.match(ui, /const item = quickEnterResult\(results, activePath\);[\s\S]*?activate\(item.entry\)/);
  const ctx = vm.createContext({ calls: [] });
  const launchEntry = file('src/lib/tauri.ts').match(/export function launchEntry\([\s\S]*?\n\}/)?.[0].replace(/^export /,'');
  assert.ok(launchEntry);
  vm.runInContext(ts.transpile(`
    const openEntry = (...args) => calls.push(args);
    const launch = (action) => action();
    ${launchEntry}
    ${activate}
    activate({ name: "Folder", kind: "folder", path: "C:/Test Folder", launchKind: "filesystem" });
    activate({ name: "Folder Shortcut", kind: "shortcut", path: "C:/Link.lnk", target: "D:/Target", launchKind: "filesystem" });
  `), ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.calls)), [
    ['C:/Test Folder', 'filesystem', true], ['C:/Link.lnk', 'filesystem', true],
  ]);
  assert.doesNotMatch(activate, /scanFolder|navigate/);
});
