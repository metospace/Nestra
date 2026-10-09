import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
function compile(path){
 const ast=ts.createSourceFile(path,readFileSync(new URL(path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 return ts.transpile(ast.statements.filter(s=>!ts.isImportDeclaration(s)).map(s=>s.getText(ast).replace(/^export /,'')).join('\n'),{target:ts.ScriptTarget.ES2022});
}
const code=compile('../src/lib/layout.ts')+'\n'+compile('../src/composables/useSurfaceDrag.ts');
const main={id:'main',x:0,y:0,width:1000,height:700,isPrimary:true};
function setup(displays=[main]){
 const events=new Map(),classes=new Set();let saves=0;
 class Element{captured=false;addEventListener(){}removeEventListener(){}setPointerCapture(){this.captured=true;}hasPointerCapture(){return this.captured;}releasePointerCapture(){this.captured=false;}}
 const target=new Element();
 const context=vm.createContext({flushState:async()=>{saves++},store:{displays},HTMLElement:Element,window:{innerWidth:1000,innerHeight:700,addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n)},document:{body:{classList:{add:n=>classes.add(n),remove:n=>classes.delete(n)}}}});
 vm.runInContext(code,context);
 const event=(x,y,pointerId=1)=>({button:0,pointerId,clientX:x,clientY:y,currentTarget:target,preventDefault(){}});
 return {context,events,classes,target,event,get saves(){return saves},move:(x,y,pointerId=1)=>events.get('pointermove')?.(event(x,y,pointerId))};
}
function fits(layout,display=main){assert.ok(layout.x>=display.x && layout.y>=display.y && layout.x+layout.width<=display.x+display.width && layout.y+layout.height<=display.y+display.height,JSON.stringify(layout));}
test('moving to any screen edge contains the entire surface and releases capture',()=>{
 for(const [x,y] of [[-500,100],[1500,100],[100,-500],[100,1500]]){
  const t=setup(),layout={x:100,y:100,width:336,height:400};
  t.context.startMove(t.event(110,110),layout);t.move(x,y);fits(layout);
  t.events.get('pointerup')();assert.equal(t.target.captured,false);assert.equal(t.events.size,0);assert.equal(t.classes.size,0);
 }
});
test('multi-monitor dragging crosses to smaller screens and avoids monitor gaps',()=>{
 const other={id:'other',x:1200,y:200,width:500,height:300};
 const t=setup([main,other]),layout={x:100,y:100,width:600,height:400,displacedFrom:{monitorId:'gone'}};
 t.context.startMove(t.event(110,110),layout);t.move(1300,250);fits(layout,other);assert.equal(layout.monitorId,'other');assert.equal(layout.displacedFrom,undefined);
 t.move(1100,50);fits(layout,main);assert.equal(layout.width,600);assert.equal(layout.height,400);
});
test('all eight resize directions respect screen limits and minimum size',()=>{
 for(const direction of ['n','s','e','w','ne','nw','se','sw']){
  const t=setup(),layout={x:100,y:100,width:336,height:400};
  t.context.startResize(t.event(110,110),direction,layout,{minWidth:264,minHeight:176});
  for(const [x,y] of [[-3000,-3000],[3000,3000]]){t.move(x,y);fits(layout);assert.ok(layout.width>=264 && layout.height>=176);}
 }
});
test('locked surfaces ignore gestures and a different pointer cannot change a drag',()=>{
 const t=setup(),layout={x:100,y:100,width:336,height:400,locked:true},before={...layout};
 t.context.startMove(t.event(110,110),layout);t.context.startResize(t.event(110,110),'se',layout);assert.equal(t.events.size,0);assert.deepEqual(layout,before);
 layout.locked=false;t.context.startMove(t.event(110,110),layout);const start={...layout};t.move(900,600,2);assert.deepEqual(layout,start);
 t.events.get('pointercancel')();assert.equal(t.target.captured,false);
});

test('finishing or cancelling a gesture flushes its final placement exactly once',()=>{
 for(const event of ['pointerup','pointercancel','blur']){
  const t=setup(),layout={x:100,y:100,width:336,height:400};
  t.context.startMove(t.event(110,110),layout);t.move(400,200);const end=t.events.get(event);
  assert.equal(t.saves,0);end();assert.equal(t.saves,1);end();assert.equal(t.saves,1);
  assert.equal(t.classes.has('is-gesturing'),false);assert.equal(layout.monitorBounds.x,0);
 }
});

test('manual resize cancels automatic recovery so the old size cannot return later',()=>{
 const t=setup(),layout={x:100,y:100,width:336,height:400,displacedFrom:{monitorId:'offline',width:500,height:600}};
 t.context.startResize(t.event(110,110),'se',layout);t.move(200,200);
 assert.equal(layout.displacedFrom,undefined);assert.equal(layout.monitorId,'main');
 t.events.get('pointerup')();assert.equal(t.saves,1);
});
