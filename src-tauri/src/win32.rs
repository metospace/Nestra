//! One stable WebView clipped to the visible desktop surfaces. Windows routes
//! clicks and OLE drops outside the native region directly to Explorer. Never
//! toggle WS_EX_LAYERED on a live WebView2 composition surface.
#![cfg(windows)]
use std::{cell::RefCell, sync::{OnceLock, RwLock, atomic::{AtomicBool, AtomicIsize, AtomicU8, Ordering}}, time::{Duration, Instant}};
use windows::core::{w, BOOL};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{CreateRectRgn, CombineRgn, DeleteObject, EqualRgn, GetWindowRgn, RedrawWindow, SetWindowRgn, HRGN, RGN_OR, RGN_DIFF, RDW_INVALIDATE, RDW_NOERASE, RDW_ALLCHILDREN};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetFocus, SetFocus};
use windows::Win32::UI::WindowsAndMessaging::*;

static ORIGINAL_PROC: AtomicIsize = AtomicIsize::new(0);
static LAYER_HWND: AtomicIsize = AtomicIsize::new(0);
static STAY_ON_DESKTOP: AtomicBool = AtomicBool::new(true);
static PREV_FOREGROUND: AtomicIsize = AtomicIsize::new(0);
static INPUT_GRANTED: AtomicBool = AtomicBool::new(false);
static ATTACHED_THREAD: AtomicIsize = AtomicIsize::new(0);
static HIT_RECTS: RwLock<Vec<RECT>> = RwLock::new(Vec::new());
static SHELL_MENU_PROCESSES: RwLock<Vec<u32>> = RwLock::new(Vec::new());
pub(crate) const SHELL_MENU_OWNER: windows::core::PCWSTR = w!("Nestra.ShellMenuOwner");
const REGION_CHANGED: u32 = WM_APP + 0x51;
const CALIBRATE_BOUNDS: u32 = WM_APP + 0x52;
const RELEASE_INPUT: u32 = WM_APP + 0x53;
const RECONCILE_DESKTOP: u32 = WM_APP + 0x54;
const RESTORE_TIMER_ID: usize = 0x4E54;
const TRANSITION_TIMER_ID: usize = 0x4E55;
const RECHECK_ORDER: u8 = 1;
const FOREGROUND_CHANGED: u8 = 2;
static PENDING_DESKTOP_EVENTS: DesktopEvents = DesktopEvents(AtomicU8::new(0));

struct DesktopEvents(AtomicU8);

impl DesktopEvents {
    /// One posted message represents all pending events; never lose a foreground
    /// change when it arrives behind a reorder, since only it starts a probe.
    fn enqueue(&self, reason: u8) -> bool { self.0.fetch_or(reason, Ordering::SeqCst) == 0 }
    fn take(&self) -> u8 { self.0.swap(0, Ordering::SeqCst) }
}

#[derive(Default)]
struct TransitionProbe { until: Option<Instant> }

#[derive(Debug, PartialEq, Eq)]
enum ProbeTimerChange { Start, Stop, Unchanged }

impl TransitionProbe {
    fn update(&mut self, now: Instant, foreground_changed: bool, eligible: bool) -> ProbeTimerChange {
        let was_active = self.until.is_some();
        if !eligible { self.until = None; }
        else if foreground_changed { self.until = Some(now + Duration::from_millis(300)); }
        else if self.until.is_some_and(|until| now >= until) { self.until = None; }
        match (was_active, self.until.is_some()) {
            (false, true) => ProbeTimerChange::Start,
            (true, false) => ProbeTimerChange::Stop,
            _ => ProbeTimerChange::Unchanged,
        }
    }
}

// Created, read and destroyed only by the thread owning the layer HWND.
thread_local! {
    static DESKTOP_TRACKING: RefCell<Option<DesktopTracking>> = const { RefCell::new(None) };
    static TRANSITION_PROBE: RefCell<TransitionProbe> = const { RefCell::new(TransitionProbe { until: None }) };
}

struct DesktopTracking {
    marker: HWND,
    foreground_hook: HWINEVENTHOOK,
    reorder_hook: HWINEVENTHOOK,
}

impl Drop for DesktopTracking {
    fn drop(&mut self) {
        unsafe {
            if !self.foreground_hook.0.is_null() { let _ = UnhookWinEvent(self.foreground_hook); }
            if !self.reorder_hook.0.is_null() { let _ = UnhookWinEvent(self.reorder_hook); }
            if IsWindow(Some(self.marker)).as_bool() { let _ = DestroyWindow(self.marker); }
        }
    }
}

pub fn virtual_desktop_bounds() -> (i32, i32, u32, u32) {
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let width = GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1) as u32;
        let height = GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1) as u32;
        (x, y, width, height)
    }
}

/// Recheck the actual HWND, even if physical monitor bounds have not changed:
/// Tao's DPI handler can resize it using a new logical-to-physical scale.
/// Both watchdog callers and display messages marshal this to the window thread.
pub fn recalibrate_desktop_layer() {
    let hwnd = HWND(LAYER_HWND.load(Ordering::SeqCst) as _);
    if !hwnd.0.is_null() {
        unsafe { let _ = PostMessageW(Some(hwnd), CALIBRATE_BOUNDS, WPARAM(0), LPARAM(0)); }
    }
}

unsafe fn calibrate_window_bounds(hwnd: HWND, bounds: (i32, i32, u32, u32)) -> bool {
    let mut rect = RECT::default();
    if GetWindowRect(hwnd, &mut rect).is_err() { return false; }
    let (x, y, width, height) = bounds;
    if rect.left == x && rect.top == y && rect.right - rect.left == width as i32
        && rect.bottom - rect.top == height as i32 { return false; }
    // Only geometry changes: leave styles, activation, Z order and the native
    // hit region intact. No frame/style mutation that could recurse via DPI.
    SetWindowPos(hwnd, None, x, y, width as i32, height as i32,
        SWP_NOACTIVATE | SWP_NOZORDER).is_ok()
}

/// Unlike DISPLAY1/2, the monitor interface survives display enumeration order
/// changes. Keep the GDI name only as a migration alias for existing layouts.
pub fn monitor_identity(name: &str) -> String {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Graphics::Gdi::{EnumDisplayDevicesW, DISPLAY_DEVICEW, DISPLAY_DEVICE_ACTIVE};
    let name_wide = HSTRING::from(name);
    let mut index = 0;
    loop {
        let mut device = DISPLAY_DEVICEW { cb: std::mem::size_of::<DISPLAY_DEVICEW>() as u32, ..Default::default() };
        if !unsafe { EnumDisplayDevicesW(PCWSTR(name_wide.as_ptr()), index, &mut device, 1) }.as_bool() { break; }
        if (device.StateFlags & DISPLAY_DEVICE_ACTIVE).0 != 0 {
            let length = device.DeviceID.iter().position(|c| *c == 0).unwrap_or(device.DeviceID.len());
            let id = String::from_utf16_lossy(&device.DeviceID[..length]);
            if !id.is_empty() { return format!("monitor:{}", id.to_lowercase()); }
        }
        index += 1;
    }
    name.into()
}

pub fn set_hit_rects(mut rects: Vec<RECT>) {
    rects.retain(|r| r.right > r.left && r.bottom > r.top);
    rects.sort_by_key(|r| (r.left, r.top, r.right, r.bottom));
    rects.dedup();
    if let Ok(mut current) = HIT_RECTS.write() {
        if *current == rects { return; }
        *current = rects;
    }
    let hwnd = HWND(LAYER_HWND.load(Ordering::SeqCst) as _);
    if !hwnd.0.is_null() {
        unsafe { let _ = PostMessageW(Some(hwnd), REGION_CHANGED, WPARAM(0), LPARAM(0)); }
    }
}

unsafe fn build_region(rects: &[RECT]) -> Option<HRGN> {
    let region = CreateRectRgn(0, 0, 0, 0);
    if region.0.is_null() { return None; }
    for rect in rects {
        if rect.right <= rect.left || rect.bottom <= rect.top { continue; }
        let part = CreateRectRgn(rect.left, rect.top, rect.right, rect.bottom);
        if part.0.is_null() {
            let _ = DeleteObject(region.into());
            return None;
        }
        let result = CombineRgn(Some(region), Some(region), Some(part), RGN_OR);
        let _ = DeleteObject(part.into());
        if result.0 == 0 { let _ = DeleteObject(region.into()); return None; }
    }
    Some(region)
}

unsafe fn apply_surface_region(hwnd: HWND) {
    let rects = HIT_RECTS.read().map(|r| r.clone()).unwrap_or_default();
    if let Some(region) = build_region(&rects) {
        let previous = CreateRectRgn(0, 0, 0, 0);
        let has_previous = !previous.0.is_null() && GetWindowRgn(hwnd, previous).0 != 0;
        if has_previous && EqualRgn(region, previous).as_bool() {
            let _ = DeleteObject(previous.into());
            let _ = DeleteObject(region.into());
            return;
        }
        let exposed = CreateRectRgn(0, 0, 0, 0);
        if !exposed.0.is_null() {
            let _ = CombineRgn(Some(exposed), Some(region), if has_previous { Some(previous) } else { Some(region) },
                if has_previous { RGN_DIFF } else { RGN_OR });
        }
        // On success Windows owns the region. An empty region leaves no hidden
        // full-screen input target during startup or when all surfaces are hidden.
        // Preserve existing WebView pixels. Only newly exposed popup/surface
        // area needs invalidation; erasing the whole layer flashes every card.
        if SetWindowRgn(hwnd, Some(region), false) == 0 {
            let _ = DeleteObject(region.into());
        } else if !exposed.0.is_null() {
            let _ = RedrawWindow(Some(hwnd), None, Some(exposed), RDW_INVALIDATE | RDW_NOERASE | RDW_ALLCHILDREN);
        }
        if !previous.0.is_null() { let _ = DeleteObject(previous.into()); }
        if !exposed.0.is_null() { let _ = DeleteObject(exposed.into()); }
    }
}

