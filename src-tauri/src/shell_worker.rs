//! Shell extensions are native DLLs: a Rust Result cannot catch their access
//! violations. Run them in a disposable copy of this executable, before Tauri
//! startup and the single-instance lock. The organizer never loads those DLLs.
#![cfg(windows)]

use std::{io::{Read, Write}, os::windows::process::CommandExt, process::{Child, Command, Stdio}, time::{Duration, Instant}};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const WORKER_ARG: &str = "--nestra-shell-worker";

#[derive(Serialize, Deserialize)]
pub struct MenuRequest {
    pub path: String,
    pub x: i32,
    pub y: i32,
    pub to_desktop: bool,
    pub in_launcher: bool,
    pub can_fold: bool,
    pub can_rename: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "operation")]
pub enum Request {
    Icons { paths: Vec<String>, cache_dir: std::path::PathBuf },
    Menu { menu: MenuRequest },
    Pick { folder: bool },
    Open { target: String },
    #[cfg(debug_assertions)]
    TestExit,
}

/// Returns true only in the private helper mode. No WebViews, tray or state
/// initialization are performed in that process.
pub fn run_if_requested() -> bool {
    if std::env::args().nth(1).as_deref() != Some(WORKER_ARG) { return false; }
    unsafe {
        use windows::Win32::System::Diagnostics::Debug::{SetErrorMode, SEM_FAILCRITICALERRORS, SEM_NOGPFAULTERRORBOX};
        SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    }
    let result = (|| -> Result<Value, String> {
        let request: Request = serde_json::from_reader(std::io::stdin()).map_err(|e| e.to_string())?;
        match request {
            Request::Icons { paths, cache_dir } => {
                for path in paths { crate::icons::icon_png_for(&path, Some(cache_dir.clone())); }
                Ok(Value::Null)
            }
            Request::Menu { menu } => crate::shell_menu::show_native(&menu).map(Value::String),
            Request::Pick { folder } => serde_json::to_value(crate::commands::pick_path_blocking(folder)?).map_err(|e| e.to_string()),
            Request::Open { target } => { crate::commands::shell_execute_open_native(&target)?; Ok(Value::Null) }
            #[cfg(debug_assertions)]
            Request::TestExit => std::process::exit(73),
        }
    })();
    let _ = serde_json::to_writer(std::io::stdout(), &result);
    true
}

/// Wait without letting a hung extension block the organizer indefinitely.
fn wait_for(child: &mut Child, timeout: Duration) -> Result<(), String> {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => return Err(format!("系统扩展异常退出（{status}）")),
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(25)),
            outcome => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(match outcome { Err(e) => e.to_string(), _ => "系统扩展响应超时".into() });
            }
        }
    }
}

/// All communication uses pipes, so Unicode paths never pass through a shell
/// command line. CREATE_NO_WINDOW keeps helper consoles out of the desktop.
pub fn execute(request: &Request, timeout: Duration) -> Result<Value, String> {
    let mut child = Command::new(std::env::current_exe().map_err(|e| e.to_string())?)
        .arg(WORKER_ARG).creation_flags(0x08000000)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|e| e.to_string())?;
    // Register before sending the request: the worker cannot activate its menu
    // before the desktop layer knows its identity. RAII removes it on every
    // input failure, timeout, crash and successful completion.
    let _menu_process = matches!(request, Request::Menu { .. })
        .then(|| crate::win32::track_shell_menu_process(child.id()));
    // Transfer our foreground permission to the dialog/menu owner process.
    unsafe { let _ = windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(child.id()); }
    let input = (|| -> Result<(), String> {
        let mut stdin = child.stdin.take().ok_or("系统扩展输入不可用")?;
        let bytes = serde_json::to_vec(request).map_err(|e| e.to_string())?;
        stdin.write_all(&bytes).map_err(|e| e.to_string())
    })();
    if let Err(error) = input { let _ = child.kill(); let _ = child.wait(); return Err(error); }
    wait_for(&mut child, timeout)?;
    let mut output = String::new();
    child.stdout.take().ok_or("系统扩展输出不可用")?.read_to_string(&mut output).map_err(|e| e.to_string())?;
    serde_json::from_str::<Result<Value, String>>(&output).map_err(|e| format!("系统扩展返回无效：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn command(script: &str) -> Child {
        Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(0x08000000).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap()
    }
    #[test]
    fn failed_extension_is_reported_without_exiting_host() {
        let mut child = command("exit 73");
        assert!(wait_for(&mut child, Duration::from_secs(10)).unwrap_err().contains("异常退出"));
        let mut healthy = command("exit 0");
        assert!(wait_for(&mut healthy, Duration::from_secs(10)).is_ok());
    }
    #[test]
    fn hung_extension_is_killed_and_reaped() {
        let mut child = command("Start-Sleep -Seconds 30");
        assert!(wait_for(&mut child, Duration::from_millis(100)).unwrap_err().contains("超时"));
        assert!(child.try_wait().unwrap().is_some());
    }
}
