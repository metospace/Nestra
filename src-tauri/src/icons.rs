//! Shell icon extraction with a local PNG cache.
//!
//! Icons are resolved through `IShellItemImageFactory` (the same API Explorer
//! uses) and stored as PNG files under `<app-local-data>/cache/icons` so the
//! webview can load them through the asset protocol without further IPC.

#![cfg(windows)]

use std::path::Path;

use sha2::{Digest, Sha256};

const ICON_SIZE: i32 = 64;

/// Returns a cached PNG path for `path`, extracting the icon when needed.
/// `cache_dir` comes from the caller so this module stays handle-free.
pub fn icon_png_for(path: &str, cache_dir: Option<std::path::PathBuf>) -> Option<String> {
    let cache_key = cache_key(path);
    let cache_dir = cache_dir?;
    if crate::paths::ensure_dir(&cache_dir) {
        cleanup_stale_once(&cache_dir);

        let cached = cache_dir.join(format!("{cache_key}.png"));
        if cached.exists() {
            return Some(cached.to_string_lossy().into_owned());
        }

        // 失败也落盘一个 .fail 标记：shell: 入口等注定解析不了，
        // 不做负缓存的话每次启动/扫描都要白跑一遍 COM 提取。
        let failed = cache_dir.join(format!("{cache_key}.fail"));
        if failed.exists() {
            return None;
        }

        // Mark BEFORE loading native DLLs. A crashing helper leaves a negative
        // cache entry so the parent can skip that path and finish the batch.
        std::fs::write(&failed, b"").ok()?;
        let temporary = cached.with_extension("png.tmp");
        if extract_to(path, &temporary).is_some() && std::fs::rename(&temporary, &cached).is_ok() {
            let _ = std::fs::remove_file(&failed);
            return Some(cached.to_string_lossy().into_owned());
        }
        let _ = std::fs::write(&failed, b"");
    }

    None
}

/// Cache hits stay in the host. Only uncached paths cross the process boundary,
/// in small batches; a broken item cannot prevent the remaining icons loading.
pub fn resolve_pairs(pairs: Vec<[String; 2]>, cache_dir: Option<std::path::PathBuf>) -> std::collections::HashMap<String, Option<String>> {
    use std::collections::HashSet;
    let Some(dir) = cache_dir.filter(|dir| crate::paths::ensure_dir(dir)) else {
        return pairs.into_iter().map(|pair| (pair[0].clone(), None)).collect();
    };
    cleanup_stale_once(&dir);
    // Separate windows can request the same path; don't launch duplicate workers
    // or mistake another worker's in-progress marker for a permanent failure.
    static RESOLVE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let Ok(_guard) = RESOLVE_LOCK.lock() else { return Default::default(); };
    let mut seen = HashSet::new();
    let mut pending: Vec<String> = pairs.iter().flat_map(|pair| pair.iter()).filter(|path|
        !path.is_empty() && seen.insert((*path).clone())
        && !dir.join(format!("{}.png", cache_key(path))).exists()
        && !dir.join(format!("{}.fail", cache_key(path))).exists()).cloned().collect();
    while !pending.is_empty() {
        let batch: Vec<String> = pending.iter().take(16).cloned().collect();
        let request = crate::shell_worker::Request::Icons { paths: batch.clone(), cache_dir: dir.clone() };
        let _ = crate::shell_worker::execute(&request, std::time::Duration::from_secs(15));
        let old_len = pending.len();
        pending.retain(|path| !dir.join(format!("{}.png", cache_key(path))).exists()
            && !dir.join(format!("{}.fail", cache_key(path))).exists());
        // If the process couldn't start, stop rather than spinning forever.
        if pending.len() == old_len {
            for path in &pending { let _ = std::fs::write(dir.join(format!("{}.fail", cache_key(path))), b""); }
            break;
        }
    }
    pairs.into_iter().map(|pair| {
        let png = pair.iter().find_map(|path| {
            let file = dir.join(format!("{}.png", cache_key(path)));
            file.exists().then(|| file.to_string_lossy().into_owned())
        });
        (pair[0].clone(), png)
    }).collect()
}

/// 每个进程只跑一次：清掉 30 天前的 .png/.fail 缓存，防止无限增长。
fn cleanup_stale_once(dir: &Path) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static CLEANED: AtomicBool = AtomicBool::new(false);
    if CLEANED.swap(true, Ordering::SeqCst) {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = std::time::SystemTime::now()
        - std::time::Duration::from_secs(30 * 24 * 3600);
    for entry in entries.flatten() {
        let stale = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .is_some_and(|time| time < cutoff);
        if stale {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn cache_key(path: &str) -> String {
    let mut stamp = String::from(path);
    if let Ok(metadata) = std::fs::metadata(path) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(elapsed) = modified.duration_since(std::time::UNIX_EPOCH) {
                stamp = format!("{stamp}|{}", elapsed.as_secs());
            }
        }
    }

    let digest = Sha256::digest(stamp.as_bytes());
    hex_short(&digest)
}

fn hex_short(bytes: &[u8]) -> String {
    bytes
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Extracts the shell icon for `path` and writes a PNG to `destination`.
fn extract_to(path: &str, destination: &Path) -> Option<()> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, ReleaseDC, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        SHCreateItemFromParsingName, IShellItemImageFactory, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
    };

    unsafe {
        // Commands run on worker threads; make sure COM is available.
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().ok()?;
        struct ComGuard;
        impl Drop for ComGuard { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
        let _com = ComGuard;

        let location = HSTRING::from(path);
        let factory: IShellItemImageFactory =
            match SHCreateItemFromParsingName(PCWSTR(location.as_ptr()), None) {
                Ok(factory) => factory,
                Err(_) => return None,
            };

        let bitmap = match factory.GetImage(
            SIZE {
                cx: ICON_SIZE,
                cy: ICON_SIZE,
            },
            SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
        ) {
            Ok(bitmap) => bitmap,
            Err(_) => return None,
        };

        let hdc = GetDC(None);
        let mut buffer_info = BITMAPINFO::default();
        buffer_info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        buffer_info.bmiHeader.biWidth = ICON_SIZE;
        buffer_info.bmiHeader.biHeight = -ICON_SIZE; // top-down
        buffer_info.bmiHeader.biPlanes = 1;
        buffer_info.bmiHeader.biBitCount = 32;
        buffer_info.bmiHeader.biCompression = BI_RGB.0;

        let mut pixels = vec![0u8; (ICON_SIZE * ICON_SIZE * 4) as usize];
        let lines = GetDIBits(
            hdc,
            bitmap,
            0,
            ICON_SIZE as u32,
            Some(pixels.as_mut_ptr().cast()),
            &mut buffer_info,
            DIB_RGB_COLORS,
        );
        ReleaseDC(None, hdc);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));

        if lines == 0 {
            return None;
        }

        // GDI returns BGRA; convert in place and normalize alpha, because
        // plenty of legacy icons carry an all-zero alpha channel.
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2);
            if chunk[3] == 0 && (chunk[0] != 0 || chunk[1] != 0 || chunk[2] != 0) {
                chunk[3] = 255;
            }
        }

        let image = image::RgbaImage::from_raw(
            ICON_SIZE as u32,
            ICON_SIZE as u32,
            pixels,
        )?;
        image.save_with_format(destination, image::ImageFormat::Png).ok()?;
        Some(())
    }
}
