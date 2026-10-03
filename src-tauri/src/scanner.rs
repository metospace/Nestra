#![cfg(windows)]

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use windows::core::GUID;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{KNOWN_FOLDER_FLAG, SHGetKnownFolderPath};

const FOLDERID_DESKTOP: GUID =
    GUID::from_u128(0xB4BFCC3A_DB2C_424C_B029_7FE99A87C641);
const FOLDERID_PUBLICDESKTOP: GUID =
    GUID::from_u128(0xC4AA340D_F20F_4863_AFEF_F87EF2E6BA25);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopEntry {
    pub id: String,
    pub name: String,
    pub extension: String,
    /// Physical path of the entry itself (the `.lnk` file for shortcuts).
    pub path: String,
    /// Resolved launch target (`shell:` URIs for system entries).
    pub target: String,
    pub size: u64,
    pub modified: u64,
    /// `file` | `folder` | `shortcut` | `url` | `appref` | `shell`
    pub kind: String,
    pub source_label: String,
    /// `filesystem` | `shell`
    pub launch_kind: String,
    /// Emoji fallback when no real icon is available.
    pub glyph: String,
    pub is_hidden: bool,
    pub is_fresh: bool,
    pub is_application: bool,
    pub icon_path: Option<String>,
    /// 位于个人桌面内才可改名/删除（公共桌面项目只读展示）。
    pub can_manage: bool,
    /// 所在收纳区的目录名（Desktop\.nestra\<zone>\）；不在收纳区为 None。
    pub zone: Option<String>,
}

fn known_folder(id: &GUID) -> Option<String> {
    unsafe {
        let path = SHGetKnownFolderPath(id, KNOWN_FOLDER_FLAG(0), None).ok()?;
        let value = path
            .to_string()
            .ok()
            .map(|value| value.trim_end_matches('\\').to_string());
        CoTaskMemFree(Some(path.0 as _));
        value
    }
}

