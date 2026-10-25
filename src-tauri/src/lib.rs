//! Application assembly: window lifecycle, tray menu, global shortcut and
//! command registration.

mod clipboard;
mod commands;
mod configuration;
#[cfg(windows)]
mod desktop_diagnostics;
#[cfg(windows)]
mod desktop_hover;
#[cfg(windows)]
mod everything;
#[cfg(windows)]
mod everything_setup;
#[cfg(windows)]
mod explorer;
#[cfg(windows)]
mod files;
mod icons;
#[cfg(windows)]
mod instance;
#[cfg(windows)]
mod shell_menu;
#[cfg(windows)]
mod shell_worker;
mod paths;
mod persistence;
mod scanner;
mod session;
mod shutdown;
#[cfg(windows)]
mod startup;
mod watch;

#[cfg(windows)]
mod win32;

pub use session::STATE_CHANGED_EVENT;
#[cfg(windows)]
pub use shell_worker::run_if_requested as run_shell_worker;

use std::str::FromStr;

use tauri::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{
    Builder as ShortcutBuilder, GlobalShortcutExt, Shortcut, ShortcutState,
};

const HOTKEY_MANAGER: &str = "ctrl+alt+g";
const HOTKEY_SEARCH: &str = "ctrl+alt+f";
const HOTKEY_PAUSE: &str = "ctrl+alt+p";
const TRAY_EVENT_NAME: &str = "nestra://tray";

pub fn run() {
    #[cfg(windows)]
    let _instance = match instance::acquire() {
        Ok(Some(guard)) => guard,
        Ok(None) => return,
        Err(error) => { eprintln!("{error}"); return; }
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            ShortcutBuilder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed || shutdown::in_progress() {
                        return;
                    }
                    let action = if shortcut == &Shortcut::from_str(HOTKEY_MANAGER).expect("valid hotkey") {
                        "manager"
                    } else if shortcut == &Shortcut::from_str(HOTKEY_SEARCH).expect("valid hotkey") {
                        "search"
                    } else { "pause" };
                    let app = app.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        if shutdown::in_progress() { return; }
                        match action {
                            "manager" => toggle_manager(&app),
                            "search" => session::open_search(&app),
                            _ => { session::toggle_paused(&app); refresh_pause_label(&app); }
                        }
                    });
                })
                .build(),
        )
        .setup(|app| {
            #[cfg(windows)]
            desktop_diagnostics::init(app.handle());
            prepare_desktop_layer(app.handle())?;
            session::apply_takeover(app.handle());
            clipboard::init(app.handle());
            #[cfg(windows)]
            {
                watch::start(app.handle());
                spawn_layer_watchdog(app.handle());
            }
            register_hotkeys(app.handle())?;
            build_tray(app.handle())?;
            #[cfg(windows)]
            if let Some(manager) = app.get_webview_window("manager") {
                if let Ok(hwnd) = manager.hwnd() { instance::mark_manager(hwnd.0 as isize); }
            }
            // Manual launches always have a discoverable entry. Autostart stays
            // in the tray; it uses --background in the Run key.
            if !std::env::args().any(|arg| arg == "--background") {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn_blocking(move || show_manager(&handle));
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                // 桌面层就是桌面本身，不能随窗口关闭/Win+D 一起藏起来。
                if window.label() == "desktop" {
                    return;
                }
                let window = window.clone();
                tauri::async_runtime::spawn_blocking(move || { let _ = window.hide(); });
            }
            WindowEvent::Focused(false) if window.label() == "search" => {
                let window = window.clone();
                tauri::async_runtime::spawn_blocking(move || { let _ = window.hide(); });
            }
            WindowEvent::Focused(true) if window.label() == "desktop" => {
                #[cfg(windows)]
                win32::reassert_bottom();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_applications,
            commands::pick_file,
            commands::set_clipboard_enabled,
            configuration::backup_configuration,
            configuration::list_configuration_backups,
            configuration::export_configuration,
            configuration::read_configuration,
            configuration::list_storage_zones,
            commands::scan_folder,
            commands::show_manager,
            commands::scan_paths,
            commands::move_to_folder,
            commands::list_file_moves,
            commands::undo_file_move,
            commands::recent_launches,
            commands::set_mapping_watch_paths,
            commands::search_mapped_folders,
            commands::search_everything,
            commands::set_desktop_hover_tracking,
            commands::everything_status,
            commands::install_everything,
            commands::start_everything,
            commands::list_displays,
            commands::pick_folder,
            commands::scan_desktop,
            commands::resolve_icon_pairs,
            commands::open_entry,
            commands::reveal_entry,
            commands::load_state,
            commands::save_state,
            commands::set_hit_rects,
            commands::clip_load,
            commands::clip_copy,
            commands::clip_remove,
            commands::clip_clear,
            commands::quit_app,
            commands::acknowledge_exit,
            commands::rename_entry,
            commands::recycle_entry,
            commands::create_zone,
            commands::move_to_zone,
            commands::move_paths_to_zone,
            commands::move_to_desktop,
            commands::dissolve_zone,
            commands::rename_zone_dir,
            commands::set_paused,
            commands::get_paused,
            commands::set_hide_native_icons,
            commands::start_with_windows,
            commands::set_start_with_windows,
            commands::open_search,
            commands::grant_desktop_input,
            commands::release_desktop_input,
            commands::show_shell_menu,
        ])
        .build(tauri::generate_context!())
        .expect("Nestra 启动失败")
        .run(|app, event| match event {
            RunEvent::ExitRequested { api, .. } if !shutdown::approved() => {
                api.prevent_exit();
                shutdown::request_exit(app);
            }
            RunEvent::Exit => session::prepare_exit(),
            _ => {}
        });
}

