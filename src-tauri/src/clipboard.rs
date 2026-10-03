//! 剪贴板文本历史：后台线程轮询系统剪贴板，变化时入栈并广播。
//!
//! 规则（见 AGENTS.md）：
//! - 内容去重保留原 ID（重复内容移到顶部，不重建 id）
//! - 回写剪贴板时同步更新 LAST_HASH，抑制"把自己当成新记录"
//! - 历史只留内存，不落盘（避免密码/验证码写入磁盘）

#![cfg(windows)]

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicUsize, Ordering};
static ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);
pub fn set_enabled(enabled: bool) {
    if let Some(text) = read_clipboard_text() { suppress_next_read(&text); }
    ENABLED.store(enabled, Ordering::SeqCst);
}
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub const CLIP_EVENT: &str = "nestra://clipboard-changed";
const MAX_ITEMS: usize = 50;

static HISTORY: Mutex<Vec<ClipItem>> = Mutex::new(Vec::new());
static LAST_HASH: Mutex<u64> = Mutex::new(0);
static ID_COUNTER: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipItem {
    pub id: String,
    pub text: String,
    pub created_label: String,
}

fn hash_text(text: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

fn now_label() -> String {
    let local: chrono::DateTime<chrono::Local> = chrono::Local::now();
    local.format("%m-%d %H:%M").to_string()
}

/* 记录 / 查询 -------------------------------------------------------------- */

fn record(app: &AppHandle, text: String) {
    let id = format!(
        "c{}-{}",
        chrono::Utc::now().timestamp_millis(),
        ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let mut item = ClipItem { id, text, created_label: now_label() };

    if let Ok(mut history) = HISTORY.lock() {
        // 内容去重：移到顶部但保留原 id（前端持有的引用不会失效）。
        if let Some(existing) = history.iter().find(|existing| existing.text == item.text) { item.id = existing.id.clone(); }
        history.retain(|existing| existing.text != item.text);
        history.insert(0, item);
        history.truncate(MAX_ITEMS);
    }

    let _ = app.emit(CLIP_EVENT, ());
}

pub fn snapshot() -> Vec<ClipItem> {
    HISTORY.lock().map(|history| history.clone()).unwrap_or_default()
}

/// 复制指定历史项回系统剪贴板，并抑制监控把这次写入当成新记录。
pub fn copy_item_text(id: &str) -> Option<String> {
    let text = {
        let history = HISTORY.lock().ok()?;
        history.iter().find(|item| item.id == id)?.text.clone()
    };
    write_clipboard_text(&text)?;
    suppress_next_read(&text);
    Some(text)
}

pub fn remove_item(app: &AppHandle, id: &str) {
    if let Ok(mut history) = HISTORY.lock() {
        history.retain(|item| item.id != id);
    }
    let _ = app.emit(CLIP_EVENT, ());
}

pub fn clear_all(app: &AppHandle) {
    if let Ok(mut history) = HISTORY.lock() {
        history.clear();
    }
    let _ = app.emit(CLIP_EVENT, ());
}

/* Win32 读写 --------------------------------------------------------------- */

const CF_UNICODETEXT: u32 = 13;

/// 读取剪贴板纯文本；打不开或非文本返回 None。
pub fn read_clipboard_text() -> Option<String> {
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};

    unsafe {
        OpenClipboard(None).ok()?;
        let result = (|| {
            let handle = GetClipboardData(CF_UNICODETEXT).ok()?;
            let global = HGLOBAL(handle.0);
            let pointer = GlobalLock(global);
            if pointer.is_null() {
                return None;
            }
            // CF_UNICODETEXT 是 NUL 结尾的 UTF-16；先扫到结束符确定长度。
            let mut len = 0usize;
            while *pointer.cast::<u16>().add(len) != 0 {
                len += 1;
            }
            let wide = std::slice::from_raw_parts(pointer.cast::<u16>(), len).to_vec();
            let _ = GlobalUnlock(global);
            String::from_utf16(&wide).ok()
        })();
        CloseClipboard().ok();
        result.filter(|text| !text.is_empty())
    }
}

/// 把文本写入剪贴板（覆盖现有内容）。
pub fn write_clipboard_text(text: &str) -> Option<()> {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    let mut wide: Vec<u16> = text.encode_utf16().collect();
    wide.push(0);

    unsafe {
        OpenClipboard(None).ok()?;
        let result = (|| {
            EmptyClipboard().ok()?;
            let handle = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2).ok()?;
            let destination = GlobalLock(handle);
            if destination.is_null() {
                return None;
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), destination.cast::<u16>(), wide.len());
            let _ = GlobalUnlock(handle);

            // 所有权移交剪贴板；成功后不再 GlobalFree。
            SetClipboardData(CF_UNICODETEXT, Some(HANDLE(handle.0))).ok()?;
            Some(())
        })();
        CloseClipboard().ok();
        result
    }
}

/* 后台监控 ------------------------------------------------------------------ */

/// 启动时调用：初始化基准 hash、拉起轮询线程。
/// 剪贴板历史只留在内存，避免把密码/验证码写到磁盘。
pub fn init(app: &AppHandle) {
    if let Some(path) = crate::paths::state_file(app) {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(state) = serde_json::from_str::<serde_json::Value>(&text) { ENABLED.store(state["clipboardEnabled"].as_bool().unwrap_or(true), Ordering::SeqCst); }
        }
    }

    let baseline = read_clipboard_text().map(|text| hash_text(&text)).unwrap_or(0);
    if let Ok(mut last) = LAST_HASH.lock() {
        *last = baseline;
    }

    let handle = app.clone();
    std::thread::spawn(move || monitor_loop(handle));
}

fn monitor_loop(app: AppHandle) {
    loop {
        std::thread::sleep(Duration::from_millis(800));
        if !ENABLED.load(Ordering::SeqCst) { continue; }

        let Some(text) = read_clipboard_text() else { continue };
        if text.trim().is_empty() || text.len() > 100_000 {
            continue;
        }

        let hash = hash_text(&text);
        let unchanged = LAST_HASH.lock().map(|mut last| {
            if *last == hash {
                true
            } else {
                *last = hash;
                false
            }
        });
        if unchanged.unwrap_or(true) {
            continue;
        }

        record(&app, text);
    }
}

/// 复制回写后调用：让监控线程认为当前剪贴板内容已被记录（自写入抑制）。
pub fn suppress_next_read(text: &str) {
    if let Ok(mut last) = LAST_HASH.lock() {
        *last = hash_text(text);
    }
}
