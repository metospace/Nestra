import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCollection, getIcon } from '@iconify/vue';
import { buildOfflineCollection, collectIconNames, offlineIconsPlugin, subsetCollection } from '../scripts/offline-icons.mjs';

test('offline scan includes static, conditional and data-driven literal names', () => {
  assert.deepEqual(collectIconNames([
    '<UIcon name="i-lucide-x" :name="open ? \'i-lucide-eye\' : \'i-lucide-eye-off\'"/>',
    'const tabs = [{ icon: "i-lucide-settings-2" }]; const icon = "lucide:circle-check";',
  ]), ['circle-check', 'eye', 'eye-off', 'settings-2', 'x']);
});

test('offline subset carries alias chains and rejects unavailable or circular names', () => {
  const collection = { prefix: 'test', width: 24, height: 24,
    icons: { original: { body: '<path d="M0 0"/>' }, unused: { body: '<path/>' } },
    aliases: { first: { parent: 'original' }, second: { parent: 'first', rotate: 1 } } };
  const result = subsetCollection(collection, ['second']);
  assert.deepEqual(Object.keys(result.icons), ['original']);
  assert.deepEqual(Object.keys(result.aliases), ['first', 'second']);
  assert.throws(() => subsetCollection(collection, ['missing']), /Unknown offline/);
  assert.throws(() => subsetCollection({ ...collection, aliases: { a: { parent: 'b' }, b: { parent: 'a' } } }, ['a']), /Circular/);
});

test('all app and Nuxt UI icon names resolve offline without bundling the entire library', () => {
  const { collection, names, files } = buildOfflineCollection(process.cwd());
  assert.ok(files.some(file => /[\\/]@nuxt[\\/]ui[\\/]/.test(file)), 'must scan installed UI defaults');
  assert.ok(names.includes('loader-circle') && names.includes('chevron-down') && names.includes('check'));
  assert.ok(names.length > 30 && names.length < 250, `unexpected icon subset size: ${names.length}`);
  assert.ok(addCollection(collection));
  for (const name of names) assert.ok(getIcon(`lucide:${name}`)?.body, `${name} must resolve without an API request`);
});

test('development edits reload the collection only when offline icon names change', () => {
  const root = mkdtempSync(join(tmpdir(), 'nestra-icons-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'vite.config.ts'), 'export default {}');
    const source = join(root, 'src', 'Example.vue');
    writeFileSync(source, '<UIcon name="i-lucide-x"/>');
    const plugin = offlineIconsPlugin();
    const id = '\0virtual:nestra-icons';
    plugin.configResolved({ root });
    plugin.load.call({ addWatchFile() {} }, id);
    const iconModule = { id }, component = { id: source };
    let invalidated = 0;
    const server = { moduleGraph: {
      getModuleById: () => iconModule,
      invalidateModule(module) { assert.equal(module, iconModule); invalidated++; },
    } };
    const context = { file: source.replaceAll('\\', '/'), modules: [component], server };
    assert.equal(plugin.handleHotUpdate(context), undefined);
    const names = buildOfflineCollection(root).names;
    const full = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve('@iconify-json/lucide/icons.json')), 'utf8'));
    const newIcon = Object.keys(full.icons).find(name => !names.includes(name));
    assert.ok(newIcon);
    writeFileSync(source, `<UIcon name="i-lucide-${newIcon}"/>`);
    assert.deepEqual(plugin.handleHotUpdate(context), [component, iconModule]);
    assert.equal(invalidated, 1);
    const output = plugin.load.call({ addWatchFile() {} }, id);
    assert.ok(output.includes(`"${newIcon}":`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('new files with unknown icons report an overlay error without crashing the watcher', () => {
  const root = mkdtempSync(join(tmpdir(), 'nestra-icons-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'vite.config.ts'), 'export default {}');
    const plugin = offlineIconsPlugin();
    plugin.configResolved({ root });
    plugin.load.call({ addWatchFile() {} }, '\0virtual:nestra-icons');
    const handlers = {}, messages = [], errors = [];
    plugin.configureServer({
      moduleGraph: { getModuleById: () => ({}), invalidateModule() {} },
      watcher: { on(event, handler) { handlers[event] = handler; return this; }, off() {} },
      config: { logger: { error: message => errors.push(message) } },
      ws: { send: message => messages.push(message) },
    });
    const file = join(root, 'src', 'New.vue');
    writeFileSync(file, '<UIcon name="i-lucide-this-icon-does-not-exist"/>');
    assert.doesNotThrow(() => handlers.add(file));
    assert.match(errors[0], /Unknown offline/);
    assert.equal(messages[0].type, 'error');
    assert.match(messages[0].err.message, /this-icon-does-not-exist/);
    // Production builds still fail rather than silently omitting broken icons.
    assert.throws(() => plugin.load.call({ addWatchFile() {} }, '\0virtual:nestra-icons'), /Unknown offline/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
