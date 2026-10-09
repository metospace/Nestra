import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";

// Exercise the production persistence functions without starting a desktop window.
const source = readFileSync(new URL("../src/stores/state.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("state.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["snapshotFromStore", "mergePersisted", "applyPersisted"]);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(functions.length, names.size);
const code = ts.transpile(functions.map(node => node.getText(ast)).join("\n"), { target: ts.ScriptTarget.ES2022 });
function setup() {
  const store = { panelLayouts: {}, customGroups: [], tabGroups: [], foldedItems: {}, itemOrders: {}, widgets: [], appearance: {}, launcherIds: [], startWithWindows: false, hideNativeIcons: false };
  const context = vm.createContext({ store, DEFAULT_APPEARANCE: {}, suppressPersistWatch: false, zCounter: 0 });
  vm.runInContext(code, context);
  return context;
}
const plain = value => JSON.parse(JSON.stringify(value));

test("receiving an existing layout never schedules a broadcast back to the other window", () => {
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ensureLayouts");
  const layoutCode = ts.transpile(fn.getText(ast), { target: ts.ScriptTarget.ES2022 });
  let saves = 0;
  const context = vm.createContext({
    store: { displays: [], panels: [{ key: "zone:one" }], panelLayouts: { "zone:one": { x: 20, y: 20 } } },
    window: { screen: { width: 1920 }, innerWidth: 1920 },
    SCREEN_MARGIN: 18, PANEL_WIDTH: 336, PANEL_GAP: 20, PANEL_HEIGHT: 432,
    LAUNCHER_PANEL_KEY: "system:launcher", zCounter: 0, scheduleSave: () => { saves++; },
  });
  vm.runInContext(layoutCode, context);
  context.ensureLayouts(); context.ensureLayouts();
  assert.equal(saves, 0);
  context.store.panels.push({ key: "zone:two" });
  context.ensureLayouts();
  assert.equal(saves, 1);
  context.ensureLayouts();
  assert.equal(saves, 1);
});

test("mapping paths, formal tab groups, active tab and filters survive persistence", () => {
  const c = setup(); const state = c.snapshotFromStore();
  state.customGroups = [
    {id:"map",name:"Photos",dirName:"D:/Photos",mappedPath:"D:/Photos",filter:"images"},
    {id:"zone",name:"Inbox",dirName:"Inbox",filter:"documents"},
  ];
  state.tabGroups = [{id:"tabs",name:"Work",groupIds:["map","zone"],activeGroupId:"zone"}];
  c.applyPersisted(state);
  assert.deepEqual(plain(c.store.customGroups), plain(state.customGroups));
  assert.deepEqual(plain(c.store.tabGroups), plain(state.tabGroups));
});

test("tab groups created in different windows are retained by three-way merge", () => {
  const c = setup(); const base = c.snapshotFromStore();
  const local = plain(base), remote = plain(base);
  local.tabGroups.push({id:"local-tabs",name:"Local",groupIds:[],activeGroupId:""});
  remote.tabGroups.push({id:"remote-tabs",name:"Remote",groupIds:[],activeGroupId:""});
  assert.deepEqual(plain(c.mergePersisted(base, local, remote).tabGroups).map(item => item.id), ["local-tabs", "remote-tabs"]);
});

test("nested store changes do not mutate a captured save snapshot", () => {
  const c = setup();
  c.store.panelLayouts.zone = { x: 10 };
  c.store.customGroups.push({ id: "one", name: "One", dirName: "One" });
  const before = c.snapshotFromStore();
  c.store.panelLayouts.zone.x = 99;
  c.store.customGroups[0].name = "Changed";
  assert.equal(before.panelLayouts.zone.x, 10);
  assert.equal(before.customGroups[0].name, "One");
});

test("applying saved state does not alias the merge baseline", () => {
  const c = setup();
  const baseline = c.snapshotFromStore();
  baseline.panelLayouts.zone = { x: 10 };
  baseline.widgets.push({ id: "note", layout: { x: 10 } });
  c.applyPersisted(baseline);
  c.store.panelLayouts.zone.x = 99;
  c.store.widgets[0].layout.x = 99;
  assert.equal(baseline.panelLayouts.zone.x, 10);
  assert.equal(baseline.widgets[0].layout.x, 10);
});

test("two windows creating zones keep both additions", () => {
  const c = setup();
  const base = c.snapshotFromStore();
  const local = plain(base), remote = plain(base);
  local.customGroups.push({ id: "local", dirName: "Local" });
  remote.customGroups.push({ id: "remote", dirName: "Remote" });
  assert.deepEqual(plain(c.mergePersisted(base, local, remote).customGroups).map(g => g.id), ["local", "remote"]);
});

test("a zone created during save IPC survives applying the save result", () => {
  const c = setup();
  const captured = c.snapshotFromStore();
  const merged = plain(captured);
  merged.customGroups.push({ id: "remote", dirName: "Remote" });
  c.store.customGroups.push({ id: "in-flight", dirName: "In flight" });
  c.applyPersisted(c.mergePersisted(captured, c.snapshotFromStore(), merged));
  assert.deepEqual(plain(c.store.customGroups).map(g => g.id), ["in-flight", "remote"]);
});


test("save completion keeps the layout object used by an active drag", () => {
  const c = setup();
  c.store.panelLayouts.zone = { x: 10, y: 20 };
  const draggingLayout = c.store.panelLayouts.zone;
  const saved = c.snapshotFromStore();
  c.applyPersisted(saved);
  draggingLayout.x = 240;
  draggingLayout.y = 180;
  assert.equal(c.store.panelLayouts.zone, draggingLayout);
  assert.equal(c.snapshotFromStore().panelLayouts.zone.x, 240);
  assert.equal(saved.panelLayouts.zone.x, 10);
});

test("save completion preserves widget drag identity without aliasing disk state", () => {
  const c = setup();
  c.store.widgets.push({ id: "note", layout: { x: 10 } });
  const draggingLayout = c.store.widgets[0].layout;
  const saved = c.snapshotFromStore();
  c.applyPersisted(saved);
  draggingLayout.x = 240;
  assert.equal(c.store.widgets[0].layout, draggingLayout);
  assert.equal(c.snapshotFromStore().widgets[0].layout.x, 240);
  assert.equal(saved.widgets[0].layout.x, 10);
});

test("shortcut removals and ordering survive concurrent reference additions",()=>{
 const c=setup(),base=c.snapshotFromStore();base.launcherIds=["a","b"];base.launcherReferences={a:{id:"a"},b:{id:"b"}};base.launchCollections=[{id:"work",name:"Work",entryIds:["a","b"]}];
 const local=plain(base),remote=plain(base);local.launcherIds=["b"];delete local.launcherReferences.a;remote.launcherIds.push("c");remote.launcherReferences.c={id:"c"};remote.launchCollections.push({id:"new",name:"New",entryIds:["c"]});
 const merged=c.mergePersisted(base,local,remote);assert.deepEqual(plain(merged.launcherIds),["b","c"]);assert.equal(merged.launcherReferences.a,undefined);assert.equal(merged.launchCollections.length,2);
 const reordered=plain(base);reordered.launcherIds=["b","a"];assert.deepEqual(plain(c.mergePersisted(base,reordered,base).launcherIds),["b","a"]);
});

test("remote recovery clears an obsolete monitor displacement while retaining drag object identity",()=>{
 const c=setup();c.store.panelLayouts.zone={x:20,displacedFrom:{monitorId:"offline"}};const existing=c.store.panelLayouts.zone;const incoming=c.snapshotFromStore();delete incoming.panelLayouts.zone.displacedFrom;c.applyPersisted(incoming);assert.equal(c.store.panelLayouts.zone,existing);assert.equal(existing.displacedFrom,undefined);
});

test('Rust-sorted disk keys do not turn a style reset into a conflicting remote edit',()=>{
 const c=setup(),base=c.snapshotFromStore();base.panelLayouts.zone={x:20,y:30,zIndex:2,appearance:{surfaceMaterial:'glass',panelOpacity:.7}};
 const local=plain(base);delete local.panelLayouts.zone.appearance;
 const canonical=value=>JSON.parse(JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v));
 const disk=canonical(base);assert.notEqual(JSON.stringify(disk.panelLayouts.zone),JSON.stringify(base.panelLayouts.zone));
 const merged=c.mergePersisted(base,local,disk);assert.equal(merged.panelLayouts.zone.appearance,undefined);assert.equal(merged.panelLayouts.zone.x,20);
 const reordered=plain(base);reordered.appearance={panelOpacity:.95,cornerStyle:'standard'};const changed=plain(reordered);changed.appearance.cornerStyle='rounded';const outcome=c.mergePersisted(reordered,canonical(reordered),changed);assert.equal(outcome.appearance.cornerStyle,'rounded');
});

