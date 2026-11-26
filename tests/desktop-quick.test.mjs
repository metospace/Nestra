import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const file = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const script = path => ts.transpile(file(path).replace(/^import .*$/gm, '').replace(/^export /gm, ''), { target: ts.ScriptTarget.ES2022 });
const context = vm.createContext({});
vm.runInContext(script('src/lib/search.ts') + script('src/lib/desktopQuick.ts'), context);
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
