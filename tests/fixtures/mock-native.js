// Browser-only acceptance adapter. No call is forwarded to Tauri/native APIs.
// Each page has independent memory; refresh discards its files/configuration.
export const layout = (x, y, width = 336, height = 380) => ({
  x, y, width, height, zIndex: 10, visible: true, monitorId: 'main',
});
export const appearance = { styleVersion: 1, theme: 'light', surfaceMaterial: 'glass', cornerStyle: 'standard', borderStyle: 'subtle', panelOpacity: .95 };
export function configuration(patch = {}) {
  return { schemaVersion: 2, coexistMigrated: true, customGroups: [], tabGroups: [],
    panelLayouts: { 'system:launcher': { ...layout(760, 120), visible: false, launcherVisibilityMigrated: true },
      'system:search': { ...layout(370, 22, 280, 46), visible: false } },
    foldedItems: {}, itemOrders: {}, launcherIds: [], launcherReferences: {}, launchCollections: [],
    appearance: { ...appearance }, widgets: [], startWithWindows: false, hideNativeIcons: false,
    clipboardEnabled: true, ...patch };
}
export function entry(name, zone = null, patch = {}) {
  const path = zone ? `C:\\fixture\\Desktop\\.nestra\\${zone}\\${name}` : `C:\\fixture\\Desktop\\${name}`;
  return { id: `file:${path}`, name, path, target: '', kind: 'file', launchKind: 'filesystem',
    sourceLabel: zone ?? '个人桌面', glyph: '文', isHidden: false, isFresh: false,
    isApplication: false, iconPath: null, canManage: true, zone, ...patch };
}
export function installFixture({ label = 'desktop', disk: initialDisk, files: initialFiles = [], commands = {}, onInvoke = () => {} }) {
  const state = { disk: structuredClone(initialDisk), files: structuredClone(initialFiles), calls: [], paused: false };
  let callbackId = 0, listenerId = 0;
  const callbacks = new Map(), listeners = new Map();
  function emit(event, payload) {
    for (const [id, listener] of listeners) if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
  }
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event, id) => listeners.delete(id) };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { label } },
    transformCallback: callback => { callbacks.set(++callbackId, callback); return callbackId; },
    unregisterCallback: id => callbacks.delete(id), convertFileSrc: path => path,
    invoke: async (command, args = {}) => {
      state.calls.push({ command, args }); onInvoke(command, args, state);
      if (commands[command]) return commands[command](args, state, emit);
      if (command === 'load_state') return structuredClone(state.disk);
      if (command === 'save_state') { state.disk = structuredClone(args.state); return; }
      if (command === 'scan_desktop') return structuredClone(state.files);
      if (command === 'scan_paths') return structuredClone(state.files.filter(file => args.paths.includes(file.path)));
      if (command === 'list_displays') return [{ id: 'main', name: '验收显示器', x: 0, y: 0, width: 1200, height: 800, isPrimary: true }];
      if (command === 'list_storage_zones') return state.disk.customGroups.filter(group => !group.mappedPath && group.sourceKind !== 'category').map(group => ({ dirName: group.dirName }));
      if (command === 'resolve_icon_pairs') return {};
      if (['scan_applications', 'scan_folder', 'recent_launches', 'list_file_moves', 'list_configuration_backups', 'search_mapped_folders', 'clip_load'].includes(command)) return [];
      if (command === 'search_everything') return { available: false, message: '示例数据 · 未连接 Everything', total: 0, entries: [] };
      if (command === 'get_paused') return state.paused;
      if (command === 'set_paused') { state.paused = args.paused; return args.paused; }
      if (command === 'start_with_windows') return false;
      if (command === 'set_start_with_windows') return args.enabled;
      if (command === 'set_hide_native_icons') return args.hide;
      if (command === 'open_search') { emit('nestra://session', 'search'); return; }
      if (command === 'create_zone') return args.name;
      if (command === 'rename_zone_dir') {
        for (const file of state.files.filter(file => file.zone === args.oldDir)) {
          file.path = file.path.replace(`\\${args.oldDir}\\`, `\\${args.newDir}\\`);
          file.id = `${file.isApplication ? 'app:shortcut:' : 'file:'}${file.path}`;
          file.zone = args.newDir;
        }
        return;
      }
      if (command === 'dissolve_zone') {
        const moves = [];
        for (const file of state.files.filter(file => file.zone === args.zoneDir)) {
          const fromPath = file.path;
          file.path = `C:\\fixture\\Desktop\\${file.name}`; file.zone = null;
          file.id = `${file.isApplication ? 'app:shortcut:' : 'file:'}${file.path}`;
          moves.push({ fromPath, newPath: file.path });
        }
        return { moves, error: null };
      }
      if (command === 'move_to_zone' || command === 'move_to_desktop') {
        const file = state.files.find(file => file.path === args.path);
        if (!file) throw Error('示例源文件不存在');
        file.zone = command === 'move_to_zone' ? args.zoneDir : null;
        file.path = file.zone ? `C:\\fixture\\Desktop\\.nestra\\${file.zone}\\${file.name}` : `C:\\fixture\\Desktop\\${file.name}`;
        file.id = `${file.isApplication ? 'app:shortcut:' : 'file:'}${file.path}`;
        return file.path;
      }
      if (command === 'rename_entry') {
        const file = state.files.find(file => file.path === args.path);
        if (!file) throw Error('示例源文件不存在');
        file.path = file.path.slice(0, file.path.lastIndexOf('\\') + 1) + args.name; file.name = args.name;
        file.id = `file:${file.path}`; return file.path;
      }
      if (command === 'recycle_entry') { state.files = state.files.filter(file => file.path !== args.path); return; }
      if (command === 'plugin:event|listen') { listeners.set(++listenerId, args); return listenerId; }
      if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
      if (command === 'plugin:window|scale_factor') return 1;
      if (['set_mapping_watch_paths', 'set_clipboard_enabled', 'set_hit_rects', 'grant_desktop_input', 'release_desktop_input',
        'open_entry', 'reveal_entry', 'show_manager', 'show_shell_menu', 'acknowledge_exit'].includes(command)
        || command.startsWith('plugin:event|') || command.startsWith('plugin:window|')) return;
      throw Error(`Fixture blocked IPC: ${command}`);
    },
  };
  return { state, emit };
}

export async function mountFixtureApp(Controls) {
  await import('/src/main.tsx');
  if (!Controls) return;
  const React = await import('react'), { createRoot } = await import('react-dom/client');
  const controls = document.createElement('aside'); controls.className = 'fixture-controls nestra-hit'; document.body.append(controls);
  createRoot(controls).render(React.createElement(Controls));
}
