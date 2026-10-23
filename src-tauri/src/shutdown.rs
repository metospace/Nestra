//! Exit only after every live frontend has drained its persistence queue.

use std::{
    collections::BTreeSet,
    sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Condvar, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

static SEQUENCE: AtomicU64 = AtomicU64::new(1);
static APPROVED: AtomicBool = AtomicBool::new(false);
static PENDING: Mutex<Option<ExitRequest>> = Mutex::new(None);
static CHANGED: Condvar = Condvar::new();
const SAVE_TIMEOUT: Duration = Duration::from_secs(15);

struct ExitRequest {
    id: u64,
    waiting: BTreeSet<String>,
    error: Option<String>,
}

impl ExitRequest {
    fn acknowledge(&mut self, label: &str, id: u64, error: Option<String>) {
        if self.id != id || !self.waiting.remove(label) { return; }
        if let Some(error) = error {
            self.error.get_or_insert(format!("{label}：{error}"));
        }
    }

    fn complete(&self) -> bool { self.waiting.is_empty() && self.error.is_none() }
}

pub fn approved() -> bool { APPROVED.load(Ordering::Acquire) }

pub fn in_progress() -> bool {
    approved() || PENDING.lock().map(|pending| pending.is_some()).unwrap_or(true)
}

pub fn acknowledge(label: &str, request_id: u64, error: Option<String>) {
    if let Ok(mut pending) = PENDING.lock() {
        if let Some(request) = pending.as_mut() {
            request.acknowledge(label, request_id, error);
            CHANGED.notify_all();
        }
    }
}

pub fn request_exit(app: &AppHandle) {
    let Ok(mut pending) = PENDING.lock() else { return; };
    if pending.is_some() || approved() { return; }
    let labels: BTreeSet<String> = app.webview_windows().into_keys()
        .filter(|label| matches!(label.as_str(), "desktop" | "manager" | "search"))
        .collect();
    let id = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    *pending = Some(ExitRequest { id, waiting: labels.clone(), error: None });
    drop(pending);
    let app = app.clone();
    // Window operations and the wait must not block the Windows UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        for label in labels {
            if let Err(error) = app.emit_to(label.as_str(), "nestra://prepare-exit", id) {
                acknowledge(&label, id, Some(error.to_string()));
            }
        }
        let deadline = Instant::now() + SAVE_TIMEOUT;
        let Ok(mut pending) = PENDING.lock() else { return; };
        let reason = loop {
            let Some(request) = pending.as_ref() else { return; };
            if request.complete() {
                APPROVED.store(true, Ordering::Release);
                drop(pending);
                app.exit(0);
                return;
            }
            if let Some(error) = &request.error {
                break format!("退出已取消，保存未完成：{error}");
            }
            let now = Instant::now();
            if now >= deadline {
                break format!("退出已取消，等待保存超时（{}），请稍后重试", request.waiting.iter().cloned().collect::<Vec<_>>().join("、"));
            }
            let Ok((next, _)) = CHANGED.wait_timeout(pending, deadline - now) else { return; };
            pending = next;
        };
        // Keep the request reserved until cancellation is queued, so a retry
        // cannot be unfrozen by this request's delayed cancellation event.
        let _ = app.emit("nestra://exit-cancelled", &reason);
        *pending = None;
        drop(pending);
        eprintln!("{reason}");
        crate::show_manager(&app);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> ExitRequest {
        ExitRequest { id: 7, waiting: ["desktop", "manager", "search"].into_iter().map(str::to_owned).collect(), error: None }
    }

    #[test]
    fn every_window_must_finish_before_exit() {
        let mut request = request();
        request.acknowledge("desktop", 7, None);
        request.acknowledge("manager", 7, None);
        assert!(!request.complete());
        request.acknowledge("search", 7, None);
        assert!(request.complete());
    }

    #[test]
    fn stale_duplicate_and_unknown_acknowledgments_do_not_authorize_exit() {
        let mut request = request();
        request.acknowledge("desktop", 6, None);
        request.acknowledge("unknown", 7, None);
        assert_eq!(request.waiting.len(), 3);
        request.acknowledge("desktop", 7, None);
        request.acknowledge("desktop", 7, Some("late duplicate".into()));
        assert_eq!(request.waiting.len(), 2);
        assert!(request.error.is_none());
    }

    #[test]
    fn failed_save_cannot_be_overridden_by_other_successes() {
        let mut request = request();
        request.acknowledge("manager", 7, Some("disk full".into()));
        request.acknowledge("desktop", 7, None);
        request.acknowledge("search", 7, None);
        assert!(!request.complete());
        assert!(request.error.as_ref().unwrap().contains("disk full"));
    }
}
