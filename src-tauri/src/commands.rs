//! IPC commands exposed to the webview frontends.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::paths;
use crate::scanner;

static RECENT_LAUNCHES: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
fn remember_launch(target: &str) {
    if let Ok(mut recent)=RECENT_LAUNCHES.lock() {
        recent.retain(|path|!path.eq_ignore_ascii_case(target));
        recent.insert(0,target.to_owned());
        recent.truncate(50);
    }
}
#[tauri::command]
pub fn recent_launches() -> Vec<String> {RECENT_LAUNCHES.lock().map(|paths|paths.clone()).unwrap_or_default()}

#[tauri::command]
pub async fn show_manager(app: AppHandle, module: Option<String>, object_id: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::show_manager(&app);
        if let Some(module) = module {
            let _ = app.emit_to("manager", "nestra://manager-route", serde_json::json!({"module":module,"objectId":object_id}));
        }
    })
        .await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn scan_paths(paths: Vec<String>) -> Result<Vec<scanner::DesktopEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || scanner::scan_paths(&paths)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scan_folder(path: String) -> Result<Vec<scanner::DesktopEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || scanner::scan_folder(&path)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scan_applications() -> Result<Vec<scanner::DesktopEntry>, String> {
    tauri::async_runtime::spawn_blocking(scanner::scan_applications).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_clipboard_enabled(enabled: bool) { crate::clipboard::set_enabled(enabled); }

#[tauri::command]
pub async fn pick_file() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| pick_path_isolated(false)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn move_to_folder(path: String, folder: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::files::move_to_folder(&path, folder.as_deref())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_file_moves() -> Result<Vec<crate::files::MoveRecord>, String> {
    tauri::async_runtime::spawn_blocking(crate::files::list_file_moves).await.map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn undo_file_move(id: u64) -> Result<crate::files::UndoResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::files::undo_file_move(id)).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub fn set_mapping_watch_paths(paths: Vec<String>) {
    crate::watch::set_mapped_paths(paths);
}

#[tauri::command]
pub async fn search_mapped_folders(
    paths: Vec<String>,
    query: String,
    limit: usize,
) -> Result<Vec<scanner::DesktopEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || scanner::search_folders(&paths, &query, limit.min(200)))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn search_everything(query: String, limit: usize) -> Result<crate::everything::SearchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || crate::everything::search(&query, limit))
        .await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn set_desktop_hover_tracking(window: tauri::WebviewWindow, app: AppHandle, enabled: bool, generation: Option<u64>) -> Result<u64, String> {
    if window.label() != "desktop" { return Err("悬停检测仅供桌面层使用".into()); }
    tauri::async_runtime::spawn_blocking(move || crate::desktop_hover::set_enabled(app, enabled, generation))
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn everything_status() -> Result<crate::everything_setup::EverythingStatus, String> {
    tauri::async_runtime::spawn_blocking(crate::everything_setup::status)
        .await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn install_everything(install_dir: String) -> Result<crate::everything_setup::EverythingStatus, String> {
    tauri::async_runtime::spawn_blocking(move || crate::everything_setup::install(&install_dir))
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn start_everything() -> Result<crate::everything_setup::EverythingStatus, String> {
    tauri::async_runtime::spawn_blocking(crate::everything_setup::start)
        .await.map_err(|error| error.to_string())?
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub id: String,
    pub legacy_id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub is_primary: bool,
    pub work_area: DisplayWorkArea,
}

#[derive(Clone, Serialize)]
pub struct DisplayWorkArea { pub x: f64, pub y: f64, pub width: f64, pub height: f64 }

#[tauri::command]
pub fn list_displays(app: AppHandle) -> Result<Vec<DisplayInfo>, String> {
    use tauri::Manager;
    let layer = app.get_webview_window("desktop").ok_or("桌面层尚未创建")?;
    let scale = layer.scale_factor().unwrap_or(1.0);
    let primary = app.primary_monitor().map_err(|error| error.to_string())?;
    let (origin_x, origin_y, _, _) = crate::win32::virtual_desktop_bounds();
    let monitors = app.available_monitors().map_err(|error| error.to_string())?;
    Ok(monitors.into_iter().map(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        let work_area = monitor.work_area();
        let is_primary = primary.as_ref().is_some_and(|candidate|
            candidate.position() == position && candidate.size() == size);
        let name = monitor.name().cloned().unwrap_or_else(|| "显示器".into());
        DisplayInfo {
            id: crate::win32::monitor_identity(&name),
            legacy_id: name.clone(),
            name,
            x: (position.x - origin_x) as f64 / scale,
            y: (position.y - origin_y) as f64 / scale,
            width: size.width as f64 / scale,
            height: size.height as f64 / scale,
            is_primary,
            work_area: DisplayWorkArea {
                x: (work_area.position.x - origin_x) as f64 / scale,
                y: (work_area.position.y - origin_y) as f64 / scale,
                width: work_area.size.width as f64 / scale,
                height: work_area.size.height as f64 / scale,
            },
        }
    }).collect())
}

#[tauri::command]
pub async fn pick_folder() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| pick_path_isolated(true))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(windows)]
pub(crate) fn pick_path_blocking(folder: bool) -> Result<Option<String>, String> {
    use windows::core::{w, Interface};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM,
        FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
    };
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(|e| e.to_string())?;
        struct ComGuard;
        impl Drop for ComGuard { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
        let _guard = ComGuard;
        let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| e.to_string())?;
        let base: IFileDialog = dialog.cast().map_err(|e| e.to_string())?;
        let options = base.GetOptions().map_err(|e| e.to_string())?;
        base.SetOptions(options | (if folder { FOS_PICKFOLDERS } else { windows::Win32::UI::Shell::FOS_FILEMUSTEXIST }) | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST)
            .map_err(|e| e.to_string())?;
        base.SetTitle(if folder { w!("选择文件夹") } else { w!("选择文件") }).map_err(|e| e.to_string())?;
        if dialog.Show(None).is_err() { return Ok(None); }
        let item = base.GetResult().map_err(|e| e.to_string())?;
        let value = item.GetDisplayName(SIGDN_FILESYSPATH).map_err(|e| e.to_string())?;
        let path = value.to_string().map_err(|e| e.to_string())?;
        CoTaskMemFree(Some(value.0.cast()));
        Ok(Some(path))
    }
}

