import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";

const source = readFileSync(new URL("../src/lib/tauri.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("tauri.ts", source, ts.ScriptTarget.Latest, true);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node)
  && ["launchEntry", "openEntry"].includes(node.name?.text));
const code = ts.transpile(functions.map(node => node.getText(ast).replace(/^export /, "")).join("\n"), { target: ts.ScriptTarget.ES2022 });

test("shortcut launch hands the .lnk to Windows so arguments and working directory survive", async () => {
  const calls = [];
  const context = vm.createContext({ invoke: async (...args) => calls.push(args) });
  vm.runInContext(code, context);
  await context.launchEntry({ kind: "shortcut", path: "C:\\Desktop\\Work.lnk", target: "C:\\App\\app.exe", launchKind: "filesystem" });
  assert.equal(calls[0][0], "open_entry");
  assert.equal(calls[0][1].target, "C:\\Desktop\\Work.lnk");
});

test("virtual Windows entries use their shell URI", async () => {
  const calls = [];
  const context = vm.createContext({ invoke: async (...args) => calls.push(args) });
  vm.runInContext(code, context);
  await context.launchEntry({ kind: "shell", path: "", target: "shell:MyComputerFolder", launchKind: "shell" });
  assert.equal(calls[0][1].target, "shell:MyComputerFolder");
});
