import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const c=vm.createContext({});
vm.runInContext(ts.transpile(readFileSync('src/domain/organizerLayout.ts','utf8').replace(/^import .*$/gm,'').replace(/^export /gm,''),{target:ts.ScriptTarget.ES2022}),c);
const base={x:32,y:40,width:420,height:300,zIndex:1,visible:true,autoSize:false,iconSize:48,itemGap:8,labelLines:2};
const screen={x:0,y:0,width:1280,height:720};

test('folder mode preserves every ordered item exactly once, including a one-cell organizer',()=>{
 for(const capacity of [1,2,6,12])for(const count of [0,1,2,6,12,90]){
  const items=Array.from({length:count},(_,i)=>({id:i,path:`original/${i}`}));const result=c.splitOrganizerOverflow(items,capacity);
  assert.deepEqual([...result.visible,...result.overflow],items);
  assert.equal(result.overflow.length>0,count>capacity);
  assert.equal(result.visible.length,count>capacity?capacity-1:count);
  if(result.overflow.length)assert.equal(result.visible.length+1,capacity);
  assert.equal(items[0]?.path,count?'original/0':undefined);
 }
});
test('folder mode reuses the pager area for complete rows and never grows a manual panel',()=>{
 for(const height of [180,240,300,420]){
  const folder=c.fitOrganizer({...base,height,overflowMode:'folder'},100,screen);
  assert.equal(folder.layout.height,height);assert.equal(folder.layout.width,base.width);
  assert.ok(folder.layout.height>=60+folder.rows*folder.tileHeight+(folder.rows-1)*folder.gap);
  const pages=c.fitOrganizer({...base,height,overflowMode:'pages'},100,screen);
  assert.ok(folder.pageSize>=pages.pageSize);
 }
});
test('resizing and filtering move only the view boundary, preserving the full item sequence',()=>{
 const entries=Array.from({length:24},(_,i)=>`file-${i}`);
 for(const width of [264,420,600]){
  const fit=c.fitOrganizer({...base,width,overflowMode:'folder'},entries.length,screen);
  const split=c.splitOrganizerOverflow(entries,fit.pageSize);
  assert.deepEqual([...split.visible,...split.overflow],entries);
 }
 const split=c.splitOrganizerOverflow(entries.filter(x=>x==='file-3'),6);
 assert.equal(split.overflow.length,0);assert.deepEqual(Array.from(split.visible),['file-3']);
});
