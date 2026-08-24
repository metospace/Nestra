//! Desktop enumeration: personal + public desktop entries, shortcut
//! resolution and system entry points, mirroring the WPF scanners.

#![cfg(windows)]

use std::collections::HashMap;
use std::fs;
use std::os::windows::fs::MetadataExt;
use std::time::SystemTime;

use serde::Serialize;

const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
const SHORTCUT_EXTENSIONS: [&str; 3] = [".lnk", ".url", ".appref-ms"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopEntry {
    pub id: String,
    pub name: String,
    /// Physical path of the entry itself (the `.lnk` file for shortcuts).
    pub path: String,
    /// Resolved launch target (`shell:` URIs for system entries).
    pub target: String,
    /// `file` | `folder` | `shortcut` | `url` | `appref` | `shell`
    pub kind: String,
    /// `filesystem` | `shell`
    pub launch_kind: String,
    pub source_label: String,
    pub glyph: String,
    pub is_hidden: bool,
    pub is_fresh: bool,
    pub is_application: bool,
    pub icon_path: Option<String>,
}

/// Scans both desktop roots plus the two fixed shell entry points.
///
/// NOTE: intentionally does NOT extract shell icons — that would block the
/// snapshot for seconds. Icons are resolved afterwards via the batched
/// `resolve_icon_pairs` command (see AGENTS.md).
pub fn scan_desktop() -> Vec<DesktopEntry> {
    let mut by_identity: HashMap<String, DesktopEntry> = HashMap::new();

    let desktop = known_folder(&FOLDERID_DESKTOP);
    let public = known_folder(&FOLDERID_PUBLICDESKTOP);

    for (root, label) in [
        (desktop.clone(), "个人桌面"),
        (public, "公共桌面"),
    ] {
        let Some(root) = root else { continue };
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };

        for entry in entries.flatten() {
            let full_path = entry.path();
            let Some(meta) = fs::metadata(&full_path).ok() else {
                continue;
            };

            let name = full_path
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_default();
            if name.eq_ignore_ascii_case("desktop.ini") || name.is_empty() {
                continue;
            }

            let extension = extension_of(&name);
            let is_shortcut = SHORTCUT_EXTENSIONS.contains(&extension.as_str());
            let hidden = meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0;
            let modified = stamp_label(&meta.modified().ok().map(SystemTime::from));
            let created = meta.created().ok();
            let fresh = created
                .or_else(|| meta.modified().ok())
                .and_then(|time| time.elapsed().ok())
                .is_some_and(|age| age.as_secs() < 7 * 24 * 3600);

            let identity_prefix = if is_shortcut { "app:shortcut:" } else { "file:" };
            let identity = format!("{identity_prefix}{}", full_path.display());

            let (target, kind) = if extension == ".lnk" {
                (resolve_lnk(&full_path), "shortcut")
            } else if extension == ".url" {
                (resolve_url(&full_path), "url")
            } else if extension == ".appref-ms" {
                (Some(full_path.to_string_lossy().into_owned()), "appref")
            } else if meta.is_dir() {
                (Some(full_path.to_string_lossy().into_owned()), "folder")
            } else {
                (Some(full_path.to_string_lossy().into_owned()), "file")
            };

            // Unresolvable shortcuts still launch via their own file.
            let target = target.unwrap_or_else(|| full_path.to_string_lossy().into_owned());

            let display_name = if is_shortcut {
                name.trim_end_matches(&extension).to_string()
            } else {
                name.clone()
            };

            let glyph = glyph_for(&display_name, &kind);

            by_identity.entry(identity.clone()).or_insert(DesktopEntry {
                id: identity,
                name: display_name,
                path: full_path.to_string_lossy().into_owned(),
                target,
                kind: kind.into(),
                launch_kind: "filesystem".into(),
                source_label: format!("{label} · {modified}"),
                glyph,
                is_hidden: hidden,
                is_fresh: fresh,
                is_application: is_shortcut,
                icon_path: None,
            });
        }
    }

    add_system_entry(
        &mut by_identity,
        "system:this-pc",
        "此电脑",
        "shell:MyComputerFolder",
        "机",
    );
    add_system_entry(
        &mut by_identity,
        "system:recycle-bin",
        "回收站",
        "shell:RecycleBinFolder",
        "收",
    );

    let mut entries: Vec<DesktopEntry> = by_identity.into_values().collect();
    entries.sort_by(|a, b| {
        b.is_fresh
            .cmp(&a.is_fresh)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    entries
}

fn add_system_entry(
    map: &mut HashMap<String, DesktopEntry>,
    id: &str,
    name: &str,
    target: &str,
    glyph: &str,
) {
    if map.contains_key(id) {
        return;
    }

    map.insert(
        id.to_string(),
        DesktopEntry {
            id: id.to_string(),
            name: name.to_string(),
            path: target.to_string(),
            target: target.to_string(),
            kind: "shell".into(),
            launch_kind: "shell".into(),
            source_label: "Windows 系统入口".into(),
            glyph: glyph.to_string(),
            is_hidden: false,
            is_fresh: false,
            is_application: false,
            // `shell:` targets rarely resolve through the icon factory; the
            // frontend renders its own glyph when this comes back empty.
            icon_path: None,
        },
    );
}

fn extension_of(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((_, tail)) if !tail.is_empty() => format!(".{tail}").to_lowercase(),
        _ => String::new(),
    }
}

fn glyph_for(display_name: &str, kind: &str) -> String {
    if kind == "folder" {
        return "夹".into();
    }

    if matches!(kind, "shortcut" | "url" | "appref") {
        return "链".into();
    }

    match extension_of(display_name).as_str() {
        ".png" | ".jpg" | ".jpeg" | ".gif" | ".webp" | ".bmp" | ".svg" => "图",
        ".zip" | ".7z" | ".rar" => "压",
        ".xlsx" | ".xls" | ".csv" => "表",
        ".cs" | ".js" | ".ts" | ".tsx" | ".vue" | ".json" => "码",
        _ => "文",
    }
    .into()
}

/// Formats a modification time as `MM-dd HH:mm`, matching the WPF labels.
fn stamp_label(time: &Option<SystemTime>) -> String {
    let Some(time) = time else {
        return "--".into();
    };

    let local: chrono::DateTime<chrono::Local> = (*time).into();
    local.format("%m-%d %H:%M").to_string()
}

fn resolve_lnk(path: &std::path::Path) -> Option<String> {
    // Modern .lnk files are Unicode; the legacy code page only matters for
    // ancient shortcuts where a best-effort target is acceptable.
    let link = lnk::ShellLink::open(path, lnk::encoding::WINDOWS_1252).ok()?;
    link.link_target()
}

fn resolve_url(path: &std::path::Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    for line in text.lines() {
        if let Some(value) = line.strip_prefix("URL=") {
            return Some(value.trim().to_string());
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Known-folder helpers
// ---------------------------------------------------------------------------

use windows::core::GUID;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{KNOWN_FOLDER_FLAG, SHGetKnownFolderPath};

const FOLDERID_DESKTOP: GUID =
    GUID::from_u128(0xB4BFCC3A_DB2C_424C_B029_7FE99A87C641);
const FOLDERID_PUBLICDESKTOP: GUID =
    GUID::from_u128(0xC4AA340D_F20F_4863_AFEF_F87EF2E6BA25);

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
