//! User-initiated installation of the pinned official Everything release.
//! No arbitrary URLs or executable arguments cross the webview boundary.
#![cfg(windows)]

use std::{ffi::OsStr, fs::{self, OpenOptions}, io::{Read, Write},
    os::windows::{ffi::OsStrExt, fs::{MetadataExt, OpenOptionsExt}, process::CommandExt},
    path::{Component, Path, PathBuf, Prefix}, process::Command,
    sync::{atomic::{AtomicBool, Ordering}, Mutex, OnceLock}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use serde::Serialize;
use sha2::{Digest, Sha256};
use windows::core::{w, PCWSTR, PWSTR};
use windows::Win32::{Foundation::*, Networking::WinHttp::*, Storage::FileSystem::GetDriveTypeW,
    System::{Registry::*, Threading::*}, UI::{Shell::*, WindowsAndMessaging::*}};

const INSTALLER_NAME: &str = "Everything-1.4.1.1032.x64-Setup.exe";
const INSTALLER_SHA256: &str = "c42efad041d4c0bb4d4ac97ae7cbe89f153ec1fe078772392e749c7f5d5282d3";
const MAX_DOWNLOAD: u64 = 16 * 1024 * 1024;
static BUSY: AtomicBool = AtomicBool::new(false);
static JOB: OnceLock<Mutex<Option<EverythingStatus>>> = OnceLock::new();
static INSTALLED_HINT: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EverythingStatus {
    pub installed: bool,
    pub running: bool,
    pub install_path: Option<String>,
    pub default_install_dir: Option<String>,
    pub phase: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub message: String,
}

fn wide(value: impl AsRef<OsStr>) -> Vec<u16> { value.as_ref().encode_wide().chain(Some(0)).collect() }
fn job() -> &'static Mutex<Option<EverythingStatus>> { JOB.get_or_init(|| Mutex::new(None)) }
fn hint() -> &'static Mutex<Option<PathBuf>> { INSTALLED_HINT.get_or_init(|| Mutex::new(None)) }
fn update(phase: &str, message: impl Into<String>) {
    if let Ok(mut state) = job().lock() { if let Some(state) = state.as_mut() { state.phase = phase.into(); state.message = message.into(); } }
}
fn progress(done: u64, total: Option<u64>) {
    if let Ok(mut state) = job().lock() { if let Some(state) = state.as_mut() { state.downloaded_bytes = done; state.total_bytes = total; } }
}

struct BusyGuard;
impl BusyGuard {
    fn acquire(flag: &AtomicBool) -> Result<(), String> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ()).map_err(|_| "Everything 安装或启动任务正在进行，请稍候".into())
    }
}
impl Drop for BusyGuard { fn drop(&mut self) { BUSY.store(false, Ordering::Release); } }

struct Handle(HANDLE);
impl Drop for Handle { fn drop(&mut self) { unsafe { let _ = CloseHandle(self.0); } } }

fn runtime_path() -> (bool, Option<PathBuf>) {
    unsafe {
        let hwnd = [w!("EVERYTHING_TASKBAR_NOTIFICATION"), w!("EVERYTHING_TASKBAR_NOTIFICATION_(1.5a)")]
            .into_iter().find_map(|class| FindWindowW(class, None).ok());
        let Some(hwnd) = hwnd else { return (false, None); };
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return (true, None); };
        let process = Handle(process);
        let mut buffer = vec![0u16; 32768];
        let mut size = buffer.len() as u32;
        let path = QueryFullProcessImageNameW(process.0, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut size)
            .ok().and_then(|_| String::from_utf16(&buffer[..size as usize]).ok()).map(PathBuf::from);
        (true, path)
    }
}

