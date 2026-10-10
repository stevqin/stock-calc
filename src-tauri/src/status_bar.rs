use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
#[cfg(not(target_os = "macos"))]
use tauri::LogicalSize;
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

#[derive(Default)]
struct PanelFocus {
    acquired: bool,
}
impl PanelFocus {
    fn changed(&mut self, focused: bool) -> bool {
        if focused {
            self.acquired = true;
            return false;
        }
        std::mem::take(&mut self.acquired)
    }
}

struct Rotation {
    frames: Vec<String>,
    index: usize,
    paused: bool,
    updated: Instant,
}
impl Default for Rotation {
    fn default() -> Self {
        Self {
            frames: vec!["T刻 · 加载中".into()],
            index: 0,
            paused: false,
            updated: Instant::now(),
        }
    }
}
impl Rotation {
    fn replace(&mut self, frames: Vec<String>) {
        self.frames = frames;
        self.index %= self.frames.len();
        self.updated = Instant::now();
    }
    fn title(&self) -> String {
        let title = &self.frames[self.index];
        if self.updated.elapsed() > Duration::from_secs(60) && !title.ends_with('*') {
            format!("{title} *")
        } else {
            title.clone()
        }
    }
    fn advance(&mut self) {
        if !self.paused {
            self.index = (self.index + 1) % self.frames.len();
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Holding {
    id: String,
    name: String,
    short_name: String,
    holding_profit: Option<String>,
    price: Option<String>,
    daily_percent: Option<String>,
    holding_percent: Option<String>,
    change: Option<String>,
    profit: Option<String>,
    stale: bool,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Total {
    percent: Option<String>,
    profit: Option<String>,
    stale: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    frames: Vec<String>,
    holdings: Vec<Holding>,
    total: Total,
    date: String,
    updated_at: f64,
}
#[derive(Default)]
pub struct StatusBar(Mutex<Rotation>, Mutex<Option<Snapshot>>);

// The underlying NSStatusItem length is in points, independent of title glyph widths.
fn set_title(tray: &tauri::tray::TrayIcon, title: String) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    tray.with_inner_tray_icon(|inner| {
        if let Some(item) = inner.ns_status_item() {
            item.setLength(160.0);
        }
    })?;
    // tray-icon's title setter synchronizes its mouse target with button.frame().
    // Always do this AFTER changing the native length, including the first frame.
    tray.set_title(Some(&title))?;
    tray.set_tooltip(Some(&title))?;
    #[cfg(target_os = "macos")]
    tray.with_inner_tray_icon(|inner| {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSAutoresizingMaskOptions;
        let mtm = MainThreadMarker::new().expect("Tauri dispatches tray operations on main thread");
        if let Some(item) = inner.ns_status_item() {
            if let Some(button) = item.button(mtm) {
                button.setFont(Some(&objc2_app_kit::NSFont::systemFontOfSize(11.0)));
                button.setUsesSingleLineMode(true);
                button.setAlignment(objc2_app_kit::NSTextAlignment::Right);
                if let Some(cell) = button.cell() {
                    cell.setWraps(false);
                    cell.setScrollable(true);
                }
                for view in button.subviews() {
                    // tray-icon creates this mouse-event overlay before AppKit has
                    // necessarily laid out the title. Without autoresizing, the
                    // uncovered button invokes NSStatusItem.menu on BOTH buttons.
                    if view.class().name().to_bytes() == b"TaoTrayTarget" {
                        view.setAutoresizingMask(
                            NSAutoresizingMaskOptions::ViewWidthSizable
                                | NSAutoresizingMaskOptions::ViewHeightSizable,
                        );
                        view.setFrame(button.bounds());
                    }
                }
            }
        }
    })?;
    Ok(())
}
#[tauri::command]
pub fn get_status_portfolio(state: tauri::State<StatusBar>) -> Result<Option<Snapshot>, String> {
    Ok(state.1.lock().map_err(|e| e.to_string())?.clone())
}
#[tauri::command]
pub fn hide_status_panel(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("status-panel") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn open_status_main(app: tauri::AppHandle) {
    let _ = hide_status_panel(app.clone());
    show_window(&app);
}
#[tauri::command]
pub fn get_status_paused(state: tauri::State<StatusBar>) -> Result<bool, String> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.paused)
}
#[tauri::command]
pub fn set_status_paused(state: tauri::State<StatusBar>, paused: bool) -> Result<bool, String> {
    state.0.lock().map_err(|e| e.to_string())?.paused = paused;
    Ok(paused)
}
#[tauri::command]
pub fn exit_status_app(app: tauri::AppHandle) {
    app.exit(0);
}
// AppKit screen and mouse coordinates are all global logical points with a
// bottom-left origin. Never combine these with tray-icon's scaled pixel output.
#[cfg(any(target_os = "macos", test))]
fn point_in_screen(point: (f64, f64), frame: (f64, f64, f64, f64)) -> bool {
    point.0 >= frame.0
        && point.0 < frame.0 + frame.2
        && point.1 > frame.1
        && point.1 <= frame.1 + frame.3
}
#[cfg(any(target_os = "macos", test))]
fn cocoa_panel_placement(click: (f64, f64), visible: (f64, f64, f64, f64)) -> (f64, f64, f64, f64) {
    let (left, bottom, available_width, available_height) = visible;
    let width = 300.0_f64.min(available_width);
    let height = 520.0_f64.min(available_height);
    let x = (click.0 - width / 2.0).clamp(left, left + available_width - width);
    let y = (click.1.min(bottom + available_height) - 4.0 - height)
        .clamp(bottom, bottom + available_height - height);
    (x, y, width, height)
}
#[cfg(target_os = "macos")]
fn panel_collection_behavior(
    mut behavior: objc2_app_kit::NSWindowCollectionBehavior,
    modern_spaces: bool,
) -> objc2_app_kit::NSWindowCollectionBehavior {
    use objc2_app_kit::NSWindowCollectionBehavior as B;
    // These groups are mutually exclusive in AppKit. A popup must not inherit
    // normal document-window/fullscreen-primary behavior from the webview host.
    behavior.remove(
        B::MoveToActiveSpace
            | B::Managed
            | B::Stationary
            | B::ParticipatesInCycle
            | B::FullScreenPrimary
            | B::FullScreenNone
            | B::FullScreenAllowsTiling
            | B::Primary
            | B::Auxiliary
            | B::CanJoinAllApplications,
    );
    behavior.insert(
        B::CanJoinAllSpaces
            | B::Transient
            | B::IgnoresCycle
            | B::FullScreenAuxiliary
            | B::FullScreenDisallowsTiling,
    );
    if modern_spaces {
        behavior.insert(B::CanJoinAllApplications);
    }
    behavior
}
#[cfg(target_os = "macos")]
fn position_macos_panel(panel: &tauri::WebviewWindow) -> Result<(), String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSEvent, NSScreen, NSWindow};
    let mtm = MainThreadMarker::new().ok_or("面板定位必须运行在主线程")?;
    let mouse = NSEvent::mouseLocation();
    let screens = NSScreen::screens(mtm);
    let screen = screens
        .iter()
        .find(|screen| {
            let frame = screen.frame();
            point_in_screen(
                (mouse.x, mouse.y),
                (
                    frame.origin.x,
                    frame.origin.y,
                    frame.size.width,
                    frame.size.height,
                ),
            )
        })
        .ok_or("未找到点击位置所在屏幕")?;
    let mut frame = screen.visibleFrame();
    let (x, y, width, height) = cocoa_panel_placement(
        (mouse.x, mouse.y),
        (
            frame.origin.x,
            frame.origin.y,
            frame.size.width,
            frame.size.height,
        ),
    );
    frame.origin.x = x;
    frame.origin.y = y;
    frame.size.width = width;
    frame.size.height = height;
    // Set the Cocoa frame directly. Tauri's physical-position setter divides
    // by the window's OLD screen scale before moving, which breaks mixed-DPI moves.
    let ptr = panel.ns_window().map_err(|e| e.to_string())?;
    // SAFETY: Tauri owns this live NSWindow; the panel handle retains it and this
    // function is dispatched on the AppKit main thread.
    unsafe {
        let window = &*ptr.cast::<NSWindow>();
        window.setCollectionBehavior(panel_collection_behavior(
            window.collectionBehavior(),
            objc2::available!(macos = 13.0),
        ));
        window.setLevel(objc2_app_kit::NSStatusWindowLevel);
        window.setFrame_display(frame, true);
    }
    panel.show().map_err(|e| e.to_string())?;
    panel.set_focus().map_err(|e| e.to_string())
}

