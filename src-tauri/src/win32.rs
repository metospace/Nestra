//! One stable WebView clipped to the visible desktop surfaces. Windows routes
//! clicks and OLE drops outside the native region directly to Explorer. Never
//! toggle WS_EX_LAYERED on a live WebView2 composition surface.
#![cfg(windows)]
use std::sync::{RwLock, atomic::{AtomicBool, AtomicIsize, Ordering}};
use windows::core::{w, BOOL};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{CreateRectRgn, CombineRgn, DeleteObject, SetWindowRgn, HRGN, RGN_OR};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetFocus, SetFocus};
use windows::Win32::UI::WindowsAndMessaging::*;

static ORIGINAL_PROC: AtomicIsize = AtomicIsize::new(0);
static LAYER_HWND: AtomicIsize = AtomicIsize::new(0);
static STAY_ON_DESKTOP: AtomicBool = AtomicBool::new(true);
static PREV_FOREGROUND: AtomicIsize = AtomicIsize::new(0);
static INPUT_GRANTED: AtomicBool = AtomicBool::new(false);
static ATTACHED_THREAD: AtomicIsize = AtomicIsize::new(0);
static HIT_RECTS: RwLock<Vec<RECT>> = RwLock::new(Vec::new());
const REGION_CHANGED: u32 = WM_APP + 0x51;
const RELEASE_INPUT: u32 = WM_APP + 0x53;
const RESTORE_TIMER_ID: usize = 0x4E54;

pub fn virtual_desktop_bounds() -> (i32, i32, u32, u32) {
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let width = GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1) as u32;
        let height = GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1) as u32;
        (x, y, width, height)
    }
}

pub fn set_hit_rects(rects: Vec<RECT>) {
    if let Ok(mut current) = HIT_RECTS.write() { *current = rects; }
    let hwnd = HWND(LAYER_HWND.load(Ordering::SeqCst) as _);
    if !hwnd.0.is_null() {
        unsafe { let _ = PostMessageW(Some(hwnd), REGION_CHANGED, WPARAM(0), LPARAM(0)); }
    }
}

unsafe fn build_region(rects: &[RECT]) -> Option<HRGN> {
    let region = CreateRectRgn(0, 0, 0, 0);
    if region.0.is_null() { return None; }
    for rect in rects {
        if rect.right <= rect.left || rect.bottom <= rect.top { continue; }
        let part = CreateRectRgn(rect.left, rect.top, rect.right, rect.bottom);
        if part.0.is_null() {
            let _ = DeleteObject(region.into());
            return None;
        }
        let result = CombineRgn(Some(region), Some(region), Some(part), RGN_OR);
        let _ = DeleteObject(part.into());
        if result.0 == 0 { let _ = DeleteObject(region.into()); return None; }
    }
    Some(region)
}

unsafe fn apply_surface_region(hwnd: HWND) {
    let rects = HIT_RECTS.read().map(|r| r.clone()).unwrap_or_default();
    if let Some(region) = build_region(&rects) {
        // On success Windows owns the region. An empty region leaves no hidden
        // full-screen input target during startup or when all surfaces are hidden.
        if SetWindowRgn(hwnd, Some(region), true) == 0 {
            let _ = DeleteObject(region.into());
        }
    }
}

fn desktop_host() -> Option<HWND> {
    unsafe extern "system" fn find(hwnd: HWND, data: LPARAM) -> BOOL {
        let mut class = [0u16; 64];
        let length = GetClassNameW(hwnd, &mut class) as usize;
        let class = String::from_utf16_lossy(&class[..length]);
        let shell = GetShellWindow();
        let mut shell_pid = 0;
        let mut candidate_pid = 0;
        GetWindowThreadProcessId(shell, Some(&mut shell_pid));
        GetWindowThreadProcessId(hwnd, Some(&mut candidate_pid));
        if matches!(class.as_str(), "Progman" | "WorkerW")
            && shell_pid != 0 && candidate_pid == shell_pid
            && FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), None)
                .is_ok_and(|child| !child.0.is_null()) {
            *(data.0 as *mut HWND) = hwnd;
            return BOOL(0);
        }
        BOOL(1)
    }
    let mut host = HWND::default();
    unsafe {
        let _ = EnumWindows(Some(find), LPARAM(&mut host as *mut HWND as isize));
    }
    (!host.0.is_null()).then_some(host)
}

