//! Poll personal + public desktop directories and emit when the file set changes.

use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter};

use crate::scanner;

pub const DESKTOP_CHANGED_EVENT: &str = "nestra://desktop-changed";

static MAPPED_PATHS: OnceLock<RwLock<Vec<PathBuf>>> = OnceLock::new();

/// The frontend owns mapping definitions, while this watcher owns refresh timing.
/// Updating this list removes the old browser-side polling loop and lets every
/// mapped directory participate in the same coalesced desktop change event.
pub fn set_mapped_paths(paths: Vec<String>) {
    let mut normalized: Vec<PathBuf> = paths
        .into_iter()
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .collect();
    normalized.sort();
    normalized.dedup();
    if let Ok(mut current) = MAPPED_PATHS.get_or_init(|| RwLock::new(Vec::new())).write() {
        *current = normalized;
    }
}

pub fn start(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut last = fingerprint();
        loop {
            std::thread::sleep(Duration::from_millis(1600));
            let next = fingerprint();
            if next != last {
                last = next;
                let _ = handle.emit(DESKTOP_CHANGED_EVENT, ());
            }
        }
    });
}

fn fingerprint() -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    let mut entries: Vec<(String, u64, u64, u32)> = Vec::new();

    let mut collect_dir = |root: &Path| {
        let Ok(read) = std::fs::read_dir(root) else {
            return;
        };
        for entry in read.flatten() {
            let path = entry.path();
            if path.file_name().is_some_and(|value| value.to_string_lossy().eq_ignore_ascii_case("desktop.ini")) {
                continue;
            }
            let name = path.to_string_lossy().into_owned();
            let meta = entry.metadata().ok();
            let modified = meta
                .as_ref()
                .and_then(|info| info.modified().ok())
                .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            let size = meta.as_ref().map(|info| info.len()).unwrap_or(0);
            // 隐藏等属性位也要进指纹，否则 attrib +h 不触发刷新。
            let attrs = meta
                .as_ref()
                .map(|info| info.file_attributes())
                .unwrap_or(0);
            entries.push((name, modified, size, attrs));
        }
    };

    for root in scanner::desktop_roots() {
        collect_dir(Path::new(&root));
    }
    // 收纳区（.nestra\<zone>\*）的变化同样要触发重扫。
    if let Some(storage) = scanner::storage_root() {
        if let Ok(zones) = std::fs::read_dir(&storage) {
            for zone in zones.flatten() {
                if zone.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    collect_dir(&zone.path());
                }
            }
        }
    }
    if let Ok(paths) = MAPPED_PATHS.get_or_init(|| RwLock::new(Vec::new())).read() {
        for path in paths.iter() {
            collect_dir(path);
        }
    }

    entries.sort_unstable();
    entries.len().hash(&mut hasher);
    for item in entries {
        item.hash(&mut hasher);
    }
    hasher.finish()
}
