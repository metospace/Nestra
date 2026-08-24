//! Win32 helpers that keep the desktop layer pinned to the bottom of the
//! z-order while still allowing it to receive mouse and keyboard input.

#![cfg(windows)]

use std::sync::atomic::{AtomicIsize, Ordering};

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, DefWindowProcW, SetWindowLongPtrW, SetWindowPos, GWL_WNDPROC, HWND_BOTTOM,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WM_WINDOWPOSCHANGING, WINDOWPOS,
};

/// Original window procedure of the subclassed desktop-layer window.
static ORIGINAL_PROC: AtomicIsize = AtomicIsize::new(0);

/// Native handle for later re-assertions.
static LAYER_HWND: AtomicIsize = AtomicIsize::new(0);

/// Subclass the window so it can never leave the bottom of the z-order.
/// Every future `WM_WINDOWPOSCHANGING` gets its insertion point forced back
/// to `HWND_BOTTOM`, which keeps the layer visually behind every normal
/// application window without blocking input.
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