fn registry_string(root: HKEY, subkey: &str, value: &str, view: REG_SAM_FLAGS) -> Option<String> {
    let subkey = wide(subkey); let value = wide(value);
    unsafe {
        let mut key = HKEY::default();
        if RegOpenKeyExW(root, PCWSTR(subkey.as_ptr()), Some(0), KEY_READ | view, &mut key) != ERROR_SUCCESS { return None; }
        let mut size = 0; let mut kind = REG_VALUE_TYPE::default();
        let result = (|| {
            if RegQueryValueExW(key, PCWSTR(value.as_ptr()), None, Some(&mut kind), None, Some(&mut size)) != ERROR_SUCCESS
                || kind != REG_SZ || size < 2 || size > 65536 || size % 2 != 0 { return None; }
            let mut data = vec![0u16; (size / 2) as usize];
            if RegQueryValueExW(key, PCWSTR(value.as_ptr()), None, None, Some(data.as_mut_ptr().cast()), Some(&mut size)) != ERROR_SUCCESS { return None; }
            String::from_utf16(&data[..data.iter().position(|c| *c == 0).unwrap_or(data.len())]).ok()
        })();
        let _ = RegCloseKey(key);
        result
    }
}

fn local_file(path: &Path) -> bool {
    matches!(path.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(drive) if drive_is_fixed(drive)))
        && path.file_name().is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("Everything.exe"))
        && path.is_absolute() && path.is_file()
}

fn uninstall_executable(command: &str) -> Option<&str> {
    if let Some(quoted) = command.strip_prefix('"') { return quoted.split_once('"').map(|(path, _)| path); }
    let end = command.to_ascii_lowercase().rfind(".exe")? + 4;
    Some(&command[..end])
}

fn detected() -> (bool, Option<PathBuf>) {
    let (running, runtime) = runtime_path();
    if running { return (true, runtime); }
    let mut candidates = Vec::new();
    if let Ok(path) = hint().lock() { candidates.extend(path.clone()); }
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
            if let Some(path) = registry_string(root, r"Software\Microsoft\Windows\CurrentVersion\App Paths\Everything.exe", "", view) {
                candidates.push(PathBuf::from(path.trim_matches('"')));
            }
            for name in ["Everything", "Everything 1.5a"] {
                let key = format!(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{name}");
                if let Some(path) = registry_string(root, &key, "InstallLocation", view) { candidates.push(PathBuf::from(path).join("Everything.exe")); }
                if let Some(path) = registry_string(root, &key, "UninstallString", view) {
                    if let Some(parent) = uninstall_executable(&path).and_then(|executable| Path::new(executable).parent()) { candidates.push(parent.join("Everything.exe")); }
                }
            }
        }
    }
    for variable in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(variable) {
            for sub in ["Everything", "Everything 1.5a", r"Programs\Everything"] { candidates.push(PathBuf::from(&base).join(sub).join("Everything.exe")); }
        }
    }
    if let Some(path) = default_install_dir() { candidates.push(path.join("Everything.exe")); }
    (false, candidates.into_iter().find(|path| local_file(path)))
}

fn drive_is_fixed(letter: u8) -> bool {
    let root = wide(format!("{}:\\", letter as char));
    unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) == 3 }
}

fn default_install_dir() -> Option<PathBuf> {
    let preferred = std::env::current_exe().ok().and_then(|path| path.to_str().and_then(|s| s.as_bytes().first().copied()));
    preferred.into_iter().chain(Some(b'D')).chain(b'D'..=b'Z')
        .map(|drive| drive.to_ascii_uppercase()).find(|drive| *drive != b'C' && drive.is_ascii_alphabetic() && drive_is_fixed(*drive))
        .map(|drive| PathBuf::from(format!("{}:\\Apps\\Everything", drive as char)))
}

fn detection_status(running: bool, path: Option<PathBuf>) -> EverythingStatus {
    let installed = running || path.is_some();
    EverythingStatus {
        installed, running, install_path: path.map(|path| path.to_string_lossy().into()),
        default_install_dir: default_install_dir().map(|path| path.to_string_lossy().into()),
        phase: if running { "ready" } else { "idle" }.into(), downloaded_bytes: 0, total_bytes: None,
        message: if running { "Everything 已运行，搜索时将查询本地索引" } else if installed { "Everything 已安装，尚未启动" } else { "未检测到 Everything，安装后可搜索全盘文件" }.into(),
    }
}

