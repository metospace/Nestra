//! Everything's documented QUERY2W IPC. No DLL, CLI, HTTP server or disk crawl.
//! https://www.voidtools.com/support/everything/sdk/ipc/
#![cfg(windows)]

use std::sync::OnceLock;
use std::time::{Duration, Instant};
use serde::Serialize;
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::DataExchange::COPYDATASTRUCT;
use windows::Win32::UI::WindowsAndMessaging::*;
use crate::scanner::{self, DesktopEntry};

const QUERY2W: usize = 18;
const REPLY: usize = 0x4e455354;
const FULL_PATH: u32 = 4;
const MAX_RESULTS: usize = 200;
const MAX_REPLY_BYTES: usize = 4 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub available: bool,
    pub message: String,
    pub total: u32,
    pub entries: Vec<DesktopEntry>,
}

struct IndexedItem { path: String, folder: bool }
struct Reply { total: u32, items: Vec<IndexedItem> }
struct Receiver { sender: HWND, result: Option<Result<Reply, String>> }

fn read_u32(bytes: &[u8], at: usize) -> Result<u32, String> {
    let end = at.checked_add(4).ok_or("Everything 返回了无效的数据偏移")?;
    let data = bytes.get(at..end).ok_or("Everything 返回了不完整的数据")?;
    Ok(u32::from_le_bytes(data.try_into().unwrap()))
}

fn parse_reply(bytes: &[u8], limit: usize) -> Result<Reply, String> {
    let total = read_u32(bytes, 0)?;
    let count = read_u32(bytes, 4)? as usize;
    if read_u32(bytes, 12)? != FULL_PATH || count > limit.min(MAX_RESULTS) || count > total as usize
        || bytes.len() < 20 + count * 8 {
        return Err("Everything 返回了无效的结果列表".into());
    }
    let mut items = Vec::with_capacity(count);
    for i in 0..count {
        let flags = read_u32(bytes, 20 + i * 8)?;
        let offset = read_u32(bytes, 24 + i * 8)? as usize;
        if offset < 20 + count * 8 { return Err("Everything 返回了无效的数据偏移".into()); }
        let length = read_u32(bytes, offset)? as usize;
        if length > 32768 { return Err("Everything 返回的路径过长".into()); }
        let text = bytes.get(offset + 4..offset + 4 + (length + 1) * 2)
            .ok_or("Everything 返回了不完整的路径")?;
        if text[text.len() - 2..] != [0, 0] { return Err("Everything 返回了无效的路径结尾".into()); }
        let units: Vec<u16> = text[..length * 2].chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
        if units.contains(&0) { return Err("Everything 返回的路径包含空字符".into()); }
        let path = String::from_utf16(&units).map_err(|_| "Everything 返回了无效的 Unicode 路径")?;
        items.push(IndexedItem { path, folder: flags & 1 != 0 });
    }
    Ok(Reply { total, items })
}

fn query_bytes(reply_hwnd: u32, query: &str, limit: usize) -> Vec<u8> {
    let mut bytes = Vec::new();
    // HWND occupies exactly 32 bits in this packed protocol even on x64.
    for value in [reply_hwnd, REPLY as u32, 0, 0, limit.min(MAX_RESULTS) as u32, FULL_PATH, 1] {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    for unit in query.encode_utf16().chain(Some(0)) { bytes.extend_from_slice(&unit.to_le_bytes()); }
    bytes
}

unsafe extern "system" fn receiver_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if msg == WM_NCCREATE {
        let create = &*(lp.0 as *const CREATESTRUCTW);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
    }
    if msg == WM_COPYDATA && lp.0 != 0 {
        let receiver = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut Receiver;
        if !receiver.is_null() && wp.0 == (*receiver).sender.0 as usize {
            let cds = &*(lp.0 as *const COPYDATASTRUCT);
            if cds.dwData == REPLY && !cds.lpData.is_null() && (cds.cbData as usize) <= MAX_REPLY_BYTES {
                let bytes = std::slice::from_raw_parts(cds.lpData as *const u8, cds.cbData as usize);
                (*receiver).result = Some(parse_reply(bytes, MAX_RESULTS));
                return LRESULT(1);
            }
        }
    }
    DefWindowProcW(hwnd, msg, wp, lp)
}

fn find_provider() -> Option<HWND> {
    unsafe {
        // Default 1.4/1.5 instance, plus the older 1.5 alpha default instance.
        [w!("EVERYTHING"), w!("EVERYTHING_(1.5a)")].into_iter()
            .find_map(|class| FindWindowW(class, None).ok().filter(|hwnd| !hwnd.0.is_null()))
    }
}

