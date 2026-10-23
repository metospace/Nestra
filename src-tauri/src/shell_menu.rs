//! Native Explorer context menu for a desktop item (IContextMenu).

#![cfg(windows)]

use windows::core::{PCSTR, PCWSTR};
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Shell::{
    BHID_SFUIObject, SHCreateItemFromParsingName, CMF_EXTENDEDVERBS, CMF_NORMAL,
    CMINVOKECOMMANDINFO, IContextMenu, IShellItem,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_SHIFT};
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, DestroyMenu, GetCursorPos, TrackPopupMenuEx, HMENU, MF_SEPARATOR,
    MF_STRING, TPM_RETURNCMD, TPM_RIGHTBUTTON, SW_SHOWNORMAL,
};

const FIRST_SHELL: u32 = 1;
const LAST_SHELL: u32 = 0x6FFF;
const CMD_TO_DESKTOP: u32 = 0x7001;
const CMD_LAUNCHER: u32 = 0x7002;
const CMD_FOLD: u32 = 0x7003;
const CMD_RENAME: u32 = 0x7004;

pub fn show_native(request: &crate::shell_worker::MenuRequest) -> Result<String, String> {
    use windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, SetForegroundWindow, ShowWindow, WS_EX_TOOLWINDOW, WS_POPUP, SW_SHOWNOACTIVATE};
    // Own the popup in this process. A failed extension must never subclass or
    // destroy the organizer's desktop HWND.
    let hwnd = unsafe { CreateWindowExW(WS_EX_TOOLWINDOW, windows::core::w!("STATIC"),
        windows::core::w!("Nestra Shell"), WS_POPUP, 0, 0, 0, 0, None, None, None, None) }
        .map_err(|e| e.to_string())?;
    struct Owner(HWND);
    impl Drop for Owner { fn drop(&mut self) { unsafe { let _ = DestroyWindow(self.0); } } }
    let _owner = Owner(hwnd);
    unsafe {
        windows::Win32::UI::WindowsAndMessaging::SetPropW(hwnd, crate::win32::SHELL_MENU_OWNER,
            Some(windows::Win32::Foundation::HANDLE(1usize as _)))
            .map_err(|error| format!("无法标记系统菜单窗口：{error}"))?;
    }
    let crate::shell_worker::MenuRequest { path, x: screen_x, y: screen_y, to_desktop, in_launcher, can_fold, can_rename } = request;
    let (screen_x, screen_y) = (*screen_x, *screen_y);
    let (x, y) = if screen_x == 0 && screen_y == 0 {
        let mut pt = POINT::default();
        unsafe {
            let _ = GetCursorPos(&mut pt);
        }
        (pt.x, pt.y)
    } else {
        (screen_x, screen_y)
    };

    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(|e| e.to_string())?; }
    struct ComGuard;
    impl Drop for ComGuard { fn drop(&mut self) { unsafe { windows::Win32::System::Com::CoUninitialize(); } } }
    let _com = ComGuard;

    let item: IShellItem = unsafe {
        SHCreateItemFromParsingName(&windows::core::HSTRING::from(path.as_str()), None)
            .map_err(|error| format!("无法打开 Shell 项目：{error}"))?
    };
    let menu: IContextMenu = unsafe {
        item.BindToHandler(None, &BHID_SFUIObject)
            .map_err(|error| format!("无法创建右键菜单：{error}"))?
    };

    let popup: HMENU = unsafe { CreatePopupMenu() }.map_err(|error| error.to_string())?;

    let mut flags = CMF_NORMAL;
    if unsafe { GetAsyncKeyState(VK_SHIFT.0 as i32) } < 0 {
        flags |= CMF_EXTENDEDVERBS;
    }

    let query = unsafe { menu.QueryContextMenu(popup, 0, FIRST_SHELL, LAST_SHELL, flags) };
    if query.is_err() {
        unsafe {
            let _ = DestroyMenu(popup);
        }
        return Err("无法填充系统菜单".into());
    }

    unsafe {
        let _ = AppendMenuW(popup, MF_SEPARATOR, 0, PCWSTR::null());
        if *to_desktop {
            let _ = AppendMenuW(popup, MF_STRING, CMD_TO_DESKTOP as usize, windows::core::w!("放回桌面"));
        }
        let launcher_label = if *in_launcher {
            windows::core::w!("移出快捷启动")
        } else {
            windows::core::w!("添加到快捷启动")
        };
        let _ = AppendMenuW(popup, MF_STRING, CMD_LAUNCHER as usize, launcher_label);
        if *can_fold {
            let _ = AppendMenuW(popup, MF_STRING, CMD_FOLD as usize, windows::core::w!("收入折叠"));
        }
        // Explorer 自带"重命名"会在被隐藏的 SysListView32 上弹出不可见的编辑框，
        // 因此追加我们自己的入口，交给前端的可见重命名弹窗。
        if *can_rename {
            let _ = AppendMenuW(popup, MF_STRING, CMD_RENAME as usize, windows::core::w!("重命名(Nestra)"));
        }
    }

    let selected = unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let _ = SetForegroundWindow(hwnd);
        TrackPopupMenuEx(
            popup,
            TPM_RIGHTBUTTON.0 | TPM_RETURNCMD.0,
            x,
            y,
            hwnd,
            None,
        )
    };
    unsafe {
        let _ = DestroyMenu(popup);
    }

    let cmd = selected.0 as u32;
    if cmd == 0 {
        return Ok("dismissed".into());
    }
    if cmd == CMD_TO_DESKTOP {
        return Ok("desktop".into());
    }
    if cmd == CMD_LAUNCHER {
        return Ok("launcher".into());
    }
    if cmd == CMD_FOLD {
        return Ok("fold".into());
    }
    if cmd == CMD_RENAME {
        return Ok("rename".into());
    }
    if cmd < FIRST_SHELL || cmd > LAST_SHELL {
        return Ok("dismissed".into());
    }

    let verb_index = cmd - FIRST_SHELL;
    let info = CMINVOKECOMMANDINFO {
        cbSize: std::mem::size_of::<CMINVOKECOMMANDINFO>() as u32,
        fMask: Default::default(),
        hwnd,
        lpVerb: PCSTR(verb_index as usize as *const u8),
        lpParameters: PCSTR::null(),
        lpDirectory: PCSTR::null(),
        nShow: SW_SHOWNORMAL.0 as i32,
        dwHotKey: 0,
        hIcon: Default::default(),
    };
    unsafe {
        menu.InvokeCommand(&info)
            .map_err(|error| format!("无法执行菜单命令：{error}"))?;
    }
    Ok("invoked".into())
}