fn desktop_host() -> Option<HWND> {
    unsafe extern "system" fn find(hwnd: HWND, data: LPARAM) -> BOOL {
        let mut class = [0u16; 64];
        let length = GetClassNameW(hwnd, &mut class) as usize;
        let class = String::from_utf16_lossy(&class[..length]);
        let shell = GetShellWindow();
        let mut shell_pid = 0;
        let mut candidate_pid = 0;
        GetWindowThreadProcessId(shell, Some(&mut shell_pid));
        GetWindowThreadProcessId(hwnd, Some(&mut candidate_pid));
        if matches!(class.as_str(), "Progman" | "WorkerW")
            && shell_pid != 0 && candidate_pid == shell_pid
            && FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), None)
                .is_ok_and(|child| !child.0.is_null()) {
            *(data.0 as *mut HWND) = hwnd;
            return BOOL(0);
        }
        BOOL(1)
    }
    let mut host = HWND::default();
    unsafe {
        let _ = EnumWindows(Some(find), LPARAM(&mut host as *mut HWND as isize));
    }
    (!host.0.is_null()).then_some(host)
}

// This independent, invisible normal-band window stays below ordinary apps.
// A normal click on the desktop does not move its host above this marker;
// Show Desktop does. Foreground alone cannot distinguish those two cases.
unsafe extern "system" fn marker_window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_WINDOWPOSCHANGING {
        if let Some(pos) = (lparam.0 as *mut WINDOWPOS).as_mut() {
            pos.flags |= SWP_NOZORDER | SWP_NOACTIVATE;
            pos.flags &= !SWP_SHOWWINDOW;
        }
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

unsafe fn create_desktop_marker() -> Option<HWND> {
    static CLASS: OnceLock<u16> = OnceLock::new();
    let instance = GetModuleHandleW(None).ok()?;
    let class = *CLASS.get_or_init(|| RegisterClassW(&WNDCLASSW {
        lpfnWndProc: Some(marker_window_proc),
        hInstance: instance.into(),
        lpszClassName: w!("NestraDesktopOrderMarker"),
        ..Default::default()
    }));
    if class == 0 { return None; }
    let marker = CreateWindowExW(WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
        w!("NestraDesktopOrderMarker"), w!(""), WS_POPUP | WS_DISABLED,
        0, 0, 0, 0, None, None, Some(instance.into()), None).ok()?;
    if position_without_activation(marker, HWND_BOTTOM).is_err() {
        let _ = DestroyWindow(marker);
        return None;
    }
    Some(marker)
}

unsafe extern "system" fn foreground_changed(_hook: HWINEVENTHOOK, event: u32, _hwnd: HWND,
    _object: i32, _child: i32, _thread: u32, _time: u32) {
    // OUTOFCONTEXT delivers on our message-loop thread, but never manipulate
    // windows inside a WinEvent callback (including events from our own windows).
    // Menu start/end can change the desktop interaction without changing the
    // foreground HWND. Recheck them, but only foreground starts a short probe.
    queue_desktop_event(if event == EVENT_SYSTEM_FOREGROUND { FOREGROUND_CHANGED } else { RECHECK_ORDER });
}

fn desktop_reorder_event(event: u32, hwnd: HWND, desktop: HWND, object: i32, child: i32) -> bool {
    event == EVENT_OBJECT_REORDER && !desktop.0.is_null() && hwnd == desktop && child == 0
        && (object == OBJID_CLIENT.0 || object == OBJID_WINDOW.0)
}

unsafe extern "system" fn desktop_reordered(_hook: HWINEVENTHOOK, event: u32, hwnd: HWND,
    object: i32, child: i32, _thread: u32, _time: u32) {
    // Top-level Z-order changes are reported by the desktop container, not
    // necessarily by Progman/WorkerW. Ignore control/list reorders elsewhere.
    if desktop_reorder_event(event, hwnd, GetDesktopWindow(), object, child) {
        queue_desktop_event(RECHECK_ORDER);
    }
}

fn queue_desktop_event(reason: u8) {
    let hwnd = HWND(LAYER_HWND.load(Ordering::SeqCst) as _);
    if !hwnd.0.is_null() && PENDING_DESKTOP_EVENTS.enqueue(reason) {
        if unsafe { PostMessageW(Some(hwnd), RECONCILE_DESKTOP, WPARAM(0), LPARAM(0)) }.is_err() {
            PENDING_DESKTOP_EVENTS.take();
        }
    }
}

unsafe fn ensure_desktop_tracking() -> Option<HWND> {
    DESKTOP_TRACKING.with(|tracking| {
        let mut tracking = tracking.borrow_mut();
        if tracking.as_ref().is_some_and(|state| !IsWindow(Some(state.marker)).as_bool()) {
            *tracking = None;
        }
        if tracking.is_none() {
            *tracking = Some(DesktopTracking {
                marker: create_desktop_marker()?,
                foreground_hook: HWINEVENTHOOK::default(),
                reorder_hook: HWINEVENTHOOK::default(),
            });
        }
        let state = tracking.as_mut()?;
        if state.foreground_hook.0.is_null() {
            state.foreground_hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MENUPOPUPEND,
                None, Some(foreground_changed), 0, 0, WINEVENT_OUTOFCONTEXT);
        }
        if state.reorder_hook.0.is_null() {
            state.reorder_hook = SetWinEventHook(EVENT_OBJECT_REORDER, EVENT_OBJECT_REORDER,
                None, Some(desktop_reordered), 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
        }
        Some(state.marker)
    })
}

#[derive(Clone, Copy)]
struct OrderedWindow { value: isize, topmost: bool }

fn window_order() -> Option<Vec<OrderedWindow>> {
    unsafe extern "system" fn collect(hwnd: HWND, data: LPARAM) -> BOOL {
        let order = &mut *(data.0 as *mut Vec<OrderedWindow>);
        order.push(OrderedWindow { value: hwnd.0 as isize,
            topmost: GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0 });
        BOOL(1)
    }
    let mut order = Vec::new();
    unsafe { EnumWindows(Some(collect), LPARAM(&mut order as *mut Vec<OrderedWindow> as isize)).ok()?; }
    Some(order)
}

#[derive(Debug, PartialEq, Eq)]
enum DesktopOrderMode { Normal, Raised, Unknown }

fn desktop_order_mode(order: &[OrderedWindow], layer: isize, host: Option<isize>, marker: Option<isize>) -> DesktopOrderMode {
    let (Some(host), Some(marker)) = (host.filter(|v| *v != 0), marker.filter(|v| *v != 0)) else { return DesktopOrderMode::Unknown; };
    if layer == 0 || layer == host || layer == marker || host == marker
        || !order.iter().any(|window| window.value == layer) { return DesktopOrderMode::Unknown; }
    let host = order.iter().position(|window| window.value == host);
    let marker = order.iter().position(|window| window.value == marker);
    match (host, marker) {
        (Some(host), Some(marker)) if host < marker => DesktopOrderMode::Raised,
        (Some(_), Some(_)) => DesktopOrderMode::Normal,
        _ => DesktopOrderMode::Unknown,
    }
}

fn temporary_topmost_allowed(mode: &DesktopOrderMode, stay: bool, desktop_foreground: bool, shell_cloaked: bool) -> bool {
    stay && desktop_foreground && !shell_cloaked && *mode == DesktopOrderMode::Raised
}

unsafe fn position_without_activation(hwnd: HWND, after: HWND) -> windows::core::Result<()> {
    // Internal moves must bypass WM_WINDOWPOSCHANGING, which prevents Shell or
    // activation requests from independently changing the layer's Z order.
    SetWindowPos(hwnd, Some(after), 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE
        | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING)
}

unsafe fn set_temporary_topmost(hwnd: HWND, order: &[OrderedWindow]) {
    let topmost = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0;
    let bottom = order.iter().rev().find(|window| window.topmost && window.value != hwnd.0 as isize)
        .map(|window| HWND(window.value as _));
    if !topmost && position_without_activation(hwnd, HWND_TOPMOST).is_err() { return; }
    // Keep all existing topmost windows (taskbar, menus, overlays) above us.
    // Promotion is explicit: insertion after the last topmost HWND alone can
    // leave a normal window in the normal band.
    if let Some(bottom) = bottom {
        if GetWindow(hwnd, GW_HWNDPREV).ok() != Some(bottom) {
            let _ = position_without_activation(hwnd, bottom);
        }
    }
}

unsafe fn anchor_in_normal_band(hwnd: HWND, anchor: Option<HWND>) {
    let topmost = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0;
    let mut after = HWND_BOTTOM;
    if let Some(anchor) = anchor.filter(|handle| IsWindow(Some(*handle)).as_bool()) {
        if !topmost && GetWindow(hwnd, GW_HWNDNEXT).ok() == Some(anchor) { return; }
        let mut above = GetWindow(anchor, GW_HWNDPREV).unwrap_or_default();
        if above == hwnd { above = GetWindow(hwnd, GW_HWNDPREV).unwrap_or_default(); }
        if !above.0.is_null() && IsWindow(Some(above)).as_bool()
            && GetWindowLongPtrW(above, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 == 0 {
            after = above;
        }
    }
    if after == HWND_BOTTOM && !topmost && GetWindow(hwnd, GW_HWNDNEXT).unwrap_or_default().0.is_null() { return; }
    // Positioning after a verified non-topmost HWND (or BOTTOM) demotes and
    // anchors in one operation. NOTOPMOST first briefly exposed the layer over
    // every normal app before the second positioning call moved it down.
    let _ = position_without_activation(hwnd, after);
}

unsafe fn reconcile_desktop_order(hwnd: HWND) {
    reconcile_desktop_event(hwnd, false);
}

struct TrayForeground<'a> {
    foreground: isize,
    foreground_pid: u32,
    root: isize,
    root_pid: u32,
    root_class: &'a str,
}

fn trusted_tray_foreground(shell_pid: u32, candidate: &TrayForeground<'_>) -> bool {
    shell_pid != 0 && candidate.foreground != 0 && candidate.root != 0
        && candidate.foreground_pid == shell_pid && candidate.root_pid == shell_pid
        && matches!(candidate.root_class, "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
            | "TopLevelWindowForOverflowXamlIsland" | "NotifyIconOverflowWindow")
}

unsafe fn tray_foreground_for_shell_pid(foreground: HWND, shell_pid: u32) -> bool {
    if shell_pid == 0 || !IsWindow(Some(foreground)).as_bool() { return false; }
    // GA_ROOT follows parents only. Following owners would also admit ordinary
    // dialogs associated with the tray, and must not extend this exception.
    let root = GetAncestor(foreground, GA_ROOT);
    if !IsWindow(Some(root)).as_bool() { return false; }
    let mut foreground_pid = 0;
    let mut root_pid = 0;
    GetWindowThreadProcessId(foreground, Some(&mut foreground_pid));
    GetWindowThreadProcessId(root, Some(&mut root_pid));
    let mut class = [0u16; 128];
    let length = GetClassNameW(root, &mut class) as usize;
    let root_class = String::from_utf16_lossy(&class[..length]);
    trusted_tray_foreground(shell_pid, &TrayForeground {
        foreground: foreground.0 as isize, foreground_pid,
        root: root.0 as isize, root_pid, root_class: &root_class,
    })
}

unsafe fn shell_tray_has_foreground(foreground: HWND) -> bool {
    let shell = GetShellWindow();
    if !IsWindow(Some(shell)).as_bool() { return false; }
    let mut shell_pid = 0;
    GetWindowThreadProcessId(shell, Some(&mut shell_pid));
    // Do not cache Explorer's PID: its taskbar/overflow windows are replaced
    // after a Shell restart. Same-PID File Explorer windows are not accepted.
    tray_foreground_for_shell_pid(foreground, shell_pid)
}

/// Only a live Menu request may extend the desktop interaction. Dialog, icon
/// and open helpers are deliberately absent from this registry.
pub(crate) struct ShellMenuProcess(u32);
impl Drop for ShellMenuProcess {
    fn drop(&mut self) {
        if let Ok(mut processes) = SHELL_MENU_PROCESSES.write() {
            if let Some(index) = processes.iter().rposition(|pid| *pid == self.0) { processes.remove(index); }
        }
        reassert_bottom();
    }
}

pub(crate) fn track_shell_menu_process(pid: u32) -> ShellMenuProcess {
    if pid != 0 {
        if let Ok(mut processes) = SHELL_MENU_PROCESSES.write() { processes.push(pid); }
    }
    reassert_bottom();
    ShellMenuProcess(pid)
}

unsafe fn helper_menu_has_foreground(foreground: HWND) -> bool {
    if !IsWindow(Some(foreground)).as_bool() { return false; }
    let root = GetAncestor(foreground, GA_ROOT);
    if !IsWindow(Some(root)).as_bool() { return false; }
    let mut pid = 0;
    let mut root_pid = 0;
    let thread = GetWindowThreadProcessId(foreground, Some(&mut pid));
    GetWindowThreadProcessId(root, Some(&mut root_pid));
    if pid == 0 || root_pid != pid
        || !SHELL_MENU_PROCESSES.read().is_ok_and(|processes| processes.contains(&pid)) { return false; }
    if !GetPropW(root, SHELL_MENU_OWNER).0.is_null() { return true; }
    // Some classic menus expose their own foreground HWND. Admit only an
    // active menu whose reported owner is our marked window, never a property
    // dialog or arbitrary window created by a Shell extension in the worker.
    let mut class = [0u16; 32];
    let length = GetClassNameW(root, &mut class) as usize;
    if String::from_utf16_lossy(&class[..length]) != "#32768" || thread == 0 { return false; }
    let mut info = GUITHREADINFO { cbSize: std::mem::size_of::<GUITHREADINFO>() as u32, ..Default::default() };
    if GetGUIThreadInfo(thread, &mut info).is_err()
        || info.flags.0 & (GUI_INMENUMODE | GUI_POPUPMENUMODE).0 == 0 { return false; }
    let owner = GetAncestor(info.hwndMenuOwner, GA_ROOT);
    let mut owner_pid = 0;
    GetWindowThreadProcessId(owner, Some(&mut owner_pid));
    owner_pid == pid && !GetPropW(owner, SHELL_MENU_OWNER).0.is_null()
}

struct DesktopMenuForeground<'a> {
    window: TrayForeground<'a>,
    foreground_thread: u32,
    root_thread: u32,
}

