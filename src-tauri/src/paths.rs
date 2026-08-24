//! Filesystem layout helpers shared by the Rust services.

use std::path::PathBuf;

use tauri::Manager;

/// `<app-local-data>/cache/icons`, also referenced by the asset-protocol scope.
pub fn icon_cache_dir<R: tauri::Runtime, M: Manager<R>>(manager: &M) -> Option<PathBuf> {
    Some(
        manager
            .path()
            .app_local_data_dir()
            .ok()?
            .join("cache")
            .join("icons"),
    )
}

/// `<app-local-data>/state.json`, mirroring the WPF version's storage model.
pub fn state_file<R: tauri::Runtime, M: Manager<R>>(manager: &M) -> Option<PathBuf> {
    Some(
        manager
            .path()
            .app_local_data_dir()
            .ok()?
            .join("state.json"),
    )
}

/// Best-effort directory creation.
pub fn ensure_dir(path: &std::path::Path) -> bool {
    std::fs::create_dir_all(path).is_ok()
}
