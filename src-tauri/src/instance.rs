//! One organizer per Windows session. Reopening the executable opens settings.
#![cfg(windows)]

use windows::core::{w, BOOL};
use windows::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, HWND, LPARAM, ERROR_ALREADY_EXISTS};
use windows::Win32::System::Threading::CreateMutexW;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetPropW, SetPropW, SetForegroundWindow, ShowWindow, SW_RESTORE,
};

const MANAGER_MARKER: windows::core::PCWSTR = w!("Nestra.ManagerWindow");

pub struct InstanceGuard(HANDLE);
impl Drop for InstanceGuard {
    fn drop(&mut self) { unsafe { let _ = CloseHandle(self.0); } }
}

pub fn acquire() -> Result<Option<InstanceGuard>, String> {
    unsafe {
        let handle = CreateMutexW(None, false, w!("Local\\Nestra.DesktopOrganizer.Instance"))
            .map_err(|error| format!("无法创建应用实例锁：{error}"))?;
        let existing = GetLastError() == ERROR_ALREADY_EXISTS;
        let guard = InstanceGuard(handle);
        if existing {
            // The first process may still be creating its WebViews.
            for _ in 0..30 {
                if activate_existing_manager() { break; }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            return Ok(None);
        }
        Ok(Some(guard))
    }
}

pub fn mark_manager(value: isize) {
    let hwnd = HWND(value as _);
    unsafe { let _ = SetPropW(hwnd, MANAGER_MARKER, Some(HANDLE(1usize as _))); }
}

fn activate_existing_manager() -> bool {
    unsafe extern "system" fn find(hwnd: HWND, data: LPARAM) -> BOOL {
        if !GetPropW(hwnd, MANAGER_MARKER).0.is_null() {
            *(data.0 as *mut HWND) = hwnd;
            return BOOL(0);
        }
        BOOL(1)
    }
    unsafe {
        let mut manager = HWND::default();
        let _ = EnumWindows(Some(find), LPARAM(&mut manager as *mut HWND as isize));
        if manager.0.is_null() { return false; }
        let _ = ShowWindow(manager, SW_RESTORE);
        let _ = SetForegroundWindow(manager);
        true
    }
}
