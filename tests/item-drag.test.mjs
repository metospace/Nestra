import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";

const source = readFileSync(new URL("../src/composables/useItemDrag.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("useItemDrag.ts", source, ts.ScriptTarget.Latest, true);
const code = ts.transpile(ast.statements.filter(s => !ts.isImportDeclaration(s))
  .map(s => s.getText(ast).replace(/^export /, "")).join("\n"), { target: ts.ScriptTarget.ES2022 });

function setup() {
  const events = new Map(), classes = new Set(), actions = [];
  class Element {
    dataset = {};
    classList = { add() {}, remove() {} };
    captured = false;
    addEventListener() {}
    removeEventListener() {}
    setPointerCapture() { this.captured = true; }
    hasPointerCapture() { return this.captured; }
    releasePointerCapture() { this.captured = false; }
    closest() { return null; }
    hasAttribute() { return false; }
  }
  const target = new Element();
  let hit = target;
  const context = vm.createContext({ HTMLElement: Element, reactive: x => x,
    document: { body: { classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)) } }, elementFromPoint: () => hit },
    window: { innerWidth: 1920, innerHeight: 1080, setTimeout,
      addEventListener: (name, cb) => events.set(name, cb),
      removeEventListener: (name, cb) => { if (events.get(name) === cb) events.delete(name); } },
    scheduleHitRectSync() {}, showStatus() {},
    placeItem: async (...args) => actions.push(["place", ...args]),
    moveEntryToDesktop: async id => actions.push(["desktop", id]),
    moveItem: async () => "new-path-id",
    foldItem: (...args) => actions.push(["fold", ...args]),
    unfoldItem() {},
  });
  vm.runInContext(code, context);
  const event = (x, y) => ({button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: target, preventDefault() {}});
  context.startItemDrag(event(10, 10), { id: "old-path-id", name: "test.txt", zone: "zone-a" });
  return { context, classes, actions, target,
    fire: (name, x=40, y=40) => events.get(name)?.(event(x,y)),
    setHit: next => { hit = next; },
    zone: { dataset: { groupId: "zone-b" }, classList: target.classList },
  };
}

test("small pointer movement remains a click and never moves a file", () => {
  const t = setup(); t.fire("pointermove", 12,12); t.fire("pointerup",12,12);
  assert.deepEqual(t.actions, []); assert.equal(t.target.captured, false);
});
test("cross-zone pointer drag dispatches one file move and restores desktop input", async () => {
  const t = setup(); t.setHit({closest: selector => selector === "[data-group-id]" ? t.zone : null});
  t.fire("pointermove"); assert.equal(t.classes.has("is-item-dragging"), true);
  t.fire("pointerup"); await Promise.resolve();
  assert.deepEqual(t.actions, [["place","old-path-id","zone-b",null]]);
  assert.equal(t.classes.size,0); assert.equal(t.target.captured,false);
});
test("cancelled drag restores clipping and does not move files", () => {
  const t = setup(); t.fire("pointermove"); t.fire("pointercancel"); t.fire("pointerup");
  assert.deepEqual(t.actions, []); assert.equal(t.classes.size,0); assert.equal(t.target.captured,false);
});
test("only the desktop background accepts return-to-desktop drops", () => {
  const t = setup(); t.fire("pointermove"); t.fire("pointerup");
  assert.deepEqual(t.actions, []);
  const u = setup(); u.setHit({closest: () => null, hasAttribute: key => key === "data-desktop-background"});
  u.fire("pointermove"); u.fire("pointerup");
  assert.deepEqual(u.actions, [["desktop","old-path-id"]]);
});
test("folding across zones uses the new path identity", async () => {
  const t = setup(); await t.context.finishItemDrop("old-path-id","zone-b",null,true);
  assert.deepEqual(t.actions, [["fold","zone:zone-b","new-path-id"]]);
});