/// Keep progress/error information while refreshing live process and installation facts.
pub fn status() -> EverythingStatus {
    let (running, path) = detected();
    let detected = detection_status(running, path);
    let mut state = job().lock().unwrap_or_else(|e| e.into_inner());
    let Some(existing) = state.as_mut() else { return detected; };
    // Preserve an actionable idle/error message, but let live connection facts win.
    if !BUSY.load(Ordering::Acquire) && (running || existing.phase == "ready") { return detected; }
    existing.installed = detected.installed;
    existing.running = detected.running;
    existing.install_path = detected.install_path;
    existing.default_install_dir = detected.default_install_dir;
    existing.clone()
}

fn validate_install_dir(input: &str) -> Result<PathBuf, String> {
    if input.is_empty() || input.len() > 220 || input.chars().any(|c| c.is_control() || matches!(c, '"' | '<' | '>' | '|' | '*' | '?')) {
        return Err("请选择有效的本地安装目录".into());
    }
    let normalized = input.replace('/', "\\");
    let bytes = normalized.as_bytes();
    if bytes.len() < 4 || !bytes[0].is_ascii_alphabetic() || bytes[1..3] != *b":\\" || bytes[0].eq_ignore_ascii_case(&b'C') || normalized[2..].contains(':') {
        return Err("请选择 C 盘以外的本地磁盘目录，例如 D:\\Apps\\Everything".into());
    }
    for part in normalized[3..].split('\\') {
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.is_empty() || part == "." || part == ".." || part.ends_with(['.', ' '])
            || ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
            || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit()) {
            return Err("安装目录包含无效的文件夹名称".into());
        }
    }
    Ok(PathBuf::from(normalized))
}

fn validate_install_location(path: &Path) -> Result<(), String> {
    let drive = path.to_string_lossy().as_bytes()[0];
    if !drive_is_fixed(drive) { return Err("安装目录必须位于可用的本地固定磁盘".into()); }
    // Do not let a D: junction silently install on C: or traverse a remote share.
    for ancestor in path.ancestors() {
        if let Ok(metadata) = fs::symlink_metadata(ancestor) {
            if metadata.file_attributes() & 0x400 != 0 { return Err("安装目录不能包含符号链接或目录联接，请选择普通文件夹".into()); }
            if !metadata.is_dir() { return Err("安装位置不是文件夹".into()); }
        }
    }
    if path.exists() && fs::read_dir(path).map_err(|e| format!("无法读取安装目录：{e}"))?.next().is_some() {
        return Err("安装目录不是空文件夹，请选择新的 Everything 文件夹".into());
    }
    Ok(())
}

fn launch_existing(path: &Path) -> Result<(), String> {
    if !local_file(path) { return Err("找不到 Everything 程序，请重新检测安装位置".into()); }
    Command::new(path).arg("-startup").current_dir(path.parent().unwrap_or(path))
        .creation_flags(CREATE_NO_WINDOW.0).spawn().map_err(|e| format!("无法启动 Everything：{e}"))?;
    Ok(())
}

fn start_and_wait(path: &Path) -> Result<(), String> {
    update("starting", "正在启动 Everything 并连接本地索引…");
    launch_existing(path)?;
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if runtime_path().0 { update("ready", "Everything 已启动，搜索时将检查索引连接"); return Ok(()); }
        std::thread::sleep(Duration::from_millis(250));
    }
    update("idle", "Everything 已安装，但尚未连接。索引可能正在加载，请稍后重新检测或启动。");
    Ok(())
}

fn begin(task: impl FnOnce() -> Result<(), String> + Send + 'static, initial: EverythingStatus) -> Result<EverythingStatus, String> {
    BusyGuard::acquire(&BUSY)?;
    *job().lock().unwrap_or_else(|e| e.into_inner()) = Some(initial.clone());
    match std::thread::Builder::new().name("nestra-everything-setup".into()).spawn(move || {
        let _guard = BusyGuard;
        if let Err(error) = task() { update("error", error); }
    }) {
        Ok(_) => Ok(initial),
        Err(error) => { BUSY.store(false, Ordering::Release); update("error", format!("无法开始任务：{error}")); Err("无法开始 Everything 后台任务".into()) }
    }
}

