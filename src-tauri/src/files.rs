#![cfg(windows)]

use std::path::{Path, PathBuf};
use std::sync::{Mutex, atomic::{AtomicU64, Ordering}};
use serde::Serialize;

use crate::scanner;

static FILE_OPERATION_LOCK: Mutex<()> = Mutex::new(());
static MOVE_HISTORY: Mutex<Vec<MoveRecord>> = Mutex::new(Vec::new());
static MOVE_SEQUENCE: AtomicU64 = AtomicU64::new(1);
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveRecord {
    pub id: u64,
    pub name: String,
    pub from_path: String,
    pub to_path: String,
    pub created_at: i64,
    pub undone: bool,
    #[serde(skip)]
    identity: FileIdentity,
}
#[derive(Clone, Default, PartialEq)]
struct FileIdentity { volume: u32, index: u64, directory: bool, size: u64, modified: u64 }
fn file_identity(path: &Path) -> Result<FileIdentity, String> {
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
    use windows::Win32::{Foundation::HANDLE, Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION}};
    let file = std::fs::OpenOptions::new().read(true).custom_flags(0x02000000).open(path).map_err(|e| e.to_string())?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info).map_err(|e| e.to_string())?; }
    let directory = info.dwFileAttributes & 0x10 != 0;
    Ok(FileIdentity {volume:info.dwVolumeSerialNumber,index:((info.nFileIndexHigh as u64)<<32)|info.nFileIndexLow as u64,directory,
        size:if directory {0} else {((info.nFileSizeHigh as u64)<<32)|info.nFileSizeLow as u64},
        modified:if directory {0} else {((info.ftLastWriteTime.dwHighDateTime as u64)<<32)|info.ftLastWriteTime.dwLowDateTime as u64}})
}
fn record_move(source: &Path, destination: &Path) {
    // A successful move is never reported as failed just because history could not be captured.
    if let Ok(identity) = file_identity(destination) {
        if let Ok(mut history) = MOVE_HISTORY.lock() {
            history.push(MoveRecord {id:MOVE_SEQUENCE.fetch_add(1,Ordering::Relaxed),name:destination.file_name().unwrap_or_default().to_string_lossy().into_owned(),from_path:source.to_string_lossy().into_owned(),to_path:destination.to_string_lossy().into_owned(),created_at:chrono::Local::now().timestamp_millis(),undone:false,identity});
            if history.len()>50 {history.remove(0);}
        }
    }
}
pub fn list_file_moves() -> Vec<MoveRecord> { MOVE_HISTORY.lock().map(|items|items.iter().rev().cloned().collect()).unwrap_or_default() }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoResult { pub from_path: String, pub new_path: String }
pub fn undo_file_move(id: u64) -> Result<UndoResult, String> {
    let _guard = FILE_OPERATION_LOCK.lock().map_err(|e|e.to_string())?;
    let mut history = MOVE_HISTORY.lock().map_err(|e|e.to_string())?;
    let record = history.iter_mut().find(|record|record.id==id).ok_or("移动记录已失效")?;
    if record.undone {return Err("这次移动已经撤销".into());}
    let source = PathBuf::from(&record.to_path);
    if file_identity(&source)? != record.identity {return Err("目标已修改或被替换，未移动任何文件；请手动检查位置".into());}
    let destination = PathBuf::from(&record.from_path);
    if destination.exists() {return Err("原位置已有同名项目，撤销已停止；未覆盖任何文件".into());}
    if !destination.parent().is_some_and(Path::is_dir) {return Err("原目录已不存在，无法撤销".into());}
    move_path(&source,&destination)?;
    record.undone=true;
    Ok(UndoResult {from_path:record.to_path.clone(),new_path:record.from_path.clone()})
}

/// 规范化路径用于比较：去掉 \\?\ 前缀与末尾分隔符、忽略大小写。
fn normalize_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    value
        .trim_start_matches("\\\\?\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn is_under(root: &Path, path: &Path) -> bool {
    let normalized_root = normalize_path(root);
    let normalized_path = normalize_path(path);
    normalized_path == normalized_root
        || normalized_path.starts_with(&format!("{normalized_root}\\"))
}