fn trusted_desktop_menu_foreground(shell_pid: u32, desktop_thread: u32, candidate: &DesktopMenuForeground<'_>) -> bool {
    let window = &candidate.window;
    // Explorer reuses these classes for folder menus too. Only the real
    // desktop's GUI thread may extend the desktop interaction, never the whole
    // Explorer process or an arbitrary chain of owned windows.
    shell_pid != 0 && desktop_thread != 0 && window.foreground != 0 && window.root != 0
        && window.foreground_pid == shell_pid && window.root_pid == shell_pid
        && candidate.foreground_thread == desktop_thread && candidate.root_thread == desktop_thread
        && matches!(window.root_class, "XamlExplorerHostIslandWindow_WASDK"
            | "XamlExplorerHostIslandWindow" | "Microsoft.UI.Content.PopupWindowSiteBridge" | "#32768")
}

unsafe fn desktop_menu_for_host(foreground: HWND, host: HWND) -> bool {
    if !IsWindow(Some(foreground)).as_bool() || !IsWindow(Some(host)).as_bool() { return false; }
    let shell = GetShellWindow();
    if !IsWindow(Some(shell)).as_bool() { return false; }
    let mut shell_pid = 0;
    GetWindowThreadProcessId(shell, Some(&mut shell_pid));
    let mut host_pid = 0;
    let desktop_thread = GetWindowThreadProcessId(host, Some(&mut host_pid));
    if shell_pid == 0 || host_pid != shell_pid || desktop_thread == 0 { return false; }
    desktop_menu_for_thread(foreground, shell_pid, desktop_thread)
}

unsafe fn desktop_menu_for_thread(foreground: HWND, shell_pid: u32, desktop_thread: u32) -> bool {
    if !IsWindow(Some(foreground)).as_bool() { return false; }
    let root = GetAncestor(foreground, GA_ROOT);
    if !IsWindow(Some(root)).as_bool() { return false; }
    let mut foreground_pid = 0;
    let mut root_pid = 0;
    let foreground_thread = GetWindowThreadProcessId(foreground, Some(&mut foreground_pid));
    let root_thread = GetWindowThreadProcessId(root, Some(&mut root_pid));
    let mut class = [0u16; 128];
    let length = GetClassNameW(root, &mut class) as usize;
    let root_class = String::from_utf16_lossy(&class[..length]);
    trusted_desktop_menu_foreground(shell_pid, desktop_thread, &DesktopMenuForeground {
        window: TrayForeground { foreground: foreground.0 as isize, foreground_pid,
            root: root.0 as isize, root_pid, root_class: &root_class },
        foreground_thread, root_thread,
    })
}

unsafe fn reconcile_desktop_event(hwnd: HWND, foreground_event: bool) {
    let marker = ensure_desktop_tracking();
    let host = desktop_host().filter(|host| IsWindowVisible(*host).as_bool());
    let order = window_order().unwrap_or_default();
    let foreground = GetForegroundWindow();
    let desktop_foreground = foreground == hwnd || IsChild(hwnd, foreground).as_bool()
        || host.is_some_and(|host| foreground == host || IsChild(host, foreground).as_bool())
        || shell_tray_has_foreground(foreground) || helper_menu_has_foreground(foreground)
        || host.is_some_and(|host| desktop_menu_for_host(foreground, host));
    let stay = STAY_ON_DESKTOP.load(Ordering::SeqCst);
    let cloaked = shell_cloaked(hwnd);
    apply_desktop_order(hwnd, host, marker, &order, stay, desktop_foreground, cloaked);
    update_transition_probe(hwnd, foreground_event, stay && desktop_foreground && !cloaked);
}

unsafe fn update_transition_probe(hwnd: HWND, foreground_event: bool, eligible: bool) {
    let change = TRANSITION_PROBE.with(|probe| probe.borrow_mut()
        .update(Instant::now(), foreground_event, eligible));
    match change {
        ProbeTimerChange::Start => {
            if SetTimer(Some(hwnd), TRANSITION_TIMER_ID, 16, None) == 0 {
                TRANSITION_PROBE.with(|probe| probe.borrow_mut().until = None);
            }
        }
        ProbeTimerChange::Stop => { let _ = KillTimer(Some(hwnd), TRANSITION_TIMER_ID); }
        ProbeTimerChange::Unchanged => {}
    }
}

unsafe fn stop_transition_probe(hwnd: HWND) {
    TRANSITION_PROBE.with(|probe| probe.borrow_mut().until = None);
    let _ = KillTimer(Some(hwnd), TRANSITION_TIMER_ID);
}

unsafe fn apply_desktop_order(hwnd: HWND, host: Option<HWND>, marker: Option<HWND>,
    order: &[OrderedWindow], stay: bool, desktop_foreground: bool, cloaked: bool) {
    let host_value = host.map(|hwnd| hwnd.0 as isize);
    let marker_value = marker.map(|hwnd| hwnd.0 as isize);
    let mode = desktop_order_mode(order, hwnd.0 as isize, host_value, marker_value);
    let promote = temporary_topmost_allowed(&mode, stay, desktop_foreground, cloaked);
    if promote {
        set_temporary_topmost(hwnd, order);
    } else {
        // An ordinary app can regain foreground before Explorer lowers its
        // host. Do not follow that raised host over the newly opened app.
        let anchor = match mode {
            DesktopOrderMode::Normal => host,
            DesktopOrderMode::Raised | DesktopOrderMode::Unknown => marker,
        };
        anchor_in_normal_band(hwnd, anchor);
    }
}

