import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
const script = readFileSync(new URL('../src/desktop/ItemTile.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('ItemTile.tsx', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const activation = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'tileActivation');
const context = vm.createContext({});
vm.runInContext(ts.transpile(activation.getText(ast).replace(/^export /, ''), { target: ts.ScriptTarget.ES2022 }), context);
const event = patch => ({ detail: 1, ctrlKey: false, metaKey: false, shiftKey: false, ...patch });
test('ordinary application clicks open while ordinary file clicks select', () => {
 assert.equal(context.tileActivation(event(), true), 'open');
 assert.equal(context.tileActivation(event(), false), 'select');
});
test('double-clicking a single-click application never opens it twice', () => {
 assert.equal(context.tileActivation(event({ detail: 2 }), true), 'none');
 assert.equal(context.tileActivation(event({ detail: 2 }), true, true), 'none');
});
test('Ctrl, Shift and Meta selections never launch applications', () => {
 for (const key of ['ctrlKey', 'shiftKey', 'metaKey']) {
  assert.equal(context.tileActivation(event({ [key]: true }), true), 'select');
  assert.equal(context.tileActivation(event({ [key]: true }), true, true), 'none');
 }
});
test('regular files retain double-click opening and modifier double clicks do nothing', () => {
 assert.equal(context.tileActivation(event({ detail: 2 }), false, true), 'open');
 assert.equal(context.tileActivation(event({ detail: 2, ctrlKey: true }), false, true), 'none');
});
const stateSource=readFileSync(new URL('../src/stores/state.ts',import.meta.url),'utf8');
const stateAst=ts.createSourceFile('state.ts',stateSource,ts.ScriptTarget.Latest,true);
const migration=stateAst.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='hideLegacyLauncher');
test('new launcher layouts start hidden and already carry the upgrade marker',()=>{
 const initializer=stateAst.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='ensureLauncherLayout');
 const store={displays:[],panelLayouts:{'system:search':{}}};
 const context=vm.createContext({store,LAUNCHER_PANEL_KEY:'system:launcher',DESKTOP_SEARCH_KEY:'system:search',window:{innerWidth:1000,innerHeight:700}});
 vm.runInContext(ts.transpile(initializer.getText(stateAst),{target:ts.ScriptTarget.ES2022}),context);context.ensureLauncherLayout();
 assert.equal(store.panelLayouts['system:launcher'].visible,false);assert.equal(store.panelLayouts['system:launcher'].launcherVisibilityMigrated,true);
});
test('launcher is hidden once on upgrade while its references and later restore are retained',()=>{
 const layout={visible:true,x:100,y:100},store={panelLayouts:{'system:launcher':layout},launcherIds:['app']};
 const context=vm.createContext({store,LAUNCHER_PANEL_KEY:'system:launcher'});
 vm.runInContext(ts.transpile(migration.getText(stateAst),{target:ts.ScriptTarget.ES2022}),context);
 assert.equal(context.hideLegacyLauncher(),true);assert.equal(layout.visible,false);assert.equal(layout.launcherVisibilityMigrated,true);assert.deepEqual(store.launcherIds,['app']);
 layout.visible=true;assert.equal(context.hideLegacyLauncher(),false);assert.equal(layout.visible,true);
});
