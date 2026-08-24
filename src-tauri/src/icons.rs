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
        let cached = cache_dir.join(format!("{cache_key}.png"));
        if cached.exists() {
            return Some(cached.to_string_lossy().into_owned());
        }

        if extract_to(path, &cached).is_some() {
            return Some(cached.to_string_lossy().into_owned());
        }
    }

    None
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
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        SHCreateItemFromParsingName, IShellItemImageFactory, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
    };

    unsafe {
        // Commands run on worker threads; make sure COM is available.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

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
        image.save(destination).ok()?;
        Some(())
    }
}