/// Must be called through WebviewWindow::run_on_main_thread, including rebuilds.
pub fn pin_desktop_layer(value: isize) {
    let hwnd = HWND(value as _);
    unsafe {
        if hwnd.0.is_null() || GetWindowThreadProcessId(hwnd, None) != GetCurrentThreadId() { return; }
        if LAYER_HWND.load(Ordering::SeqCst) == value && ORIGINAL_PROC.load(Ordering::SeqCst) != 0 {
            reconcile_desktop_order(hwnd);
            return;
        }
        LAYER_HWND.store(value, Ordering::SeqCst);
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let style = (style | WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0)
            & !(WS_EX_APPWINDOW.0 | WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0);
        #[cfg(feature = "ui-test")]
        let style = (style | WS_EX_APPWINDOW.0) & !WS_EX_TOOLWINDOW.0;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style as isize);
        #[allow(function_casts_as_integer)]
        let previous = SetWindowLongPtrW(hwnd, GWL_WNDPROC, layer_window_proc as usize as isize);
        ORIGINAL_PROC.store(previous, Ordering::SeqCst);
        let style = frameless_style(GetWindowLongPtrW(hwnd, GWL_STYLE) as u32);
        SetWindowLongPtrW(hwnd, GWL_STYLE, style as isize);
        let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER);
        let _ = exclude_from_peek(hwnd);
        apply_surface_region(hwnd);
        SetTimer(Some(hwnd), RESTORE_TIMER_ID, 250, None);
        reconcile_desktop_order(hwnd);
        // WebView must be created visible for OLE registration. A recreated
        // layer then resumes the existing pause state without resetting it.
        if !STAY_ON_DESKTOP.load(Ordering::SeqCst) { let _ = ShowWindow(hwnd, SW_HIDE); }
    }
}

pub fn set_stay_on_desktop(stay: bool) {
    STAY_ON_DESKTOP.store(stay, Ordering::SeqCst);
    post_input_request(RECONCILE_DESKTOP);
}
pub fn reassert_bottom() { post_input_request(RECONCILE_DESKTOP); }
pub fn layer_destroyed() -> bool {
    layer_needs_recovery(LAYER_HWND.load(Ordering::SeqCst))
}
fn layer_needs_recovery(value: isize) -> bool { !unsafe { IsWindow(Some(HWND(value as _))).as_bool() } }
pub fn reset_layer_handle() {
    PENDING_DESKTOP_EVENTS.take();
    LAYER_HWND.store(0, Ordering::SeqCst);
    ORIGINAL_PROC.store(0, Ordering::SeqCst);
    INPUT_GRANTED.store(false, Ordering::SeqCst);
    PREV_FOREGROUND.store(0, Ordering::SeqCst);
    ATTACHED_THREAD.store(0, Ordering::SeqCst);
    if let Ok(mut rects) = HIT_RECTS.write() { rects.clear(); }
}

pub fn release_keyboard_focus() {
    post_input_request(RELEASE_INPUT);
}

fn post_input_request(message: u32) {
    if message == RECONCILE_DESKTOP { queue_desktop_event(RECHECK_ORDER); return; }
    let hwnd = HWND(LAYER_HWND.load(Ordering::SeqCst) as _);
    if !hwnd.0.is_null() {
        unsafe { let _ = PostMessageW(Some(hwnd), message, WPARAM(0), LPARAM(0)); }
    }
}

// AttachThreadInput and SetFocus must use the thread that OWNS the WebView.
// IPC/pause callbacks may run on other threads; keep the whole session here.
pub(crate) fn grant_keyboard_focus_on_window_thread() -> bool {
    let value = LAYER_HWND.load(Ordering::SeqCst);
    if value == 0 {
        return false;
    }
    let layer = HWND(value as _);
    unsafe {
        if !IsWindow(Some(layer)).as_bool() || !IsWindowVisible(layer).as_bool()
            || !STAY_ON_DESKTOP.load(Ordering::SeqCst) {
            return false;
        }

        let foreground = GetForegroundWindow();
        let target = FindWindowExW(Some(layer), None, w!("WRY_WEBVIEW"), None)
            .unwrap_or_else(|_| GetWindow(layer, GW_CHILD).unwrap_or(layer));
        let focused = GetFocus();
        if INPUT_GRANTED.load(Ordering::SeqCst)
            && (foreground == layer || foreground.0 as isize == PREV_FOREGROUND.load(Ordering::SeqCst))
            && (focused == target || IsChild(target, focused).as_bool()) {
            return true;
        }
        if !foreground.0.is_null() && foreground != layer {
            PREV_FOREGROUND.store(foreground.0 as isize, Ordering::SeqCst);
        }

        // 先归还旧的挂接（连续 focusin 时前台线程可能已变）。
        let old_thread = ATTACHED_THREAD.swap(0, Ordering::SeqCst);
        if old_thread != 0 {
            let own = GetCurrentThreadId();
            let _ = AttachThreadInput(own, old_thread as u32, false);
        }

        let foreground_thread = if foreground.0.is_null() {
            0
        } else {
            GetWindowThreadProcessId(foreground, None)
        };
        let own_thread = GetCurrentThreadId();

        // 挂接保持到 release_keyboard_focus：合并队列一拆，借来的焦点状态
        // 可能随队列拆分失效，所以整个"输入会话"期间都保持挂接。
        if foreground_thread != 0 && foreground_thread != own_thread {
            if AttachThreadInput(own_thread, foreground_thread, true).as_bool() {
                ATTACHED_THREAD.store(foreground_thread as isize, Ordering::SeqCst);
            } else {
                // Local GetFocus can succeed without owning foreground input.
                // Do not report a usable keyboard session if attaching failed.
                INPUT_GRANTED.store(false, Ordering::SeqCst);
                PREV_FOREGROUND.store(0, Ordering::SeqCst);
                return false;
            }
        }

        // 焦点要给到 wry 的 WebView 宿主子窗口：它的窗口过程收到 WM_SETFOCUS
        // 后会调 MoveFocus 把键盘焦点推进页面。外层 Tauri 窗口没有这一步。
        let _ = SetFocus(Some(target));
        INPUT_GRANTED.store(true, Ordering::SeqCst);
        let focused = GetFocus();
        let granted = focused == target || IsChild(target, focused).as_bool();
        if !granted { release_keyboard_focus_on_window_thread(); }
        granted
    }
}

/// 归还借来的键盘焦点。只有当"看上去的前台窗口"仍是抢焦时那个窗口时才恢复
/// （用户若已点击别的应用，前台已切换，无需归还）。无论如何都断开输入挂接。
pub(crate) fn release_keyboard_focus_on_window_thread() {
    if !INPUT_GRANTED.swap(false, Ordering::SeqCst) {
        return;
    }
    unsafe {
        let previous = HWND(PREV_FOREGROUND.swap(0, Ordering::SeqCst) as _);
        let foreground = GetForegroundWindow();
        if !previous.0.is_null()
            && foreground == previous
            && IsWindow(Some(previous)).as_bool()
        {
            let _ = SetFocus(Some(previous));
            // It is already foreground. Activating it again triggers needless
            // nonclient painting when returning borrowed WebView keyboard focus.
        }
    }

    let attached_thread = ATTACHED_THREAD.swap(0, Ordering::SeqCst);
    if attached_thread != 0 {
        unsafe {
            let _ = AttachThreadInput(
                GetCurrentThreadId(),
                attached_thread as u32,
                false,
            );
        }
    }
}

fn exclude_from_peek(hwnd: HWND) -> windows::core::Result<()> {
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_EXCLUDED_FROM_PEEK};
    let enabled = BOOL(1);
    unsafe { DwmSetWindowAttribute(hwnd, DWMWA_EXCLUDED_FROM_PEEK,
        &enabled as *const BOOL as *const _, std::mem::size_of::<BOOL>() as u32) }
}

fn shell_cloaked(hwnd: HWND) -> bool {
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED,
        DWM_CLOAKED_SHELL, DWM_CLOAKED_INHERITED};
    let mut cloak = 0u32;
    let result = unsafe { DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED,
        &mut cloak as *mut u32 as *mut _, std::mem::size_of::<u32>() as u32) };
    // Cloaking belongs to Shell/virtual desktops. Never forcibly uncloak the
    // layer, or promote it when we cannot verify its current desktop membership.
    result.is_err() || cloak & (DWM_CLOAKED_SHELL | DWM_CLOAKED_INHERITED) != 0
}

fn frameless_style(style: u32) -> u32 {
    (style | WS_POPUP.0) & !(WS_CAPTION.0 | WS_THICKFRAME.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0)
}