// Explorer can host icons in WorkerW instead of Progman. Never insert a window
// after itself: that invalid z-order request used to occur on every click.
fn desktop_anchor(hwnd: HWND) -> Option<HWND> {
    let host = desktop_host()?;
    let mut above = unsafe { GetWindow(host, GW_HWNDPREV).unwrap_or_default() };
    if above == hwnd { above = unsafe { GetWindow(hwnd, GW_HWNDPREV).unwrap_or_default() }; }
    Some(if above.0.is_null() { HWND_TOP } else { above })
}

fn anchor_above_desktop(hwnd: HWND) {
    let Some(host) = desktop_host() else { return; };
    unsafe {
        if GetWindow(hwnd, GW_HWNDNEXT).ok() == Some(host) { return; }
        if let Some(anchor) = desktop_anchor(hwnd) {
            let _ = SetWindowPos(hwnd, Some(anchor), 0, 0, 0, 0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
        }
    }
}

pub fn pin_desktop_layer(value: isize) {
    let hwnd = HWND(value as _);
    if hwnd.0.is_null() { return; }
    LAYER_HWND.store(value, Ordering::SeqCst);
    STAY_ON_DESKTOP.store(true, Ordering::SeqCst);
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let style = (style | WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0)
            & !(WS_EX_APPWINDOW.0 | WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0);
        #[cfg(feature = "ui-test")]
        let style = (style | WS_EX_APPWINDOW.0) & !WS_EX_TOOLWINDOW.0;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style as isize);
        apply_surface_region(hwnd);
        #[allow(function_casts_as_integer)]
        let previous = SetWindowLongPtrW(hwnd, GWL_WNDPROC, layer_window_proc as usize as isize);
        ORIGINAL_PROC.store(previous, Ordering::SeqCst);
        SetTimer(Some(hwnd), RESTORE_TIMER_ID, 250, None);
    }
    anchor_above_desktop(hwnd);
}

pub fn set_stay_on_desktop(stay: bool) { STAY_ON_DESKTOP.store(stay, Ordering::SeqCst); }
pub fn reassert_bottom() {
    let hwnd = HWND(LAYER_HWND.load(Ordering::SeqCst) as _);
    if !hwnd.0.is_null() { anchor_above_desktop(hwnd); }
}
pub fn desktop_has_foreground() -> bool {
    unsafe {
        let foreground = GetForegroundWindow();
        let layer = HWND(LAYER_HWND.load(Ordering::SeqCst) as _);
        foreground == layer || desktop_host() == Some(foreground)
    }
}
pub fn layer_destroyed() -> bool {
    let hwnd = HWND(LAYER_HWND.load(Ordering::SeqCst) as _);
    !hwnd.0.is_null() && unsafe { !IsWindow(Some(hwnd)).as_bool() }
}
pub fn reset_layer_handle() {
    LAYER_HWND.store(0, Ordering::SeqCst);
    ORIGINAL_PROC.store(0, Ordering::SeqCst);
    INPUT_GRANTED.store(false, Ordering::SeqCst);
    PREV_FOREGROUND.store(0, Ordering::SeqCst);
    ATTACHED_THREAD.store(0, Ordering::SeqCst);
    if let Ok(mut rects) = HIT_RECTS.write() { rects.clear(); }
}

pub fn release_keyboard_focus() {
    post_input_request(RELEASE_INPUT);
}

fn post_input_request(message: u32) {
    let hwnd = HWND(LAYER_HWND.load(Ordering::SeqCst) as _);
    if !hwnd.0.is_null() {
        unsafe { let _ = PostMessageW(Some(hwnd), message, WPARAM(0), LPARAM(0)); }
    }
}