function todoState(context) {
 const state=context.snapshotFromStore();
 state.widgets=[{id:'tasks',kind:'todo',title:'待办',content:'',layout:{x:10,y:20},todos:[{id:'a',text:'资料',completed:false},{id:'b',text:'评审',completed:false}]}];
 return state;
}
test('desktop and manager retain independent task edits and additions in one widget',()=>{
 const c=setup(),base=todoState(c),local=plain(base),remote=plain(base);
 local.widgets[0].todos[0].completed=true;
 local.widgets[0].todos.push({id:'desktop-added',text:'桌面新增',completed:false});
 remote.widgets[0].todos[1].text='更新评审资料';
 remote.widgets[0].todos.push({id:'manager-added',text:'应用新增',completed:false});
 const todos=plain(c.mergePersisted(base,local,remote).widgets[0].todos);
 assert.deepEqual(todos.map(t=>t.id),['a','b','desktop-added','manager-added']);
 assert.equal(todos[0].completed,true);assert.equal(todos[1].text,'更新评审资料');
});
test('a task deletion survives concurrent widget movement and same-task conflicts converge remotely',()=>{
 const c=setup(),base=todoState(c),local=plain(base),remote=plain(base);
 local.widgets[0].todos=local.widgets[0].todos.filter(t=>t.id!=='a');
 local.widgets[0].todos[0].text='本地修改';
 remote.widgets[0].layout.x=250;
 remote.widgets[0].todos[1].text='远端修改';
 const widget=plain(c.mergePersisted(base,local,remote).widgets[0]);
 assert.deepEqual(widget.todos,[{id:'b',text:'远端修改',completed:false}]);assert.equal(widget.layout.x,250);
});
test('a deleted todo widget is not revived by nested task merging',()=>{
 const c=setup(),base=todoState(c),local=plain(base),remote=plain(base);
 local.widgets=[];remote.widgets[0].todos.push({id:'new',text:'新增',completed:false});
 assert.deepEqual(plain(c.mergePersisted(base,local,remote).widgets),[]);
});
