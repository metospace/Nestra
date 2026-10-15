//! Session-level desktop takeover: pause, native icon visibility, search.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager};

use crate::paths;
#[cfg(windows)]
use crate::explorer;
#[cfg(windows)]
use crate::win32;

pub const SESSION_EVENT: &str = "nestra://session";
pub const STATE_CHANGED_EVENT: &str = "nestra://state-changed";

static PAUSED: AtomicBool = AtomicBool::new(false);
/// 共存模式默认不隐藏原生图标——收纳区才是真收纳的载体。
static HIDE_NATIVE: AtomicBool = AtomicBool::new(false);

pub fn is_paused() -> bool {
    PAUSED.load(Ordering::SeqCst)
}

pub fn hide_native_enabled() -> bool {
    HIDE_NATIVE.load(Ordering::SeqCst)
}

pub fn set_hide_native_icons(hide: bool) {
    HIDE_NATIVE.store(hide, Ordering::SeqCst);
    if is_paused() {
        return;
    }
    #[cfg(windows)]
    if hide {
        explorer::hide_icons();
    } else {
        explorer::restore_icons();
    }
}

/// 启动接管：先从持久化状态恢复 hideNativeIcons，再决定是否隐藏系统图标。
/// 否则用户即使关掉了"隐藏图标"，每次启动也会先藏后还原，图标闪一下。
///
/// 迁移：旧版默认接管模式，老状态文件里 hideNativeIcons 常被写成 true。
/// 切到共存模型后复位一次（标记通过前端保存链写入），避免升级后
/// "桌面没有图标"。配置损坏时恢复由本应用隐藏的图标。
pub fn apply_takeover(app: &AppHandle) {
    // Migration is persisted by the frontend's normal save chain. Startup and
    // the Explorer watchdog must never race save_state using a shared temp file.
    let hide = paths::state_file(app).and_then(|file| crate::persistence::load(&file).ok())
        .is_some_and(|value| value["hideNativeIcons"] == true && value["coexistMigrated"] == true
            && value["schemaVersion"].as_u64().unwrap_or(1) <= 2);
    HIDE_NATIVE.store(hide, Ordering::SeqCst);
    #[cfg(windows)]
    if hide && !is_paused() { explorer::hide_icons(); }
    else { explorer::restore_icons(); }
}

pub fn set_paused(app: &AppHandle, paused: bool) {
    PAUSED.store(paused, Ordering::SeqCst);
    let Some(layer) = app.get_webview_window("desktop") else {
        return;
    };

    if paused {
        #[cfg(windows)]
        win32::release_keyboard_focus();
        #[cfg(windows)]
        win32::set_stay_on_desktop(false);
        let _ = layer.hide();
        #[cfg(windows)]
        explorer::restore_icons();
        let _ = app.emit(SESSION_EVENT, "paused");
        return;
    }

    #[cfg(windows)]
    if hide_native_enabled() {
        explorer::hide_icons();
    }
    #[cfg(windows)]
    win32::set_stay_on_desktop(true);
    let _ = layer.show();
    #[cfg(windows)]
    win32::reassert_bottom();
    let _ = app.emit(SESSION_EVENT, "resumed");
}

pub fn toggle_paused(app: &AppHandle) -> bool {
    let next = !is_paused();
    set_paused(app, next);
    next
}

pub fn open_search(app: &AppHandle) {
    if let Some(search) = app.get_webview_window("search") {
        let _ = search.show(); let _ = search.unminimize(); let _ = search.set_focus();
        let _ = app.emit_to("search", "nestra://search-focus", ());
    }
}

pub fn show_desktop_layer(app: &AppHandle) {
    if is_paused() {
        set_paused(app, false);
        return;
    }
    if let Some(layer) = app.get_webview_window("desktop") {
        let _ = layer.show();
        #[cfg(windows)]
        win32::reassert_bottom();
    }
}

pub fn prepare_exit() {
    #[cfg(windows)]
    explorer::restore_icons();
}