pub fn start() -> Result<EverythingStatus, String> {
    let mut initial = status();
    if initial.running { return Ok(initial); }
    let path = initial.install_path.as_deref().map(PathBuf::from).ok_or("未找到 Everything，请先安装")?;
    initial.phase = "starting".into(); initial.message = "正在启动 Everything…".into();
    begin(move || start_and_wait(&path), initial)
}

pub fn install(input: &str) -> Result<EverythingStatus, String> {
    let current = status();
    if current.running { return Ok(current); }
    if current.installed { return start(); }
    let directory = validate_install_dir(input)?;
    validate_install_location(&directory)?;
    let mut initial = current;
    initial.phase = "downloading".into(); initial.downloaded_bytes = 0; initial.total_bytes = None;
    initial.message = "正在从 voidtools 官方网站下载安装包…".into();
    begin(move || install_job(&directory), initial)
}

struct DownloadDirectory(PathBuf);
impl Drop for DownloadDirectory {
    fn drop(&mut self) { let _ = fs::remove_file(self.0.join(INSTALLER_NAME)); let _ = fs::remove_dir(&self.0); }
}

fn install_job(directory: &Path) -> Result<(), String> {
    // Another installer may have completed between detection and job acquisition.
    let (running, existing) = detected();
    if running { update("ready", "Everything 已连接"); return Ok(()); }
    if let Some(path) = existing { return start_and_wait(&path); }
    validate_install_location(directory)?;
    let parent = directory.parent().ok_or("安装目录无效")?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建下载目录：{e}"))?;
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let download_path = parent.join(format!(".nestra-everything-{}-{nonce}", std::process::id()));
    fs::create_dir(&download_path).map_err(|e| format!("无法创建下载目录：{e}"))?;
    let download = DownloadDirectory(download_path);
    let installer = download.0.join(INSTALLER_NAME);
    download_installer(&installer)?;
    update("verifying", "正在校验官方安装包…");
    // Deny write/delete sharing from verification until the elevated installer exits.
    let mut locked = OpenOptions::new().read(true).share_mode(1).open(&installer).map_err(|e| format!("无法读取安装包：{e}"))?;
    verify(&mut locked, INSTALLER_SHA256)?;
    validate_install_location(directory)?;
    update("installing", "正在安装 Everything，请允许 Windows 管理员授权提示…");
    run_installer(&installer, directory)?;
    let executable = directory.join("Everything.exe");
    if !local_file(&executable) { return Err("安装程序已结束，但未找到 Everything.exe，请检查安装结果后重试".into()); }
    *hint().lock().unwrap_or_else(|e| e.into_inner()) = Some(executable.clone());
    start_and_wait(&executable)
}

fn verify(reader: &mut impl Read, expected: &str) -> Result<(), String> {
    let mut hasher = Sha256::new(); let mut buffer = [0u8; 32768]; let mut size = 0u64;
    loop {
        let read = reader.read(&mut buffer).map_err(|e| format!("读取安装包失败：{e}"))?;
        if read == 0 { break; }
        size += read as u64;
        if size > MAX_DOWNLOAD { return Err("安装包大小异常，已停止安装".into()); }
        hasher.update(&buffer[..read]);
    }
    if size == 0 || format!("{:x}", hasher.finalize()) != expected { return Err("安装包校验失败，未执行安装。请重新下载".into()); }
    Ok(())
}

struct Internet(*mut std::ffi::c_void);
impl Drop for Internet { fn drop(&mut self) { unsafe { let _ = WinHttpCloseHandle(self.0); } } }
impl Internet { fn checked(raw: *mut std::ffi::c_void) -> Result<Self, String> {
    if raw.is_null() { Err(format!("无法连接官方下载服务：{}", windows::core::Error::from_thread())) } else { Ok(Self(raw)) }
} }
fn http_error(error: windows::core::Error) -> String { format!("下载失败，请检查网络后重试：{error}") }
unsafe fn header_number(request: &Internet, header: u32) -> Option<u32> {
    let mut value = 0u32; let mut size = 4;
    WinHttpQueryHeaders(request.0, header | WINHTTP_QUERY_FLAG_NUMBER, None, Some((&mut value as *mut u32).cast()), &mut size, std::ptr::null_mut()).ok().map(|_| value)
}

