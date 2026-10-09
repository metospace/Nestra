import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";

const source = readFileSync(new URL("../src/lib/layout.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("layout.ts", source, ts.ScriptTarget.Latest, true);
const code = ts.transpile(ast.statements.filter(node => ts.isFunctionDeclaration(node))
  .map(node => node.getText(ast).replace(/^export /, "")).join("\n"), { target: ts.ScriptTarget.ES2022 });
const context = vm.createContext({});
vm.runInContext(code, context);
const display = { id: "main", x: 0, y: 0, width: 1536, height: 864, isPrimary: true };

test("layout stranded on a disconnected display returns to the primary screen", () => {
  const layout = { x: 2000, y: 80, width: 336, height: 400, visible: true };
  assert.equal(context.recoverSurface(layout, [display]), true);
  assert.equal(layout.x, 18); assert.equal(layout.y, 64);
  assert.equal(layout.monitorId, "main");
});

test("reachable layouts on a secondary monitor retain their position and size", () => {
  const layout = { x: 1660, y: 80, width: 336, height: 400, visible: false };
  const before = { ...layout };
  assert.equal(context.recoverSurface(layout, [display, { ...display, id: "other", x: 1536, isPrimary: false }]), false);
  assert.deepEqual(layout, before);
});

test("invalid persisted coordinates recover without revealing a hidden surface", () => {
  const layout = { x: NaN, y: Infinity, width: -10, height: NaN, visible: false };
  assert.equal(context.recoverSurface(layout, [display]), true);
  assert.equal(Number.isFinite(layout.x), true);
  assert.equal(Number.isFinite(layout.y), true);
  assert.equal(layout.visible, false); assert.ok(layout.width >= 120);
});

test("a header below the screen is recovered, unavailable monitor data changes nothing", () => {
  const layout = { x: 20, y: 850, width: 336, height: 400 };
  assert.equal(context.recoverSurface(layout, []), false);
  assert.equal(context.recoverSurface(layout, [display]), true);
  assert.ok(layout.y + 36 <= display.height);
});

test("disconnected monitor assignment is remembered and restored when it returns",()=>{
 const other={...display,id:"other",x:1536,isPrimary:false};
 const layout={x:1650,y:110,width:400,height:500,monitorId:"other",visible:false};
 context.recoverSurface(layout,[display]);assert.equal(layout.monitorId,"main");assert.equal(layout.displacedFrom.monitorId,"other");assert.equal(layout.visible,false);
 context.recoverSurface(layout,[display,other]);assert.equal(layout.monitorId,"other");assert.equal(layout.x,1650);assert.equal(layout.y,110);assert.equal(layout.displacedFrom,undefined);
});

test("partly off-screen surfaces are fully recovered, search keeps its compact height",()=>{
 for(const position of [{x:1450,y:500},{x:-100,y:100},{x:100,y:800}]){
  const layout={...position,width:336,height:400,visible:false};
  context.recoverSurface(layout,[display]);
  assert.ok(layout.x>=0 && layout.y>=0 && layout.x+layout.width<=display.width && layout.y+layout.height<=display.height);
  assert.equal(layout.visible,false);
 }
 const search={x:600,y:14,width:280,height:46};
 assert.equal(context.recoverSurface(search,[display]),false);assert.equal(search.height,46);
});

test("surfaces in monitor gaps move to a real monitor and oversized surfaces fit",()=>{
 const screens=[display,{...display,id:'other',x:1800,y:300,width:800,height:600,isPrimary:false}];
 const layout={x:1650,y:0,width:1200,height:900};
 context.recoverSurface(layout,screens);
 assert.ok(screens.some(d=>layout.x>=d.x && layout.y>=d.y && layout.x+layout.width<=d.x+d.width && layout.y+layout.height<=d.y+d.height));
});

test('legacy DISPLAY2 placements survive renumbering to DISPLAY1, including prior fallback snapshots',()=>{
 const screen={...display,id:'monitor:hardware-a',legacyId:'\\\\.\\DISPLAY1'};
 for(const displaced of [false,true]){
  const saved={monitorId:'\\\\.\\DISPLAY2',x:1100,y:130,width:336,height:400};
  const layout=displaced?{...saved,x:18,y:64,monitorId:'\\\\.\\DISPLAY1',displacedFrom:{...saved}}:{...saved};
  context.recoverSurface(layout,[screen]);
  assert.equal(layout.x,1100);assert.equal(layout.y,130);assert.equal(layout.monitorId,screen.id);assert.equal(layout.displacedFrom,undefined);
  assert.equal(context.recoverSurface(layout,[screen]),false);
 }
});

test('stable monitor identity survives GDI renumbering and virtual desktop origin changes',()=>{
 const screen={...display,id:'monitor:hardware-a',legacyId:'\\\\.\\DISPLAY2',x:1536};
 const layout={monitorId:screen.id,monitorBounds:{x:1536,y:0},x:1650,y:110,width:336,height:400};
 const newScreen={...screen,x:0,legacyId:'\\\\.\\DISPLAY1'};
 context.recoverSurface(layout,[newScreen]);assert.equal(layout.x,114);assert.equal(layout.y,110);assert.equal(layout.displacedFrom,undefined);
 context.recoverSurface(layout,[screen]);assert.equal(layout.x,1650);assert.equal(layout.y,110);
});

test('temporary smaller resolutions preserve placement and size through restart and restore',()=>{
 const screen={...display,id:'monitor:hardware-a',legacyId:'\\\\.\\DISPLAY1'};
 const original={monitorId:screen.id,monitorBounds:{x:0,y:0},x:1100,y:400,width:400,height:450};
 const layout={...original};const small={...screen,width:1024,height:600};
 context.recoverSurface(layout,[small]);
 assert.equal(layout.displacedFrom.x,original.x);assert.equal(layout.displacedFrom.y,original.y);
 const restarted=JSON.parse(JSON.stringify(layout));assert.equal(context.recoverSurface(restarted,[small]),false);
 context.recoverSurface(restarted,[screen]);assert.equal(restarted.x,original.x);assert.equal(restarted.y,original.y);assert.equal(restarted.width,original.width);assert.equal(restarted.displacedFrom,undefined);
});

test('missing hardware monitor preserves the original even when its coordinates overlap another monitor',()=>{
 const layout={monitorId:'monitor:offline',x:500,y:200,width:336,height:400};
 context.recoverSurface(layout,[display]);assert.equal(layout.displacedFrom.monitorId,'monitor:offline');assert.equal(layout.displacedFrom.x,500);
 const restarted=JSON.parse(JSON.stringify(layout));assert.equal(context.recoverSurface(restarted,[display]),false);
 context.recoverSurface(restarted,[{...display,id:'monitor:offline'}]);assert.equal(restarted.x,500);assert.equal(restarted.y,200);assert.equal(restarted.displacedFrom,undefined);
});

test('display recovery waits for stable enumeration and resets after wake-up failures',()=>{
 const ready=context.createDisplayRecoveryGate();
 assert.equal(ready([display],0),false);assert.equal(ready([display],2000),false);
 const other={...display,id:'other',x:1536,isPrimary:false};
 assert.equal(ready([display,other],4500),false);assert.equal(ready([display,other],5000),false);assert.equal(ready([other,display],6500),true);
 assert.equal(ready([],7000),false);assert.equal(ready([display],8000),false);assert.equal(ready([display],12000),false);assert.equal(ready([display],13000),true);
});