/// Sizes the layer to the complete Windows virtual desktop, pins it to the bottom of the
/// z-order and keeps it non-focusable on startup.
fn prepare_desktop_layer(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(layer) = app.get_webview_window("desktop") else {
        return Ok(());
    };

    #[cfg(windows)]
    {
        let (x, y, width, height) = win32::virtual_desktop_bounds();
        layer.set_position(tauri::PhysicalPosition::new(x, y))?;
        layer.set_size(tauri::PhysicalSize::new(width, height))?;
    }

    #[cfg(not(windows))]
    if let Some(monitor) = app.primary_monitor()? {
        layer.set_position(tauri::PhysicalPosition::new(monitor.position().x, monitor.position().y))?;
        layer.set_size(tauri::PhysicalSize::new(monitor.size().width, monitor.size().height))?;
    }

    #[cfg(feature = "ui-test")]
    layer.set_skip_taskbar(false)?;

    #[cfg(windows)]
    if let Ok(hwnd) = layer.hwnd() {
        let value = hwnd.0 as isize;
        layer.run_on_main_thread(move || {
            win32::pin_desktop_layer(value);
        })?;
    }

    Ok(())
}

/// The layer is independent of Explorer (no cross-process SetParent). Its
/// window-thread timer rediscovers a replaced desktop host. This watchdog also
/// repairs geometry and rebuilds the WebView if its own HWND was destroyed.
#[cfg(windows)]
fn spawn_layer_watchdog(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
      loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        if !win32::layer_destroyed() {
            // DPI alone can resize the HWND without changing monitor pixels.
            // Compare its actual rectangle on the UI thread every cycle.
            win32::recalibrate_desktop_layer();
            continue;
        }

        // A failed/missing native binding is recoverable without destroying a
        // live WebView. In particular, reset + failed prepare must retry rather
        // than leaving LAYER_HWND=0 permanently treated as healthy.
        if app.get_webview_window("desktop").and_then(|layer| layer.hwnd().ok())
            .is_some_and(|hwnd| unsafe { windows::Win32::UI::WindowsAndMessaging::IsWindow(
                Some(windows::Win32::Foundation::HWND(hwnd.0 as _))).as_bool() }) {
            if let Err(error) = prepare_desktop_layer(&app) { eprintln!("重新绑定桌面层失败：{error}"); }
            continue;
        }

        // 旧句柄已死；Tauri 侧可能还挂着记录，先清掉。
        if let Some(existing) = app.get_webview_window("desktop") {
            let _ = existing.destroy();
            std::thread::sleep(std::time::Duration::from_millis(300));
        }

        // Clear the previous layer before the replacement frontend can submit
        // its first hit rectangles. Clearing after build could erase them.
        win32::reset_layer_handle();
        match recreate_desktop_layer(&app) {
            Ok(_) => {
                if let Err(error) = prepare_desktop_layer(&app) { eprintln!("绑定重建桌面层失败：{error}"); }
                // 新 Explorer 实例的桌面图标重新出现，按设置再隐藏。
                session::apply_takeover(&app);
            }
            Err(error) => eprintln!("重建桌面层失败：{error}"),
        }
      }
    });
}

