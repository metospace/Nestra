import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
import { loadMoveReports } from './helpers/move-reports.mjs';
function functions(path,names) {
  const source=readFileSync(path,'utf8').replace(/^[\s\S]*?<script setup lang="ts">/,'').replace(/<\/script>[\s\S]*$/,'');
  const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
  return ts.transpile(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)).map(n=>n.getText(ast).replace(/^export /,'')).join('\n'),{target:ts.ScriptTarget.ES2022});
}
test('async result enrichment preserves the latest keyboard selection and expands visible rows',async()=>{
  let callback,partial,finish;
  const source=readFileSync('src/features/SearchPanel.tsx','utf8');
  const ast=ts.createSourceFile('SearchPanel.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const effects=[];
  function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect')effects.push(node.arguments[0]);ts.forEachChild(node,visit)}
  visit(ast);
  const searchEffect=effects.find(node=>node.getText(ast).includes('searchWithDetails'));
  const resetEffect=effects.find(node=>node.getText(ast).includes('setVisibleCount(24)'));
  assert.ok(searchEffect&&resetEffect,'Exercise the production search and reset effects');
  const c=vm.createContext({visibleCount:24,results:[],active:0,message:'',loading:false,query:'a',scope:'all',resultsRef:{current:[]},activeRef:{current:0},revision:{current:0},window:{clearTimeout(){},setTimeout:fn=>{callback=fn;return 1;}},searchWithDetails:async(_query,_scope,apply)=>{partial=apply;apply({entries:[{id:'a'},{id:'b'}],message:'local'});return new Promise(resolve=>finish=resolve)}});
  c.setResults=value=>{c.results=value;c.resultsRef.current=value};
  c.setActive=value=>{c.active=value;c.activeRef.current=value};
  c.setMessage=value=>{c.message=value};c.setLoading=value=>{c.loading=value};
  c.setVisibleCount=value=>{c.visibleCount=typeof value==='function'?value(c.visibleCount):value};
  vm.runInContext(ts.transpile(`globalThis.runSearchEffect = (${searchEffect.getText(ast)});globalThis.resetSearchResults = (${resetEffect.getText(ast)});`,{target:ts.ScriptTarget.ES2022}),c);
  let cancel=c.runSearchEffect();const pending=callback();c.setActive(1);
  partial({entries:[{id:'c'},{id:'a'},{id:'b'}],message:'partial'});assert.equal(c.active,2);
  finish({entries:[...Array.from({length:30},(_,i)=>({id:`more-${i}`})),{id:'b'}],message:'final'});await pending;
  assert.equal(c.results[c.active].id,'b');assert.equal(c.visibleCount,31);
  // Refresh re-runs only the search effect, retaining selection and expanded rows.
  cancel();cancel=c.runSearchEffect();assert.equal(c.results[c.active].id,'b');assert.equal(c.visibleCount,31);
  // A query/scope change also runs the reset effect; cancelled searches cannot repopulate it.
  cancel();c.query='new';c.resetSearchResults();cancel=c.runSearchEffect();assert.equal(c.active,0);assert.equal(c.results.length,0);
  partial({entries:[{id:'stale'}],message:'stale'});assert.equal(c.results.length,0);cancel();
});
test('only failed moves are retried, with complete errors and session history retained',async()=>{
  const m=loadMoveReports();let failing=true;const calls=[];
  const tasks=['a','b','c'].map(path=>({name:path,path,run:async()=>{calls.push(path);if(path!=='a'&&failing)throw Error(`occupied-${path}`);}}));
  const report=await m.trackFileMoves('Zone',tasks,async()=>{});
  assert.equal(report.items[1].error,'Error: occupied-b');assert.equal(report.items[2].error,'Error: occupied-c');
  failing=false;await m.retryFailedMoves();assert.deepEqual(calls,['a','b','c','b','c']);
  assert.ok(report.items.every(item=>item.state==='success'));
  await m.trackFileMoves('Second',tasks.slice(0,1),async()=>{});assert.equal(m.fileMoves.reports.length,2);
});
test('refresh failures never turn a successful native move into a retryable failure',async()=>{
  const m=loadMoveReports();let moves=0;
  const report=await m.trackFileMoves('Zone',[{name:'a',path:'a',run:async()=>moves++}],async()=>{throw Error('scan failed');});
  assert.equal(report.items[0].state,'success');assert.match(report.warning,/scan failed/);await m.retryFailedMoves();assert.equal(moves,1);
});
test('retrying an older report refreshes that report rather than the most recent operation',async()=>{
 const m=loadMoveReports(),finished=[];let occupied=true;
 const first=await m.trackFileMoves('first',[{name:'a',path:'a',run:async()=>{if(occupied)throw Error('locked')}}],async report=>finished.push(report.id));
 const second=await m.trackFileMoves('second',[{name:'b',path:'b',run:async()=>{}}],async report=>finished.push(report.id));
 occupied=false;m.fileMoves.activeId=first.id;await m.retryFailedMoves();assert.deepEqual(finished,[first.id,second.id,first.id]);assert.equal(first.items[0].state,'success');
});
test('single native move remains successful and saves ID migration when the subsequent scan fails',async()=>{
 const moves=[],migrations=[],messages=[];let saves=0;
 const c=vm.createContext({runStateMutation: fn => fn(), isExitFrozen: () => false, store:{entries:[{id:'old',path:'C:/Desktop/a',name:'A',canManage:true,kind:'file'}],customGroups:[{id:'zone',dirName:'Work',name:'Work'}]},sourceFor:()=>({writable:true}),performFileChange:fn=>fn(),moveToZone:async(path,dir)=>{moves.push([path,dir]);return 'C:/Desktop/.nestra/Work/a'},remappedId:(_entry,path)=>`file:${path}`,migrateItemId:(oldId,newId)=>migrations.push([oldId,newId]),clearFolded(){},scheduleSave:()=>saves++,rescan:async()=>{throw Error('offline scan')},showStatus:message=>messages.push(message)});
 vm.runInContext(functions('src/stores/state.ts',['moveItem','moveItemOrThrow']),c);
 assert.equal(await c.moveItem('old','zone'),'file:C:/Desktop/.nestra/Work/a');assert.equal(moves.length,1);assert.equal(migrations.length,1);assert.equal(saves,1);assert.match(messages[0],/移动已完成/);
});
test('batch return to desktop tracks per-file failure and never repeats a successful return',async()=>{
 const m=loadMoveReports(),calls=[];let occupied=true;
 const c=vm.createContext({runStateMutation: fn => fn(), isExitFrozen: () => false, ...m,store:{entries:['a','b'].map(id=>({id,path:id,name:id,zone:'Zone',canManage:true})),customGroups:[]},performFileChange:fn=>fn(),moveToDesktopNative:async path=>{calls.push(path);if(path==='b'&&occupied)throw Error('locked');return `Desktop/${path}`},remappedId:(_entry,path)=>`file:${path}`,migrateItemId(){},scheduleSave(){},rescan:async()=>{},showStatus(){}});
 vm.runInContext(functions('src/stores/state.ts',['batchReturnItems','returnItemOrThrow']),c);
 await c.batchReturnItems(['a','b']);occupied=false;await m.retryFailedMoves();assert.deepEqual(calls,['a','b','b']);assert.ok(m.fileMoves.reports[0].items.every(item=>item.state==='success'));
});
test('concurrent batches cannot start while a prior move is pending',async()=>{
  const m=loadMoveReports();let release;const gate=new Promise(resolve=>release=resolve);
  const first=m.trackFileMoves('first',[{name:'a',path:'a',run:()=>gate}],async()=>{});
  assert.equal(await m.trackFileMoves('second',[{name:'b',path:'b',run:async()=>{throw Error('must not run')}}],async()=>{}),undefined);
  release();await first;assert.equal(m.fileMoves.reports.length,1);
});
test('failed retries stop when the destination changes or the source disappears',async()=>{
  const m=loadMoveReports();let calls=0;
  const c=vm.createContext({runStateMutation: fn => fn(), isExitFrozen: () => false, ...m,store:{customGroups:[{id:'target',dirName:'before',name:'Zone'}],entries:[{id:'a',path:'a',name:'A'}]},sourceFor:()=>({writable:true}),moveItemOrThrow:async()=>{calls++;throw Error('locked');},rescan:async()=>{},scheduleSave(){},selectPanelItems(){},showStatus(){}});
  vm.runInContext(functions('src/stores/state.ts',['batchMoveItems']),c);
  await c.batchMoveItems(['a'],'target');c.store.customGroups[0].dirName='after';await m.retryFailedMoves();assert.equal(calls,1);assert.match(m.fileMoves.reports[0].items[0].error,/目标目录已改变/);
  c.store.customGroups[0].dirName='before';c.store.entries=[];await m.retryFailedMoves();assert.equal(calls,1);assert.match(m.fileMoves.reports[0].items[0].error,/源文件已改变/);
});
function viewTest(){const calls=[];const layout={x:450,y:250,width:336,height:432,locked:true,visible:false,zIndex:5,monitorId:'main'};
 const c=vm.createContext({runStateMutation: fn => fn(), isExitFrozen: () => false, fileMoves:{busy:false},desktopGestureActive:()=>false,store:{paused:true,displays:[{id:'main',x:0,y:0,width:1920,height:1080,isPrimary:true}]},layoutFor:()=>layout,nextZ:()=>20,scheduleHitRectSync(){},flushState:async()=>calls.push('save'),setPausedNative:async()=>calls.push('resume'),getCurrentWebviewWindow:()=>({hide:async()=>calls.push('hide')}),showStatus:message=>calls.push(message)});
 vm.runInContext(functions('src/lib/layout.ts',['recoverSurface','containSurface','displayAtPoint'])+functions('src/stores/state.ts',['viewSurface']),c);return {c,calls,layout};}
test('viewing a locked surface keeps its placement and saves before hiding the manager',async()=>{const t=viewTest();await t.c.viewSurface('zone');assert.equal(t.layout.x,450);assert.equal(t.layout.y,250);assert.equal(t.layout.locked,true);assert.equal(t.layout.visible,true);assert.equal(t.layout.zIndex,20);assert.deepEqual(t.calls,['resume','save','hide']);});
test('viewing recovers offscreen surfaces, but keeps the manager open on native or save failure',async()=>{
 const t=viewTest();t.layout.x=4000;await t.c.viewSurface('zone');assert.ok(t.layout.x<1920);
 for(const operation of ['setPausedNative','flushState']){const f=viewTest();f.c[operation]=async()=>{throw Error('failed');};await f.c.viewSurface('zone');assert.ok(!f.calls.includes('hide'));assert.match(f.calls.at(-1),/无法在桌面查看/);}
 for(const condition of ['moving','no-displays']){const f=viewTest();if(condition==='moving')f.c.desktopGestureActive=()=>true;else f.c.store.displays=[];await f.c.viewSurface('zone');assert.ok(!f.calls.includes('hide'));assert.equal(f.layout.visible,false);}
});
