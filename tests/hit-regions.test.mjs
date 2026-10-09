import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const c = vm.createContext({});
vm.runInContext(ts.transpile(readFileSync('src/lib/hitRegions.ts', 'utf8').replace(/^export /gm, ''), { target: ts.ScriptTarget.ES2022 }), c);
const rect = (x=0, y=0, width=100, height=100) => ({x,y,width,height});
const plain = value => JSON.parse(JSON.stringify(value));

test('scrim subsumes nested controls; duplicates and DOM order do not change region', () => {
  assert.deepEqual(plain(c.normalizeHitRects([rect(40,40,20,20),rect(),rect()],300,200)), [rect()]);
  const a=rect(10,10,40,40), b=rect(200,10,40,40);
  assert.deepEqual(plain(c.normalizeHitRects([b,a,a],300,200)), plain(c.normalizeHitRects([a,b],300,200)));
});
test('physical regions are clipped to viewport; invisible, invalid and negative extents are excluded', () => {
  assert.deepEqual(plain(c.normalizeHitRects([rect(-20,-10,50,40),rect(280,190,50,40),rect(310),rect(0,0,0,20),rect(NaN),rect(0,0,-10,100)],300,200)), [rect(0,0,30,30),rect(280,190,20,10)]);
});
test('unchanged content/focus mutations send no IPC; failed sends can retry', async () => {
  const calls=[];let fail=true;
  const sync=c.createHitRegionSync(async r=>{calls.push(r);if(fail){fail=false;throw Error('temporary');}});
  await sync([rect()]);await sync([rect()]);await sync([rect()]);
  assert.equal(calls.length,2);
});
test('slow IPC cannot apply obsolete geometry after the latest; drag cleanup restores shaped region', async () => {
  const calls=[];let release;const gate=new Promise(resolve=>release=resolve);
  const sync=c.createHitRegionSync(async r=>{calls.push(plain(r));if(calls.length===1)await gate;});
  const first=sync([rect()]);sync([rect(0,0,300,200)]);const last=sync([rect(20,20,80,80)]);
  release();await Promise.all([first,last]);assert.deepEqual(calls,[[rect()],[rect(20,20,80,80)]]);
});
test('updates during an already-acknowledged drain are not lost', async () => {
  const calls=[];const sync=c.createHitRegionSync(async r=>calls.push(plain(r)));
  await sync([rect()]);const equal=sync([rect()]);const changed=sync([]);
  await Promise.all([equal,changed]);assert.deepEqual(calls,[[rect()],[]]);
});
