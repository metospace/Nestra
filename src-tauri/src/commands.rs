//! IPC commands exposed to the webview frontends.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::paths;
use crate::scanner;

/// Interactive rectangle in **physical** screen coordinates; points inside
/// hit the webview layer, everything else falls through to the desktop.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct HitRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[tauri::command]
pub fn set_hit_rects(rects: Vec<HitRect>) {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::RECT;
        crate::win32::set_hit_rects(
            rects
                .iter()
                .map(|r| RECT {
                    left: r.x,
                    top: r.y,
                    right: r.x + r.width,
                    bottom: r.y + r.height,
                })
                .collect(),
        );
    }

    #[cfg(not(windows))]
    {
        let _ = rects;
    }
}

#[tauri::command]
pub async fn scan_desktop() -> Vec<scanner::DesktopEntry> {
    tauri::async_runtime::spawn_blocking(scanner::scan_desktop)
        .await
        .unwrap_or_default()
}

/// Batched icon resolution, run AFTER the snapshot so the UI paints fast.
/// Each pair is `[primary_path, alternate_path]` (shortcuts fall back to their
/// resolved target). Returns primary → cached PNG path (None on failure).
#[tauri::command]
pub async fn resolve_icon_pairs(
    app: AppHandle,
    pairs: Vec<[String; 2]>,
) -> HashMap<String, Option<String>> {
    let cache_dir = paths::icon_cache_dir(&app);
    let mut out: HashMap<String, Option<String>> = HashMap::with_capacity(pairs.len());
    for pair in pairs {
        let primary = pair[0].clone();
        let png = crate::icons::icon_png_for(&primary, cache_dir.clone())
            .or_else(|| crate::icons::icon_png_for(pair.get(1).map(String::as_str).unwrap_or(""), cache_dir.clone()));
        out.insert(primary, png);
    }
    out
}

#[tauri::command]
pub fn open_entry(target: String, launch_kind: String) -> Result<(), String> {
    if launch_kind == "shell" || target.starts_with("shell:") || target.starts_with("http") {
        // Explorer resolves `shell:` URIs such as MyComputerFolder.
        std::process::Command::new("explorer.exe")
            .arg(&target)
            .spawn()
            .map_err(|error| format!("无法打开系统入口：{error}"))?;
        return Ok(());
    }

    shell_execute_open(&target)
}

#[tauri::command]
pub fn reveal_entry(path: String) -> Result<(), String> {
    let meta = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    if meta.is_dir() {
        return shell_execute_open(&path);
    }

    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_state(app: AppHandle) -> Value {
    let Some(file) = paths::state_file(&app) else {
        return Value::Null;
    };

    match std::fs::read_to_string(&file) {
        Ok(text) => serde_json::from_str::<Value>(&text).unwrap_or(Value::Null),
        Err(_) => Value::Null,
    }
}

#[tauri::command]
pub fn save_state(app: AppHandle, state: Value) -> Result<(), String> {
    let file = paths::state_file(&app).ok_or_else(|| "无法确定状态文件位置".to_string())?;
    if let Some(parent) = file.parent() {
        paths::ensure_dir(parent);
    }

    let temporary = file.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&state).map_err(|error| error.to_string())?;
    std::fs::write(&temporary, text).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, &file).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/* 剪贴板历史 --------------------------------------------------------------- */

#[tauri::command]
pub fn clip_load() -> Vec<crate::clipboard::ClipItem> {
    crate::clipboard::snapshot()
}

/// 复制指定历史项回系统剪贴板；成功返回其文本。
#[tauri::command]
pub fn clip_copy(id: String) -> Result<String, String> {
    crate::clipboard::copy_item_text(&id).ok_or_else(|| "剪贴板不可用或该项不存在".into())
}

#[tauri::command]
pub fn clip_remove(app: AppHandle, id: String) {
    crate::clipboard::remove_item(&app, &id);
}

#[tauri::command]
pub fn clip_clear(app: AppHandle) {
    crate::clipboard::clear_all(&app);
}

/// Opens an arbitrary path (file, folder or URL) through the shell.
fn shell_execute_open(target: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::core::{HSTRING, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        unsafe {
            let file = HSTRING::from(target);
            let verb = HSTRING::from("open");
            let instance = ShellExecuteW(
                None,
                PCWSTR(verb.as_ptr()),
                PCWSTR(file.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            );

            if instance.0 as isize <= 32 {
                return Err(format!("Shell 无法打开：{target}"));
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = target;
    }

    Ok(())
}