#[cfg(not(windows))]
fn pick_path_blocking(_folder: bool) -> Result<Option<String>, String> { Err("仅支持 Windows".into()) }

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
    tauri::async_runtime::spawn_blocking(move || {
        crate::icons::resolve_pairs(pairs, cache_dir)
    }).await.unwrap_or_default()
}

#[tauri::command]
pub async fn open_entry(target: String, launch_kind: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || open_entry_blocking(target, launch_kind))
        .await.map_err(|e| e.to_string())?
}

fn open_entry_blocking(target: String, launch_kind: String) -> Result<(), String> {
    if launch_kind == "shell" || target.starts_with("shell:") || target.starts_with("http") {
        // Explorer resolves `shell:` URIs such as MyComputerFolder.
        std::process::Command::new("explorer.exe")
            .arg(&target)
            .spawn()
            .map_err(|error| format!("无法打开系统入口：{error}"))?;
        remember_launch(&target);
        return Ok(());
    }

    shell_execute_open(&target)?;
    remember_launch(&target);
    Ok(())
}

#[tauri::command]
pub async fn reveal_entry(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || reveal_entry_blocking(path)).await.map_err(|e| e.to_string())?
}

fn reveal_entry_blocking(path: String) -> Result<(), String> {
    let meta = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    if meta.is_dir() {
        return shell_execute_open(&path);
    }

    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn load_state(app: AppHandle) -> Result<Value, String> {
    let file = paths::state_file(&app).ok_or("无法确定状态文件位置")?;
    tauri::async_runtime::spawn_blocking(move || crate::persistence::load(&file)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_state(app: AppHandle, state: Value, origin: Option<String>, expected: Option<Value>) -> Result<(), String> {
    let file = paths::state_file(&app).ok_or_else(|| "无法确定状态文件位置".to_string())?;
    tauri::async_runtime::spawn_blocking(move || crate::persistence::save(&file, &state, &expected.unwrap_or(Value::Null)))
        .await.map_err(|e| e.to_string())??;

    let _ = app.emit(
        crate::STATE_CHANGED_EVENT,
        origin.unwrap_or_default(),
    );
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    crate::shutdown::request_exit(&app);
}

#[tauri::command]
pub fn acknowledge_exit(window: tauri::WebviewWindow, request_id: u64, error: Option<String>) {
    crate::shutdown::acknowledge(window.label(), request_id, error);
}

#[tauri::command]
pub fn rename_entry(path: String, name: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        crate::files::rename_entry(&path, &name)
    }
    #[cfg(not(windows))]
    {
        let _ = (path, name);
        Err("仅支持 Windows".into())
    }
}

#[tauri::command]
pub fn recycle_entry(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::files::recycle_entry(&path)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("仅支持 Windows".into())
    }
}

#[tauri::command]
pub async fn set_paused(app: AppHandle, paused: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::session::set_paused(&app, paused);
        paused
    }).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_paused() -> bool {
    crate::session::is_paused()
}

#[tauri::command]
pub fn set_hide_native_icons(hide: bool) -> bool {
    crate::session::set_hide_native_icons(hide);
    hide
}