unsafe extern "system" fn layer_window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, mut lparam: LPARAM) -> LRESULT {
    match msg {
        WM_NCCALCSIZE | WM_NCPAINT => return LRESULT(0),
        // Tao still receives activation changes, but DefWindowProc must never
        // paint a Windows caption over the shaped, frameless desktop WebView.
        WM_NCACTIVATE => lparam = LPARAM(-1),
        REGION_CHANGED => { apply_surface_region(hwnd); return LRESULT(0); }
        CALIBRATE_BOUNDS => {
            if calibrate_window_bounds(hwnd, virtual_desktop_bounds()) {
                apply_surface_region(hwnd);
            }
            return LRESULT(0);
        }
        RELEASE_INPUT => { release_keyboard_focus_on_window_thread(); return LRESULT(0); }
        RECONCILE_DESKTOP => {
            // Clear before coordinating, so a concurrent later event can post
            // one follow-up. Stable positioning is a no-op, ending feedback.
            let reasons = PENDING_DESKTOP_EVENTS.take();
            reconcile_desktop_event(hwnd, reasons & FOREGROUND_CHANGED != 0);
            return LRESULT(0);
        }
        WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
        WM_TIMER if wparam.0 == TRANSITION_TIMER_ID => {
            if TRANSITION_PROBE.with(|probe| probe.borrow().until.is_some()) {
                reconcile_desktop_order(hwnd);
            }
            return LRESULT(0);
        }
        WM_TIMER if wparam.0 == RESTORE_TIMER_ID => {
            if INPUT_GRANTED.load(Ordering::SeqCst) {
                let foreground = GetForegroundWindow();
                let previous = HWND(PREV_FOREGROUND.load(Ordering::SeqCst) as _);
                if foreground != previous && foreground != hwnd {
                    release_keyboard_focus_on_window_thread();
                }
            }
            if STAY_ON_DESKTOP.load(Ordering::SeqCst) {
                if IsIconic(hwnd).as_bool() || !IsWindowVisible(hwnd).as_bool() {
                    let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                }

            }
            reconcile_desktop_order(hwnd);
            return LRESULT(0);
        }
        WM_SYSCOMMAND if STAY_ON_DESKTOP.load(Ordering::SeqCst)
            && wparam.0 & 0xFFF0 == SC_MINIMIZE as usize => return LRESULT(0),
        WM_WINDOWPOSCHANGING if STAY_ON_DESKTOP.load(Ordering::SeqCst) => {
            let pos = lparam.0 as *mut WINDOWPOS;
            if let Some(pos) = pos.as_mut() {
                pos.flags &= !SWP_HIDEWINDOW;
                if pos.flags.0 & SWP_NOZORDER.0 == 0 {
                    pos.flags |= SWP_NOZORDER;
                    queue_desktop_event(RECHECK_ORDER);
                }
            }
        }
        WM_NCDESTROY => {
            release_keyboard_focus_on_window_thread();
            let _ = KillTimer(Some(hwnd), RESTORE_TIMER_ID);
            stop_transition_probe(hwnd);
            DESKTOP_TRACKING.with(|tracking| { tracking.borrow_mut().take(); });
            PENDING_DESKTOP_EVENTS.take();
        }
        _ => {}
    }
    let previous = ORIGINAL_PROC.load(Ordering::SeqCst);
    let result = if previous != 0 {
        let proc: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT = std::mem::transmute(previous);
        CallWindowProcW(Some(proc), hwnd, msg, wparam, lparam)
    } else { DefWindowProcW(hwnd, msg, wparam, lparam) };
    if msg == WM_DPICHANGED || msg == WM_DISPLAYCHANGE {
        // Let Tao/WebView update their scale first; then override the suggested
        // per-monitor rectangle with the full virtual desktop on the next turn.
        let _ = PostMessageW(Some(hwnd), CALIBRATE_BOUNDS, WPARAM(0), LPARAM(0));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Graphics::Gdi::PtInRegion;

    fn order(values: &[isize]) -> Vec<OrderedWindow> {
        values.iter().map(|value| OrderedWindow { value: *value, topmost: false }).collect()
    }

    #[test]
    fn tray_foreground_requires_current_shell_pid_and_an_exact_allowed_root_class() {
        for root_class in ["Shell_TrayWnd", "Shell_SecondaryTrayWnd",
            "TopLevelWindowForOverflowXamlIsland", "NotifyIconOverflowWindow"] {
            for foreground in [10, 11] { // top-level itself or a parent-chain child
                let valid = TrayForeground { foreground, foreground_pid: 42, root: 10,
                    root_pid: 42, root_class };
                assert!(trusted_tray_foreground(42, &valid));
                assert!(!trusted_tray_foreground(0, &valid));
                assert!(!trusted_tray_foreground(43, &valid)); // replaced Explorer
                assert!(!trusted_tray_foreground(42, &TrayForeground { foreground: 0, ..valid }));
                assert!(!trusted_tray_foreground(42, &TrayForeground { root: 0, ..valid }));
                for wrong_pid in [0, 43] {
                    assert!(!trusted_tray_foreground(42, &TrayForeground { foreground_pid: wrong_pid, ..valid }));
                    assert!(!trusted_tray_foreground(42, &TrayForeground { root_pid: wrong_pid, ..valid }));
                }
            }
        }
        for root_class in ["CabinetWClass", "ExploreWClass", "#32770", "Chrome_WidgetWin_1", "",
            "Shell_TrayWndFake", "shell_traywnd"] {
            assert!(!trusted_tray_foreground(42, &TrayForeground { foreground: 10,
                foreground_pid: 42, root: 10, root_pid: 42, root_class }));
        }
    }

    #[test]
    fn tray_exception_does_not_bypass_show_desktop_pause_cloak_or_unknown_guards() {
        let tray = trusted_tray_foreground(42, &TrayForeground { foreground: 10,
            foreground_pid: 42, root: 10, root_pid: 42, root_class: "NotifyIconOverflowWindow" });
        assert!(temporary_topmost_allowed(&DesktopOrderMode::Raised, true, tray, false));
        assert!(!temporary_topmost_allowed(&DesktopOrderMode::Normal, true, tray, false));
        assert!(!temporary_topmost_allowed(&DesktopOrderMode::Unknown, true, tray, false));
        assert!(!temporary_topmost_allowed(&DesktopOrderMode::Raised, false, tray, false));
        assert!(!temporary_topmost_allowed(&DesktopOrderMode::Raised, true, tray, true));
    }

    #[test]
    fn desktop_menu_requires_real_shell_and_desktop_thread_for_root_and_child() {
        for class in ["XamlExplorerHostIslandWindow_WASDK", "XamlExplorerHostIslandWindow",
            "Microsoft.UI.Content.PopupWindowSiteBridge", "#32768"] {
            for (shell, desktop, foreground_pid, root_pid, foreground_thread, root_thread, expected) in [
                (42, 77, 42, 42, 77, 77, true),
                (0, 77, 42, 42, 77, 77, false), (42, 0, 42, 42, 77, 77, false),
                (43, 77, 42, 42, 77, 77, false), // replaced Shell
                (42, 77, 43, 42, 77, 77, false), (42, 77, 42, 43, 77, 77, false),
                (42, 77, 42, 42, 78, 77, false), (42, 77, 42, 42, 77, 78, false),
                (42, 77, 42, 42, 78, 78, false), // Explorer folder menu, same process
                (42, 77, 42, 42, 0, 77, false), (42, 77, 42, 42, 77, 0, false),
            ] {
                let candidate = DesktopMenuForeground { window: TrayForeground {
                    foreground: 10, foreground_pid, root: 11, root_pid, root_class: class,
                }, foreground_thread, root_thread };
                assert_eq!(trusted_desktop_menu_foreground(shell, desktop, &candidate), expected);
            }
        }
        for class in ["CabinetWClass", "Chrome_WidgetWin_1", "#32770", "", "XamlExplorerHostIslandWindow_fake"] {
            assert!(!trusted_desktop_menu_foreground(42, 77, &DesktopMenuForeground {
                window: TrayForeground { foreground: 10, foreground_pid: 42, root: 11, root_pid: 42, root_class: class },
                foreground_thread: 77, root_thread: 77,
            }));
        }
        for (foreground, root) in [(0, 11), (10, 0)] {
            assert!(!trusted_desktop_menu_foreground(42, 77, &DesktopMenuForeground {
                window: TrayForeground { foreground, foreground_pid: 42, root, root_pid: 42, root_class: "#32768" },
                foreground_thread: 77, root_thread: 77,
            }));
        }
    }

    #[test]
    fn desktop_menu_cannot_bypass_pause_cloak_or_missing_desktop_order() {
        let menu = trusted_desktop_menu_foreground(42, 77, &DesktopMenuForeground {
            window: TrayForeground { foreground: 10, foreground_pid: 42, root: 11, root_pid: 42,
                root_class: "XamlExplorerHostIslandWindow_WASDK" }, foreground_thread: 77, root_thread: 77,
        });
        assert!(temporary_topmost_allowed(&DesktopOrderMode::Raised, true, menu, false));
        assert!(!temporary_topmost_allowed(&DesktopOrderMode::Normal, true, menu, false));
        assert!(!temporary_topmost_allowed(&DesktopOrderMode::Unknown, true, menu, false));
        assert!(!temporary_topmost_allowed(&DesktopOrderMode::Raised, false, menu, false));
        assert!(!temporary_topmost_allowed(&DesktopOrderMode::Raised, true, menu, true));
    }

    #[test]
    fn reorder_filter_accepts_only_top_level_desktop_container_events() {
        let desktop = HWND(100usize as _);
        for object in [OBJID_CLIENT.0, OBJID_WINDOW.0] {
            assert!(desktop_reorder_event(EVENT_OBJECT_REORDER, desktop, desktop, object, 0));
        }
        for (event, hwnd, object, child) in [
            (EVENT_OBJECT_REORDER, HWND(101usize as _), OBJID_CLIENT.0, 0),
            (EVENT_OBJECT_REORDER, desktop, OBJID_CLIENT.0, 1),
            (EVENT_OBJECT_REORDER, desktop, OBJID_CURSOR.0, 0),
            (EVENT_OBJECT_LOCATIONCHANGE, desktop, OBJID_CLIENT.0, 0),
        ] {
            assert!(!desktop_reorder_event(event, hwnd, desktop, object, child));
        }
        assert!(!desktop_reorder_event(EVENT_OBJECT_REORDER, HWND::default(), HWND::default(), 0, 0));
    }

    #[test]
    fn desktop_events_coalesce_without_losing_foreground_or_later_reorders() {
        let events = DesktopEvents(AtomicU8::new(0));
        assert!(events.enqueue(RECHECK_ORDER));
        for _ in 0..100 { assert!(!events.enqueue(RECHECK_ORDER)); }
        assert!(!events.enqueue(FOREGROUND_CHANGED));
        assert_eq!(events.take(), RECHECK_ORDER | FOREGROUND_CHANGED);
        // A later reorder must schedule again even with no foreground change.
        assert!(events.enqueue(RECHECK_ORDER));
        assert_eq!(events.take(), RECHECK_ORDER);
        assert_eq!(events.take(), 0);
    }

    #[test]
    fn transition_probe_is_bounded_and_reorders_do_not_extend_it() {
        let now = Instant::now();
        let mut probe = TransitionProbe::default();
        assert_eq!(probe.update(now, false, true), ProbeTimerChange::Unchanged);
        assert!(probe.until.is_none());
        assert_eq!(probe.update(now, true, true), ProbeTimerChange::Start);
        let until = probe.until;
        for ms in [16, 32, 64, 128, 250, 299] {
            assert_eq!(probe.update(now + Duration::from_millis(ms), false, true), ProbeTimerChange::Unchanged);
            assert_eq!(probe.until, until);
        }
        assert_eq!(probe.update(now + Duration::from_millis(300), false, true), ProbeTimerChange::Stop);
        assert_eq!(probe.update(now + Duration::from_millis(400), false, true), ProbeTimerChange::Unchanged);
        assert!(probe.until.is_none());
    }

    #[test]
    fn transition_probe_cancels_for_apps_pause_or_cloak() {
        let now = Instant::now();
        for (stay, desktop_foreground, cloaked) in [(true, false, false), (false, true, false), (true, true, true)] {
            let mut probe = TransitionProbe::default();
            assert_eq!(probe.update(now, true, true), ProbeTimerChange::Start);
            assert_eq!(probe.update(now, true, stay && desktop_foreground && !cloaked), ProbeTimerChange::Stop);
            assert!(probe.until.is_none());
        }
    }

    #[test]
    fn reorder_alone_observes_a_late_host_raise_without_starting_a_probe() {
        let events = DesktopEvents(AtomicU8::new(0));
        let mut probe = TransitionProbe::default();
        let now = Instant::now();
        let normal = order(&[10, 20, 40, 30]);
        let raised = order(&[30, 10, 40, 20]);
        for (snapshot, allowed) in [(&normal, false), (&raised, true), (&normal, false)] {
            assert!(events.enqueue(RECHECK_ORDER));
            let foreground_event = events.take() & FOREGROUND_CHANGED != 0;
            let mode = desktop_order_mode(snapshot, 40, Some(30), Some(20));
            assert_eq!(temporary_topmost_allowed(&mode, true, true, false), allowed);
            assert_eq!(probe.update(now, foreground_event, true), ProbeTimerChange::Unchanged);
            assert!(probe.until.is_none());
        }
    }

    #[test]
    fn show_desktop_requires_raised_host_and_desktop_foreground() {
        let normal = desktop_order_mode(&order(&[10, 20, 40, 30]), 40, Some(30), Some(20));
        let raised = desktop_order_mode(&order(&[30, 10, 40, 20]), 40, Some(30), Some(20));
        assert_eq!(normal, DesktopOrderMode::Normal);
        assert_eq!(raised, DesktopOrderMode::Raised);
        // Clicking the desktop normally must not turn the layer into an overlay.
        assert!(!temporary_topmost_allowed(&normal, true, true, false));
        assert!(temporary_topmost_allowed(&raised, true, true, false));
        // Returning to any app (including our manager), pause and another
        // virtual desktop revoke elevation even while Explorer remains raised.
        assert!(!temporary_topmost_allowed(&raised, true, false, false));
        assert!(!temporary_topmost_allowed(&raised, false, true, false));
        assert!(!temporary_topmost_allowed(&raised, true, true, true));
    }

    #[test]
    fn incomplete_desktop_order_fails_closed() {
        for (snapshot, host, marker) in [
            (order(&[]), Some(30), Some(20)),
            (order(&[30]), Some(30), Some(20)),
            (order(&[20]), Some(30), Some(20)),
            (order(&[30, 20]), Some(30), Some(20)), // missing layer
            (order(&[30, 40, 20]), None, Some(20)),
            (order(&[30, 40, 20]), Some(30), None),
            (order(&[30, 40, 20]), Some(0), Some(20)),
            (order(&[30, 40, 20]), Some(30), Some(0)),
        ] {
            let mode = desktop_order_mode(&snapshot, 40, host, marker);
            assert_eq!(mode, DesktopOrderMode::Unknown);
            assert!(!temporary_topmost_allowed(&mode, true, true, false));
        }
    }

    struct PrivateWindow(HWND);
    impl Drop for PrivateWindow {
        fn drop(&mut self) { unsafe { let _ = DestroyWindow(self.0); } }
    }

    unsafe fn private_window() -> PrivateWindow {
        PrivateWindow(CreateWindowExW(WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW, w!("STATIC"), w!(""),
            WS_POPUP, 0, 0, 320, 200, None, None, None, None).unwrap())
    }

    #[test]
    fn unbound_and_destroyed_layers_require_recovery_while_live_windows_do_not() {
        unsafe {
            assert!(layer_needs_recovery(0));
            let window = private_window();
            let value = window.0.0 as isize;
            assert!(!layer_needs_recovery(value));
            drop(window);
            assert!(layer_needs_recovery(value));
        }
    }

    #[test]
    fn shell_menu_process_registration_cleans_up_duplicates_and_error_returns() {
        let pid = 0x7FFF_FF01;
        let first = track_shell_menu_process(pid);
        let second = track_shell_menu_process(pid);
        assert_eq!(SHELL_MENU_PROCESSES.read().unwrap().iter().filter(|item| **item == pid).count(), 2);
        drop(first);
        assert!(SHELL_MENU_PROCESSES.read().unwrap().contains(&pid));
        drop(second);
        assert!(!SHELL_MENU_PROCESSES.read().unwrap().contains(&pid));
        let fails = || -> Result<(), ()> { let _guard = track_shell_menu_process(pid); Err(()) };
        assert!(fails().is_err());
        assert!(!SHELL_MENU_PROCESSES.read().unwrap().contains(&pid));
    }

    #[test]
    fn helper_menu_requires_both_a_live_request_and_a_marked_root() {
        unsafe {
            let owner = private_window();
            let normal = private_window();
            let child = PrivateWindow(CreateWindowExW(WS_EX_NOACTIVATE, w!("STATIC"), w!(""),
                WS_CHILD, 0, 0, 10, 10, Some(owner.0), None, None, None).unwrap());
            SetPropW(owner.0, SHELL_MENU_OWNER, Some(windows::Win32::Foundation::HANDLE(1usize as _))).unwrap();
            let mut pid = 0;
            GetWindowThreadProcessId(owner.0, Some(&mut pid));
            assert!(!helper_menu_has_foreground(owner.0));
            let guard = track_shell_menu_process(pid);
            assert!(helper_menu_has_foreground(owner.0));
            assert!(helper_menu_has_foreground(child.0));
            assert!(!helper_menu_has_foreground(normal.0));
            assert!(!helper_menu_has_foreground(HWND::default()));
            // Request completion, timeout or crash revokes the exception even
            // if a window carrying the old property has not been destroyed yet.
            drop(guard);
            assert!(!helper_menu_has_foreground(owner.0));
            assert!(!helper_menu_has_foreground(child.0));
        }
    }

    unsafe extern "system" fn private_shell_window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    unsafe fn private_shell_window(tray: bool, owner: Option<HWND>) -> PrivateWindow {
        static CLASSES: OnceLock<[u16; 2]> = OnceLock::new();
        let names = [w!("TopLevelWindowForOverflowXamlIsland"), w!("CabinetWClass")];
        let instance = GetModuleHandleW(None).unwrap();
        let classes = CLASSES.get_or_init(|| names.map(|name| RegisterClassW(&WNDCLASSW {
            lpfnWndProc: Some(private_shell_window_proc), hInstance: instance.into(),
            lpszClassName: name, ..Default::default()
        })));
        assert!(classes.iter().all(|class| *class != 0));
        // Window classes are registered in this test process. These windows are
        // invisible fixtures; neither real Explorer nor the taskbar is changed.
        PrivateWindow(CreateWindowExW(WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
            names[usize::from(!tray)], w!(""), WS_POPUP, 0, 0, 80, 80,
            owner, None, Some(instance.into()), None).unwrap())
    }

    unsafe fn private_desktop_menu() -> PrivateWindow {
        static CLASS: OnceLock<u16> = OnceLock::new();
        let instance = GetModuleHandleW(None).unwrap();
        assert_ne!(*CLASS.get_or_init(|| RegisterClassW(&WNDCLASSW {
            lpfnWndProc: Some(private_shell_window_proc), hInstance: instance.into(),
            lpszClassName: w!("XamlExplorerHostIslandWindow_WASDK"), ..Default::default()
        })), 0);
        PrivateWindow(CreateWindowExW(WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
            w!("XamlExplorerHostIslandWindow_WASDK"), w!(""), WS_POPUP,
            0, 0, 80, 80, None, None, Some(instance.into()), None).unwrap())
    }

    #[test]
    fn private_desktop_menu_keeps_layer_below_menu_and_rejects_same_pid_folder_thread() {
        unsafe {
            let menu = private_desktop_menu();
            let folder = private_shell_window(false, Some(menu.0));
            let child = PrivateWindow(CreateWindowExW(WS_EX_NOACTIVATE, w!("STATIC"), w!(""),
                WS_CHILD, 0, 0, 10, 10, Some(menu.0), None, None, None).unwrap());
            let mut pid = 0;
            let desktop_thread = GetWindowThreadProcessId(menu.0, Some(&mut pid));
            assert!(desktop_menu_for_thread(menu.0, pid, desktop_thread));
            assert!(desktop_menu_for_thread(child.0, pid, desktop_thread));
            // A normal dialog's owner being the menu does not make it a menu.
            assert_eq!(GetAncestor(folder.0, GA_ROOTOWNER), menu.0);
            assert!(!desktop_menu_for_thread(folder.0, pid, desktop_thread));
            assert!(!desktop_menu_for_thread(HWND::default(), pid, desktop_thread));

            let (ready_tx, ready_rx) = std::sync::mpsc::channel();
            let (done_tx, done_rx) = std::sync::mpsc::channel();
            let other_thread = std::thread::spawn(move || {
                let other_menu = private_desktop_menu();
                ready_tx.send(other_menu.0.0 as usize).unwrap();
                let _ = done_rx.recv_timeout(Duration::from_secs(10));
                drop(other_menu);
            });
            let other_menu = HWND(ready_rx.recv_timeout(Duration::from_secs(5)).unwrap() as _);
            // Same class and process, but another GUI thread (like folder menus).
            let accepted_other = desktop_menu_for_thread(other_menu, pid, desktop_thread);
            done_tx.send(()).unwrap();
            other_thread.join().unwrap();
            assert!(!accepted_other);

            let layer = private_window();
            let host = private_window();
            let marker = PrivateWindow(create_desktop_marker().unwrap());
            position_without_activation(menu.0, HWND_TOPMOST).unwrap();
            let raised = vec![OrderedWindow { value: menu.0.0 as isize, topmost: true },
                OrderedWindow { value: host.0.0 as isize, topmost: false },
                OrderedWindow { value: layer.0.0 as isize, topmost: false },
                OrderedWindow { value: marker.0.0 as isize, topmost: false }];
            let focus = GetFocus();
            apply_desktop_order(layer.0, Some(host.0), Some(marker.0), &raised, true,
                desktop_menu_for_thread(child.0, pid, desktop_thread), false);
            assert_ne!(GetWindowLongPtrW(layer.0, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0, 0);
            assert_eq!(GetWindow(layer.0, GW_HWNDPREV).unwrap_or_default(), menu.0);
            apply_desktop_order(layer.0, Some(host.0), Some(marker.0), &raised, true,
                desktop_menu_for_thread(folder.0, pid, desktop_thread), false);
            assert_eq!(GetWindowLongPtrW(layer.0, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0, 0);
            assert_eq!(GetWindow(layer.0, GW_HWNDNEXT).unwrap_or_default(), marker.0);
            assert!(!IsWindowVisible(layer.0).as_bool());
            assert!(!IsWindowVisible(menu.0).as_bool());
            assert_eq!(GetFocus(), focus);
        }
    }

    #[test]
    fn private_tray_root_keeps_layer_below_overflow_but_same_pid_folder_demotes() {
        unsafe {
            let layer = private_window();
            let host = private_window();
            let marker = PrivateWindow(create_desktop_marker().unwrap());
            let tray = private_shell_window(true, None);
            let folder = private_shell_window(false, Some(tray.0));
            let child = PrivateWindow(CreateWindowExW(WS_EX_NOACTIVATE, w!("STATIC"), w!(""),
                WS_CHILD, 0, 0, 10, 10, Some(tray.0), None, None, None).unwrap());
            let mut test_shell_pid = 0;
            GetWindowThreadProcessId(tray.0, Some(&mut test_shell_pid));
            let mut folder_pid = 0;
            GetWindowThreadProcessId(folder.0, Some(&mut folder_pid));
            assert_eq!(folder_pid, test_shell_pid);
            assert_eq!(GetAncestor(child.0, GA_ROOT), tray.0);
            assert_eq!(GetAncestor(folder.0, GA_ROOTOWNER), tray.0);
            assert_eq!(GetAncestor(folder.0, GA_ROOT), folder.0);
            assert!(tray_foreground_for_shell_pid(tray.0, test_shell_pid));
            assert!(tray_foreground_for_shell_pid(child.0, test_shell_pid));
            assert!(!tray_foreground_for_shell_pid(folder.0, test_shell_pid));
            assert!(!tray_foreground_for_shell_pid(HWND::default(), test_shell_pid));
            assert!(!tray_foreground_for_shell_pid(tray.0, 0));
            let focus = GetFocus();
            let foreground = GetForegroundWindow();
            position_without_activation(tray.0, HWND_TOPMOST).unwrap();
            let raised = vec![OrderedWindow { value: tray.0.0 as isize, topmost: true },
                OrderedWindow { value: host.0.0 as isize, topmost: false },
                OrderedWindow { value: layer.0.0 as isize, topmost: false },
                OrderedWindow { value: marker.0.0 as isize, topmost: false }];
            apply_desktop_order(layer.0, Some(host.0), Some(marker.0), &raised, true,
                tray_foreground_for_shell_pid(child.0, test_shell_pid), false);
            assert_ne!(GetWindowLongPtrW(layer.0, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0, 0);
            assert_eq!(GetWindow(layer.0, GW_HWNDPREV).unwrap_or_default(), tray.0);
            apply_desktop_order(layer.0, Some(host.0), Some(marker.0), &raised, true,
                tray_foreground_for_shell_pid(folder.0, test_shell_pid), false);
            assert_eq!(GetWindowLongPtrW(layer.0, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0, 0);
            assert_eq!(GetWindow(layer.0, GW_HWNDNEXT).unwrap_or_default(), marker.0);
            assert!(!IsWindowVisible(layer.0).as_bool());
            assert!(!IsWindowVisible(tray.0).as_bool());
            assert!(!IsWindowVisible(folder.0).as_bool());
            assert_eq!(GetFocus(), focus);
            assert_eq!(GetForegroundWindow(), foreground);
        }
    }

    #[derive(Debug)]
    struct PositionObservation { after: HWND, next: HWND, topmost: bool }
    thread_local! {
        static POSITION_TRACE: RefCell<Option<(HWND, Vec<PositionObservation>)>> = const { RefCell::new(None) };
    }

    unsafe extern "system" fn trace_window_positions(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if msg == WM_WINDOWPOSCHANGED {
            POSITION_TRACE.with(|trace| {
                if let Some((target, changes)) = trace.borrow_mut().as_mut() {
                    if *target == hwnd {
                        let pos = &*(lparam.0 as *const WINDOWPOS);
                        changes.push(PositionObservation { after: pos.hwndInsertAfter,
                            next: GetWindow(hwnd, GW_HWNDNEXT).unwrap_or_default(),
                            topmost: GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0 });
                    }
                }
            });
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    #[test]
    fn demotion_has_one_native_position_change_and_steady_order_is_a_noop() {
        unsafe {
            let layer = private_window();
            let host = private_window();
            let marker = PrivateWindow(create_desktop_marker().unwrap());
            let blocker = private_window();
            anchor_in_normal_band(host.0, Some(marker.0));
            anchor_in_normal_band(blocker.0, Some(host.0));
            position_without_activation(layer.0, HWND_TOPMOST).unwrap();
            let original = SetWindowLongPtrW(layer.0, GWL_WNDPROC, trace_window_positions as *const () as isize);
            POSITION_TRACE.with(|trace| *trace.borrow_mut() = Some((layer.0, Vec::new())));
            let raised = order(&[host.0.0 as isize, blocker.0.0 as isize, layer.0.0 as isize, marker.0.0 as isize]);
            apply_desktop_order(layer.0, Some(host.0), Some(marker.0), &raised, true, false, false);
            // Repeated timer/reorder notifications must not cause any more
            // SetWindowPos calls, and thus cannot create a reorder feedback loop.
            for _ in 0..8 {
                apply_desktop_order(layer.0, Some(host.0), Some(marker.0), &raised, true, false, false);
            }
            let (_, changes) = POSITION_TRACE.with(|trace| trace.borrow_mut().take().unwrap());
            SetWindowLongPtrW(layer.0, GWL_WNDPROC, original);
            assert_eq!(changes.len(), 1, "{changes:?}");
            assert!(!changes[0].topmost);
            assert_eq!(changes[0].next, marker.0);
            assert_eq!(changes[0].after, host.0);
            assert_ne!(changes[0].after, HWND_NOTOPMOST);
            assert!(!IsWindowVisible(layer.0).as_bool());

            // Missing anchors also settle once, rather than repeatedly moving
            // an already bottom-most window on every event.
            position_without_activation(layer.0, HWND_TOPMOST).unwrap();
            SetWindowLongPtrW(layer.0, GWL_WNDPROC, trace_window_positions as *const () as isize);
            POSITION_TRACE.with(|trace| *trace.borrow_mut() = Some((layer.0, Vec::new())));
            for _ in 0..8 { anchor_in_normal_band(layer.0, None); }
            let (_, changes) = POSITION_TRACE.with(|trace| trace.borrow_mut().take().unwrap());
            SetWindowLongPtrW(layer.0, GWL_WNDPROC, original);
            assert_eq!(changes.len(), 1, "{changes:?}");
            assert_eq!(changes[0].after, HWND_BOTTOM);
            assert!(!changes[0].topmost);
        }
    }

    #[test]
    fn stopping_transition_clears_state_and_removes_the_private_window_timer() {
        unsafe {
            let window = private_window();
            update_transition_probe(window.0, true, true);
            assert!(TRANSITION_PROBE.with(|probe| probe.borrow().until.is_some()));
            stop_transition_probe(window.0);
            assert!(TRANSITION_PROBE.with(|probe| probe.borrow().until.is_none()));
            assert!(KillTimer(Some(window.0), TRANSITION_TIMER_ID).is_err());
        }
    }

    #[test]
    fn desktop_marker_is_invisible_independent_and_owned_by_tracking_lifetime() {
        unsafe {
            let focus = GetFocus();
            let foreground = GetForegroundWindow();
            let marker = create_desktop_marker().unwrap();
            let state = DesktopTracking { marker, foreground_hook: HWINEVENTHOOK::default(), reorder_hook: HWINEVENTHOOK::default() };
            assert!(IsWindow(Some(marker)).as_bool());
            assert!(!IsWindowVisible(marker).as_bool());
            assert!(GetWindow(marker, GW_OWNER).unwrap_or_default().0.is_null());
            assert_eq!(GetWindowThreadProcessId(marker, None), GetCurrentThreadId());
            let mut rect = RECT::default();
            GetWindowRect(marker, &mut rect).unwrap();
            assert_eq!(rect.right - rect.left, 0);
            assert_eq!(rect.bottom - rect.top, 0);
            assert_eq!(GetWindowLongPtrW(marker, GWL_STYLE) as u32 & WS_DISABLED.0, WS_DISABLED.0);
            let before = GetWindow(marker, GW_HWNDPREV).unwrap_or_default();
            // Ordinary attempts cannot disturb the bottom marker. Only our
            // explicit NOSENDCHANGING placement bypasses its procedure.
            SetWindowPos(marker, Some(HWND_TOPMOST), 0, 0, 0, 0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE).unwrap();
            assert_eq!(GetWindowLongPtrW(marker, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0, 0);
            assert_eq!(GetWindow(marker, GW_HWNDPREV).unwrap_or_default(), before);
            drop(state);
            assert!(!IsWindow(Some(marker)).as_bool());
            assert_eq!(GetFocus(), focus);
            assert_eq!(GetForegroundWindow(), foreground);
        }
    }

    #[test]
    fn tracking_recreates_dead_marker_and_releases_both_hooks() {
        unsafe {
            let marker = ensure_desktop_tracking().unwrap();
            let first_hook = DESKTOP_TRACKING.with(|state| state.borrow().as_ref().unwrap().foreground_hook);
            let first_reorder = DESKTOP_TRACKING.with(|state| state.borrow().as_ref().unwrap().reorder_hook);
            assert!(!first_hook.0.is_null());
            assert!(!first_reorder.0.is_null());
            DestroyWindow(marker).unwrap();
            let replacement = ensure_desktop_tracking().unwrap();
            assert!(IsWindow(Some(replacement)).as_bool());
            assert!(!UnhookWinEvent(first_hook).as_bool());
            assert!(!UnhookWinEvent(first_reorder).as_bool());
            let hook = DESKTOP_TRACKING.with(|state| state.borrow().as_ref().unwrap().foreground_hook);
            let reorder = DESKTOP_TRACKING.with(|state| state.borrow().as_ref().unwrap().reorder_hook);
            DESKTOP_TRACKING.with(|state| { state.borrow_mut().take(); });
            assert!(!IsWindow(Some(replacement)).as_bool());
            assert!(!UnhookWinEvent(hook).as_bool());
            assert!(!UnhookWinEvent(reorder).as_bool());
        }
    }

    #[test]
    fn temporary_elevation_preserves_native_surface_and_releases_for_apps_and_pause() {
        unsafe {
            let layer = private_window();
            let host = private_window();
            let marker = PrivateWindow(create_desktop_marker().unwrap());
            let overlay = private_window();
            position_without_activation(overlay.0, HWND_TOPMOST).unwrap();
            let hwnd = layer.0;
            let region = build_region(&[RECT { left: 10, top: 10, right: 100, bottom: 100 }]).unwrap();
            assert_ne!(SetWindowRgn(hwnd, Some(region), false), 0);
            exclude_from_peek(hwnd).unwrap(); // This DWM attribute is set-only.
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let focus = GetFocus();
            let foreground = GetForegroundWindow();
            let mut before = RECT::default();
            GetWindowRect(hwnd, &mut before).unwrap();
            let raised = vec![OrderedWindow { value: overlay.0.0 as isize, topmost: true },
                OrderedWindow { value: host.0.0 as isize, topmost: false },
                OrderedWindow { value: hwnd.0 as isize, topmost: false },
                OrderedWindow { value: marker.0.0 as isize, topmost: false }];
            apply_desktop_order(hwnd, Some(host.0), Some(marker.0), &raised, true, true, false);
            assert_ne!(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0, 0);
            assert_eq!(GetWindow(hwnd, GW_HWNDPREV).unwrap_or_default(), overlay.0);
            // A foreign foreground while host is still raised returns us to
            // the bottom marker, not next to the raised host.
            apply_desktop_order(hwnd, Some(host.0), Some(marker.0), &raised, true, false, false);
            assert_eq!(GetWindowLongPtrW(hwnd, GWL_EXSTYLE), ex_style);
            assert_eq!(GetWindow(hwnd, GW_HWNDNEXT).unwrap_or_default(), marker.0);
            apply_desktop_order(hwnd, Some(host.0), Some(marker.0), &raised, true, true, false);
            apply_desktop_order(hwnd, Some(host.0), Some(marker.0), &raised, false, true, false);
            assert_eq!(GetWindowLongPtrW(hwnd, GWL_EXSTYLE), ex_style);
            apply_desktop_order(hwnd, Some(host.0), Some(marker.0), &raised, true, true, false);
            // Failed/incomplete enumeration must demote and follow the marker.
            apply_desktop_order(hwnd, Some(host.0), Some(marker.0), &[], true, true, false);
            assert_eq!(GetWindowLongPtrW(hwnd, GWL_EXSTYLE), ex_style);
            assert_eq!(GetWindow(hwnd, GW_HWNDNEXT).unwrap_or_default(), marker.0);
            let normal = order(&[marker.0.0 as isize, hwnd.0 as isize, host.0.0 as isize]);
            apply_desktop_order(hwnd, Some(host.0), Some(marker.0), &normal, true, true, false);
            assert_eq!(GetWindow(hwnd, GW_HWNDNEXT).unwrap_or_default(), host.0);
            assert_eq!(GetWindowLongPtrW(hwnd, GWL_STYLE), style);
            assert_eq!(GetWindowLongPtrW(hwnd, GWL_EXSTYLE), ex_style);
            assert!(!IsWindowVisible(hwnd).as_bool());
            assert_eq!(GetFocus(), focus);
            assert_eq!(GetForegroundWindow(), foreground);
            let mut after = RECT::default();
            GetWindowRect(hwnd, &mut after).unwrap();
            assert_eq!(after, before);
            let current = CreateRectRgn(0, 0, 0, 0);
            assert_ne!(GetWindowRgn(hwnd, current).0, 0);
            assert!(PtInRegion(current, 20, 20).as_bool());
            assert!(!PtInRegion(current, 150, 20).as_bool());
            let _ = DeleteObject(current.into());
        }
    }

    #[test]
    fn recalibration_repairs_size_without_changing_styles_or_clipping() {
        unsafe {
            // A private invisible window: do not resize the real desktop layer.
            let hwnd = CreateWindowExW(WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW, w!("STATIC"), w!(""),
                WS_POPUP, 0, 0, 320, 200, None, None, None, None).unwrap();
            struct WindowGuard(HWND);
            impl Drop for WindowGuard { fn drop(&mut self) { unsafe { let _ = DestroyWindow(self.0); } } }
            let _window = WindowGuard(hwnd);
            let region = build_region(&[RECT { left: 10, top: 10, right: 100, bottom: 100 }]).unwrap();
            assert_ne!(SetWindowRgn(hwnd, Some(region), false), 0);
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            assert!(calibrate_window_bounds(hwnd, (-100, -50, 800, 600)));
            assert!(!calibrate_window_bounds(hwnd, (-100, -50, 800, 600)));
            assert_eq!(GetWindowLongPtrW(hwnd, GWL_STYLE), style);
            assert_eq!(GetWindowLongPtrW(hwnd, GWL_EXSTYLE), ex_style);
            assert!(!IsWindowVisible(hwnd).as_bool());
            let current = CreateRectRgn(0, 0, 0, 0);
            assert_ne!(GetWindowRgn(hwnd, current).0, 0);
            assert!(PtInRegion(current, 20, 20).as_bool());
            assert!(!PtInRegion(current, 150, 20).as_bool());
            let _ = DeleteObject(current.into());
        }
    }
    #[test]
    fn frameless_desktop_preserves_visibility_and_webview_clipping() {
        let style = frameless_style((WS_OVERLAPPEDWINDOW | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS).0);
        assert_eq!(style & (WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX).0, 0);
        assert_eq!(style & (WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS | WS_POPUP).0,
            (WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS | WS_POPUP).0);
        unsafe {
            // Both forms are sent by Windows: activation/frame recalculation
            // must never let the default procedure reserve a caption strip.
            for parameter in [0, 1] {
                assert_eq!(layer_window_proc(HWND::default(), WM_NCCALCSIZE, WPARAM(parameter), LPARAM(0)).0, 0);
            }
        }
    }
    #[test]
    fn equivalent_unions_do_not_need_a_second_native_region_update() {
        unsafe {
            let a = RECT { left: 0, top: 0, right: 800, bottom: 600 };
            let b = RECT { left: 20, top: 20, right: 200, bottom: 200 };
            let first = build_region(&[a]).unwrap();
            let nested = build_region(&[b, a, b]).unwrap();
            assert!(EqualRgn(first, nested).as_bool());
            let _ = DeleteObject(first.into());
            let _ = DeleteObject(nested.into());
        }
    }
    #[test]
    fn native_region_covers_surfaces_but_not_desktop_between_them() {
        unsafe {
            let region = build_region(&[
                RECT { left: 10, top: 10, right: 100, bottom: 100 },
                RECT { left: 200, top: 10, right: 300, bottom: 100 },
            ]).unwrap();
            assert!(PtInRegion(region, 20, 20).as_bool());
            assert!(PtInRegion(region, 220, 20).as_bool());
            assert!(!PtInRegion(region, 150, 20).as_bool());
            assert!(!PtInRegion(region, 20, 150).as_bool());
            let _ = DeleteObject(region.into());
            let empty = build_region(&[]).unwrap();
            assert!(!PtInRegion(empty, 20, 20).as_bool());
            let _ = DeleteObject(empty.into());
        }
    }
}
