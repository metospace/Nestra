import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";
const source = readFileSync(new URL("../src/stores/state.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("state.ts", source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "dropPaths");
const code = ts.transpile(fn.getText(ast).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });
function setup() {
  const moves = [], messages = [], migrations = [];
  const store = { customGroups: [{id: "zone", dirName: "Documents", name: "Documents"}], entries: [{id: "old", path: "C:/Desktop/test.lnk", target: "C:/Program Files/App/app.exe"}], launcherIds: [], launcherReferences: {} };
  const context = vm.createContext({ store,
    performFileChange: fn => fn(),
    moveToZone: async (path, dir) => { moves.push({path, dir}); return "C:/Desktop/.nestra/Documents/test.lnk"; },
    remappedId: (_entry, path) => `new:${path}`,
    migrateItemId: (oldId, newId) => migrations.push({oldId, newId}),
    isLauncher: id => store.launcherIds.includes(id),
    showStatus: message => messages.push(message),
    scheduleSave() {}, rescan: async () => {},
  });
  const model=readFileSync(new URL("../src/domain/sources.ts",import.meta.url),"utf8");
  vm.runInContext(ts.transpile(model.replace(/^import .*$/mg, "").replace(/^export /mg,""),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}),context);
  vm.runInContext(code, context);
  return { context, store, moves, messages, migrations };
}
test("external drop into a zone moves the shortcut file, not the application target", async () => {
  const t = setup();
  await t.context.dropPaths(["C:/Desktop/test.lnk"], "zone");
  assert.deepEqual(t.moves, [{path: "C:/Desktop/test.lnk", dir: "Documents"}]);
  assert.equal(t.migrations[0].oldId, "old");
});
test("launcher drops are explicit references and never move a file", async () => {
  const t = setup();
  await t.context.dropPaths(["C:/Desktop/test.lnk"], "launcher");
  assert.equal(t.moves.length, 0);
  assert.deepEqual(t.store.launcherIds, ["old"]);
  assert.match(t.messages[0], /原文件仍在桌面/);
});
test("a missed surface reports that no zone received the drop", async () => {
  const t = setup();
  await t.context.dropPaths(["C:/Desktop/test.lnk"], null);
  assert.equal(t.moves.length, 0);
  assert.match(t.messages[0], /未落入收纳区/);
});

test("mapping drop moves to the mapped directory instead of creating a storage zone", async () => {
  const t = setup(); t.store.customGroups[0].mappedPath = "D:/Work";
  t.context.moveToFolder = async (path, folder) => { t.moves.push({path, folder}); return "D:/Work/test.lnk"; };
  await t.context.dropPaths(["C:/Desktop/test.lnk"], "zone");
  assert.deepEqual(t.moves, [{path:"C:/Desktop/test.lnk",folder:"D:/Work"}]);
});
test("failed moves do not report collection success or migrate references", async () => {
  const t = setup();
  t.context.moveToZone = async () => { throw new Error("access denied"); };
  await t.context.dropPaths(["C:/Desktop/test.lnk"], "zone");
  assert.equal(t.migrations.length, 0);
  assert.match(t.messages[0], /0 项，1 项失败/);
});

test("read-only mappings and category views reject file drops without moving anything",async()=>{
 for(const source of [{mappedPath:"D:/Work",dropPolicy:"none"},{sourceKind:"category"}]){
  const t=setup();Object.assign(t.store.customGroups[0],source);await t.context.dropPaths(["C:/Desktop/test.lnk"],"zone");
  assert.equal(t.moves.length,0);assert.equal(t.migrations.length,0);assert.match(t.messages[0],/只浏览/);
 }
});
