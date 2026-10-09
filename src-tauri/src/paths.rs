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
    // Native UI checks run beside the user's instance without sharing its state.
    #[cfg(feature = "ui-test")]
    {
        let _ = manager;
        return Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../releases/native-ui-test/state.json"));
    }
    #[cfg(not(feature = "ui-test"))]
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