/// 目标位置已有同名时自动加 (2)(3)… 后缀。
fn unique_dest(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(name)
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = Path::new(name)
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    for index in 2..9999 {
        let next = dir.join(format!("{stem} ({index}){ext}"));
        if !next.exists() {
            return next;
        }
    }
    candidate
}

fn real_path(path: &str) -> Result<PathBuf, String> {
    let value = path.trim();
    if value.is_empty() {
        return Err("路径为空".into());
    }
    if value.starts_with("shell:") {
        return Err("系统入口不能移动".into());
    }
    let source = PathBuf::from(value);
    if !source.exists() {
        return Err("找不到这个项目".into());
    }
    Ok(source)
}

fn managed_path(path: &str) -> Result<PathBuf, String> {
    let source = real_path(path)?;
    let Some(desktop) = scanner::personal_desktop() else {
        return Err("找不到桌面目录".into());
    };
    if !is_under(Path::new(&desktop), &source) {
        return Err("只能管理个人桌面内的项目".into());
    }
    Ok(source)
}

/// 移动文件/目录：优先 rename；跨卷失败时降级为复制 + 删除源。
fn move_path(source: &Path, dest: &Path) -> Result<(), String> {
    use windows::{core::HSTRING, Win32::Storage::FileSystem::{MoveFileExW, MOVE_FILE_FLAGS}};
    if source.is_dir() {
        let source_real = source.canonicalize().map_err(|e| e.to_string())?;
        let parent_real = dest.parent().ok_or("目标目录无效")?.canonicalize().map_err(|e| e.to_string())?;
        if is_under(&source_real, &parent_real) {
            return Err("不能把文件夹移入自身或其子目录".into());
        }
    }
    if dest.exists() { return Err("目标已存在，未覆盖任何文件".into()); }
    let was_directory = source.is_dir();
    // No REPLACE_EXISTING: the OS also rejects a destination created after the
    // preflight check, including by Explorer in another process.
    let renamed = unsafe { MoveFileExW(&HSTRING::from(source.as_os_str()), &HSTRING::from(dest.as_os_str()), MOVE_FILE_FLAGS(0)) }
        .map_err(|e|std::io::Error::from_raw_os_error(e.code().0 & 0xffff));
    match renamed {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            // Access-denied/sharing violations are not cross-volume moves. The
            // old fallback copied these anyway, leaving a duplicate on failure.
            if rename_error.raw_os_error() != Some(17) {
                return Err(format!("无法移动，原文件保持不变：{rename_error}"));
            }
            let copy_result = if source.is_dir() {
                copy_dir_recursive(source, dest).and_then(|_| {
                    std::fs::remove_dir_all(source).map_err(|e| e.to_string())
                })
            } else {
                copy_file_exclusive(source, dest)
                    .and_then(|_| std::fs::remove_file(source).map_err(|e| e.to_string()))
            };
            copy_result.map_err(|copy_error| {
                format!("{rename_error}（跨卷复制也失败：{copy_error}）")
            })
        }
    }?;
    if source.exists() || !dest.exists() {
        return Err("移动未完成：原路径仍存在或目标不存在，请检查文件位置".into());
    }
    notify_shell_move(source, dest, was_directory);
    Ok(())
}

fn notify_shell_move(source: &Path, dest: &Path, directory: bool) {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_RENAMEITEM, SHCNE_RENAMEFOLDER, SHCNF_PATHW, SHCNF_FLUSHNOWAIT};
    let from = HSTRING::from(source.as_os_str());
    let to = HSTRING::from(dest.as_os_str());
    unsafe {
        SHChangeNotify(if directory { SHCNE_RENAMEFOLDER } else { SHCNE_RENAMEITEM },
            SHCNF_PATHW | SHCNF_FLUSHNOWAIT, Some(from.as_ptr().cast()), Some(to.as_ptr().cast()));
    }
}

