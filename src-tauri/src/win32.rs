//! Win32 helpers that keep the desktop layer pinned to the bottom of the
//! z-order while letting mouse input fall through to the real desktop beneath
//! (Explorer icons / wallpaper / taskbar) everywhere except the interactive
//! panel rectangles.
//!
//! Why `WS_EX_TRANSPARENT` and not `WM_NCHITTEST`/`HTTRANSPARENT`?
//! `HTTRANSPARENT` only forwards the hit-test to another window *in the same
//! thread*, so it can never reach the Explorer desktop (a different process).
//! The `WS_EX_TRANSPARENT` extended style, by contrast, makes the OS skip the
//! window's input entirely and deliver the cursor event to whatever is below,
//! regardless of process. So we poll the cursor and toggle `WS_EX_TRANSPARENT`
//! on for empty regions and off over the panels.

#![cfg(windows)]

use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::RwLock;

use windows::Win32::Foundation::{HWND, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, DefWindowProcW, GetCursorPos, GetWindowLongPtrW, KillTimer,
    SetTimer, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, GWL_WNDPROC,
        HTCLIENT, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    SWP_FRAMECHANGED, WM_NCDESTROY, WM_NCHITTEST, WM_TIMER, WM_WINDOWPOSCHANGING,
    WS_EX_TRANSPARENT,
};

/// Original window procedure of the subclassed desktop-layer window.
static ORIGINAL_PROC: AtomicIsize = AtomicIsize::new(0);

/// Native handle of the layer, for the click-through poller.
static LAYER_HWND: AtomicIsize = AtomicIsize::new(0);

/// Interactive rectangles in **physical** screen coordinates. Only points
/// inside these receive input on the webview; everywhere else is made input
/// transparent so the native desktop stays fully interactive.
static HIT_RECTS: RwLock<Vec<RECT>> = RwLock::new(Vec::new());

/// ID + cadence of the cursor poll that toggles `WS_EX_TRANSPARENT`.
const CLICKTHROUGH_TIMER_ID: usize = 0x4E53; // "NS"
const CLICKTHROUGH_POLL_MS: u32 = 33;

/// Replaces the interactive-rect set (physical pixels).
pub fn set_hit_rects(rects: Vec<RECT>) {
    if let Ok(mut guard) = HIT_RECTS.write() {
        *guard = rects;
    }
}

#[allow(dead_code)]
pub fn clear_hit_rects() {
    if let Ok(mut guard) = HIT_RECTS.write() {
        guard.clear();
    }
}

fn point_in_interactive(x: i32, y: i32) -> bool {
    HIT_RECTS
        .read()
        .map(|rects| {
            rects
                .iter()
                .any(|r| x >= r.left && x < r.right && y >= r.top && y < r.bottom)
        })
        .unwrap_or(false)
}

/// Pin the layer to the bottom of the z-order, subclass its window procedure
/// and start the poller that makes empty regions click-through.
pub fn pin_desktop_layer(hwnd_value: isize) {
    if hwnd_value == 0 {
        return;
    }

    let hwnd = HWND(hwnd_value as _);
    LAYER_HWND.store(hwnd_value, Ordering::SeqCst);

    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_BOTTOM),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );

        #[allow(function_casts_as_integer)]
        let previous =
            SetWindowLongPtrW(hwnd, GWL_WNDPROC, layer_window_proc as usize as _);
        ORIGINAL_PROC.store(previous, Ordering::SeqCst);

                // Start polling the cursor every ~33ms to toggle click-through.
        SetTimer(Some(hwnd), CLICKTHROUGH_TIMER_ID, CLICKTHROUGH_POLL_MS, None);

        // Begin fully click-transparent so the desktop is interactive the
        // instant the window appears; update_click_through () will lift the
        // transparency whenever the cursor rests on a panel rect.
        let base = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let _ = SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            (base | WS_EX_TRANSPARENT.0 as u32) as isize,
        );
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_BOTTOM),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
        );
    }
}

/// Push the layer down again (used after display changes or on demand).
pub fn reassert_bottom() {
    let value = LAYER_HWND.load(Ordering::SeqCst);
    if value == 0 {
        return;
    }

    unsafe {
        let _ = SetWindowPos(
            HWND(value as _),
            Some(HWND_BOTTOM),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

/// Cursor-driven toggle of `WS_EX_TRANSPARENT`:
///  - over an interactive panel  -> not transparent (webview gets the input)
///  - over empty desktop         -> transparent (input falls through to Explorer)
/// While the left button is held down *over the layer*, we keep it interactive
/// so a panel drag doesn't break when the cursor leaves the panel bounds.
unsafe fn update_click_through(hwnd: HWND) {
    let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
    let currently_transparent = style & WS_EX_TRANSPARENT.0 as u32 != 0;

    // If the user is mid-gesture on the layer, hold the current mode.
    let left_down = (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16) & 0x8000 != 0;
    if left_down && !currently_transparent {
        return;
    }

    let mut pt = POINT::default();
    if GetCursorPos(&mut pt).is_err() {
        return;
    }
    let mut client = pt;
    let _ = ScreenToClient(hwnd, &mut client);

    let wants_transparent = !point_in_interactive(client.x, client.y);
    if wants_transparent != currently_transparent {
        let new_style = if wants_transparent {
            if style & WS_EX_TRANSPARENT.0 as u32 == 0 {
                style | WS_EX_TRANSPARENT.0 as u32
            } else {
                style
            }
        } else {
            style & !(WS_EX_TRANSPARENT.0 as u32)
        };
                let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style as isize);
        // Style changes only take effect after a frame-change flush. Keep the
        // layer pinned to the bottom and non-activating while we do so.
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_BOTTOM),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
        );
    }
}

unsafe extern "system" fn layer_window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> LRESULT {
    match msg {
        WM_WINDOWPOSCHANGING => {
            // Force the layer back to the bottom of the z-order no matter
            // who is trying to move it where.
            let params = lparam.0 as *mut windows::Win32::UI::WindowsAndMessaging::WINDOWPOS;
            if !params.is_null() {
                (*params).hwndInsertAfter = HWND_BOTTOM;
                (*params).flags &= !SWP_NOZORDER;
            }
            LRESULT(0)
        }
                WM_TIMER if wparam.0 == CLICKTHROUGH_TIMER_ID as usize => {
            update_click_through(hwnd);
            LRESULT(0)
        }
                WM_NCHITTEST => {
            // Input routing is handled by toggling WS_EX_TRANSPARENT, so when
            // the layer is interactive the whole window is a normal hit target.
            LRESULT(HTCLIENT as isize)
        }
        WM_NCDESTROY => {
            let _ = KillTimer(Some(hwnd), CLICKTHROUGH_TIMER_ID);
            let previous = ORIGINAL_PROC.load(Ordering::SeqCst);
            if previous != 0 {
                let original: unsafe extern "system" fn(
                    HWND,
                    u32,
                    WPARAM,
                    windows::Win32::Foundation::LPARAM,
                ) -> LRESULT = std::mem::transmute(previous);
                CallWindowProcW(Some(original), hwnd, msg, wparam, lparam)
            } else {
                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
        }
        _ => {
            let previous = ORIGINAL_PROC.load(Ordering::SeqCst);
            if previous != 0 {
                let original: unsafe extern "system" fn(
                    HWND,
                    u32,
                    WPARAM,
                    windows::Win32::Foundation::LPARAM,
                ) -> LRESULT = std::mem::transmute(previous);
                CallWindowProcW(Some(original), hwnd, msg, wparam, lparam)
            } else {
                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
        }
    }
}
