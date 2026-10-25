import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const context = vm.createContext({});
vm.runInContext(ts.transpile(readFileSync('src/domain/organizerLayout.ts','utf8').replace(/^import .*$/gm,'').replace(/^export /gm,''), {target:ts.ScriptTarget.ES2022}), context);
const layout = {x:32,y:70,width:336,height:240,zIndex:1,visible:true,columns:4,iconSize:64,itemGap:12,labelLines:2};
const screen = {x:0,y:0,width:1280,height:720};
function assertFits(fit, bounds, chrome=42, padding=16) {
  assert.ok(fit.layout.x >= bounds.x && fit.layout.y >= bounds.y);
  assert.ok(fit.layout.x+fit.layout.width <= bounds.x+bounds.width);
  assert.ok(fit.layout.y+fit.layout.height <= bounds.y+bounds.height);
  assert.ok((fit.layout.width-18-(fit.columns-1)*fit.gap)/fit.columns >= fit.tileWidth);
  assert.ok(fit.layout.height >= chrome+padding+2+fit.rows*fit.tileHeight+(fit.rows-1)*fit.gap+(fit.pageCount>1?34:0));
}
test('six large application icons grow past the old fixed width and fit both complete rows',()=>{
  const fit=context.fitOrganizer(layout,6,screen);assert.equal(fit.columns,4);assert.equal(fit.rows,2);assert.equal(fit.pageCount,1);assert.ok(fit.layout.width>layout.width);assert.ok(fit.layout.height>layout.height);assertFits(fit,screen);
});
test('large folders reserve the pager and every item belongs to a complete page',()=>{
  const fit=context.fitOrganizer(layout,200,screen);assert.ok(fit.pageCount>1);assertFits(fit,screen);
  const pages=Array.from({length:fit.pageCount},(_,page)=>Array.from({length:Math.min(fit.pageSize,200-page*fit.pageSize)},(_,i)=>page*fit.pageSize+i));
  assert.deepEqual(pages.flat(),Array.from({length:200},(_,i)=>i));
});
test('all supported icon sizes, gaps, lines and densities retain whole icons and rows',()=>{
  for(const iconSize of [24,42,64])for(const itemGap of [0,8,24])for(const labelLines of [1,2,3])for(const density of ['compact','comfortable'])for(const count of [1,6,31,200]){
    const fit=context.fitOrganizer({...layout,iconSize,itemGap,labelLines,density},count,screen);assertFits(fit,screen);
  }
});
test('screen changes and negative monitor origins keep a complete page within its own monitor',()=>{
  for(const bounds of [{x:0,y:0,width:640,height:480},{x:-1920,y:-100,width:1920,height:1080}])assertFits(context.fitOrganizer({...layout,x:9999,y:9999},80,bounds),bounds);
});
test('search, tabs, folded strips and multi-selection space never hide the last row',()=>{
  assertFits(context.fitOrganizer(layout,50,screen,142,56),screen,142,56);
});
test('list view and empty zones have finite positive geometry',()=>{
  const fit=context.fitOrganizer({...layout,viewMode:'list'},200,screen);assert.equal(fit.columns,1);assertFits(fit,screen);
  const empty=context.fitOrganizer(layout,0,screen);assert.equal(empty.pageCount,1);assert.ok(empty.layout.height>0);assert.ok(Number.isFinite(empty.pageSize));
});