fn query_index(sender: HWND, query: &str, limit: usize) -> Result<Reply, String> {
    static CLASS: OnceLock<u16> = OnceLock::new();
    unsafe {
        let atom = CLASS.get_or_init(|| RegisterClassW(&WNDCLASSW {
            lpfnWndProc: Some(receiver_proc), lpszClassName: w!("Nestra.EverythingReply"),
            ..Default::default()
        }));
        if *atom == 0 { return Err("无法创建 Everything 查询通道".into()); }
        let mut receiver = Box::new(Receiver { sender, result: None });
        let hwnd = CreateWindowExW(WINDOW_EX_STYLE(0), w!("Nestra.EverythingReply"), w!(""),
            WINDOW_STYLE(0), 0, 0, 0, 0, Some(HWND_MESSAGE), None, None,
            Some((&mut *receiver as *mut Receiver).cast()))
            .map_err(|_| "无法创建 Everything 查询窗口")?;
        // Destroy on the same worker thread on every success/error path.
        struct WindowGuard(HWND);
        impl Drop for WindowGuard { fn drop(&mut self) { unsafe { let _ = DestroyWindow(self.0); } } }
        let _window = WindowGuard(hwnd);
        let bytes = query_bytes(hwnd.0 as usize as u32, query, limit);
        let cds = COPYDATASTRUCT { dwData: QUERY2W, cbData: bytes.len() as u32, lpData: bytes.as_ptr() as _ };
        let deadline = Instant::now() + Duration::from_millis(1800);
        let mut accepted = 0usize;
        let sent = SendMessageTimeoutW(sender, WM_COPYDATA, WPARAM(hwnd.0 as usize),
            LPARAM((&cds as *const COPYDATASTRUCT) as isize), SMTO_ABORTIFHUNG, 700, Some(&mut accepted));
        if sent.0 == 0 || accepted == 0 {
            return Err("Everything 未响应查询，请检查其是否运行并启用 IPC".into());
        }
        loop {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, Some(hwnd), 0, 0, PM_REMOVE).as_bool() {
                DispatchMessageW(&msg);
            }
            if let Some(reply) = receiver.result.take() { return reply; }
            if Instant::now() >= deadline { return Err("Everything 查询超时，索引可能正在加载".into()); }
            MsgWaitForMultipleObjects(None, false, 25, QS_ALLINPUT);
        }
    }
}