fn copy_dir_recursive(source: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir(dest).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let child_source = entry.path();
        let child_dest = dest.join(entry.file_name());
        if child_source.is_dir() {
            copy_dir_recursive(&child_source, &child_dest)?;
        } else {
            copy_file_exclusive(&child_source, &child_dest)?;
        }
    }
    Ok(())
}

fn copy_file_exclusive(source: &Path, dest: &Path) -> Result<(), String> {
    use windows::{core::HSTRING, Win32::Storage::FileSystem::CopyFileW};
    unsafe {CopyFileW(&HSTRING::from(source.as_os_str()),&HSTRING::from(dest.as_os_str()),true)}.map_err(|e|e.to_string())
}

/// 确保 Desktop\.nestra 存在并带隐藏属性（隐藏目录 → 里面的文件
/// 不会出现在桌面顶层，原生图标自然消失）。
fn ensure_storage() -> Result<PathBuf, String> {
    let Some(root) = scanner::storage_root() else {
        return Err("找不到桌面目录".into());
    };
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    mark_hidden(&root);
    Ok(root)
}

fn mark_hidden(dir: &Path) {
    use std::os::windows::fs::MetadataExt;
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::{
        SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_FLAGS_AND_ATTRIBUTES,
    };

    let attrs = std::fs::metadata(dir)
        .map(|meta| meta.file_attributes())
        .unwrap_or(0);
    if attrs & FILE_ATTRIBUTE_HIDDEN.0 != 0 {
        return;
    }
    unsafe {
        let _ = SetFileAttributesW(
            &HSTRING::from(dir.as_os_str()),
            FILE_FLAGS_AND_ATTRIBUTES(attrs | FILE_ATTRIBUTE_HIDDEN.0),
        );
    }
}

fn zone_dir(zone_dir_name: &str) -> Result<PathBuf, String> {
    let name = zone_dir_name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains('\\') || name.contains('/') {
        return Err("收纳区目录名无效".into());
    }
    Ok(ensure_storage()?.join(name))
}

