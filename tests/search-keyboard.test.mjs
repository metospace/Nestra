import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync('src/features/SearchPanel.vue','utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
const ast=ts.createSourceFile('search.ts',source,ts.ScriptTarget.Latest,true);
const code=ts.transpile(ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='onKey').getText(ast),{target:ts.ScriptTarget.ES2022});
function setup(){const calls=[];const c=vm.createContext({results:{value:[{id:'a'},{id:'b'}]},active:{value:0},visibleCount:{value:24},emit:kind=>calls.push(kind),open:entry=>calls.push(entry.id),nextTick:()=>Promise.resolve()});vm.runInContext(code,c);return {c,calls};}
function key(key,patch={}){return {key,isComposing:false,keyCode:0,preventDefault(){},target:{closest:()=>false},...patch};}
test('Chinese IME candidate navigation and confirmation never control search',()=>{
  for(const k of ['Enter','Escape','ArrowDown','ArrowUp'])for(const composition of [{isComposing:true},{keyCode:229}]){
    const {c,calls}=setup();c.onKey(key(k,composition));assert.deepEqual(calls,[]);assert.equal(c.active.value,0);
  }
});
test('Enter opens the selected result and Escape closes outside composition',()=>{
  const {c,calls}=setup();c.onKey(key('Enter'));c.onKey(key('Escape'));assert.deepEqual(calls,['a','close']);
});