// AttachThreadInput and SetFocus must use the thread that OWNS the WebView.
// IPC/pause callbacks may run on other threads; keep the whole session here.
pub(crate) fn grant_keyboard_focus_on_window_thread() -> bool {
    let value = LAYER_HWND.load(Ordering::SeqCst);
    if value == 0 {
        return false;
    }
    let layer = HWND(value as _);
    unsafe {
        if !IsWindow(Some(layer)).as_bool() {
            return false;
        }

        let foreground = GetForegroundWindow();
        let target = FindWindowExW(Some(layer), None, w!("WRY_WEBVIEW"), None)
            .unwrap_or_else(|_| GetWindow(layer, GW_CHILD).unwrap_or(layer));
        let focused = GetFocus();
        if INPUT_GRANTED.load(Ordering::SeqCst)
            && (foreground == layer || foreground.0 as isize == PREV_FOREGROUND.load(Ordering::SeqCst))
            && (focused == target || IsChild(target, focused).as_bool()) {
            return true;
        }
        if !foreground.0.is_null() && foreground != layer {
            PREV_FOREGROUND.store(foreground.0 as isize, Ordering::SeqCst);
        }

        // 先归还旧的挂接（连续 focusin 时前台线程可能已变）。
        let old_thread = ATTACHED_THREAD.swap(0, Ordering::SeqCst);
        if old_thread != 0 {
            let own = GetCurrentThreadId();
            let _ = AttachThreadInput(own, old_thread as u32, false);
        }

        let foreground_thread = if foreground.0.is_null() {
            0
        } else {
            GetWindowThreadProcessId(foreground, None)
        };
        let own_thread = GetCurrentThreadId();

        // 挂接保持到 release_keyboard_focus：合并队列一拆，借来的焦点状态
        // 可能随队列拆分失效，所以整个"输入会话"期间都保持挂接。
        if foreground_thread != 0 && foreground_thread != own_thread {
            if AttachThreadInput(own_thread, foreground_thread, true).as_bool() {
                ATTACHED_THREAD.store(foreground_thread as isize, Ordering::SeqCst);
            }
        }

        // 焦点要给到 wry 的 WebView 宿主子窗口：它的窗口过程收到 WM_SETFOCUS
        // 后会调 MoveFocus 把键盘焦点推进页面。外层 Tauri 窗口没有这一步。
        let _ = SetFocus(Some(target));
        INPUT_GRANTED.store(true, Ordering::SeqCst);
        let focused = GetFocus();
        let granted = focused == target || IsChild(target, focused).as_bool();
        if !granted { release_keyboard_focus_on_window_thread(); }
        granted
    }
}

/// 归还借来的键盘焦点。只有当"看上去的前台窗口"仍是抢焦时那个窗口时才恢复
/// （用户若已点击别的应用，前台已切换，无需归还）。无论如何都断开输入挂接。
fn release_keyboard_focus_on_window_thread() {
    if !INPUT_GRANTED.swap(false, Ordering::SeqCst) {
        return;
    }
    unsafe {
        let previous = HWND(PREV_FOREGROUND.swap(0, Ordering::SeqCst) as _);
        let foreground = GetForegroundWindow();
        if !previous.0.is_null()
            && foreground == previous
            && IsWindow(Some(previous)).as_bool()
        {
            let _ = SetFocus(Some(previous));
            let _ = SetForegroundWindow(previous);
        }
    }

    let attached_thread = ATTACHED_THREAD.swap(0, Ordering::SeqCst);
    if attached_thread != 0 {
        unsafe {
            let _ = AttachThreadInput(
                GetCurrentThreadId(),
                attached_thread as u32,
                false,
            );
        }
    }
}

