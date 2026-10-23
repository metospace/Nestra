//! Hide / restore Explorer's native desktop icon layer.
//!
//! Uses the same SHELLDLL_DefView `WM_COMMAND 0x7402` toggle as the WPF host
//! so Explorer's own "show desktop icons" state stays consistent.

#![cfg(windows)]

use std::sync::Mutex;

use windows::core::{w, BOOL, PCWSTR};
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetPropW, IsWindow, IsWindowVisible,
    RemovePropW, SendMessageTimeoutW, SetPropW, SMTO_ABORTIFHUNG, WM_COMMAND,
};

const TOGGLE_DESKTOP_ICONS: usize = 0x7402;
const SPAWN_WORKER: u32 = 0x052C;
const MARKER: PCWSTR = w!("Nestra.HiddenDesktopIconLayer");
const MARKER_VALUE: isize = 2;

// HWND properties disappear with Explorer. Keep ownership in this process too,
// but only inherit it onto a replacement view after the old HWND was destroyed.
// Serialize watchdog hide and settings/exit restore operations.
static HIDDEN_VIEW: Mutex<isize> = Mutex::new(0);

fn owns_hidden_layer(marked: bool, owned: isize, current: isize, old_is_window: bool) -> bool {
    marked || (owned != 0 && (owned == current || !old_is_window))
}

struct FoundView {
    def_view: HWND,
    host: HWND,
}

/// Hide Explorer desktop icons if they are currently visible.
pub fn hide_icons() {
    let Ok(mut owned) = HIDDEN_VIEW.lock() else { return; };
    let Some(def_view) = find_def_view() else {
        return;
    };
    let list_view = find_list_view(def_view);
    if list_view.0.is_null() || unsafe { !IsWindow(Some(list_view)).as_bool() } {
        return;
    }

    let already_marked = unsafe { GetPropW(list_view, MARKER) };
    let visible = unsafe { IsWindowVisible(list_view).as_bool() };

    let owns = owns_hidden_layer(!already_marked.0.is_null(), *owned, list_view.0 as isize,
        *owned != 0 && unsafe { IsWindow(Some(HWND(*owned as _))).as_bool() });
    if !visible && !owns {
        // User (or another tool) already hid the icons; leave them alone.
        return;
    }

    if visible {
        toggle_icons(def_view);
        // A failed/hung toggle must never give us ownership of a user setting.
        if unsafe { IsWindowVisible(list_view).as_bool() } { return; }
    }

    unsafe {
        let _ = SetPropW(list_view, MARKER, Some(HANDLE(MARKER_VALUE as _)));
    }
    *owned = list_view.0 as isize;
}

/// Restore icons only when this process hid them.
pub fn restore_icons() {
    let Ok(mut owned) = HIDDEN_VIEW.lock() else { return; };

    let Some(def_view) = find_def_view() else {
        return;
    };
    let list_view = find_list_view(def_view);
    if list_view.0.is_null() || unsafe { !IsWindow(Some(list_view)).as_bool() } {
        return;
    }

    let marked = unsafe { GetPropW(list_view, MARKER) };
    let visible = unsafe { IsWindowVisible(list_view).as_bool() };
    let owns = owns_hidden_layer(!marked.0.is_null(), *owned, list_view.0 as isize,
        *owned != 0 && unsafe { IsWindow(Some(HWND(*owned as _))).as_bool() });
    if !visible && owns {
        toggle_icons(def_view);
        if unsafe { !IsWindowVisible(list_view).as_bool() } { return; }
    }
    unsafe {
        let _ = RemovePropW(list_view, MARKER);
    }
    *owned = 0;
}

#[cfg(test)]
mod tests {
    use super::owns_hidden_layer;

    #[test]
    fn icon_ownership_survives_explorer_restart_but_does_not_claim_user_hidden_icons() {
        assert!(!owns_hidden_layer(false, 0, 200, false));
        assert!(owns_hidden_layer(false, 100, 200, false));
        assert!(!owns_hidden_layer(false, 100, 200, true));
        assert!(owns_hidden_layer(false, 100, 100, true));
        assert!(owns_hidden_layer(true, 0, 200, false));
    }
}

fn toggle_icons(def_view: HWND) {
    let mut result: usize = 0;
    unsafe {
        let _ = SendMessageTimeoutW(
            def_view,
            WM_COMMAND,
            WPARAM(TOGGLE_DESKTOP_ICONS),
            LPARAM(0),
            SMTO_ABORTIFHUNG,
            1000,
            Some(&mut result),
        );
    }
}

fn spawn_workerw(progman: HWND) {
    let mut ignored: usize = 0;
    unsafe {
        let _ = SendMessageTimeoutW(
            progman,
            SPAWN_WORKER,
            WPARAM(0),
            LPARAM(0),
            SMTO_ABORTIFHUNG,
            1000,
            Some(&mut ignored),
        );
        let _ = SendMessageTimeoutW(
            progman,
            SPAWN_WORKER,
            WPARAM(0xD),
            LPARAM(1),
            SMTO_ABORTIFHUNG,
            1000,
            Some(&mut ignored),
        );
    }
}

fn find_def_view() -> Option<HWND> {
    let progman = unsafe { FindWindowW(w!("Progman"), None).unwrap_or_default() };
    if !progman.0.is_null() {
        if let Ok(def_view) =
            unsafe { FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), None) }
        {
            if !def_view.0.is_null() {
                return Some(def_view);
            }
        }
    }

    if let Some(def_view) = scan_workerw_for_def_view() {
        return Some(def_view);
    }

    // 前两条路都没找到才 spawn 一次再扫——spawn 会新建 WorkerW，
    // 无条件调用（曾经每 400ms 一次）会在系统里堆出一串死窗口。
    if !progman.0.is_null() {
        spawn_workerw(progman);
        return scan_workerw_for_def_view();
    }
    None
}

fn scan_workerw_for_def_view() -> Option<HWND> {
    let mut found = FoundView {
        def_view: HWND::default(),
        host: HWND::default(),
    };
    unsafe {
        let _ = EnumWindows(Some(enum_worker), LPARAM(&mut found as *mut FoundView as isize));
    }
    if found.def_view.0.is_null() {
        None
    } else {
        Some(found.def_view)
    }
}

fn find_list_view(def_view: HWND) -> HWND {
    unsafe { FindWindowExW(Some(def_view), None, w!("SysListView32"), None).unwrap_or_default() }
}

unsafe extern "system" fn enum_worker(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let found = &mut *(lparam.0 as *mut FoundView);
    if let Ok(child) = FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), None) {
        if !child.0.is_null() {
            found.def_view = child;
            found.host = hwnd;
            return BOOL(0);
        }
    }
    BOOL(1)
}