fn download_installer(path: &Path) -> Result<(), String> {
    unsafe {
        let session = Internet::checked(WinHttpOpen(w!("Nestra Everything Setup/1.0"), WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, None, None, 0))?;
        WinHttpSetTimeouts(session.0, 15000, 15000, 15000, 15000).map_err(http_error)?;
        let connect = Internet::checked(WinHttpConnect(session.0, w!("www.voidtools.com"), 443, 0))?;
        let resource = wide(format!("/{INSTALLER_NAME}"));
        let request = Internet::checked(WinHttpOpenRequest(connect.0, w!("GET"), PCWSTR(resource.as_ptr()), None, None, std::ptr::null(), WINHTTP_FLAG_SECURE))?;
        WinHttpSetOption(Some(request.0.cast_const()), WINHTTP_OPTION_REDIRECT_POLICY, Some(&WINHTTP_OPTION_REDIRECT_POLICY_NEVER.to_ne_bytes())).map_err(http_error)?;
        WinHttpSendRequest(request.0, None, None, 0, 0, 0).map_err(http_error)?;
        WinHttpReceiveResponse(request.0, std::ptr::null_mut()).map_err(http_error)?;
        let status = header_number(&request, WINHTTP_QUERY_STATUS_CODE).ok_or("无法读取官方下载响应")?;
        if status != 200 { return Err(format!("官方下载服务返回 HTTP {status}，请稍后重试")); }
        let total = header_number(&request, WINHTTP_QUERY_CONTENT_LENGTH).map(u64::from);
        if total.is_some_and(|size| size == 0 || size > MAX_DOWNLOAD) { return Err("官方下载包大小异常，已停止下载".into()); }
        let mut file = OpenOptions::new().write(true).create_new(true).open(path).map_err(|e| format!("无法保存下载文件：{e}"))?;
        let mut buffer = [0u8; 32768]; let mut done = 0u64;
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            if Instant::now() >= deadline { return Err("下载超时，请检查网络后重试".into()); }
            let mut read = 0;
            WinHttpReadData(request.0, buffer.as_mut_ptr().cast(), buffer.len() as u32, &mut read).map_err(http_error)?;
            if read == 0 { break; }
            done += u64::from(read);
            if done > MAX_DOWNLOAD { return Err("下载文件超出大小限制，已停止下载".into()); }
            file.write_all(&buffer[..read as usize]).map_err(|e| format!("保存下载文件失败：{e}"))?;
            progress(done, total);
        }
        if done == 0 || total.is_some_and(|size| size != done) { return Err("安装包下载不完整，请重试".into()); }
        file.sync_all().map_err(|e| format!("保存下载文件失败：{e}"))?;
        Ok(())
    }
}

fn installer_arguments(directory: &Path) -> String {
    // NSIS requires /D last and unquoted, including when the directory contains spaces.
    format!("/S -install-options \"-app-data -disable-run-as-admin -install-service -install-start-menu-shortcuts -install-run-on-system-startup\" /D={}", directory.display())
}