fn uncloak(hwnd: HWND) {
    #[cfg(windows)]
    {
        use windows::Win32::Graphics::Dwm::{
            DwmGetWindowAttribute, DwmSetWindowAttribute, DWMWINDOWATTRIBUTE,
        };

        const DWMWA_CLOAK: DWMWINDOWATTRIBUTE = DWMWINDOWATTRIBUTE(13);
        const DWMWA_CLOAKED: DWMWINDOWATTRIBUTE = DWMWINDOWATTRIBUTE(14);

        let mut cloaked: u32 = 0;
        let get = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut _,
                std::mem::size_of::<u32>() as u32,
            )
        };
        if get.is_err() || cloaked == 0 {
            return;
        }
        let disable = BOOL(0);
        let _ = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_CLOAK,
                &disable as *const BOOL as *const _,
                std::mem::size_of::<BOOL>() as u32,
            )
        };
    }
}


unsafe extern "system" fn layer_window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        REGION_CHANGED => { apply_surface_region(hwnd); return LRESULT(0); }
        RELEASE_INPUT => { release_keyboard_focus_on_window_thread(); return LRESULT(0); }
        WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
        WM_TIMER if wparam.0 == RESTORE_TIMER_ID => {
            if INPUT_GRANTED.load(Ordering::SeqCst) {
                let foreground = GetForegroundWindow();
                let previous = HWND(PREV_FOREGROUND.load(Ordering::SeqCst) as _);
                if foreground != previous && foreground != hwnd {
                    release_keyboard_focus_on_window_thread();
                }
            }
            if STAY_ON_DESKTOP.load(Ordering::SeqCst) {
                if IsIconic(hwnd).as_bool() || !IsWindowVisible(hwnd).as_bool() {
                    let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                }
                uncloak(hwnd);
                anchor_above_desktop(hwnd);
            }
            return LRESULT(0);
        }
        WM_DISPLAYCHANGE => {
            let (x, y, width, height) = virtual_desktop_bounds();
            let _ = SetWindowPos(
                hwnd,
                None,
                x,
                y,
                width as i32,
                height as i32,
                SWP_NOACTIVATE | SWP_NOZORDER,
            );
        }
        WM_SYSCOMMAND if STAY_ON_DESKTOP.load(Ordering::SeqCst)
            && wparam.0 & 0xFFF0 == SC_MINIMIZE as usize => return LRESULT(0),
        WM_WINDOWPOSCHANGING if STAY_ON_DESKTOP.load(Ordering::SeqCst) => {
            let pos = lparam.0 as *mut WINDOWPOS;
            if let Some(pos) = pos.as_mut() {
                pos.flags &= !SWP_HIDEWINDOW;
                if pos.flags.0 & SWP_NOZORDER.0 == 0 {
                    if let Some(anchor) = desktop_anchor(hwnd) { pos.hwndInsertAfter = anchor; }
                }
            }
        }
        WM_NCDESTROY => {
            release_keyboard_focus_on_window_thread();
            let _ = KillTimer(Some(hwnd), RESTORE_TIMER_ID);
        }
        _ => {}
    }
    let previous = ORIGINAL_PROC.load(Ordering::SeqCst);
    if previous != 0 {
        let proc: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT = std::mem::transmute(previous);
        CallWindowProcW(Some(proc), hwnd, msg, wparam, lparam)
    } else { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Graphics::Gdi::PtInRegion;
    #[test]
    fn native_region_covers_surfaces_but_not_desktop_between_them() {
        unsafe {
            let region = build_region(&[
                RECT { left: 10, top: 10, right: 100, bottom: 100 },
                RECT { left: 200, top: 10, right: 300, bottom: 100 },
            ]).unwrap();
            assert!(PtInRegion(region, 20, 20).as_bool());
            assert!(PtInRegion(region, 220, 20).as_bool());
            assert!(!PtInRegion(region, 150, 20).as_bool());
            assert!(!PtInRegion(region, 20, 150).as_bool());
            let _ = DeleteObject(region.into());
            let empty = build_region(&[]).unwrap();
            assert!(!PtInRegion(empty, 20, 20).as_bool());
            let _ = DeleteObject(empty.into());
        }
    }
}