#[cfg(windows)]
fn recreate_desktop_layer(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::WebviewWindowBuilder;
    WebviewWindowBuilder::new(
        app,
        "desktop",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Nestra 桌面层")
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .focused(false)
    .shadow(false)
    // 必须 visible：隐藏创建的 WebView2 不注册 OLE DropTarget，收不到拖放。
    .visible(true)
    .build()?;
    Ok(())
}

fn register_hotkeys(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // 热键被占用时不能把整个应用带崩（本机 Ctrl+Alt+P 经常已被其他软件注册）。
    let _ = app.global_shortcut().unregister_all();
    for spec in [HOTKEY_MANAGER, HOTKEY_SEARCH, HOTKEY_PAUSE] {
        let shortcut = Shortcut::from_str(spec).expect("valid hotkey");
        if let Err(error) = app.global_shortcut().register(shortcut) {
            eprintln!("跳过热键 {spec}：{error}");
        }
    }
    Ok(())
}

fn build_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "manager", "显示管理器", true, None::<&str>)?;
    let search = MenuItem::with_id(app, "search", "搜索文件与应用\tCtrl+Alt+F", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "暂停整理，显示系统桌面\tCtrl+Alt+P", true, None::<&str>)?;
    let separator_1 = PredefinedMenuItem::separator(app)?;
    let note = MenuItem::with_id(app, "new-note", "新建便签", true, None::<&str>)?;
    let todo = MenuItem::with_id(app, "new-todo", "新建待办", true, None::<&str>)?;
    let clipboard_item = MenuItem::with_id(app, "new-clipboard", "新建剪贴板", true, None::<&str>)?;
    let new_zone = MenuItem::with_id(app, "new-zone", "新建收纳区", true, None::<&str>)?;
    let separator_2 = PredefinedMenuItem::separator(app)?;
    let refresh = MenuItem::with_id(app, "refresh", "刷新桌面", true, None::<&str>)?;
    let separator_3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Nestra", true, None::<&str>)?;

    app.manage(PauseMenu(pause.clone()));

    let menu = Menu::with_items(
        app,
        &[
            &show,
            &search,
            &pause,
            &separator_1,
            &note,
            &todo,
            &clipboard_item,
            &new_zone,
            &separator_2,
            &refresh,
            &separator_3,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("bundle icon").clone())
        .tooltip("Nestra")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(handle_tray_menu)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle().clone();
                tauri::async_runtime::spawn_blocking(move || toggle_manager(&app));
            }
        })
        .build(app)?;

    Ok(())
}

fn handle_tray_menu(app: &tauri::AppHandle, event: MenuEvent) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || handle_tray_action(&app, event));
}

fn handle_tray_action(app: &tauri::AppHandle, event: MenuEvent) {
    if shutdown::in_progress() { return; }
    match event.id().as_ref() {
        "manager" => show_manager(app),
        "search" => session::open_search(app),
        "pause" => {
            session::toggle_paused(app);
            refresh_pause_label(app);
        }
        "new-note" => {
            session::show_desktop_layer(app);
            notify_frontend(app, "new-note");
        }
        "new-todo" => {
            session::show_desktop_layer(app);
            notify_frontend(app, "new-todo");
        }
        "new-clipboard" => {
            session::show_desktop_layer(app);
            notify_frontend(app, "new-clipboard");
        }
        "new-zone" => {
            session::show_desktop_layer(app);
            notify_frontend(app, "new-zone");
        }
        "refresh" => notify_frontend(app, "refresh"),
        "quit" => shutdown::request_exit(app),
        _ => {}
    }
}

fn notify_frontend(app: &tauri::AppHandle, action: &str) {
    let _ = app.emit_to("desktop", TRAY_EVENT_NAME, action);
}

pub(crate) fn show_manager(app: &tauri::AppHandle) {
    if let Some(manager) = manager_window(app) {
        let _ = manager.show();
        let _ = manager.unminimize();
        let _ = manager.set_focus();
    }
}

fn toggle_manager(app: &tauri::AppHandle) {
    if let Some(manager) = manager_window(app) {
        if manager.is_visible().unwrap_or(false) && manager.is_focused().unwrap_or(false) {
            let _ = manager.hide();
        } else {
            show_manager(app);
        }
    }
}

fn manager_window(app: &tauri::AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("manager")
}

struct PauseMenu(MenuItem<tauri::Wry>);

fn refresh_pause_label(app: &tauri::AppHandle) {
    if let Some(item) = app.try_state::<PauseMenu>() {
        let label = if session::is_paused() {
            "恢复整理"
        } else {
            "暂停整理，显示系统桌面\tCtrl+Alt+P"
        };
        let _ = item.0.set_text(label);
    }
}
