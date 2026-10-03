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
