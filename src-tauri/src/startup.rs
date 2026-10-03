//! Current-user autostart via the Run registry key.

#![cfg(windows)]

use std::os::windows::ffi::OsStrExt;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
    HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_SZ, REG_VALUE_TYPE,
};

const VALUE_NAME: PCWSTR = w!("Nestra");

fn run_key_path() -> PCWSTR {
    w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
}

pub fn is_enabled() -> bool {
    unsafe {
        let mut key = Default::default();
        let status = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            run_key_path(),
            Some(0),
            KEY_READ,
            &mut key,
        );
        if status != ERROR_SUCCESS {
            return false;
        }

        let mut kind = REG_VALUE_TYPE::default();
        let mut size: u32 = 0;
        let query = RegQueryValueExW(key, VALUE_NAME, None, Some(&mut kind), None, Some(&mut size));
        let _ = RegCloseKey(key);
        query == ERROR_SUCCESS && size > 2
    }
}

pub fn set_enabled(enabled: bool) -> Result<bool, String> {
    if enabled {
        let exe = std::env::current_exe().map_err(|error| error.to_string())?;
        let command = format!("\"{}\" --background", exe.display());
        let mut wide: Vec<u16> = std::ffi::OsStr::new(&command).encode_wide().collect();
        wide.push(0);
        let bytes: &[u8] = unsafe {
            std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2)
        };

        unsafe {
            let mut key = Default::default();
            let status = RegCreateKeyW(HKEY_CURRENT_USER, run_key_path(), &mut key);
            if status != ERROR_SUCCESS {
                return Err("无法写入开机启动项".into());
            }
            let set = RegSetValueExW(key, VALUE_NAME, None, REG_SZ, Some(bytes));
            let _ = RegCloseKey(key);
            if set != ERROR_SUCCESS {
                return Err("无法写入开机启动项".into());
            }
        }
        return Ok(true);
    }

    unsafe {
        let mut key = Default::default();
        let status = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            run_key_path(),
            Some(0),
            KEY_WRITE,
            &mut key,
        );
        if status != ERROR_SUCCESS {
            return Ok(false);
        }
        let deleted = RegDeleteValueW(key, VALUE_NAME);
        let _ = RegCloseKey(key);
        if deleted != ERROR_SUCCESS && deleted != ERROR_FILE_NOT_FOUND {
            return Err("无法移除开机启动项".into());
        }
    }
    Ok(false)
}
