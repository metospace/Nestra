import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { loadMoveReports } from './helpers/move-reports.mjs';
const source=readFileSync('src/domain/presentation.ts','utf8');
const c=vm.createContext({});vm.runInContext(ts.transpile(source.replace(/^import .*$/gm,'').replace(/^export /gm,''),{target:ts.ScriptTarget.ES2022}),c);
const global={surfaceMaterial:'glass',cornerStyle:'rounded',borderStyle:'subtle',panelOpacity:.9};
test('surface overrides inherit unspecified global fields without mutating global appearance',()=>{
 const layout={appearance:{panelOpacity:.65,backgroundColor:'#edf4ff'},iconSize:54,labelLines:3,itemGap:12};
 const style=c.surfaceVariables(layout,global);assert.equal(style['--panel-radius'],'22px');assert.equal(style['--panel-opacity'],'0.65');assert.equal(style['--item-icon-size'],'54px');assert.equal(style['--item-label-lines'],'3');assert.equal(style['--nestra-surface-rgb'],'237,244,255');assert.equal(global.panelOpacity,.9);
});
test('background colors provide readable text for bright and dark surfaces; invalid colors cannot become CSS',()=>{
 assert.equal(c.surfaceVariables({appearance:{backgroundColor:'#ffffff'}},global)['--nestra-text'],'#172337');
 assert.equal(c.surfaceVariables({appearance:{backgroundColor:'#101820'}},global)['--nestra-text'],'#eff4fc');
 assert.equal(c.surfaceVariables({appearance:{backgroundColor:'red;display:none'}},global)['--nestra-surface-rgb'],undefined);
});
test('reset to global appearance retains layout presentation and follows later global changes',()=>{
 const layout={iconSize:32,appearance:{cornerStyle:'square'}};assert.equal(c.surfaceVariables(layout,global)['--panel-radius'],'2px');delete layout.appearance;
 assert.equal(c.surfaceVariables(layout,{...global,cornerStyle:'compact'})['--panel-radius'],'8px');assert.equal(c.surfaceVariables(layout,global)['--item-icon-size'],'32px');
});
const storeSource=readFileSync('src/stores/state.ts','utf8'),ast=ts.createSourceFile('state.ts',storeSource,ts.ScriptTarget.Latest,true);
const selectionCode=ts.transpile(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['selectPanelItems','selectItem','setPanelPresentation','setSurfaceAppearance','batchMoveItems','useGlobalAppearanceForAll','clearSurfaceBackground'].includes(n.name?.text)).map(n=>n.getText(ast).replace(/^export /,'')).join('\n'),{target:ts.ScriptTarget.ES2022});
function setup(){const c=vm.createContext({store:{selectedItemIds:[],selectionPanel:'',selectionAnchor:'',panelLayouts:{a:{},b:{}},widgets:[]},updateLayout:(key,patch)=>Object.assign(c.store.panelLayouts[key],patch),scheduleSave(){},showStatus(){}});vm.runInContext(selectionCode,c);return c;}
test('Ctrl selection toggles and Shift selection respects the active source order',()=>{const c=setup(),order=['a','b','c','d'];c.selectItem('b','one',order,false,false);c.selectItem('d','one',order,false,true);assert.deepEqual(Array.from(c.store.selectedItemIds),['b','c','d']);c.selectItem('c','one',order,true,false);assert.deepEqual(Array.from(c.store.selectedItemIds),['b','d']);c.selectItem('a','two',order,true,true);assert.deepEqual(Array.from(c.store.selectedItemIds),['a']);});
test('one surface style never changes another surface; reset removes the override',()=>{const c=setup();c.setSurfaceAppearance('a',{panelOpacity:.5});assert.equal(c.store.panelLayouts.a.appearance.panelOpacity,.5);assert.equal(c.store.panelLayouts.b.appearance,undefined);c.setSurfaceAppearance('a',null);assert.equal(c.store.panelLayouts.a.appearance,undefined);});
test('presentation inputs are clamped to supported integer ranges',()=>{const c=setup();c.setPanelPresentation('a',{columns:100,iconSize:10,itemGap:40,labelLines:5});assert.deepEqual(JSON.parse(JSON.stringify(c.store.panelLayouts.a)),{columns:8,iconSize:24,itemGap:24,labelLines:3});});
test('bulk move runs serially and retains failed selection for retry',async()=>{const c=setup();Object.assign(c,loadMoveReports(),{rescan:async()=>{},sourceFor:()=>({writable:true})});c.store.customGroups=[{id:'target',dirName:'target',name:'Target'}];c.store.entries=['a','b','c'].map(id=>({id,path:id,name:id}));let inflight=0,max=0;c.moveItemOrThrow=async id=>{inflight++;max=Math.max(max,inflight);await Promise.resolve();inflight--;if(id==='b')throw Error('occupied');return id};c.store.selectionPanel='one';await c.batchMoveItems(['a','b','c'],'target');assert.equal(max,1);assert.deepEqual(Array.from(c.store.selectedItemIds),['b']);});

test('unifying global style removes overrides while retaining position, layout and file references',()=>{const c=setup();c.store.panelLayouts.a={x:50,width:320,iconSize:54,appearance:{panelOpacity:.5}};c.store.panelLayouts.b={x:420,locked:true,appearance:{backgroundColor:'#172337'}};c.store.launcherIds=['file:sample'];c.useGlobalAppearanceForAll();assert.deepEqual(JSON.parse(JSON.stringify(c.store.panelLayouts)),{a:{x:50,width:320,iconSize:54},b:{x:420,locked:true}});assert.deepEqual(Array.from(c.store.launcherIds),['file:sample']);});
test('following the theme clears just the background override, or an empty style object',()=>{const c=setup();c.store.panelLayouts.a.appearance={backgroundColor:'#172337',panelOpacity:.6};c.store.panelLayouts.b.appearance={backgroundColor:'#ffffff'};c.clearSurfaceBackground('a');assert.equal(c.store.panelLayouts.a.appearance.panelOpacity,.6);assert.equal(c.store.panelLayouts.a.appearance.backgroundColor,undefined);c.clearSurfaceBackground('b');assert.equal(c.store.panelLayouts.b.appearance,undefined);});
test('desktop settings stay visible beside edge panels and fit small viewports',()=>{for(const viewport of [{width:1920,height:1080},{width:800,height:600},{width:320,height:300}]){for(const panel of [{x:12,y:24,width:336},{x:viewport.width-300,y:viewport.height-160,width:336},{x:-2000,y:4000,width:336}]){const p=c.settingsPosition(panel,viewport);assert.ok(p.left>=12);assert.ok(p.top>=12);assert.ok(p.left+p.width<=viewport.width-12);assert.ok(p.maxHeight<=viewport.height-24);}}});
