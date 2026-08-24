//! Application assembly: window lifecycle, tray menu, global shortcut and
//! command registration.

mod commands;
mod icons;
mod paths;
mod scanner;

#[cfg(windows)]
mod win32;

use std::str::FromStr;

use tauri::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{
    Builder as ShortcutBuilder, GlobalShortcutExt, Shortcut, ShortcutState,
};

const HOTKEY_MANAGER: &str = "ctrl+alt+g";
const TRAY_EVENT_NAME: &str = "nestra://tray";

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            ShortcutBuilder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed
                        && shortcut == &Shortcut::from_str(HOTKEY_MANAGER).expect("valid hotkey")
                    {
                        toggle_manager(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            prepare_desktop_layer(app.handle())?;
            register_hotkeys(app.handle())?;
            build_tray(app.handle())?;
            Ok(())
        })        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                // The desktop layer and the manager both hide instead of
                // closing; Nestra only exits through the tray menu.
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Focused(true) if window.label() == "desktop" => {
                #[cfg(windows)]
                win32::reassert_bottom();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_desktop,
            commands::resolve_icon_pairs,
            commands::open_entry,
            commands::reveal_entry,
            commands::load_state,
            commands::save_state,
            commands::set_hit_rects,
            commands::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("Nestra 启动失败");
}

/// Sizes the layer to the primary monitor, pins it to the bottom of the
/// z-order and keeps it non-focusable on startup.
fn prepare_desktop_layer(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(layer) = app.get_webview_window("desktop") else {
        return Ok(());
    };

    let monitor = match layer.current_monitor()? {
        Some(active) => Some(active),
        None => app.primary_monitor()?,
    };
    if let Some(monitor) = monitor {
        let position = monitor.position();
        let size = monitor.size();
        layer.set_position(tauri::PhysicalPosition::new(position.x, position.y))?;
        layer.set_size(tauri::PhysicalSize::new(size.width, size.height))?;
    }

    #[cfg(windows)]
    if let Ok(hwnd) = layer.hwnd() {
        win32::pin_desktop_layer(hwnd.0 as isize);
    }

    Ok(())
}

fn register_hotkeys(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let manager_shortcut = Shortcut::from_str(HOTKEY_MANAGER).expect("valid hotkey");
    app.global_shortcut().register(manager_shortcut)?;
    Ok(())
}

fn build_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "manager", "显示管理器", true, None::<&str>)?;
    let separator_1 = PredefinedMenuItem::separator(app)?;
    let note = MenuItem::with_id(app, "new-note", "新建便签", true, None::<&str>)?;
    let todo = MenuItem::with_id(app, "new-todo", "新建待办", true, None::<&str>)?;
    let separator_2 = PredefinedMenuItem::separator(app)?;
    let refresh = MenuItem::with_id(app, "refresh", "刷新分类", true, None::<&str>)?;
    let separator_3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Nestra", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show,
            &separator_1,
            &note,
            &todo,
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
                toggle_manager(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn handle_tray_menu(app: &tauri::AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "manager" => show_manager(app),
        "new-note" => notify_frontend(app, "new-note"),
        "new-todo" => notify_frontend(app, "new-todo"),
        "refresh" => notify_frontend(app, "refresh"),
        "quit" => app.exit(0),
        _ => {}
    }
}

fn notify_frontend(app: &tauri::AppHandle, action: &str) {
    let _ = app.emit_to("desktop", TRAY_EVENT_NAME, action);
}

fn show_manager(app: &tauri::AppHandle) {
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
