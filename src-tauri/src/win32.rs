//! Win32 helpers that keep the desktop layer pinned to the bottom of the
//! z-order while letting mouse input fall through every empty region, so the
//! native desktop beneath stays fully interactive (mirrors the WPF version's
//! `WM_NCHITTEST`/`HTTRANSPARENT` behaviour).

#![cfg(windows)]

use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::RwLock;

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, DefWindowProcW, SetWindowLongPtrW, SetWindowPos, GWL_WNDPROC,
    HTCLIENT, HTTRANSPARENT, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    WM_NCHITTEST, WM_WINDOWPOSCHANGING, WINDOWPOS,
};

/// Original window procedure of the subclassed desktop-layer window.
static ORIGINAL_PROC: AtomicIsize = AtomicIsize::new(0);

/// Native handle for later re-assertions.
static LAYER_HWND: AtomicIsize = AtomicIsize::new(0);

/// Interactive rectangles in **physical** screen coordinates. Only points
/// inside these hit the webview; everything else falls through to whatever
/// sits below the layer (Explorer desktop, icons, wallpaper).
static HIT_RECTS: RwLock<Vec<RECT>> = RwLock::new(Vec::new());

/// Replaces the interactive-rect set (physical pixels).
pub fn set_hit_rects(rects: Vec<RECT>) {
    if let Ok(mut guard) = HIT_RECTS.write() {
        *guard = rects;
    }
}

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

/// Subclass the window: pin it to the bottom of the z-order and forward
/// clicks outside the interactive rects to the windows underneath.
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

unsafe extern "system" fn layer_window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_WINDOWPOSCHANGING => {
            // Force the layer back to the bottom of the z-order no matter
            // who is trying to move it where.
            let params = lparam.0 as *mut WINDOWPOS;
            if !params.is_null() {
                (*params).hwndInsertAfter = HWND_BOTTOM;
                (*params).flags &= !SWP_NOZORDER;
            }
            LRESULT(0)
        }
        WM_NCHITTEST => {
            // lparam packs the signed screen coordinates of the cursor.
            let screen_x = (lparam.0 & 0xFFFF) as u16 as i16 as i32;
            let screen_y = ((lparam.0 >> 16) & 0xFFFF) as u16 as i16 as i32;

            let mut client = POINT {
                x: screen_x,
                y: screen_y,
            };
            let _ = ScreenToClient(hwnd, &mut client);

            if point_in_interactive(client.x, client.y) {
                LRESULT(HTCLIENT as isize)
            } else {
                // Empty region: let the click fall through to the real
                // desktop below the layer.
                LRESULT(HTTRANSPARENT as isize)
            }
        }
        _ => {
            let previous = ORIGINAL_PROC.load(Ordering::SeqCst);
            if previous != 0 {
                let original: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT =
                    std::mem::transmute(previous);
                CallWindowProcW(Some(original), hwnd, msg, wparam, lparam)
            } else {
                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
        }
    }
}
