// Native helper protocol smoke test; run with a freshly built debug executable.
// Uses only disposable fixtures, never the installed organizer's state.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const exe=resolve(process.argv[2] ?? 'src-tauri/target/debug/nestra.exe');
const release=process.argv.includes('--release');
const fixture=mkdtempSync(join(tmpdir(),'Nestra-中文-'));
const cache=join(fixture,'cache');mkdirSync(cache);
const run=request=>spawnSync(exe,['--nestra-shell-worker'],{input:JSON.stringify(request),encoding:'utf8',windowsHide:true,timeout:20000});
try {
 if(!release){
  const failed=run({operation:'TestExit'});
  assert.equal(failed.status,73);assert.equal(failed.error,undefined);
 }
 const empty=run({operation:'Icons',paths:[],cache_dir:cache});
 assert.equal(empty.status,0);assert.deepEqual(JSON.parse(empty.stdout),{Ok:null});
 const text=join(fixture,'图标测试.txt');writeFileSync(text,'fixture only');
 const icons=run({operation:'Icons',paths:[text,join(fixture,'missing-path')],cache_dir:cache});
 assert.equal(icons.status,0,icons.error?.message ?? icons.stderr);
 assert.deepEqual(JSON.parse(icons.stdout),{Ok:null});
 assert.ok(readdirSync(cache).some(name=>name.endsWith('.png')),'real native icon extraction');
 assert.ok(readdirSync(cache).some(name=>name.endsWith('.fail')),'failed paths are negatively cached');
 assert.ok(!readdirSync(cache).some(name=>name.endsWith('.tmp')),'successful output is atomically published');
 console.log(`PASS: ${release?'release helper':'abnormal helper exit, subsequent healthy helper'}, Unicode IPC, real Shell icon, failed-path cache`);
} finally {
 assert.ok(resolve(fixture).startsWith(resolve(tmpdir())+sep),'cleanup stays inside the fixture temp directory');
 rmSync(fixture,{recursive:true,force:true});
}
