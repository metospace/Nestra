import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";

const source = readFileSync(new URL("../src/lib/organizer.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("organizer.ts", source, ts.ScriptTarget.Latest, true);
const code = ts.transpile(ast.statements.filter(s => !ts.isImportDeclaration(s)).map(s => s.getText(ast).replace(/^export /, "")).join("\n"), { target: ts.ScriptTarget.ES2022 });
const c = vm.createContext({runStateMutation: fn => fn(), isExitFrozen: () => false, }); vm.runInContext(code, c);
test("mapping membership uses immediate parent and Windows path casing", () => {
  assert.equal(c.inFolder("D:/Work/Photo.JPG", "d:\\work\\"), true);
  assert.equal(c.inFolder("D:/Work-old/Photo.JPG", "D:/Work"), false);
  assert.equal(c.inFolder("D:/Work/nested/Photo.JPG", "D:/Work"), false);
});
test("category filters never classify folders by their suffix", () => {
  assert.equal(c.matchesFilter({kind:"folder", path:"D:/photo.png"}, "images"), false);
  assert.equal(c.matchesFilter({kind:"file", path:"D:/PHOTO.PNG"}, "images"), true);
  assert.equal(c.matchesFilter({kind:"file", path:"D:/report.xlsx"}, "documents"), true);
  assert.equal(c.matchesFilter({kind:"shortcut", path:"D:/editor.lnk"}, "applications"), true);
  assert.equal(c.matchesFilter({kind:"file", path:"D:/report.xlsx"}, "media"), false);
});

const storeSource = readFileSync(new URL("../src/stores/state.ts", import.meta.url), "utf8");
const storeAst = ts.createSourceFile("state.ts", storeSource, ts.ScriptTarget.Latest, true);
const functions = storeAst.statements.filter(s => ts.isFunctionDeclaration(s) && ["removeCustomGroup", "renameCustomGroup"].includes(s.name?.text));
const storeCode = ts.transpile(functions.map(s => s.getText(storeAst).replace(/^export /, "")).join("\n"), {target:ts.ScriptTarget.ES2022});
function mappingContext() {
  const actions = [];
  const store = {customGroups:[{id:"map",name:"Pictures",dirName:"D:/Pictures",mappedPath:"D:/Pictures"}],panelLayouts:{},foldedItems:{},itemOrders:{}};
  const context = vm.createContext({runStateMutation: fn => fn(), isExitFrozen: () => false, store,persistChain:Promise.resolve(),performFileChange:fn=>fn(),migratePathReferences(){},confirmDialog:async()=>true,dissolveZone:async()=>actions.push("dissolve"),renameZoneDir:async()=>actions.push("rename directory"),zonePanelKey:id=>`zone:${id}`,ensurePanels(){},scheduleSave(){},rescan:async()=>{},showStatus(){}});
  vm.runInContext(storeCode,context); return {context,store,actions};
}
test("removing a mapping never dissolves or moves its directory",async()=>{
  const t=mappingContext(); await t.context.removeCustomGroup("map");
  assert.equal(t.store.customGroups.length,0); assert.deepEqual(t.actions,[]);
});
test("renaming a mapping changes only the view title",async()=>{
  const t=mappingContext(); await t.context.renameCustomGroup("map","Photos");
  assert.equal(t.store.customGroups[0].name,"Photos");
  assert.equal(t.store.customGroups[0].mappedPath,"D:/Pictures"); assert.deepEqual(t.actions,[]);
});

test("zone deletion returns files before removing layout and group state",async()=>{
 const t=mappingContext();delete t.store.customGroups[0].mappedPath;
 t.store.panelLayouts['zone:map']={visible:true};
 let finish;const returned=new Promise(resolve=>finish=resolve);
 t.context.dissolveZone=async()=>{assert.equal(t.store.customGroups.length,1);await returned;return {moves:[],error:null};};
 const deletion=t.context.removeCustomGroup('map');await Promise.resolve();
 assert.equal(t.store.customGroups.length,1);assert.ok(t.store.panelLayouts['zone:map']);
 finish();await deletion;assert.equal(t.store.customGroups.length,0);assert.equal(t.store.panelLayouts['zone:map'],undefined);
});
test("failed or cancelled zone deletion retains the group and its layout",async()=>{
 for(const cancelled of [true,false]){
  const t=mappingContext();delete t.store.customGroups[0].mappedPath;t.store.panelLayouts['zone:map']={visible:true};
  t.context.confirmDialog=async()=>!cancelled;
  t.context.dissolveZone=async()=>{t.actions.push('dissolve');throw Error('locked file');};
  await t.context.removeCustomGroup('map');assert.equal(t.store.customGroups.length,1);assert.ok(t.store.panelLayouts['zone:map']);
  assert.equal(t.actions.length,cancelled?0:1);
 }
});

const scanFn = storeAst.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === "scanAllEntries");
const scanCode = ts.transpile(scanFn.getText(storeAst), {target:ts.ScriptTarget.ES2022});
test("launcher reference is restored without its previous folder mapping", async () => {
  const entry = {id:"file:D:/Work/a.txt", path:"D:/Work/a.txt"};
  const context = vm.createContext({runStateMutation: fn => fn(), isExitFrozen: () => false, store:{entries:[],customGroups:[],launcherIds:[entry.id]},scanDesktop:async()=>[],scanPaths:async paths=>{assert.deepEqual(Array.from(paths),[entry.path]); return [entry];}});
  vm.runInContext(scanCode,context);
  assert.deepEqual(Array.from(await context.scanAllEntries()),[entry]);
});
test("temporarily unavailable mapping retains previous entries for retry", async () => {
  const entry = {id:"file:D:/Work/a.txt",path:"D:/Work/a.txt"};
  const mappingErrors = {};
  const context = vm.createContext({runStateMutation: fn => fn(), isExitFrozen: () => false, store:{entries:[entry],customGroups:[{id:"map",mappedPath:"D:/Work"}],launcherIds:[]},mappingErrors,inFolder:c.inFolder,scanDesktop:async()=>[],scanFolder:async()=>{throw Error("unavailable");}});
  vm.runInContext(scanCode,context);
  assert.equal((await context.scanAllEntries())[0],entry);
  assert.match(mappingErrors.map,/unavailable/);
});
