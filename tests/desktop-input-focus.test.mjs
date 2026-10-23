import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';

const source = ts.transpileModule(readFileSync('src/composables/desktopInputFocus.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };

function fixture({ grant=async()=>{}, release=async()=>{} }={}) {
  class Events {
    listeners = new Map();
    addEventListener(type, fn, capture=false) { const list=this.listeners.get(type)??[]; list.push({fn,capture}); this.listeners.set(type,list); }
    removeEventListener(type, fn) { this.listeners.set(type,(this.listeners.get(type)??[]).filter(x=>x.fn!==fn)); }
    emit(type, event={}, stopped=false) { for(const {fn,capture} of [...(this.listeners.get(type)??[])].sort((a,b)=>Number(b.capture)-Number(a.capture))) if(capture||!stopped) fn(event); }
  }
  const doc=new Events(), win=new Events(), frames=new Map(), calls=[];
  let observer, frameId=0;
  class Element {
    constructor(isEditor=false,parent=null) { this.isEditor=isEditor; this.parent=parent; this.isConnected=true; this.disabled=false; this.focusCount=0; }
    matches() { return this.isEditor&&!this.disabled; }
    closest() { return this.matches()?this:this.parent?.closest()??null; }
    focus() { this.focusCount++; if(doc.activeElement===this)return; doc.activeElement=this; doc.emit('focusin',{target:this}); }
  }
  doc.body=new Element(); doc.activeElement=doc.body;
  win.requestAnimationFrame=fn=>{frames.set(++frameId,fn);return frameId;};
  win.cancelAnimationFrame=id=>frames.delete(id);
  class Observer { constructor(fn){observer=fn;} observe(){} disconnect(){observer=()=>{};} }
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,HTMLElement:Element,MutationObserver:Observer,document:doc,window:win});
  const dispose=module.exports.installDesktopInputFocus(async()=>{calls.push('grant');await grant();},async()=>{calls.push('release');await release();},()=>calls.push('error'));
  return { doc,win,calls,dispose, input:()=>new Element(true), button:()=>new Element(), child:parent=>new Element(false,parent),
    click:(el,stopped=false)=>doc.emit('pointerdown',{target:el,button:0},stopped),
    blurDom:()=>{doc.activeElement=doc.body;doc.emit('focusout',{});},
    frame:()=>{for(const [id,fn] of [...frames]){frames.delete(id);fn();}}, mutate:()=>observer() };
}

test('capture reclaims an already DOM-focused rename input despite pointerdown.stop',async()=>{
  const t=fixture(), input=t.input(); input.focus(); await settle();
  t.win.emit('blur'); await settle(); // Windows focus elsewhere; DOM still points at editor.
  t.click(input,true); await settle();
  assert.deepEqual(t.calls,['grant','release','grant']); assert.equal(t.doc.activeElement,input);
  t.dispose(); await settle();
});
test('pointerdown and focusin share one pending grant without a recursive restore grant',async()=>{
  const gate=deferred(),t=fixture({grant:()=>gate.promise}),input=t.input();
  t.click(input); input.focus(); assert.deepEqual(t.calls,['grant']);
  t.blurDom(); t.frame(); assert.deepEqual(t.calls,['grant']);
  gate.resolve(); await settle();
  assert.equal(t.doc.activeElement,input); assert.deepEqual(t.calls,['grant']);
});
test('a transient WebView blur cannot release input before native acquisition completes',async()=>{
  const gate=deferred(),t=fixture({grant:()=>gate.promise}),input=t.input();
  input.focus(); t.blurDom(); t.doc.emit('focusin',{target:t.doc.body}); t.frame();
  gate.resolve(); await settle(); t.frame(); await settle();
  assert.equal(t.doc.activeElement,input); assert.deepEqual(t.calls,['grant']);
});
test('clicking cancel during grant prevents late focus restoration and detaches',async()=>{
  const gate=deferred(),t=fixture({grant:()=>gate.promise}),input=t.input();
  input.focus(); t.click(t.button(),true); input.isConnected=false; t.mutate();
  gate.resolve(); await settle();
  assert.equal(input.focusCount,1); assert.deepEqual(t.calls,['grant','release']);
});
test('switching editors while IPC is pending restores only the latest editor',async()=>{
  const gate=deferred(),t=fixture({grant:()=>gate.promise}),first=t.input(),second=t.input();
  first.focus(); t.click(second,true); second.focus();
  gate.resolve(); await settle();
  assert.equal(first.focusCount,1); assert.equal(t.doc.activeElement,second);
  assert.deepEqual(t.calls,['grant','grant']);
});
test('a new editor waits until native release acknowledges completion',async()=>{
  const gate=deferred(),t=fixture({release:()=>gate.promise}),first=t.input(),second=t.input();
  first.focus(); await settle(); t.click(t.button());
  t.click(second); second.focus(); await settle(); assert.deepEqual(t.calls,['grant','release']);
  gate.resolve(); await settle(); assert.deepEqual(t.calls,['grant','release','grant']);
  assert.equal(t.doc.activeElement,second);
});
test('save, Escape and unmount release removed or disabled editors without focusout',async()=>{
  for(const change of ['remove','disable','unmount']) {
    const t=fixture(),input=t.input(); input.focus(); await settle();
    if(change==='unmount')t.dispose();
    else { if(change==='remove')input.isConnected=false;else input.disabled=true;t.mutate(); }
    await settle(); assert.deepEqual(t.calls,['grant','release'],change);
  }
});
test('switching applications while grant is pending does not steal focus back',async()=>{
  const gate=deferred(),t=fixture({grant:()=>gate.promise}),input=t.input();
  input.focus(); t.win.emit('blur'); gate.resolve(); await settle();
  assert.equal(input.focusCount,1); assert.deepEqual(t.calls,['grant','release']);
});
test('failed grant cleans up and can be retried by clicking the same input',async()=>{
  let failed=true; const t=fixture({grant:async()=>{if(failed)throw Error('attach failed');}}),input=t.input();
  input.focus(); await settle(); assert.deepEqual(t.calls,['grant','error','release']);
  failed=false; t.click(input,true); await settle(); assert.equal(t.calls.at(-1),'grant');
  assert.equal(t.doc.activeElement,input);
});
test('stale failures do not display errors for a closed editor',async()=>{
  const gate=deferred(),t=fixture({grant:()=>gate.promise}),input=t.input();
  input.focus(); t.dispose(); gate.reject(Error('timeout')); await settle();
  assert.deepEqual(t.calls,['grant','release']); assert.equal(input.focusCount,1);
});
test('contenteditable descendants use the containing editor',async()=>{
  const t=fixture(),input=t.input(); t.click(t.child(input),true); await settle();
  assert.equal(t.doc.activeElement,input); assert.deepEqual(t.calls,['grant']);
});
test('leaving an editor normally releases only after the final DOM focus is known',async()=>{
  const t=fixture(),first=t.input(),second=t.input(); first.focus(); await settle();
  t.blurDom(); second.focus(); await settle(); t.frame(); await settle();
  assert.deepEqual(t.calls,['grant','grant']);
  t.blurDom(); t.frame(); await settle(); assert.equal(t.calls.at(-1),'release');
});