/// Atomically reserve a real directory, including names left by older sessions.
pub fn create_zone(name: &str) -> Result<String, String> {
    let root = zone_dir(name)?;
    for index in 1..10000 {
        let candidate = if index == 1 { root.clone() } else {
            root.with_file_name(format!("{} ({index})", name.trim()))
        };
        match std::fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate.file_name().unwrap().to_string_lossy().into_owned()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("无法分配收纳区目录名".into())
}

/// 把一个项目收进收纳区（真实移动）。
pub fn move_to_zone(path: &str, zone_dir_name: &str) -> Result<String, String> {
    let _guard = FILE_OPERATION_LOCK.lock().map_err(|e|e.to_string())?;
    let source = real_path(path)?;
    let zone = zone_dir(zone_dir_name)?;

    // 已在这个收纳区里 → 无事发生；不允许把包含存放区的目录移进存放区。
    if is_under(&zone, &source) {
        return Ok(source.to_string_lossy().into_owned());
    }
    if let Some(storage) = scanner::storage_root() {
        if is_under(&source, &storage) {
            return Err("不能移动收纳区目录本身".into());
        }
    }

    std::fs::create_dir_all(&zone).map_err(|error| error.to_string())?;
    let name = source
        .file_name()
        .ok_or_else(|| "路径无效".to_string())?
        .to_string_lossy()
        .into_owned();
    let dest = unique_dest(&zone, &name);
    move_path(&source, &dest)?;
    record_move(&source, &dest);
    Ok(dest.to_string_lossy().into_owned())
}

/// 批量收进收纳区：返回移动成功后的新路径（失败项被跳过）。
pub fn move_paths_to_zone(
    paths: &[String],
    zone_dir_name: &str,
) -> Result<Vec<String>, String> {
    let mut moved = Vec::new();
    for path in paths {
        match move_to_zone(path, zone_dir_name) {
            Ok(new_path) => moved.push(new_path),
            Err(error) => eprintln!("收进收纳区失败 {path}：{error}"),
        }
    }
    Ok(moved)
}

/// 把收纳区项目放回桌面顶层。
pub fn move_to_desktop(path: &str) -> Result<String, String> {
    let _guard = FILE_OPERATION_LOCK.lock().map_err(|e|e.to_string())?;
    let source = managed_path(path)?;
    let Some(desktop) = scanner::personal_desktop() else {
        return Err("找不到桌面目录".into());
    };
    let name = source
        .file_name()
        .ok_or_else(|| "路径无效".to_string())?
        .to_string_lossy()
        .into_owned();
    let dest = unique_dest(Path::new(&desktop), &name);
    move_path(&source, &dest)?;
    record_move(&source, &dest);
    Ok(dest.to_string_lossy().into_owned())
}

/// Explicit drag into an existing folder; None means the Known Folder desktop.
pub fn move_to_folder(path: &str, folder: Option<&str>) -> Result<String, String> {
    let _guard = FILE_OPERATION_LOCK.lock().map_err(|e|e.to_string())?;
    let source = real_path(path)?;
    if let Some(storage) = scanner::storage_root() {
        if is_under(&source, &storage) { return Err("不能移动收纳区存放目录本身".into()); }
    }
    let target = folder.map(String::from).or_else(scanner::personal_desktop).ok_or("找不到目标目录")?;
    let dir = Path::new(&target).canonicalize().map_err(|e| e.to_string())?;
    if !dir.is_dir() { return Err("目标不是文件夹".into()); }
    if source.parent().and_then(|p| p.canonicalize().ok()).as_ref() == Some(&dir) {
        return Ok(source.to_string_lossy().into_owned());
    }
    let name = source.file_name().ok_or("无法移动根目录")?.to_string_lossy();
    let dest = unique_dest(Path::new(&target), &name);
    move_path(&source, &dest)?;
    record_move(&source, &dest);
    Ok(dest.to_string_lossy().into_owned())
}

/// 删除收纳区时调用：把目录里所有项目放回桌面顶层，再删掉空目录。
pub fn dissolve_zone(zone_dir_name: &str) -> Result<u32, String> {
    let _guard = FILE_OPERATION_LOCK.lock().map_err(|e|e.to_string())?;
    let zone = zone_dir(zone_dir_name)?;
    if !zone.exists() {
        return Ok(0);
    }
    let Some(desktop) = scanner::personal_desktop() else {
        return Err("找不到桌面目录".into());
    };
    let mut moved = 0u32;
    for entry in std::fs::read_dir(&zone).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let dest = unique_dest(Path::new(&desktop), &name);
        move_path(&entry.path(), &dest)?;
        moved += 1;
    }
    std::fs::remove_dir(&zone).map_err(|error| error.to_string())?;
    Ok(moved)
}

/// 收纳区改名时同步目录名。
pub fn rename_zone_dir(old_dir: &str, new_dir: &str) -> Result<(), String> {
    let _guard = FILE_OPERATION_LOCK.lock().map_err(|e|e.to_string())?;
    let storage = ensure_storage()?;
    let from = storage.join(old_dir.trim());
    let to = storage.join(new_dir.trim());
    if !from.exists() {
        return Ok(()); // 空收纳区还没建目录
    }
    if to.exists() && normalize_path(&to) != normalize_path(&from) {
        return Err("目标目录已存在".into());
    }
    std::fs::rename(&from, &to).map_err(|error| error.to_string())
}

