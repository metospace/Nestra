//! Bounded local diagnostics for intermittent desktop-layer failures. The GUI
//! thread never waits for disk I/O; records contain window metadata, not titles,
//! file names, clipboard data or keystrokes.
use std::{fs::{self, File, OpenOptions}, io::{self, Write}, path::PathBuf,
    sync::{OnceLock, mpsc::{self, SyncSender}}};
use serde::Serialize;
use serde_json::{json, Value};

pub const BUILD: &str = "20261025-desktop-diagnostics";
const MAX_BYTES: u64 = 1024 * 1024;
static SENDER: OnceLock<SyncSender<Value>> = OnceLock::new();

pub fn init(app: &tauri::AppHandle) {
    if SENDER.get().is_some() { return; }
    let Some(state) = crate::paths::state_file(app) else { return; };
    let Some(parent) = state.parent() else { return; };
    let directory = parent.join("diagnostics");
    let (sender, receiver) = mpsc::sync_channel(128);
    if std::thread::Builder::new().name("desktop-diagnostics".into()).spawn(move || {
        let mut writer = RollingLog::new(directory, MAX_BYTES);
        while let Ok(value) = receiver.recv() {
            // Read-only/failed disks must never affect organizer behavior.
            let _ = writer.write(&value);
        }
    }).is_ok() {
        let _ = SENDER.set(sender);
        record("session-start", json!({ "version": env!("CARGO_PKG_VERSION"), "pid": std::process::id() }));
    }
}

pub fn enabled() -> bool { SENDER.get().is_some() }

pub fn record(event: &str, details: impl Serialize) {
    let Some(sender) = SENDER.get() else { return; };
    // A full queue drops diagnostics rather than blocking the window thread.
    let _ = sender.try_send(json!({ "utc": chrono::Utc::now().to_rfc3339(),
        "build": BUILD, "event": event, "details": details }));
}

struct RollingLog { directory: PathBuf, limit: u64, file: Option<File>, bytes: u64 }
impl RollingLog {
    fn new(directory: PathBuf, limit: u64) -> Self { Self { directory, limit, file: None, bytes: 0 } }
    fn write(&mut self, value: &Value) -> io::Result<()> {
        let mut line = serde_json::to_vec(value)?;
        line.push(b'\n');
        if line.len() as u64 > self.limit { return Ok(()); }
        let current = self.directory.join("desktop-current.jsonl");
        if self.file.is_none() {
            fs::create_dir_all(&self.directory)?;
            let file = OpenOptions::new().create(true).append(true).open(&current)?;
            self.bytes = file.metadata()?.len();
            self.file = Some(file);
        }
        if self.bytes + line.len() as u64 > self.limit {
            self.file.take(); // Close before rotating on Windows.
            let previous = self.directory.join("desktop-previous.jsonl");
            match fs::remove_file(&previous) {
                Ok(()) => {},
                Err(error) if error.kind() == io::ErrorKind::NotFound => {},
                Err(error) => return Err(error),
            }
            fs::rename(&current, &previous)?;
            self.file = Some(OpenOptions::new().create(true).append(true).open(&current)?);
            self.bytes = 0;
        }
        let result = self.file.as_mut().expect("opened log").write_all(&line);
        if result.is_ok() { self.bytes += line.len() as u64; }
        else { self.file.take(); } // Recheck actual size after a partial write.
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("nestra-diagnostics-{}-{}", std::process::id(),
                chrono::Utc::now().timestamp_nanos_opt().unwrap())))
        }
    }
    impl Drop for Temp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn rotation_keeps_only_two_bounded_valid_logs() {
        let temp = Temp::new();
        let mut writer = RollingLog::new(temp.0.clone(), 160);
        for sequence in 0..100 { writer.write(&json!({ "sequence": sequence, "state": "visible" })).unwrap(); }
        drop(writer);
        let files: Vec<_> = fs::read_dir(&temp.0).unwrap().map(Result::unwrap).collect();
        assert_eq!(files.len(), 2);
        for file in files {
            assert!(file.metadata().unwrap().len() <= 160);
            for line in fs::read_to_string(file.path()).unwrap().lines() {
                serde_json::from_str::<Value>(line).unwrap();
            }
        }
        assert!(fs::read_to_string(temp.0.join("desktop-current.jsonl")).unwrap().contains("99"));
    }

    #[test]
    fn reopening_appends_and_rotates_using_existing_size() {
        let temp = Temp::new();
        for sequence in 0..10 {
            RollingLog::new(temp.0.clone(), 90).write(&json!({ "sequence": sequence })).unwrap();
        }
        let current = fs::read_to_string(temp.0.join("desktop-current.jsonl")).unwrap();
        assert!(current.contains("9"));
        assert!(temp.0.join("desktop-previous.jsonl").exists());
        assert!(current.len() <= 90);
    }

    #[test]
    fn oversize_records_and_unwritable_destination_do_not_panic() {
        let temp = Temp::new();
        let mut writer = RollingLog::new(temp.0.clone(), 20);
        writer.write(&json!({ "large": "a".repeat(100) })).unwrap();
        assert!(!temp.0.exists());
        fs::create_dir_all(&temp.0).unwrap();
        let blocked = temp.0.join("file");
        fs::write(&blocked, b"occupied").unwrap();
        assert!(RollingLog::new(blocked.clone(), 100).write(&json!({ "n": 1 })).is_err());
        assert_eq!(fs::read(blocked).unwrap(), b"occupied");
    }
}
