import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync('src/features/SearchPanel.tsx','utf8');
const ast=ts.createSourceFile('SearchPanel.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let handler;
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='onKey')handler=node;ts.forEachChild(node,visit)}
visit(ast);assert.ok(handler,'Test the production keyboard handler');
const code=ts.transpile(handler.getText(ast),{target:ts.ScriptTarget.ES2022});
function setup(){const calls=[];const c=vm.createContext({results:[{id:'a'},{id:'b'}],active:0,visibleCount:24,onClose:()=>calls.push('close'),open:entry=>calls.push(entry.id)});c.setActive=value=>{c.active=value};c.setVisibleCount=value=>{c.visibleCount=typeof value==='function'?value(c.visibleCount):value};vm.runInContext(code,c);return {c,calls};}
function key(key,patch={}){return {key,nativeEvent:{isComposing:false},keyCode:0,preventDefault(){},target:{closest:()=>false},...patch};}
test('Chinese IME candidate navigation and confirmation never control search',()=>{
  for(const k of ['Enter','Escape','ArrowDown','ArrowUp'])for(const composition of [{nativeEvent:{isComposing:true}},{keyCode:229}]){
    const {c,calls}=setup();c.onKey(key(k,composition));assert.deepEqual(calls,[]);assert.equal(c.active,0);
  }
});
test('Enter opens the selected result and Escape closes outside composition',()=>{
  const {c,calls}=setup();c.onKey(key('Enter'));c.onKey(key('Escape'));assert.deepEqual(calls,['a','close']);
});
test('arrow keys clamp selection, expand visible rows and leave focused controls alone',()=>{
  const {c}=setup();c.visibleCount=1;c.onKey(key('ArrowDown'));assert.equal(c.active,1);assert.equal(c.visibleCount,2);
  c.onKey(key('ArrowDown'));assert.equal(c.active,1);
  c.onKey(key('ArrowUp',{target:{closest:()=>true}}));assert.equal(c.active,1);
  c.onKey(key('ArrowUp'));c.onKey(key('ArrowUp'));assert.equal(c.active,0);
});
