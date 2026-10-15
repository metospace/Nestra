import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const context=vm.createContext({structuredClone,crypto});
for(const path of ['src/domain/sources.ts','src/domain/configuration.ts']){
 const source=readFileSync(path,'utf8');const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
 const code=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(ast).replace(/^export /,'')).join('\n');
 vm.runInContext(ts.transpile(code,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}),context);
}
const config=()=>({schemaVersion:1,customGroups:[{id:'zone',name:'文档',dirName:'文档'},{id:'map',name:'工作资料',dirName:'D:/Work',mappedPath:'D:/Work'}],tabGroups:[{id:'work',name:'工作',groupIds:['zone','map'],activeGroupId:'map'}],panelLayouts:{'zone:zone':{x:30,y:90,width:320,height:380,zIndex:2,visible:true}},widgets:[],launcherIds:['file:D:/offline/file.txt'],foldedItems:{},itemOrders:{},appearance:{surfaceMaterial:'matte',cornerStyle:'standard',borderStyle:'subtle',panelOpacity:.95},startWithWindows:true});
test('visual upgrade runs once, preserving independent styles, file references and later user choices',()=>{
 const old=config();old.panelLayouts['zone:zone'].appearance={surfaceMaterial:'clear',backgroundColor:'#ffffff'};
 const next=context.migrateConfiguration(old);
 assert.equal(next.appearance.theme,'dark');assert.equal(next.appearance.surfaceMaterial,'glass');assert.equal(next.appearance.styleVersion,1);
 assert.deepEqual(JSON.parse(JSON.stringify(next.panelLayouts['zone:zone'])),old.panelLayouts['zone:zone']);
 assert.deepEqual(Array.from(next.launcherIds),old.launcherIds);
 next.appearance.theme='light';next.appearance.surfaceMaterial='matte';next.appearance.panelOpacity=.6;
 const later=context.migrateConfiguration(next);assert.deepEqual(JSON.parse(JSON.stringify(later.appearance)),JSON.parse(JSON.stringify(next.appearance)));
 assert.equal(old.appearance.styleVersion,undefined);
});

test('existing owned directories recover even when their configuration is missing', () => {
 const zones=[{dirName:'AI IDE'},{dirName:'开发工具'},{dirName:'Empty'}];
 const groups=context.reconcileStorageZones([],zones);
 assert.deepEqual(Array.from(groups,g=>g.dirName),zones.map(z=>z.dirName));
 assert.ok(groups.every(g=>g.sourceKind==='zone'&&g.dropPolicy==='move'));
 const otherWindow=context.reconcileStorageZones([],zones);
 assert.deepEqual(Array.from(groups,g=>g.id),Array.from(otherWindow,g=>g.id));
 assert.equal(context.reconcileStorageZones(groups,zones).length,3);
});

