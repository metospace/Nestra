import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleId = 'virtual:nestra-icons';
const resolvedId = '\0' + moduleId;
const sourceExtensions = new Set(['.vue', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css', '.html']);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : sourceExtensions.has(extname(path)) ? [path] : [];
  });
}

/** Read whole sources, not just template attributes: maps and conditional icon
 * choices use the same literal names. Keep complete names literal in sources;
 * don't construct an icon name by concatenating a prefix with user input. */
export function collectIconNames(sources) {
  const names = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/\b(?:i-lucide-|lucide:)([a-z0-9]+(?:-[a-z0-9]+)*)\b/g)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

/** Carry alias parents transitively so Iconify can resolve every offline name. */
export function subsetCollection(collection, names) {
  const subset = { prefix: collection.prefix, width: collection.width, height: collection.height, icons: {} };
  const visiting = new Set();
  const add = name => {
    if (subset.icons[name] || subset.aliases?.[name]) return;
    if (visiting.has(name)) throw new Error(`Circular Lucide alias: ${name}`);
    visiting.add(name);
    if (collection.icons[name]) subset.icons[name] = collection.icons[name];
    else if (collection.aliases?.[name]) {
      const alias = collection.aliases[name];
      add(alias.parent);
      (subset.aliases ??= {})[name] = alias;
    } else throw new Error(`Unknown offline Lucide icon: ${name}`);
    visiting.delete(name);
  };
  names.forEach(add);
  return subset;
}

export function buildOfflineCollection(root) {
  // Scan installed Nuxt UI defaults instead of copying a whitelist which drifts
  // on dependency updates. This also includes its built-in component icons.
  const uiDirectory = dirname(fileURLToPath(import.meta.resolve('@nuxt/ui/vite')));
  const files = [...sourceFiles(resolve(root, 'src')), resolve(root, 'vite.config.ts'), ...sourceFiles(uiDirectory)];
  const names = collectIconNames(files.map(file => readFileSync(file, 'utf8')));
  const collectionFile = fileURLToPath(import.meta.resolve('@iconify-json/lucide/icons.json'));
  const collection = JSON.parse(readFileSync(collectionFile, 'utf8'));
  return { collection: subsetCollection(collection, names), names, files: [...files, collectionFile] };
}

export function offlineIconsPlugin() {
  let root;
  let serialized;
  function refresh(server, file) {
    // Vite uses slash-normalized paths on Windows; normalize before comparing.
    if (!resolve(file).startsWith(resolve(root, 'src') + sep)) return;
    const icons = server.moduleGraph.getModuleById(resolvedId);
    if (!icons) return;
    const next = JSON.stringify(buildOfflineCollection(root).collection);
    if (next === serialized) return; // Ordinary component edits keep Vue HMR.
    serialized = next;
    server.moduleGraph.invalidateModule(icons);
    return icons;
  }
  return {
    name: 'nestra-offline-icons',
    configResolved(config) { root = config.root; },
    resolveId(id) { if (id === moduleId) return resolvedId; },
    load(id) {
      if (id !== resolvedId) return;
      const result = buildOfflineCollection(root);
      result.files.forEach(file => this.addWatchFile(file));
      serialized = JSON.stringify(result.collection);
      return `export default ${serialized};`;
    },
    configureServer(server) {
      // A newly imported component can introduce icons before it has ever been
      // loaded by Vite. Refresh the collection on add/unlink as well as edits.
      const update = file => {
        try {
          if (refresh(server, file)) server.ws.send({ type: 'full-reload' });
        } catch (error) {
          // Watcher callbacks are outside Vite's plugin error boundary. Surface
          // a typo in the overlay without terminating the development server.
          const failure = error instanceof Error ? error : new Error(String(error));
          server.config.logger.error(failure.message);
          server.ws.send({ type: 'error', err: {
            message: failure.message, stack: failure.stack ?? '', plugin: 'nestra-offline-icons',
          } });
        }
      };
      server.watcher.on('add', update).on('unlink', update);
      server.httpServer?.once('close', () => {
        server.watcher.off('add', update).off('unlink', update);
      });
    },
    handleHotUpdate(context) {
      const icons = refresh(context.server, context.file);
      if (icons) return [...context.modules, icons];
    },
  };
}
