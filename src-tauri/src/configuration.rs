use std::{fs, path::{Path, PathBuf}};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup { pub name: String, pub path: String, pub created_at: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageZone { pub dir_name: String, pub path: String, pub item_count: usize }

#[tauri::command]
pub async fn list_storage_zones() -> Result<Vec<StorageZone>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::scanner::storage_root().ok_or("无法确定桌面目录")?;
        if !root.exists() { return Ok(vec![]); }
        let mut zones = vec![];
        for item in fs::read_dir(root).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            if !item.file_type().map_err(|e| e.to_string())?.is_dir() { continue; }
            let count = fs::read_dir(item.path()).map_err(|e| e.to_string())?.flatten().filter(|entry| !entry.file_name().to_string_lossy().eq_ignore_ascii_case("desktop.ini")).count();
            zones.push(StorageZone { dir_name: item.file_name().to_string_lossy().into_owned(), path: item.path().to_string_lossy().into_owned(), item_count: count });
        }
        zones.sort_by(|a,b| a.dir_name.cmp(&b.dir_name));
        Ok(zones)
    }).await.map_err(|e| e.to_string())?
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::paths::state_file(app).ok_or("无法确定配置位置")?.parent().ok_or("配置目录无效")?.join("backups"))
}

#[tauri::command]
pub async fn backup_configuration(app: AppHandle, reason: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = crate::paths::state_file(&app).ok_or("无法确定配置位置")?;
        let bytes = fs::read(&file).map_err(|e| e.to_string())?;
        let dir = root(&app)?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let name = if reason == "migration" {
            format!("migration-{:x}.json", Sha256::digest(&bytes))
        } else { format!("configuration-{}.json", chrono::Local::now().format("%Y%m%d-%H%M%S-%f")) };
        let dest = dir.join(name);
        use std::io::Write;
        match fs::OpenOptions::new().write(true).create_new(true).open(&dest) {
            Ok(mut out) => {
                if let Err(error) = out.write_all(&bytes).and_then(|_| out.sync_all()) {
                    drop(out); let _ = fs::remove_file(&dest); return Err(error.to_string());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && reason == "migration" => {
                if fs::read(&dest).map_err(|e| e.to_string())? != bytes { return Err("迁移备份不完整，请检查备份文件".into()); }
            },
            Err(e) => return Err(e.to_string()),
        }
        Ok(dest.to_string_lossy().into_owned())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_configuration_backups(app: AppHandle) -> Result<Vec<Backup>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = root(&app)?;
        let mut results = vec![];
        if !dir.exists() { return Ok(results); }
        for item in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
            if item.path().extension().is_some_and(|ext| ext == "json") {
                let modified = item.metadata().and_then(|m| m.modified()).ok().map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%Y-%m-%d %H:%M:%S").to_string()).unwrap_or_default();
                results.push(Backup { name: item.file_name().to_string_lossy().into_owned(), path: item.path().to_string_lossy().into_owned(), created_at: modified });
            }
        }
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(results)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_configuration(app: AppHandle, folder: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&folder).canonicalize().map_err(|e| e.to_string())?;
        if !dir.is_dir() { return Err("请选择已有目录".into()); }
        let source = crate::paths::state_file(&app).ok_or("无法确定配置位置")?;
        let bytes = fs::read(source).map_err(|e| e.to_string())?;
        let dest = dir.join(format!("Nestra-configuration-{}.json", chrono::Local::now().format("%Y%m%d-%H%M%S-%f")));
        use std::io::Write;
        let mut out = fs::OpenOptions::new().write(true).create_new(true).open(&dest).map_err(|e| e.to_string())?;
        out.write_all(&bytes).map_err(|e| e.to_string())?;
        out.sync_all().map_err(|e| e.to_string())?;
        Ok(dest.to_string_lossy().into_owned())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_configuration(path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
        if !metadata.is_file() || metadata.len() > 8 * 1024 * 1024 { return Err("配置文件无效或超过 8 MB".into()); }
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}
