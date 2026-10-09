import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';

const script=readFileSync(new URL('../src/desktop/ItemTile.vue',import.meta.url),'utf8').split('<script setup lang="ts">')[1].split('</script>')[0];
const ast=ts.createSourceFile('tile.ts',script,ts.ScriptTarget.Latest,true);
const code=ts.transpile(ast.statements.filter(s=>!ts.isImportDeclaration(s)).map(s=>s.getText(ast)).join('\n'),{target:ts.ScriptTarget.ES2022});
function setup(isApplication=true){
 const calls=[],selections=[],props={entry:{id:'app:shortcut:C:/Desktop/App.lnk',path:'C:/Desktop/App.lnk',isApplication,name:'App'},panelKey:'zone:work',selectionOrder:['a','b']};
 const context=vm.createContext({defineProps:()=>props,computed:fn=>({get value(){return fn();}}),ref:value=>({value}),store:{statusMessage:''},
  selectItem:(...args)=>selections.push(args),selectPanelItems:(...args)=>selections.push(args),launchEntry:async entry=>calls.push(entry.path),window:{setTimeout(){}}});
 vm.runInContext(code,context);
 const event=patch=>({detail:1,ctrlKey:false,metaKey:false,shiftKey:false,...patch});
 return {context,calls,selections,props,event};
}
test('ordinary application clicks launch once and clear old selection',()=>{
 const t=setup();t.context.onSelect(t.event());assert.deepEqual(t.calls,['C:/Desktop/App.lnk']);assert.equal(t.selections[0][0],'zone:work');assert.equal(t.selections[0][1].length,0);
});
test('double-clicking a single-click application does not launch it twice',async()=>{
 const t=setup();t.context.onSelect(t.event());await Promise.resolve();
 t.context.onSelect(t.event({detail:2}));t.context.onOpen(t.event({detail:2}));assert.equal(t.calls.length,1);
});
test('Ctrl, Shift and Meta selections never launch an application',()=>{
 for(const key of ['ctrlKey','shiftKey','metaKey']){
  const t=setup(),event=t.event({[key]:true});t.context.onSelect(event);t.context.onOpen(event);
  assert.equal(t.calls.length,0);assert.equal(t.selections.length,1);assert.equal(t.selections[0][0],t.props.entry.id);
 }
});
test('regular files retain single-click selection and double-click opening',()=>{
 const t=setup(false);t.context.onSelect(t.event());assert.equal(t.calls.length,0);
 t.context.onOpen(t.event({detail:2}));assert.equal(t.calls.length,1);
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
