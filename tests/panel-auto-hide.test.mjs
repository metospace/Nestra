import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const compile = path => ts.transpile(readFileSync(path,'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,''),{target:ts.ScriptTarget.ES2022});
const domainCode = compile('src/domain/panelAutoHide.ts');
const {PanelAutoHide,localPointer,pointerInside}=vm.runInNewContext(`${domainCode}\n;({PanelAutoHide,localPointer,pointerInside})`);

test('hover opens after dwell; leaving and reentering respect the independent hide delay',()=>{
  const a=new PanelAutoHide();assert.equal(a.visible,false);
  assert.equal(a.step(0,true,false,false,800),false);assert.equal(a.step(100,true,false,false,800),false);
  assert.equal(a.step(120,true,false,false,800),true);
  assert.equal(a.step(200,false,false,false,800),true);assert.equal(a.step(999,false,false,false,800),true);
  assert.equal(a.step(1000,false,false,false,800),false);
  a.step(1100,true,false,false,800);assert.equal(a.step(1220,true,false,false,800),true);
  a.step(1300,false,false,false,800);a.step(1800,true,false,false,800);
  a.step(1900,false,false,false,800);assert.equal(a.step(2600,false,false,false,800),true);
  assert.equal(a.step(2700,false,false,false,800),false);
});
test('briefly crossing a hidden region does not reveal it; other regions remain independent',()=>{
  const a=new PanelAutoHide(),b=new PanelAutoHide();a.step(0,true,false,false,200);a.step(80,false,false,false,200);
  assert.equal(a.step(300,false,false,false,200),false);
  a.step(400,true,false,false,200);assert.equal(a.step(520,true,false,false,200),true);assert.equal(b.visible,false);
});
test('editing and settings pin a panel; global menus and dragging hold only panels already open',()=>{
  const a=new PanelAutoHide(),b=new PanelAutoHide();assert.equal(a.step(0,false,true,false,800),true);
  assert.equal(a.step(5000,false,false,true,800),true);assert.equal(b.step(5000,false,false,true,800),false);
  a.step(5100,false,false,false,800);assert.equal(a.step(5899,false,false,false,800),true);
  assert.equal(a.step(5900,false,false,false,800),false);
});
test('viewing an auto-hidden panel grants a temporary reveal then resumes normal hiding',()=>{
  const a=new PanelAutoHide();a.reveal(100);assert.equal(a.visible,true);
  assert.equal(a.step(2500,false,false,false,800),true);a.step(2600,false,false,false,800);
  assert.equal(a.step(3400,false,false,false,800),false);
});
test('negative monitor origins and DPI use the same CSS rectangle, with exclusive far edges',()=>{
  const p=localPointer({x:-1650,y:150},{x:-1920,y:-150},1.5);assert.equal(p.x,180);assert.equal(p.y,200);
  assert.equal(pointerInside(p,{x:100,y:150,width:200,height:100}),true);
  assert.equal(pointerInside({x:300,y:200},{x:100,y:150,width:200,height:100}),false);
});

function monitorSetup(){
  let nativeHandler,generation=0,clock=0,unlistens=0,fail=false;
  const calls=[],dom=new Map();
  const c=vm.createContext({Promise,Set,Map,Infinity,performance:{now:()=>clock},window:{devicePixelRatio:1.5,addEventListener:(name,fn)=>dom.set(name,fn),removeEventListener:name=>dom.delete(name)},
    invoke:async(command,args)=>{assert.equal(command,'set_desktop_hover_tracking');calls.push({...args});if(fail)throw Error('native unavailable');return args.enabled?++generation:0;},
    listen:async(name,fn)=>{assert.equal(name,'nestra://desktop-pointer');nativeHandler=fn;return()=>{unlistens++;};}});
  vm.runInContext(domainCode+'\n'+compile('src/composables/desktopPointer.ts'),c);
  return {c,calls,dom,send:(sample)=>nativeHandler({payload:{generation,cursor:{x:300,y:150},origin:{x:0,y:0},...sample}}),get generation(){return generation},get unlistens(){return unlistens},setClock:v=>clock=v,setFail:()=>fail=true};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('one native subscription serves multiple panels, and final cleanup stops its own lease',async()=>{
  const t=monitorSetup(),a=[],b=[];assert.equal(t.calls.length,0);
  const stopA=t.c.subscribeDesktopPointer(p=>a.push(p)),stopB=t.c.subscribeDesktopPointer(p=>b.push(p));await settle();
  assert.equal(t.calls.filter(call=>call.enabled).length,1);t.send({});assert.equal(a[0].x,200);assert.equal(b[0].y,100);
  stopA();t.send({});assert.equal(a.length,1);assert.equal(b.length,2);
  stopB();stopB();await settle();assert.equal(t.calls.length,2);assert.equal(t.calls[1].enabled,false);assert.equal(t.calls[1].generation,1);assert.equal(t.unlistens,1);assert.equal(t.dom.size,0);
});
test('stale native events are rejected after re-subscribe; fresh generation still works',async()=>{
  const t=monitorSetup(),points=[];const stop=t.c.subscribeDesktopPointer(p=>points.push(p));await settle();const old=t.generation;stop();
  const stopNew=t.c.subscribeDesktopPointer(p=>points.push(p));await settle();
  t.send({generation:old});assert.equal(points.length,0);t.send({});assert.equal(points.length,1);stopNew();await settle();
});
test('native start failure returns a fail-open sample and cleanup remains usable',async()=>{
  const t=monitorSetup(),points=[];t.setFail();const stop=t.c.subscribeDesktopPointer(p=>points.push(p));await settle();assert.equal(points[0],null);stop();await settle();assert.equal(t.dom.size,0);
});
test('reveal requests are per panel and survive a short delayed mount, then expire',()=>{
  const t=monitorSetup();let a=0,b=0;const stop=t.c.subscribePanelReveal('a',()=>a++);t.c.subscribePanelReveal('b',()=>b++);
  t.c.revealAutoHidePanel('a');assert.equal(a,1);assert.equal(b,0);stop();t.setClock(1000);t.c.subscribePanelReveal('a',()=>a++);assert.equal(a,2);
  t.setClock(3000);t.c.subscribePanelReveal('a',()=>a++);assert.equal(a,2);
});