#[tauri::command]
pub fn start_with_windows() -> bool {
    #[cfg(windows)]
    {
        crate::startup::is_enabled()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command]
pub fn set_start_with_windows(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        crate::startup::set_enabled(enabled)
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("仅支持 Windows".into())
    }
}

#[tauri::command]
pub async fn open_search(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::session::open_search(&app))
        .await.map_err(|error| error.to_string())
}

/// 收纳语义 = 真实移动：拖进收纳区 → 移入 Desktop\.nestra\<zone>；
/// 放回桌面 → 移回桌面顶层。文件不再出现在桌面，原生图标自然消失。
#[tauri::command]
pub async fn create_zone(name: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || crate::files::create_zone(&name))
            .await.map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = name;
        Err("仅支持 Windows".into())
    }
}

#[tauri::command]
pub async fn move_to_zone(path: String, zone_dir: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || crate::files::move_to_zone(&path, &zone_dir))
            .await.map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (path, zone_dir);
        Err("仅支持 Windows".into())
    }
}

#[tauri::command]
pub fn move_paths_to_zone(paths: Vec<String>, zone_dir: String) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        crate::files::move_paths_to_zone(&paths, &zone_dir)
    }
    #[cfg(not(windows))]
    {
        let _ = (paths, zone_dir);
        Err("仅支持 Windows".into())
    }
}

#[tauri::command]
pub fn move_to_desktop(path: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        crate::files::move_to_desktop(&path)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("仅支持 Windows".into())
    }
}

/// 删除收纳区：目录里的文件全部放回桌面顶层。
#[tauri::command]
pub async fn dissolve_zone(zone_dir: String) -> Result<crate::files::DissolveResult, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || crate::files::dissolve_zone(&zone_dir))
            .await.map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = zone_dir;
        Err("仅支持 Windows".into())
    }
}

#[tauri::command]
pub fn rename_zone_dir(old_dir: String, new_dir: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::files::rename_zone_dir(&old_dir, &new_dir)
    }
    #[cfg(not(windows))]
    {
        let _ = (old_dir, new_dir);
        Err("仅支持 Windows".into())
    }
}

/// 桌面层需要键盘输入时调用：把前台线程的输入焦点借到层窗口上。
#[tauri::command]
pub async fn grant_desktop_input(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        let pending = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let request = pending.clone();
        app.run_on_main_thread(move || {
            // A callback still queued after the caller timed out must not take
            // keyboard focus when the user has already left the editor.
            if !request.swap(false, std::sync::atomic::Ordering::SeqCst) { return; }
            let granted = crate::win32::grant_keyboard_focus_on_window_thread();
            let _ = send.send(granted);
        }).map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            let result = receive.recv_timeout(std::time::Duration::from_secs(2));
            if result.is_err() {
                pending.store(false, std::sync::atomic::Ordering::SeqCst);
                crate::desktop_diagnostics::record("input-focus-timeout", serde_json::json!({ "stage": "window-thread" }));
            }
            result.map_err(|error| error.to_string())
                .and_then(|granted| if granted { Ok(()) } else { Err("无法取得 WebView 键盘焦点".into()) })
        }).await.map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    { let _ = app; Ok(()) }
}

/// 输入完成后归还键盘焦点（搜索/重命名关闭、输入框失焦时调用）。
#[tauri::command]
pub async fn release_desktop_input(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            crate::win32::release_keyboard_focus_on_window_thread();
            let _ = send.send(());
        }).map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn_blocking(move ||
            receive.recv_timeout(std::time::Duration::from_secs(2)).map_err(|error| error.to_string())
        ).await.map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    { let _ = app; Ok(()) }
}

#[tauri::command]
pub async fn show_shell_menu(
    path: String,
    x: i32,
    y: i32,
    to_desktop: bool,
    in_launcher: bool,
    can_fold: bool,
    can_rename: bool,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let request = crate::shell_worker::Request::Menu { menu: crate::shell_worker::MenuRequest {
                path, x, y, to_desktop, in_launcher, can_fold, can_rename,
            }};
            crate::shell_worker::execute(&request, std::time::Duration::from_secs(300))?
                .as_str().map(str::to_owned).ok_or_else(|| "系统菜单返回无效".into())
        }).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (path, x, y, to_desktop, in_launcher, can_fold, can_rename);
        Err("仅支持 Windows".into())
    }
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
    crate::shell_worker::execute(&crate::shell_worker::Request::Open { target: target.into() }, std::time::Duration::from_secs(30))?;
    #[cfg(not(windows))]
    let _ = target;
    Ok(())
}

fn pick_path_isolated(folder: bool) -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        let result = crate::shell_worker::execute(&crate::shell_worker::Request::Pick { folder }, std::time::Duration::from_secs(600))?;
        serde_json::from_value(result).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    pick_path_blocking(folder)
}

pub(crate) fn shell_execute_open_native(target: &str) -> Result<(), String> {
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