fn run_installer(path: &Path, directory: &Path) -> Result<(), String> {
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    let executable = wide(path); let arguments = wide(installer_arguments(directory));
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).ok()
            .map_err(|error| format!("无法初始化 Windows 安装通道：{error}"))?;
        struct ComGuard;
        impl Drop for ComGuard { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
        let _com = ComGuard;
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
            lpVerb: w!("runas"), lpFile: PCWSTR(executable.as_ptr()), lpParameters: PCWSTR(arguments.as_ptr()),
            nShow: SW_HIDE.0, ..Default::default()
        };
        if let Err(error) = ShellExecuteExW(&mut info) {
            return Err(if error.code().0 as u32 == 0x800704c7 { "已取消管理员授权，Everything 未安装，可再次点击安装".into() } else { format!("无法启动官方安装程序：{error}") });
        }
        if info.hProcess.is_invalid() { return Err("无法跟踪安装程序，请检查 Everything 安装结果".into()); }
        let process = Handle(info.hProcess);
        let deadline = Instant::now() + Duration::from_secs(300);
        let mut timed_out = false;
        loop {
            match WaitForSingleObject(process.0, 1000) {
                WAIT_OBJECT_0 => break,
                WAIT_TIMEOUT => {
                    if !timed_out && Instant::now() >= deadline {
                        // Do not kill a privileged installer or release the single-job guard.
                        timed_out = true;
                        update("installing", "安装程序仍在运行，请检查 Windows 授权或安装窗口。为避免重复安装，请等待其结束。");
                    }
                }
                _ => return Err("无法获取安装程序状态，请检查系统安装结果".into()),
            }
        }
        let mut code = 0;
        GetExitCodeProcess(process.0, &mut code).map_err(|e| format!("无法读取安装结果：{e}"))?;
        if code != 0 { return Err(format!("Everything 安装未完成（退出代码 {code}），请重新尝试")); }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unsafe_or_system_install_paths() {
        for path in [r"C:\Apps\Everything", r"c:\Apps\Everything", r"D:Everything", r"\\server\apps", r"D:\", r"D:\Apps\..\Windows", r"D:\Apps\CON", r"D:\Apps\LPT1.txt", r"D:\Apps\Everything.", r"D:\Apps\Everything ", "D:\\Apps\\a\" /S", "D:\\Apps\\bad\nname", r"D:\Apps\foo:stream"] {
            assert!(validate_install_dir(path).is_err(), "accepted {path:?}");
        }
        assert_eq!(validate_install_dir("D:/应用/Everything Search").unwrap(), PathBuf::from(r"D:\应用\Everything Search"));
    }
    #[test]
    fn hash_rejects_empty_and_tampered_installers() {
        let digest = format!("{:x}", Sha256::digest(b"official fixture"));
        assert!(verify(&mut &b"official fixture"[..], &digest).is_ok());
        assert!(verify(&mut &b"tampered fixture"[..], &digest).is_err());
        assert!(verify(&mut &b""[..], &digest).is_err());
    }
    #[test]
    fn installed_stopped_is_distinct_from_missing_and_running_portable() {
        let missing = detection_status(false, None);
        assert!(!missing.installed && !missing.running);
        let stopped = detection_status(false, Some(PathBuf::from(r"D:\Apps\Everything\Everything.exe")));
        assert!(stopped.installed && !stopped.running);
        let portable = detection_status(true, None);
        assert!(portable.installed && portable.running);
    }
    #[test]
    fn job_acquisition_does_not_allow_concurrent_installation() {
        let flag = AtomicBool::new(false);
        assert!(BusyGuard::acquire(&flag).is_ok());
        assert!(BusyGuard::acquire(&flag).is_err());
        flag.store(false, Ordering::Release);
        assert!(BusyGuard::acquire(&flag).is_ok());
    }
    #[test]
    fn nsis_target_remains_last_and_handles_spaces() {
        let path = validate_install_dir(r"D:\中文 Apps\Everything").unwrap();
        assert!(installer_arguments(&path).ends_with(r" /D=D:\中文 Apps\Everything"));
        assert!(installer_arguments(&path).starts_with("/S -install-options \""));
    }
    #[test]
    fn detects_uninstall_paths_without_including_arguments() {
        assert_eq!(uninstall_executable(r#""D:\Apps 中文\Everything\Uninstall.exe" /S"#), Some(r"D:\Apps 中文\Everything\Uninstall.exe"));
        assert_eq!(uninstall_executable(r"D:\Apps 中文\Everything\Uninstall.exe /S"), Some(r"D:\Apps 中文\Everything\Uninstall.exe"));
        assert_eq!(uninstall_executable("malformed"), None);
    }
    /// Explicit network-only smoke test; never invokes or installs the downloaded executable.
    #[test]
    #[ignore = "requires official network access; downloads and verifies only"]
    fn official_download_hash_smoke() {
        let root = std::env::var_os("NESTRA_DOWNLOAD_TEST_DIR").expect("set non-C test directory");
        let directory = validate_install_dir(&PathBuf::from(root).to_string_lossy()).unwrap();
        fs::create_dir_all(&directory).unwrap();
        let target = directory.join(INSTALLER_NAME);
        download_installer(&target).unwrap();
        let result = verify(&mut fs::File::open(&target).unwrap(), INSTALLER_SHA256);
        let _ = fs::remove_file(target);
        result.unwrap();
    }
}
