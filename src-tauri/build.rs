fn main() {
    // The embedded web assets must invalidate Cargo's cached executable even
    // when a release changes only Vue/TypeScript and no Rust source files.
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build()
}
