//! Passive cursor samples keep hidden organizers reachable when the clipped
//! WebView is occluded and Chromium throttles JavaScript timers.
use std::{sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}, time::Duration};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};

static GENERATION: AtomicU64 = AtomicU64::new(1);
static TRACKER: Mutex<Option<Lease>> = Mutex::new(None);
struct Lease { generation: u64, stopped: Arc<AtomicBool> }
#[derive(Clone, Copy, Serialize)]
struct Point { x: i32, y: i32 }
#[derive(Clone, Serialize)]
struct Sample { generation: u64, cursor: Option<Point>, origin: Option<Point> }

fn replace_lease(current: &mut Option<Lease>, replacement: Option<Lease>) {
    if let Some(previous) = current.take() { previous.stopped.store(true, Ordering::Release); }
    *current = replacement;
}
fn finish_lease(current: &mut Option<Lease>, generation: u64) {
    if current.as_ref().is_some_and(|lease| lease.generation == generation) { current.take(); }
}
fn stop_lease(current: &mut Option<Lease>, generation: Option<u64>) {
    if current.as_ref().is_some_and(|lease| Some(lease.generation) == generation) { replace_lease(current, None); }
}

pub fn set_enabled(app: AppHandle, enabled: bool, previous: Option<u64>) -> Result<u64, String> {
    let mut tracker = TRACKER.lock().unwrap_or_else(|e| e.into_inner());
    if !enabled { stop_lease(&mut tracker, previous); return Ok(0); }
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed);
    let stopped = Arc::new(AtomicBool::new(false));
    replace_lease(&mut tracker, Some(Lease { generation, stopped: stopped.clone() }));
    let spawned = std::thread::Builder::new().name("nestra-hover-cursor".into()).spawn(move || {
        while !stopped.load(Ordering::Acquire) {
            let Some(window) = app.get_webview_window("desktop") else { break; };
            let mut cursor = POINT::default();
            let position = window.inner_position();
            let valid = unsafe { GetCursorPos(&mut cursor) }.is_ok() && position.is_ok();
            let origin = position.ok();
            let sample = Sample { generation,
                cursor: valid.then_some(Point { x: cursor.x, y: cursor.y }),
                origin: if valid { origin.map(|p| Point { x: p.x, y: p.y }) } else { None } };
            if stopped.load(Ordering::Acquire) { break; }
            if app.emit_to("desktop", "nestra://desktop-pointer", sample).is_err() { break; }
            std::thread::sleep(Duration::from_millis(100));
        }
        finish_lease(&mut TRACKER.lock().unwrap_or_else(|e| e.into_inner()), generation);
    });
    if let Err(error) = spawned {
        finish_lease(&mut tracker, generation);
        return Err(format!("无法启动收纳区悬停检测：{error}"));
    }
    Ok(generation)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replacing_or_stopping_tracking_cancels_the_previous_worker() {
        let first = Arc::new(AtomicBool::new(false)); let next = Arc::new(AtomicBool::new(false));
        let mut current = Some(Lease { generation: 1, stopped: first.clone() });
        replace_lease(&mut current, Some(Lease { generation: 2, stopped: next.clone() }));
        assert!(first.load(Ordering::Acquire)); assert!(!next.load(Ordering::Acquire));
        replace_lease(&mut current, None); assert!(next.load(Ordering::Acquire)); assert!(current.is_none());
    }
    #[test]
    fn old_worker_cannot_remove_a_new_tracking_lease() {
        let mut current = Some(Lease { generation: 2, stopped: Arc::new(AtomicBool::new(false)) });
        finish_lease(&mut current, 1); assert!(current.is_some());
        stop_lease(&mut current, Some(1)); assert!(current.is_some());
        finish_lease(&mut current, 2); assert!(current.is_none());
    }
}
