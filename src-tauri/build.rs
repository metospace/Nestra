fn main() {
    // Optimizing with `cargo build --release` alone still leaves Tauri in dev
    // mode: it loads devUrl and does not embed the frontend. Never ship that
    // executable, which stops working as soon as the Vite server exits.
    if std::env::var("PROFILE").as_deref() == Ok("release") && tauri_build::is_dev() {
        panic!(
            "Nestra release builds must embed the frontend. Run `pnpm build:app` \
             or `pnpm build:app:portable` from the repository root instead of \
             plain `cargo build --release`."
        );
    }
    // The embedded web assets must invalidate Cargo's cached executable even
    // when a release changes only Vue/TypeScript and no Rust source files.
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build()
}
