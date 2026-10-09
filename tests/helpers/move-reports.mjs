import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
export function loadMoveReports() {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL('../../src/composables/fileMoveReports.ts', import.meta.url),'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { require: createRequire(import.meta.url), module, exports: module.exports });
  return module.exports;
}