pub fn search(query: &str, limit: usize) -> SearchResponse {
    let failed = |message: &str| SearchResponse {
        available: false, message: message.into(), total: 0, entries: Vec::new(),
    };
    let Some(sender) = find_provider() else { return failed("Everything 未运行"); };
    let query = query.trim();
    if query.encode_utf16().count() > 1024 || query.contains('\0') { return failed("搜索条件过长或含无效字符"); }
    if query.is_empty() { return SearchResponse {
        available: true, message: "Everything 已连接 · 输入关键词搜索索引".into(), total: 0, entries: Vec::new(),
    }; }
    match query_index(sender, query, limit.clamp(1, MAX_RESULTS)) {
        Ok(reply) => SearchResponse {
            available: true, message: "Everything · 已索引的磁盘文件".into(), total: reply.total,
            // Use indexed type/path directly; inaccessible network results must
            // not stall the query while probing metadata or extracting icons.
            entries: reply.items.into_iter().filter_map(|item|
                scanner::indexed_entry(&item.path, item.folder)).collect(),
        },
        Err(error) => failed(&error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn response(path: &str, folder: bool) -> Vec<u8> {
        let mut bytes = Vec::new();
        for value in [1u32, 1, 0, FULL_PATH, 1, folder as u32, 28] { bytes.extend(value.to_le_bytes()); }
        let units: Vec<u16> = path.encode_utf16().collect();
        bytes.extend((units.len() as u32).to_le_bytes());
        for unit in units.into_iter().chain(Some(0)) { bytes.extend(unit.to_le_bytes()); }
        bytes
    }
    #[test]
    fn query_is_packed_utf16_and_bounded() {
        let bytes = query_bytes(0x12345678, "报告 ext:pdf", 9999);
        assert_eq!(read_u32(&bytes, 0).unwrap(), 0x12345678);
        assert_eq!(read_u32(&bytes, 16).unwrap(), MAX_RESULTS as u32);
        assert_eq!(read_u32(&bytes, 20).unwrap(), FULL_PATH);
        assert_eq!(bytes.len(), 28 + ("报告 ext:pdf".encode_utf16().count() + 1) * 2);
    }
    #[test]
    fn reply_preserves_unicode_path_and_folder_flag() {
        let reply = parse_reply(&response("E:\\资料\\报告", true), 80).unwrap();
        assert_eq!(reply.total, 1);
        assert_eq!(reply.items[0].path, "E:\\资料\\报告");
        assert!(reply.items[0].folder);
    }
    #[test]
    fn malformed_reply_never_reads_outside_buffer() {
        let good = response("E:\\报告.pdf", false);
        for length in 0..good.len() { assert!(parse_reply(&good[..length], 80).is_err()); }
        let mut bad = good.clone();
        bad[24..28].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(parse_reply(&bad, 80).is_err());
        bad = good.clone(); bad[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(parse_reply(&bad, 80).is_err());
        bad = good.clone(); bad[28..32].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(parse_reply(&bad, 80).is_err());
        bad = good; *bad.last_mut().unwrap() = 1;
        assert!(parse_reply(&bad, 80).is_err());
    }

    unsafe extern "system" fn fake_provider(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if msg == WM_NCCREATE {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, (*(lp.0 as *const CREATESTRUCTW)).lpCreateParams as isize);
        }
        if msg == WM_COPYDATA {
            let cds = &*(lp.0 as *const COPYDATASTRUCT);
            if cds.dwData != QUERY2W { return LRESULT(0); }
            let query = std::slice::from_raw_parts(cds.lpData as *const u8, cds.cbData as usize);
            if GetWindowLongPtrW(hwnd, GWLP_USERDATA) != 0 {
                let reply_hwnd = HWND(read_u32(query, 0).unwrap() as usize as _);
                let bytes = response("E:\\离线资料\\报告.pdf", false);
                let reply = COPYDATASTRUCT { dwData: read_u32(query, 4).unwrap() as usize,
                    cbData: bytes.len() as u32, lpData: bytes.as_ptr() as _ };
                SendMessageW(reply_hwnd, WM_COPYDATA, Some(WPARAM(hwnd.0 as usize)), Some(LPARAM((&reply as *const COPYDATASTRUCT) as isize)));
            }
            return LRESULT(1);
        }
        if msg == WM_CLOSE { let _ = DestroyWindow(hwnd); PostQuitMessage(0); return LRESULT(0); }
        DefWindowProcW(hwnd, msg, wp, lp)
    }

    struct FakeProvider { hwnd: usize, thread: Option<std::thread::JoinHandle<()>> }
    impl Drop for FakeProvider {
        fn drop(&mut self) {
            unsafe { let _ = PostMessageW(Some(HWND(self.hwnd as _)), WM_CLOSE, WPARAM(0), LPARAM(0)); }
            if let Some(thread) = self.thread.take() { thread.join().unwrap(); }
        }
    }
    fn start_fake(reply: bool) -> FakeProvider {
        static CLASS: OnceLock<u16> = OnceLock::new();
        let (tx, rx) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || unsafe {
            CLASS.get_or_init(|| RegisterClassW(&WNDCLASSW { lpfnWndProc: Some(fake_provider),
                lpszClassName: w!("Nestra.EverythingTestProvider"), ..Default::default() }));
            let hwnd = CreateWindowExW(WINDOW_EX_STYLE(0), w!("Nestra.EverythingTestProvider"), w!(""),
                WINDOW_STYLE(0), 0, 0, 0, 0, Some(HWND_MESSAGE), None, None, Some(reply as usize as _)).unwrap();
            tx.send(hwnd.0 as usize).unwrap();
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() { DispatchMessageW(&msg); }
        });
        FakeProvider { hwnd: rx.recv().unwrap(), thread: Some(thread) }
    }
    #[test]
    fn ipc_roundtrip_receives_results_on_its_worker_thread() {
        let server = start_fake(true);
        let reply = query_index(HWND(server.hwnd as _), "报告 ext:pdf", 80).unwrap();
        assert_eq!(reply.items[0].path, "E:\\离线资料\\报告.pdf");
    }
    #[test]
    fn accepted_query_without_reply_times_out_and_cleans_up() {
        let server = start_fake(false);
        let start = Instant::now();
        assert!(query_index(HWND(server.hwnd as _), "报告", 80).err().unwrap().contains("超时"));
        assert!(start.elapsed() < Duration::from_secs(3));
    }
    #[test]
    fn provider_absence_is_explicit() {
        if find_provider().is_none() {
            let result = search("报告", 80);
            assert!(!result.available);
            assert_eq!(result.message, "Everything 未运行");
            assert!(result.entries.is_empty());
        }
    }
}
