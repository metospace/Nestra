import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync('src/stores/state.ts','utf8');
const ast=ts.createSourceFile('state.ts',source,ts.ScriptTarget.Latest,true);
const configAst=ts.createSourceFile('configuration.ts',readFileSync('src/domain/configuration.ts','utf8'),ts.ScriptTarget.Latest,true);
const configCode=configAst.statements.filter(node=>ts.isFunctionDeclaration(node)&&['migrateConfiguration','reconcileStorageZones'].includes(node.name?.text)
  ||ts.isVariableStatement(node)&&node.getText(configAst).includes('FROST_APPEARANCE')).map(node=>node.getText(configAst).replace(/^export /,''));
const stateCode=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&['restoreState','recoverStorageZones'].includes(node.name?.text))
  .map(node=>node.getText(ast).replaceAll('(await import("@/lib/tauri"))','api'));
const code=ts.transpile([...configCode,...stateCode].join('\n'),{target:ts.ScriptTarget.ES2022});
function setup(load){
 let saves=0;const messages=[];
 const c=vm.createContext({structuredClone,referenceFromId:()=>undefined,lastSynced:null,
  store:{customGroups:[],persistenceBlocked:false},loadPersistedState:load,
  api:{listStorageZones:async()=>[{dirName:'AI IDE'},{dirName:'开发工具'}],backupConfiguration:async()=>{}},
  scheduleSave:()=>saves++,showStatus:message=>messages.push(message),
  applyPersisted:state=>Object.assign(c.store,state)});
 vm.runInContext(code,c);return {c,get saves(){return saves},messages};
}

test('corrupt configuration with no backup still shows owned files without overwriting the damaged original',async()=>{
 const t=setup(async()=>{throw new Error('配置已损坏')});
 await t.c.restoreState();await t.c.recoverStorageZones();
 assert.equal(t.c.store.persistenceBlocked,true);assert.equal(t.saves,0);
 assert.deepEqual(Array.from(t.c.store.customGroups,g=>g.dirName),['AI IDE','开发工具']);
 assert.ok(t.messages[0].includes('已停止写入'));
});

test('missing configuration reconnects physical zones once with the same identities in both windows',async()=>{
 const first=setup(async()=>null),second=setup(async()=>null);
 for(const t of [first,second]){await t.c.restoreState();await t.c.recoverStorageZones();await t.c.recoverStorageZones();assert.equal(t.saves,1);}
 assert.deepEqual(Array.from(first.c.store.customGroups,g=>g.id),Array.from(second.c.store.customGroups,g=>g.id));
});

test('an older valid backup preserves its owned directory identity while recovering newer physical zones',async()=>{
 const persisted={schemaVersion:2,coexistMigrated:true,appearance:{styleVersion:1},customGroups:[{id:'user-id',name:'常用 IDE',dirName:'AI IDE',sourceKind:'zone'}],launcherIds:[]};
 const t=setup(async()=>persisted);await t.c.restoreState();await t.c.recoverStorageZones();
 assert.equal(t.c.store.customGroups[0].id,'user-id');assert.equal(t.c.store.customGroups[0].name,'常用 IDE');
 assert.equal(t.c.store.customGroups.length,2);assert.equal(t.saves,1);assert.equal(t.c.lastSynced,persisted);
});