test('directory recovery preserves existing identities and does not confuse mappings or categories with owned zones', () => {
 const groups=[{id:'original',name:'我的工具',dirName:'AI IDE'},
   {id:'mapping',name:'Mapping',dirName:'开发工具',mappedPath:'D:/Tools'},
   {id:'category',name:'Category',dirName:'Empty',sourceKind:'category'}];
 const before=JSON.stringify(groups);
 const recovered=context.reconcileStorageZones(groups,[{dirName:'ai ide'},{dirName:'开发工具'},{dirName:'Empty'},{dirName:'EMPTY'}]);
 assert.equal(JSON.stringify(groups),before);
 assert.equal(recovered.length,5);
 assert.equal(recovered[0],groups[0]);
 assert.equal(recovered[0].name,'我的工具');
 assert.equal(recovered.filter(g=>!g.mappedPath&&g.sourceKind!=='category'&&g.dirName.toLowerCase()==='empty').length,1);
});
test('schema migration preserves old moves and stable identities, keeps offline references and independent group layout',()=>{
 const old=config(),before=JSON.stringify(old),next=context.migrateConfiguration(old);
 assert.equal(JSON.stringify(old),before);assert.equal(next.schemaVersion,2);assert.equal(next.customGroups[1].dropPolicy,'move');assert.equal(next.customGroups[1].id,'map');assert.ok(next.launcherReferences[old.launcherIds[0]]);assert.deepEqual(JSON.parse(JSON.stringify(next.panelLayouts['tabs:work'])),old.panelLayouts['zone:zone']);
 next.panelLayouts['tabs:work'].x=800;assert.equal(next.panelLayouts['zone:zone'].x,30);
});
test('configuration restore preserves owned directories, all absent sources and native autostart',()=>{
 const current=config(),incoming=config();incoming.customGroups=[{id:'zone',name:'别名',dirName:'other',mappedPath:'D:/Other'},{id:'new',name:'新',dirName:'新'}];incoming.startWithWindows=false;
 const next=context.prepareRestore(current,incoming);assert.equal(next.customGroups.find(g=>g.id==='zone').dirName,'文档');assert.equal(next.customGroups.find(g=>g.id==='zone').mappedPath,undefined);assert.ok(next.customGroups.find(g=>g.id==='map'));assert.ok(next.customGroups.find(g=>g.id==='new'));assert.equal(next.startWithWindows,true);assert.equal(next.coexistMigrated,true);
});
test('imports reject unsupported versions, dangerous nested keys, invalid layouts and malformed todo data',()=>{
 for(const mutate of [c=>c.schemaVersion=3,c=>c.panelLayouts.x={x:1,y:1,width:0,height:10,zIndex:1},c=>c.launcherReferences=JSON.parse('{"__proto__":{}}'),c=>c.widgets=[{id:'w',kind:'todo',title:'待办',content:'',layout:c.panelLayouts['zone:zone'],todos:[{id:'t',text:42,completed:false}]}],c=>c.customGroups[0].dirName='../outside',c=>c.tabGroups.push({...c.tabGroups[0]})]){const c=config();mutate(c);assert.throws(()=>context.validateConfiguration(c));}
});
test('new mappings and category views distinguish browse-only policy from legacy move behavior',()=>{
 assert.equal(context.sourceFor({id:'x',name:'目录',mappedPath:'D:/Work',dropPolicy:'none'}).writable,false);
 assert.equal(context.sourceFor({id:'x',name:'目录',mappedPath:'D:/Work',dropPolicy:'move'}).writable,true);
 assert.equal(context.sourceFor({id:'x',name:'分类',sourceKind:'category'}).writable,false);
});

test('surface styling and item presentation round-trip, invalid per-surface settings reject imports',()=>{
 const c=config();Object.assign(c.panelLayouts['zone:zone'],{iconSize:48,itemGap:10,labelLines:3,appearance:{surfaceMaterial:'glass',panelOpacity:.7,backgroundColor:'#172337'}});context.validateConfiguration(c);const next=context.prepareRestore(config(),c);assert.equal(next.panelLayouts['zone:zone'].appearance.backgroundColor,'#172337');assert.equal(next.panelLayouts['zone:zone'].iconSize,48);
 for(const patch of [{iconSize:Infinity},{labelLines:0},{itemGap:-2},{appearance:{panelOpacity:2}},{appearance:{backgroundColor:'red;display:none'}}]){const bad=config();Object.assign(bad.panelLayouts['zone:zone'],patch);assert.throws(()=>context.validateConfiguration(bad));}
});

test('restoring a directory from a backup with an old identity reconnects the existing owner',()=>{
 const current=config(),incoming=config();incoming.customGroups[0].id='old-zone';incoming.tabGroups[0].groupIds[0]='old-zone';incoming.tabGroups[0].activeGroupId='old-zone';incoming.panelLayouts['zone:old-zone']=incoming.panelLayouts['zone:zone'];delete incoming.panelLayouts['zone:zone'];
 const next=context.prepareRestore(current,incoming);assert.equal(next.customGroups.filter(g=>g.dirName==='文档').length,1);assert.equal(next.tabGroups[0].activeGroupId,'zone');assert.ok(next.panelLayouts['zone:zone']);assert.equal(next.panelLayouts['zone:old-zone'],undefined);
});
