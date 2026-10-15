//! Durable, serialized state writes and recovery without touching user files.

use std::{fs, io::Write, path::Path, sync::Mutex};
use serde_json::Value;

static STATE_LOCK: Mutex<()> = Mutex::new(());

fn parse(bytes: &[u8]) -> Result<Value, String> {
    let text = std::str::from_utf8(bytes).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| e.to_string())?;
    if !value.is_object() { return Err("配置必须是对象".into()); }
    Ok(value)
}

fn backup_is_valid(value: &Value) -> bool {
    value.get("panelLayouts").is_some_and(Value::is_object)
        && ["customGroups", "widgets", "launcherIds"].iter().all(|key| value.get(key).is_some_and(Value::is_array))
        && value.get("schemaVersion").map_or(true, |version| version.as_u64().is_some_and(|v| (1..=2).contains(&v)))
}

/// The same lock covers recovery and compare-and-save across all WebViews.
pub fn load(file: &Path) -> Result<Value, String> {
    let _guard = STATE_LOCK.lock().map_err(|e| e.to_string())?;
    load_locked(file)
}

fn load_locked(file: &Path) -> Result<Value, String> {
    let original = match fs::read(file) {
        Ok(bytes) => {
            if let Ok(value) = parse(&bytes) { return Ok(value); }
            Some(bytes)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("配置读取失败：{e}")),
    };
    let backup_dir = file.parent().ok_or("配置目录无效")?.join("backups");
    let mut candidates = Vec::new();
    if backup_dir.exists() {
        for entry in fs::read_dir(&backup_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.path().extension().is_some_and(|ext| ext == "json") {
                let modified = entry.metadata().and_then(|m| m.modified()).ok();
                candidates.push((modified, entry.path()));
            }
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    for (_, candidate) in candidates {
        let Ok(bytes) = fs::read(candidate) else { continue; };
        let Ok(value) = parse(&bytes) else { continue; };
        if !backup_is_valid(&value) { continue; }
        // Preserve the damaged bytes before restoring; never overwrite the
        // only surviving copy when a disk/permission error prevents a backup.
        if let Some(bytes) = &original {
            let name = format!("corrupt-{}-{}.bin", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default());
            let mut backup = fs::OpenOptions::new().write(true).create_new(true).open(backup_dir.join(name)).map_err(|e| e.to_string())?;
            backup.write_all(bytes).and_then(|_| backup.sync_all()).map_err(|e| e.to_string())?;
        }
        atomic_write(file, &bytes)?;
        return Ok(value);
    }
    if original.is_none() { Ok(Value::Null) }
    else { Err("配置已损坏，未找到有效备份；已保留原文件".into()) }
}

/// Compare-and-save retains both the new snapshot and its previous generation.
pub fn save(file: &Path, state: &Value, expected: &Value) -> Result<(), String> {
    let _guard = STATE_LOCK.lock().map_err(|e| e.to_string())?;
    if !state.is_object() { return Err("配置必须是对象".into()); }
    let previous = match fs::read(file) {
        Ok(bytes) => {
            let current = parse(&bytes).map_err(|e| format!("配置读取失败：{e}"))?;
            if current != *expected { return Err("STATE_CONFLICT".into()); }
            Some(bytes)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if !expected.is_null() { return Err("STATE_CONFLICT".into()); }
            None
        }
        Err(e) => return Err(e.to_string()),
    };
    let bytes = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
    let parent = file.parent().ok_or("配置目录无效")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    if let Some(previous) = previous {
        atomic_write(&parent.join("backups/previous.json"), &previous)?;
    }
    // Keep the latest intended snapshot durable before replacing the main
    // file, including the first save. Recovery should retain the newest edit.
    atomic_write(&parent.join("backups/last-good.json"), &bytes)?;
    atomic_write(file, &bytes)
}

fn atomic_write(file: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::create_dir_all(file.parent().ok_or("配置目录无效")?).map_err(|e| e.to_string())?;
    let temporary = file.with_extension(format!("{}.{}.tmp", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()));
    let result = (|| {
        let mut out = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
        out.write_all(bytes).and_then(|_| out.sync_all()).map_err(|e| e.to_string())?;
        drop(out);
        // Flush file contents before the rename. On Windows, also request a
        // durable replacement rather than leaving the move in the disk cache.
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows::{core::PCWSTR, Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH}};
            let from: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<u16> = file.as_os_str().encode_wide().chain(Some(0)).collect();
            unsafe { MoveFileExW(PCWSTR(from.as_ptr()), PCWSTR(to.as_ptr()), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) }.map_err(|e| e.to_string())?;
        }
        #[cfg(not(windows))]
        {
            fs::rename(&temporary, file).map_err(|e| e.to_string())?;
            fs::File::open(file.parent().unwrap()).and_then(|dir| dir.sync_all()).map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(temporary); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    struct Workspace(std::path::PathBuf);
    impl Workspace {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("nestra-persistence-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
            fs::create_dir(&dir).unwrap(); Self(dir)
        }
        fn file(&self) -> std::path::PathBuf { self.0.join("state.json") }
    }
    impl Drop for Workspace { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn state(name: &str) -> Value { json!({"schemaVersion":2,"panelLayouts":{},"customGroups":[{"id":name,"name":name,"dirName":name}],"widgets":[],"launcherIds":[]}) }

    #[test]
    fn save_retains_previous_generation_and_rejects_stale_writers() {
        let workspace = Workspace::new(); let file = workspace.file();
        save(&file, &state("one"), &Value::Null).unwrap();
        save(&file, &state("two"), &state("one")).unwrap();
        assert_eq!(load(&file).unwrap(), state("two"));
        assert_eq!(parse(&fs::read(workspace.0.join("backups/last-good.json")).unwrap()).unwrap(), state("two"));
        assert_eq!(parse(&fs::read(workspace.0.join("backups/previous.json")).unwrap()).unwrap(), state("one"));
        assert_eq!(save(&file, &state("stale"), &state("one")).unwrap_err(), "STATE_CONFLICT");
        assert_eq!(load(&file).unwrap(), state("two"));
        assert!(!fs::read_dir(&workspace.0).unwrap().flatten().any(|entry| entry.path().extension().is_some_and(|ext| ext == "tmp")));
    }

    #[test]
    fn zero_filled_state_is_preserved_and_restored_from_last_good() {
        let workspace = Workspace::new(); let file = workspace.file();
        save(&file, &state("one"), &Value::Null).unwrap();
        save(&file, &state("two"), &state("one")).unwrap();
        let damaged = vec![0; 7299]; fs::write(&file, &damaged).unwrap();
        assert_eq!(load(&file).unwrap(), state("two"));
        assert_eq!(parse(&fs::read(&file).unwrap()).unwrap(), state("two"));
        let preserved = fs::read_dir(workspace.0.join("backups")).unwrap().flatten().find(|entry| entry.path().extension().is_some_and(|ext| ext == "bin")).unwrap();
        assert_eq!(fs::read(preserved.path()).unwrap(), damaged);
        assert_eq!(load(&file).unwrap(), state("two"));
    }

    #[test]
    fn recovery_skips_invalid_and_future_backups() {
        let workspace = Workspace::new(); let file = workspace.file();
        fs::create_dir(workspace.0.join("backups")).unwrap();
        fs::write(workspace.0.join("backups/valid.json"), serde_json::to_vec(&state("backup")).unwrap()).unwrap();
        fs::write(workspace.0.join("backups/invalid.json"), b"{broken").unwrap();
        fs::write(workspace.0.join("backups/null.json"), b"null").unwrap();
        let mut future = state("future"); future["schemaVersion"] = json!(3);
        fs::write(workspace.0.join("backups/future.json"), serde_json::to_vec(&future).unwrap()).unwrap();
        fs::write(&file, b"{broken").unwrap();
        assert_eq!(load(&file).unwrap(), state("backup"));
    }

    #[test]
    fn unreadable_or_broken_state_never_becomes_a_new_workspace() {
        let workspace = Workspace::new(); let file = workspace.file();
        assert_eq!(load(&file).unwrap(), Value::Null);
        fs::write(&file, b"{broken").unwrap();
        assert!(load(&file).is_err());
        assert!(save(&file, &state("overwrite"), &Value::Null).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"{broken");
        assert!(load(&workspace.0).is_err());
    }

    #[test]
    fn valid_future_state_is_never_rolled_back_to_an_old_backup() {
        let workspace = Workspace::new(); let file = workspace.file();
        save(&file, &state("old"), &Value::Null).unwrap();
        let mut future = state("future"); future["schemaVersion"] = json!(3);
        save(&file, &future, &state("old")).unwrap();
        assert_eq!(load(&file).unwrap(), future);
    }

    #[test]
    fn first_save_and_missing_state_can_recover_from_a_durable_copy() {
        let workspace = Workspace::new(); let file = workspace.file();
        save(&file, &state("first"), &Value::Null).unwrap();
        fs::remove_file(&file).unwrap();
        assert_eq!(load(&file).unwrap(), state("first"));
    }
}