#[cfg(any(not(target_os = "macos"), test))]
// Input/output coordinates are physical pixels. Center below the actual click,
// then clamp to the clicked monitor's work area (which may have a negative origin).
fn panel_placement(
    click: (f64, f64),
    menu_bottom: f64,
    work: (f64, f64, f64, f64),
    scale: f64,
) -> (f64, f64, f64, f64) {
    let (left, top, available_width, available_height) = work;
    let width = (300.0 * scale).min(available_width);
    let height = (520.0 * scale).min(available_height);
    let x = (click.0 - width / 2.0).clamp(left, left + available_width - width);
    let y = (click.1.max(menu_bottom) + 4.0 * scale).clamp(top, top + available_height - height);
    (x, y, width, height)
}

fn toggle_panel(
    app: &tauri::AppHandle,
    position: PhysicalPosition<f64>,
    rect: tauri::Rect,
) -> tauri::Result<()> {
    let Some(panel) = app.get_webview_window("status-panel") else {
        return Ok(());
    };
    if panel.is_visible()? {
        return panel.hide();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = (position, rect);
        let native_panel = panel.clone();
        return panel.run_on_main_thread(move || {
            if let Err(error) = position_macos_panel(&native_panel) {
                eprintln!("status panel placement: {error}");
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(monitor) = app
            .monitor_from_point(position.x, position.y)?
            .or(app.primary_monitor()?)
        {
            let scale = monitor.scale_factor();
            let work = monitor.work_area();
            let origin = rect.position.to_physical::<f64>(scale);
            let size = rect.size.to_physical::<f64>(scale);
            let (x, y, width, height) = panel_placement(
                (position.x, position.y),
                origin.y + size.height,
                (
                    work.position.x as f64,
                    work.position.y as f64,
                    work.size.width as f64,
                    work.size.height as f64,
                ),
                scale,
            );
            panel.set_size(LogicalSize::new(width / scale, height / scale))?;
            panel.set_position(PhysicalPosition::new(x, y))?;
        }
        panel.show()?;
        panel.set_focus()
    }
}

#[tauri::command]
pub fn update_status_bar(
    app: tauri::AppHandle,
    state: tauri::State<StatusBar>,
    snapshot: Snapshot,
) -> Result<(), String> {
    let frames = &snapshot.frames;
    if frames.is_empty()
        || frames.len() > 1000
        || frames
            .iter()
            .any(|s| s.chars().count() > 200 || s.contains(['\n', '\r']))
    {
        return Err("状态栏内容无效".into());
    }
    let (title, index) = {
        let mut rotation = state.0.lock().map_err(|e| e.to_string())?;
        rotation.replace(frames.clone());
        (rotation.title(), rotation.index)
    };
    if let Some(tray) = app.tray_by_id("portfolio") {
        set_title(&tray, title).map_err(|e| e.to_string())?;
    }
    *state.1.lock().map_err(|e| e.to_string())? = Some(snapshot.clone());
    app.emit_to("status-panel", "status-portfolio", snapshot)
        .map_err(|e| e.to_string())?;
    app.emit_to("status-panel", "status-active-index", index)
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = app.emit_to("main", "main-window-activated", ());
    }
}
#[cfg(any(target_os = "macos", test))]
struct PanelMaterialGeometry {
    corner_radius: f64,
    clips_content: bool,
}
#[cfg(any(target_os = "macos", test))]
fn panel_material_geometry() -> PanelMaterialGeometry {
    PanelMaterialGeometry {
        corner_radius: 18.0,
        clips_content: true,
    }
}
#[cfg(target_os = "macos")]
fn install_panel_material(panel: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSGlassEffectView, NSGlassEffectViewStyle, NSWindow,
    };
    let mtm = MainThreadMarker::new().ok_or("玻璃材质必须运行在主线程")?;
    let ptr = panel.ns_window()?;
    // The host NSWindow must remain fully transparent and shadowless. AppKit's
    // default rectangular window shadow otherwise remains visible behind the
    // rounded glass content view.
    unsafe {
        let window = &*ptr.cast::<NSWindow>();
        window.setOpaque(false);
        window.setHasShadow(false);
    }
    if objc2::available!(macos = 26.0) {
        // Tauri retains the live window; retain its content before reparenting.
        unsafe {
            let geometry = panel_material_geometry();
            let window = &*ptr.cast::<NSWindow>();
            let content = window.contentView().ok_or("面板内容视图不可用")?;
            let glass = NSGlassEffectView::new(mtm);
            glass.setFrame(content.frame());
            glass.setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );
            glass.setStyle(NSGlassEffectViewStyle::Regular);
            glass.setCornerRadius(geometry.corner_radius);
            // NSGlassEffectView rounds the glass itself, but it does not clip the
            // embedded WebView by default. On bright backgrounds that rectangular
            // child surface is visible outside the curved glass corners.
            glass.setClipsToBounds(geometry.clips_content);
            window.setContentView(None);
            glass.setContentView(Some(&content));
            window.setContentView(Some(&glass));
        }
    } else {
        panel.set_effects(tauri::utils::config::WindowEffectsConfig {
            effects: vec![tauri::window::Effect::Popover],
            state: Some(tauri::window::EffectState::Active),
            radius: Some(18.0),
            color: None,
        })?;
    }
    Ok(())
}
#[tauri::command]
pub fn get_status_active_index(state: tauri::State<StatusBar>) -> Result<usize, String> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.index)
}
pub fn initialize(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(StatusBar::default());
    let panel = WebviewWindowBuilder::new(
        app,
        "status-panel",
        WebviewUrl::App("index.html?status-panel".into()),
    )
    .title("T刻 · 持仓速览")
    .inner_size(300.0, 520.0)
    .transparent(true)
    .shadow(false)
    .visible(false)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .build()?;
    #[cfg(target_os = "macos")]
    install_panel_material(&panel)?;
    let panel_handle = panel.clone();
    let focus = Arc::new(Mutex::new(PanelFocus::default()));
    panel.on_window_event(move |event| {
        if let WindowEvent::Focused(focused) = event {
            if let Ok(mut focus) = focus.lock() {
                if focus.changed(*focused) {
                    let _ = panel_handle.hide();
                }
            }
        }
    });
    let tray = TrayIconBuilder::with_id("portfolio")
        .title("T刻 · 加载中")
        .tooltip("持仓涨跌幅与当日收益 · 每5秒轮播")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left | MouseButton::Right,
                button_state: MouseButtonState::Up,
                position,
                rect,
                ..
            } = event
            {
                if let Err(error) = toggle_panel(tray.app_handle(), position, rect) {
                    eprintln!("status panel: {error}");
                    let _ =
                        tray.app_handle()
                            .emit_to("main", "status-panel-error", error.to_string());
                }
            }
        })
        .build(app)?;
    set_title(&tray, "T刻 · 加载中".into())?;
    let handle = app.handle().clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        let (title, index) = {
            let state = handle.state::<StatusBar>();
            let Ok(mut rotation) = state.0.lock() else {
                break;
            };
            rotation.advance();
            (rotation.title(), rotation.index)
        };
        let Some(tray) = handle.tray_by_id("portfolio") else {
            break;
        };
        let _ = set_title(&tray, title);
        let _ = handle.emit_to("status-panel", "status-active-index", index);
    });
    // Quote wakeups remain independent of the five-second title rotation.
    let refresh_handle = app.handle().clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(3));
        if refresh_handle.tray_by_id("portfolio").is_none() {
            break;
        }
        let _ = refresh_handle.emit("status-bar-tick", ());
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn panel_material_clips_the_rectangular_webview_to_its_rounded_shape() {
        let geometry = panel_material_geometry();
        assert_eq!(geometry.corner_radius, 18.0);
        assert!(geometry.clips_content);
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn popup_can_join_fullscreen_spaces_without_conflicting_document_flags() {
        use objc2_app_kit::NSWindowCollectionBehavior as B;
        let inherited = B::MoveToActiveSpace
            | B::Managed
            | B::ParticipatesInCycle
            | B::FullScreenPrimary
            | B::FullScreenAllowsTiling
            | B::Primary;
        for modern in [false, true] {
            let behavior = panel_collection_behavior(inherited, modern);
            assert!(behavior.contains(B::CanJoinAllSpaces | B::FullScreenAuxiliary | B::Transient));
            assert!(!behavior.intersects(inherited));
            assert_eq!(behavior.contains(B::CanJoinAllApplications), modern);
        }
    }
    #[test]
    fn cocoa_coordinates_select_secondary_display_without_pixel_scaling() {
        // Global AppKit points: 2x primary on the left, 1x secondary on the right.
        let screens = [(0.0, 0.0, 1512.0, 982.0), (1512.0, 0.0, 2560.0, 1440.0)];
        let click = (3900.0, 1428.0);
        assert!(!point_in_screen(click, screens[0]));
        assert!(point_in_screen(click, screens[1]));
        let frame = cocoa_panel_placement(click, (1512.0, 0.0, 2560.0, 1416.0));
        assert_eq!(frame, (3750.0, 892.0, 300.0, 520.0));
    }
    #[test]
    fn cocoa_coordinates_support_screens_left_and_above_primary() {
        assert!(point_in_screen(
            (-1000.0, 900.0),
            (-1920.0, 0.0, 1920.0, 1080.0)
        ));
        assert_eq!(
            cocoa_panel_placement((-1910.0, 1068.0), (-1920.0, 0.0, 1920.0, 1056.0)),
            (-1920.0, 532.0, 300.0, 520.0)
        );
        assert!(point_in_screen(
            (500.0, 1950.0),
            (0.0, 982.0, 1920.0, 1080.0)
        ));
        assert_eq!(
            cocoa_panel_placement((500.0, 2050.0), (0.0, 982.0, 1920.0, 1056.0)),
            (350.0, 1514.0, 300.0, 520.0)
        );
    }
    #[test]
    fn panel_tracks_click_position_and_stays_below_the_menu() {
        let work = (0.0, 24.0, 1440.0, 876.0);
        let first = panel_placement((600.0, 10.0), 24.0, work, 1.0);
        let second = panel_placement((700.0, 10.0), 24.0, work, 1.0);
        assert_eq!(first, (450.0, 28.0, 300.0, 520.0));
        assert_eq!(second.0 - first.0, 100.0);
    }
    #[test]
    fn panel_clamps_to_retina_and_negative_origin_monitor_edges() {
        assert_eq!(
            panel_placement((2870.0, 20.0), 48.0, (0.0, 48.0, 2880.0, 1752.0), 2.0),
            (2280.0, 56.0, 600.0, 1040.0)
        );
        assert_eq!(
            panel_placement((-1430.0, 10.0), 24.0, (-1440.0, 24.0, 1440.0, 876.0), 1.0).0,
            -1440.0
        );
        assert_eq!(
            panel_placement((10.0, 10.0), 24.0, (0.0, 24.0, 320.0, 240.0), 1.0),
            (0.0, 24.0, 300.0, 240.0)
        );
    }
    #[test]
    fn stale_marker_is_a_single_asterisk_even_while_paused() {
        let mut rotation = Rotation::default();
        rotation.replace(vec!["茅台 +1.25%｜+¥320 *".into()]);
        rotation.paused = true;
        rotation.updated = Instant::now() - Duration::from_secs(61);
        rotation.advance();
        assert_eq!(rotation.title(), "茅台 +1.25%｜+¥320 *");
    }
    #[test]
    fn startup_blur_does_not_dismiss_panel_before_focus_arrives() {
        let mut focus = PanelFocus::default();
        assert!(!focus.changed(false));
        assert!(!focus.changed(false));
        assert!(!focus.changed(true));
        assert!(focus.changed(false));
        assert!(!focus.changed(false));
        assert!(!focus.changed(true));
        assert!(focus.changed(false));
    }
    #[test]
    fn cycles_holdings_then_summary_and_wraps() {
        let mut r = Rotation::default();
        r.replace(vec!["A".into(), "B".into(), "合计".into()]);
        assert_eq!(r.title(), "A");
        r.advance();
        assert_eq!(r.title(), "B");
        r.advance();
        assert_eq!(r.title(), "合计");
        r.advance();
        assert_eq!(r.title(), "A");
    }
    #[test]
    fn pause_keeps_position_but_accepts_new_quotes_and_removed_holdings() {
        let mut r = Rotation::default();
        r.replace(vec!["A".into(), "合计".into()]);
        r.advance();
        r.paused = true;
        r.advance();
        assert_eq!(r.title(), "合计");
        r.replace(vec!["新合计".into()]);
        assert_eq!(r.title(), "新合计");
        r.updated = Instant::now() - Duration::from_secs(61);
        assert_eq!(r.title(), "新合计 *");
    }
}