/// 重命名：同一目录下换新文件名。
pub fn rename_entry(path: &str, new_name: &str) -> Result<String, String> {
    let _guard = FILE_OPERATION_LOCK.lock().map_err(|e|e.to_string())?;
    let source = managed_path(path)?;
    let name = new_name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains('\\') || name.contains('/') {
        return Err("名称无效".into());
    }
    let Some(parent) = source.parent() else {
        return Err("路径无效".into());
    };

    let destination = parent.join(&name);
    if destination == source {
        return Ok(source.to_string_lossy().into_owned());
    }

    // 仅大小写不同的重命名（"Foo.txt" → "foo.txt"）：NTFS 大小写不敏感，
    // 直接 rename 会撞上"同名已存在"，借临时名走两步。
    if normalize_path(&destination) == normalize_path(&source) {
        let temp = parent.join(format!(
            ".nestra-ren-{}-{}",
            std::process::id(),
            chrono::Local::now().timestamp_millis()
        ));
        std::fs::rename(&source, &temp).map_err(|error| error.to_string())?;
        std::fs::rename(&temp, &destination).map_err(|error| error.to_string())?;
        return Ok(destination.to_string_lossy().into_owned());
    }

    if destination.exists() {
        return Err("桌面上已经存在同名项目".into());
    }

    std::fs::rename(&source, &destination).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

/// 回收站：只用回收（可撤销），不做硬删除。
pub fn recycle_entry(path: &str) -> Result<(), String> {
    let _guard = FILE_OPERATION_LOCK.lock().map_err(|e|e.to_string())?;
    let source = managed_path(path)?;
    trash::delete(&source).map_err(|error| error.to_string())
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::fs::OpenOptionsExt;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("nestra-move-test-{}-{}", std::process::id(), chrono::Local::now().timestamp_nanos_opt().unwrap()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
    fn recorded_fixture() -> (Fixture, PathBuf, PathBuf, u64) {
        let fixture=Fixture::new();let source=fixture.0.join("undo.txt");let folder=fixture.0.join("destination");
        std::fs::create_dir(&folder).unwrap();std::fs::write(&source,b"original bytes").unwrap();
        let destination=PathBuf::from(move_to_folder(source.to_str().unwrap(),Some(folder.to_str().unwrap())).unwrap());
        let id=list_file_moves().iter().find(|record|record.to_path==destination.to_string_lossy()).unwrap().id;
        (fixture,source,destination,id)
    }
    #[test]
    fn undo_restores_original_name_and_content_once() {
        let (_fixture,source,destination,id)=recorded_fixture();
        let result=undo_file_move(id).unwrap();assert_eq!(result.new_path,source.to_string_lossy());
        assert!(!destination.exists());assert_eq!(std::fs::read(&source).unwrap(),b"original bytes");assert!(undo_file_move(id).is_err());
    }
    #[test]
    fn undo_never_overwrites_occupied_original_path() {
        let (_fixture,source,destination,id)=recorded_fixture();std::fs::write(&source,b"new occupant").unwrap();
        assert!(undo_file_move(id).is_err());assert_eq!(std::fs::read(&source).unwrap(),b"new occupant");assert_eq!(std::fs::read(&destination).unwrap(),b"original bytes");
    }
    #[test]
    fn undo_rejects_modified_and_replaced_files() {
        let (_fixture,source,destination,id)=recorded_fixture();std::fs::write(&destination,b"modified content with a different size").unwrap();
        assert!(undo_file_move(id).is_err());assert!(!source.exists());assert!(destination.exists());
        std::fs::remove_file(&destination).unwrap();std::fs::write(&destination,b"replacement").unwrap();assert!(undo_file_move(id).is_err());assert!(!source.exists());
    }
    #[test]
    fn undo_refuses_missing_parent_and_can_retry_after_parent_returns() {
        let fixture=Fixture::new();let from=fixture.0.join("old");let to=fixture.0.join("new");std::fs::create_dir(&from).unwrap();std::fs::create_dir(&to).unwrap();let source=from.join("test.txt");std::fs::write(&source,b"data").unwrap();
        let destination=move_to_folder(source.to_str().unwrap(),Some(to.to_str().unwrap())).unwrap();let id=list_file_moves().iter().find(|record|record.to_path==destination).unwrap().id;
        std::fs::remove_dir(&from).unwrap();assert!(undo_file_move(id).is_err());std::fs::create_dir(&from).unwrap();assert!(undo_file_move(id).is_ok());assert_eq!(std::fs::read(&source).unwrap(),b"data");
    }
    #[test]
    fn cross_volume_copy_helpers_never_merge_or_overwrite_existing_targets() {
        let fixture=Fixture::new();let source=fixture.0.join("source");let destination=fixture.0.join("destination");std::fs::create_dir(&source).unwrap();std::fs::create_dir(&destination).unwrap();std::fs::write(source.join("test.txt"),b"source").unwrap();std::fs::write(destination.join("test.txt"),b"keep").unwrap();assert!(copy_dir_recursive(&source,&destination).is_err());assert!(copy_file_exclusive(&source.join("test.txt"),&destination.join("test.txt")).is_err());assert_eq!(std::fs::read(destination.join("test.txt")).unwrap(),b"keep");assert_eq!(std::fs::read(source.join("test.txt")).unwrap(),b"source");
    }
    #[test]
    fn move_into_zone_and_back_removes_old_icon_path_and_preserves_contents() {
        let fixture = Fixture::new();
        let desktop = fixture.0.join("Desktop");
        let zone = desktop.join(".nestra").join("Test zone");
        std::fs::create_dir_all(&zone).unwrap();
        let source = desktop.join("test shortcut.lnk");
        let destination = zone.join("test shortcut.lnk");
        std::fs::write(&source, b"test shortcut bytes").unwrap();
        move_path(&source, &destination).unwrap();
        assert!(!source.exists());
        assert_eq!(std::fs::read(&destination).unwrap(), b"test shortcut bytes");
        move_path(&destination, &source).unwrap();
        assert!(!destination.exists());
        assert_eq!(std::fs::read(&source).unwrap(), b"test shortcut bytes");
    }
    #[test]
    fn locked_source_does_not_leave_a_copy_in_zone() {
        let fixture = Fixture::new();
        let source = fixture.0.join("locked.txt");
        let destination = fixture.0.join("moved.txt");
        std::fs::write(&source, b"keep").unwrap();
        let lock = std::fs::OpenOptions::new().read(true).share_mode(0).open(&source).unwrap();
        assert!(move_path(&source, &destination).is_err());
        assert!(source.exists());
        assert!(!destination.exists());
        drop(lock);
    }
    #[test]
    fn mapped_folder_move_preserves_bytes_and_resolves_collision() {
        let fixture = Fixture::new();
        let folder = fixture.0.join("mapped");
        std::fs::create_dir(&folder).unwrap();
        let source = fixture.0.join("one.txt");
        std::fs::write(&source, b"source").unwrap();
        std::fs::write(folder.join("one.txt"), b"existing").unwrap();
        let moved = move_to_folder(source.to_str().unwrap(), Some(folder.to_str().unwrap())).unwrap();
        assert!(!source.exists());
        assert_eq!(std::fs::read(moved).unwrap(), b"source");
        assert_eq!(std::fs::read(folder.join("one.txt")).unwrap(), b"existing");
    }
    #[test]
    fn folder_cannot_be_moved_into_its_descendant() {
        let fixture = Fixture::new();
        let source = fixture.0.join("parent");
        let child = source.join("child");
        std::fs::create_dir_all(&child).unwrap();
        std::fs::write(source.join("keep.txt"), b"keep").unwrap();
        assert!(move_to_folder(source.to_str().unwrap(), Some(child.to_str().unwrap())).is_err());
        assert_eq!(std::fs::read(source.join("keep.txt")).unwrap(), b"keep");
        assert!(!child.join("parent").exists());
    }
    #[test]
    fn collision_never_overwrites_an_existing_file() {
        let fixture = Fixture::new();
        let source = fixture.0.join("one.txt");
        let destination = fixture.0.join("two.txt");
        std::fs::write(&source, b"one").unwrap();
        std::fs::write(&destination, b"two").unwrap();
        assert!(move_path(&source, &destination).is_err());
        assert_eq!(std::fs::read(&source).unwrap(), b"one");
        assert_eq!(std::fs::read(&destination).unwrap(), b"two");
    }
}
