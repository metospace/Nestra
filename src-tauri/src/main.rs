// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(windows)]
    if nestra_lib::run_shell_worker() { return; }
    nestra_lib::run();
}