pub fn desktop_roots() -> Vec<String> {
    [
        known_folder(&FOLDERID_DESKTOP),
        known_folder(&FOLDERID_PUBLICDESKTOP),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// 个人桌面根目录（写入目标）；取不到时退回公共桌面。
pub fn personal_desktop() -> Option<String> {
    known_folder(&FOLDERID_DESKTOP).or_else(|| known_folder(&FOLDERID_PUBLICDESKTOP))
}

/// 收纳区的物理存放根目录：Desktop\.nestra\<分区目录>\。
/// 目录带隐藏属性，收进去的文件不再出现在桌面顶层——图标自然消失。
pub fn storage_root() -> Option<PathBuf> {
    personal_desktop().map(|root| PathBuf::from(root).join(".nestra"))
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn push_entry(
    by_identity: &mut HashMap<String, DesktopEntry>,
    full_path: PathBuf,
    label: &str,
    can_manage: bool,
    zone: Option<String>,
) {
    let name = name_of(&full_path);
    if name.is_empty() || name.eq_ignore_ascii_case("desktop.ini") {
        return;
    }

    let identity = full_path.to_string_lossy().to_lowercase();
    let ext = full_path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    let meta = full_path.metadata().ok();
    let is_dir = full_path.is_dir();

    let (target, kind) = if ext == ".lnk" {
        (resolve_lnk(&full_path), "shortcut")
    } else if ext == ".url" {
        (resolve_url(&full_path), "url")
    } else if ext == ".appref-ms" {
        (Some(full_path.to_string_lossy().into_owned()), "appref")
    } else if is_dir {
        (Some(full_path.to_string_lossy().into_owned()), "folder")
    } else {
        (Some(full_path.to_string_lossy().into_owned()), "file")
    };
    let target = target.unwrap_or_else(|| full_path.to_string_lossy().into_owned());

    let hidden = meta
        .as_ref()
        .map(|info| {
            use std::os::windows::fs::MetadataExt;
            info.file_attributes() & 0x2 != 0
        })
        .unwrap_or(false);
    let fresh = meta
        .as_ref()
        .and_then(|info| info.created().or_else(|_| info.modified()).ok())
        .and_then(|time| time.elapsed().ok())
        .map(|elapsed| elapsed.as_secs() < 7 * 24 * 3600)
        .unwrap_or(false);

    let is_application = matches!(kind, "shortcut" | "url" | "appref")
        || matches!(ext.as_str(), ".exe" | ".bat" | ".cmd");
    let display_name = full_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.clone());
    let modified = meta
        .as_ref()
        .and_then(|info| info.modified().ok())
        .and_then(|time| {
            time.duration_since(std::time::SystemTime::UNIX_EPOCH).ok()
        })
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let source_label = match &zone {
        Some(zone_name) if Path::new(zone_name).is_absolute() => format!("映射 · {zone_name}"),
        Some(zone_name) => format!("收纳区 {zone_name}"),
        None => label.to_string(),
    };
    let identity_prefix = if is_application { "app:shortcut:" } else { "file:" };

    by_identity.entry(identity).or_insert(DesktopEntry {
        id: format!("{identity_prefix}{}", full_path.display()),
        name: display_name,
        extension: ext.clone(),
        path: full_path.to_string_lossy().into_owned(),
        target,
        size: meta.as_ref().map(|info| info.len()).unwrap_or(0),
        modified,
        kind: kind.into(),
        source_label,
        launch_kind: "filesystem".into(),
        glyph: glyph_for(&ext, kind),
        is_hidden: hidden,
        is_fresh: fresh,
        is_application,
        icon_path: None,
        can_manage,
        zone,
    });
}

pub fn scan_paths(paths: &[String]) -> Vec<DesktopEntry> {
    let mut entries = HashMap::new();
    for path in paths {
        if Path::new(path).is_absolute() && Path::new(path).exists() {
            push_entry(&mut entries, PathBuf::from(path), "快捷引用", false, None);
        }
    }
    entries.into_values().collect()
}

/// Start-menu shortcuts plus packaged/registered AppsFolder applications.
/// No shell icons are extracted during this scan.
pub fn scan_applications() -> Vec<DesktopEntry> {
    use windows::core::w;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{FOLDERID_Programs, FOLDERID_CommonPrograms, SHCreateItemFromParsingName,
        IShellItem, IEnumShellItems, BHID_EnumItems, SIGDN_NORMALDISPLAY, SIGDN_PARENTRELATIVEPARSING};
    let mut results = HashMap::new();
    let mut stack: Vec<(PathBuf, usize)> = [known_folder(&FOLDERID_Programs), known_folder(&FOLDERID_CommonPrograms)]
        .into_iter().flatten().map(|path| (PathBuf::from(path), 0)).collect();
    while let Some((directory, depth)) = stack.pop() {
        if depth > 8 || results.len() >= 5000 { continue; }
        let Ok(items) = fs::read_dir(directory) else { continue; };
        for item in items.flatten() {
            let Ok(kind) = item.file_type() else { continue; };
            if kind.is_dir() && !kind.is_symlink() { stack.push((item.path(), depth + 1)); }
            else if item.path().extension().is_some_and(|ext| ext.eq_ignore_ascii_case("lnk")) {
                push_entry(&mut results, item.path(), "开始菜单应用", false, None);
            }
        }
    }
    unsafe {
        if CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok() {
            struct Guard;
            impl Drop for Guard { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
            let _guard = Guard;
            if let Ok(folder) = SHCreateItemFromParsingName::<_, _, IShellItem>(w!("shell:AppsFolder"), None) {
                if let Ok(enumeration) = folder.BindToHandler::<_, IEnumShellItems>(None, &BHID_EnumItems) {
                    for _ in 0..5000 {
                        let mut fetched = 0;
                        let mut items = [None];
                        if enumeration.Next(&mut items, Some(&mut fetched)).is_err() || fetched == 0 { break; }
                        let Some(item) = items[0].take() else { break; };
                        let name_result = item.GetDisplayName(SIGDN_NORMALDISPLAY);
                        let id_result = item.GetDisplayName(SIGDN_PARENTRELATIVEPARSING);
                        let (name_ptr, id_ptr) = match (name_result, id_result) {
                            (Ok(name), Ok(id)) => (name, id),
                            (name, id) => { if let Ok(ptr) = name { CoTaskMemFree(Some(ptr.0.cast())); } if let Ok(ptr) = id { CoTaskMemFree(Some(ptr.0.cast())); } continue; }
                        };
                        let name = name_ptr.to_string().unwrap_or_default();
                        let app_id = id_ptr.to_string().unwrap_or_default();
                        CoTaskMemFree(Some(name_ptr.0.cast())); CoTaskMemFree(Some(id_ptr.0.cast()));
                        if name.is_empty() || app_id.is_empty() { continue; }
                        let target = format!("shell:AppsFolder\\{app_id}");
                        let id = format!("app:registered:{app_id}");
                        results.insert(id.clone(), DesktopEntry { id, name, extension: String::new(), path: target.clone(), target,
                            kind: "shell".into(), launch_kind: "shell".into(), source_label: "已安装应用".into(), glyph: "应用".into(),
                            size: 0, modified: 0, is_hidden: false, is_fresh: false, is_application: true, icon_path: None,
                            can_manage: false, zone: None });
                    }
                }
            }
        }
    }
    let mut entries: Vec<_> = results.into_values().collect();
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    entries
}

/// Lightweight indexed results. Never resolve shortcuts/icons or stat paths:
/// an offline share in Everything's index must not block interactive search.
pub fn indexed_entry(path: &str, folder: bool) -> Option<DesktopEntry> {
    let full = Path::new(path);
    if !full.is_absolute() { return None; }
    let name = full.file_name().map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string());
    let ext = full.extension().map(|ext| format!(".{}", ext.to_string_lossy().to_lowercase())).unwrap_or_default();
    let kind = if folder { "folder" } else { match ext.as_str() {
        ".lnk" => "shortcut", ".url" => "url", ".appref-ms" => "appref", _ => "file",
    } };
    let app = !folder && (matches!(kind, "shortcut" | "url" | "appref") || matches!(ext.as_str(), ".exe" | ".bat" | ".cmd"));
    Some(DesktopEntry {
        id: format!("{}{}", if app { "app:shortcut:" } else { "file:" }, path),
        name, extension: ext.clone(), path: path.into(), target: path.into(),
        size: 0, modified: 0, kind: kind.into(), source_label: "Everything".into(),
        launch_kind: "filesystem".into(), glyph: glyph_for(&ext, kind),
        is_hidden: false, is_fresh: false, is_application: app, icon_path: None,
        can_manage: false, zone: None,
    })
}

pub fn scan_folder(path: &str) -> Result<Vec<DesktopEntry>, String> {
    let root = Path::new(path);
    if !root.is_absolute() { return Err("请输入文件夹的完整路径".into()); }
    let items = fs::read_dir(root).map_err(|e| format!("无法读取文件夹：{e}"))?;
    let mut entries = HashMap::new();
    for item in items {
        let item = item.map_err(|e| e.to_string())?;
        push_entry(&mut entries, item.path(), "映射文件夹", false, Some(path.to_string()));
    }
    Ok(entries.into_values().collect())
}

/// Recursive name search for mapped folders. It intentionally returns entries
/// without resolving icons; the frontend's existing batch icon queue fills only
/// the visible results. Symlinked directories are not followed, preventing loops.
pub fn search_folders(paths: &[String], query: &str, limit: usize) -> Vec<DesktopEntry> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() || limit == 0 {
        return Vec::new();
    }

    let mut entries = HashMap::new();
    let mut inspected = 0usize;
    let mut stack: Vec<(PathBuf, String, usize)> = paths
        .iter()
        .map(|path| (PathBuf::from(path), path.clone(), 0usize))
        .filter(|(path, _, _)| path.is_absolute())
        .collect();
    while let Some((folder, root, depth)) = stack.pop() {
        if entries.len() >= limit || depth > 12 || inspected >= 20_000 {
            continue;
        }
        let Ok(children) = fs::read_dir(&folder) else { continue; };
        for child in children.flatten() {
            inspected += 1;
            if entries.len() >= limit || inspected >= 20_000 { break; }
            let path = child.path();
            let Ok(kind) = child.file_type() else { continue; };
            let name = child.file_name().to_string_lossy().into_owned();
            if name.eq_ignore_ascii_case("desktop.ini") { continue; }
            if kind.is_dir() && !kind.is_symlink() {
                stack.push((path.clone(), root.clone(), depth + 1));
            }
            if name.to_lowercase().contains(&needle)
                || path.to_string_lossy().to_lowercase().contains(&needle)
            {
                push_entry(&mut entries, path, &format!("映射 · {root}"), false, Some(root.clone()));
            }
        }
    }
    entries.into_values().take(limit).collect()
}

pub fn scan_desktop() -> Vec<DesktopEntry> {
    let mut by_identity = HashMap::new();
    let desktop = known_folder(&FOLDERID_DESKTOP);
    let public = known_folder(&FOLDERID_PUBLICDESKTOP);

    for (root, label, can_manage) in [
        (desktop.clone(), "个人桌面", true),
        (public, "公共桌面", false),
    ] {
        let Some(root) = root else { continue };
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };

        for entry in entries.flatten() {
            let name = name_of(&entry.path());
            // .nestra 是收纳区存放处，本身不算桌面项目。
            if name.eq_ignore_ascii_case(".nestra") {
                continue;
            }
            push_entry(&mut by_identity, entry.path(), label, can_manage, None);
        }
    }

    // 收纳区条目：.nestra\<分区目录> 下的直接子项。文件真实移到了这里，
    // 桌面顶层看不到它们；扫描把它们读回来喂给对应的分区面板。
    if let Some(storage) = storage_root() {
        if let Ok(zones) = fs::read_dir(&storage) {
            for zone_dir in zones.flatten() {
                if !zone_dir.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let zone_name = zone_dir.file_name().to_string_lossy().into_owned();
                if let Ok(items) = fs::read_dir(zone_dir.path()) {
                    for item in items.flatten() {
                        push_entry(
                            &mut by_identity,
                            item.path(),
                            "收纳区",
                            true,
                            Some(zone_name.clone()),
                        );
                    }
                }
            }
        }
    }

    // System entries Explorer always shows on the desktop.
    for (id, name, glyph, target) in [
        ("this-pc", "此电脑", "🖥", "shell:MyComputerFolder"),
        ("recycle-bin", "回收站", "🗑", "shell:RecycleBinFolder"),
    ] {
        let identity = format!("system:{id}");
        by_identity.entry(identity.clone()).or_insert(DesktopEntry {
            id: identity.clone(),
            name: name.into(),
            extension: String::new(),
            path: target.into(),
            target: target.into(),
            size: 0,
            modified: 0,
            kind: "shell".into(),
            source_label: "系统入口".into(),
            launch_kind: "shell".into(),
            glyph: glyph.into(),
            is_hidden: false,
            is_fresh: false,
            is_application: false,
            // `shell:` targets rarely resolve through the icon factory; the
            // frontend renders its own glyph when this comes back empty.
            icon_path: None,
            can_manage: false,
            zone: None,
        });
    }

    let mut entries: Vec<DesktopEntry> = by_identity.into_values().collect();
    entries.sort_by_key(|entry| entry.path.clone());
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_results_do_not_require_online_paths_or_resolve_shortcuts() {
        let entry = indexed_entry("\\\\offline-share\\资料\\应用.lnk", false).unwrap();
        assert_eq!(entry.target, entry.path);
        assert_eq!(entry.kind, "shortcut");
        assert!(entry.is_application);
        assert!(!entry.can_manage);
        assert!(entry.icon_path.is_none());
        assert!(!indexed_entry("E:\\目录.exe", true).unwrap().is_application);
        assert!(indexed_entry("relative.txt", false).is_none());
    }

    #[test]
    fn mapped_search_finds_nested_files_without_flattening_the_panel_scan() {
        let root = std::env::temp_dir().join(format!(
            "nestra-search-test-{}-{}",
            std::process::id(),
            chrono::Local::now().timestamp_nanos_opt().unwrap()
        ));
        let nested = root.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("quarterly-report.txt"), b"report").unwrap();
        std::fs::write(root.join("top-level.txt"), b"top").unwrap();
        let root_text = root.to_string_lossy().into_owned();

        let panel = scan_folder(&root_text).unwrap();
        assert_eq!(panel.len(), 2);
        assert!(panel.iter().all(|entry| entry.name != "quarterly-report"));

        let results = search_folders(&[root_text], "quarterly", 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "quarterly-report");
        let _ = std::fs::remove_dir_all(root);
    }
}

fn glyph_for(extension: &str, kind: &str) -> String {
    if kind == "folder" {
        return "📁".into();
    }
    if matches!(kind, "shortcut" | "url" | "appref") {
        return "↗".into();
    }
    match extension {
        ".png" | ".jpg" | ".jpeg" | ".gif" | ".webp" | ".bmp" | ".svg" => "🖼",
        ".zip" | ".7z" | ".rar" => "🗜",
        ".xlsx" | ".xls" | ".csv" => "📊",
        ".cs" | ".js" | ".ts" | ".tsx" | ".vue" | ".json" => "📜",
        _ => "📄",
    }
    .into()
}

fn resolve_lnk(path: &Path) -> Option<String> {
    // Modern .lnk files are Unicode; the legacy code page only matters for
    // ancient shortcuts where a best-effort target is acceptable.
    let link = lnk::ShellLink::open(path, lnk::encoding::WINDOWS_1252).ok()?;
    link.link_target()
}

fn resolve_url(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    for line in text.lines() {
        if let Some(value) = line.strip_prefix("URL=") {
            return Some(value.trim().to_string());
        }
    }
    None
}
