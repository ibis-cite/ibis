//! The short "Copied" notice shown after a clean copy hides the picker
//! (design rule 6, "Say what happened").
//!
//! It is a second, small window drawn by Ibis. It never takes focus, so the
//! editor that focus was just returned to keeps it, and it is left out of the
//! taskbar, the Dock and Alt+Tab. Each platform shows it where its own
//! notices appear: a pill near the top on macOS, a card at the bottom right
//! on Windows and a toast at the bottom on Linux, on the picker's display.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::diagnostics::{NativeIssue, checked, report};
use crate::placement::{Area, display};

pub(crate) const LABEL: &str = "notice";
/// The window title, which screen readers may read; never the citation.
const TITLE: &str = "Ibis notice";
/// About two seconds visible, then a 200 ms fade drawn by the page.
const SHOWN_FOR: Duration = Duration::from_millis(2_200);
/// The notice names what was copied on one line; longer text is cut short.
const TEXT_LIMIT: usize = 200;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Platform {
    MacOs,
    Windows,
    Linux,
}

impl Platform {
    pub(crate) const CURRENT: Self = if cfg!(target_os = "macos") {
        Self::MacOs
    } else if cfg!(target_os = "windows") {
        Self::Windows
    } else {
        Self::Linux
    };
}

/// Window size in points. On macOS and Windows the window is transparent and
/// a little larger than the notice it draws, leaving room for its shadow; on
/// Linux the window is opaque and is the toast itself.
pub(crate) fn notice_size(platform: Platform) -> (f64, f64) {
    match platform {
        Platform::MacOs => (400.0, 76.0),
        Platform::Windows => (380.0, 112.0),
        Platform::Linux => (360.0, 44.0),
    }
}

/// The window's top-left corner within the display's usable area, in the
/// same units as `usable`. A notice wider or taller than the area starts at
/// its corner rather than off screen.
pub(crate) fn notice_position(platform: Platform, usable: Area, width: f64, height: f64) -> (f64, f64) {
    let centre = usable.x + (usable.width - width).max(0.0) / 2.0;
    let right = usable.x + (usable.width - width).max(0.0);
    let bottom = |margin: f64| usable.y + (usable.height - height - margin).max(0.0);
    match platform {
        // The pill sits 40 points below the menu bar; 16 of them are the
        // window's own shadow margin.
        Platform::MacOs => (centre, usable.y + 24.0),
        // The card's own 16-point margin keeps it off the taskbar and edge.
        Platform::Windows => (right, bottom(0.0)),
        Platform::Linux => (centre, bottom(28.0)),
    }
}

/// One line of the copied text, cut at a character boundary.
pub(crate) fn summary(text: &str) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() <= TEXT_LIMIT {
        return line;
    }
    let mut cut: String = line.chars().take(TEXT_LIMIT - 1).collect();
    cut.push('…');
    cut
}

/// What the notice shows now, and which showing is the latest, so an
/// earlier notice's timer never hides a later one.
#[derive(Default)]
pub(crate) struct Notice {
    text: Mutex<Option<String>>,
    showing: AtomicU64,
    /// Held while the window is looked up or created, so two quick copies
    /// cannot both create it.
    window: Mutex<()>,
}

/// The text of the notice being shown, for a notice page that has just
/// loaded and missed the event that announced it.
#[tauri::command]
#[specta::specta]
pub(crate) fn copied_notice(notice: State<'_, Notice>) -> Option<String> {
    notice.text.lock().ok().and_then(|text| text.clone())
}

/// Say "Copied" after the picker has hidden. The interface calls this only
/// after a copy without warnings that hid the picker (see `copyFeedback.ts`);
/// copies with warnings keep their notice inside the picker. Failures are
/// reported as fixed diagnostics: the citation is on the clipboard either way.
#[tauri::command]
#[specta::specta]
pub(crate) async fn show_copied_notice(app: AppHandle, text: String) {
    show(&app, summary(&text));
}

fn show(app: &AppHandle, text: String) {
    let notice = app.state::<Notice>();
    if let Ok(mut current) = notice.text.lock() {
        *current = Some(text.clone());
    }
    let showing = notice.showing.fetch_add(1, Ordering::SeqCst).wrapping_add(1);
    let shown = {
        let Ok(_creating) = notice.window.lock() else {
            return;
        };
        match app.get_webview_window(LABEL) {
            Some(window) => {
                // Already open (or, on macOS, kept hidden): move it to the
                // picker's display and replay it with the new text.
                if let Some((x, y)) = position(app) {
                    report(window.set_position(placed(x, y)), NativeIssue::Position);
                }
                report(window.emit_to(LABEL, "notice:show", &text), NativeIssue::Notice);
                present(app);
                true
            }
            None => create(app).is_some(),
        }
    };
    if !shown {
        return;
    }
    let handle = app.clone();
    let timer = std::thread::Builder::new().name("ibis-notice".into()).spawn(move || {
        std::thread::sleep(SHOWN_FOR);
        if handle.state::<Notice>().showing.load(Ordering::SeqCst) == showing {
            dismiss(&handle);
        }
    });
    if timer.is_err() {
        // Without a timer the notice would stay; take it away at once.
        dismiss(app);
    }
}

/// The notice's corner on the display the picker was on, in the shared space
/// used by `placement`: points on macOS, pixels elsewhere.
fn position(app: &AppHandle) -> Option<(f64, f64)> {
    let picker = app.get_webview_window("main")?;
    let monitor = checked(picker.current_monitor(), NativeIssue::Monitor)
        .flatten()
        .or_else(|| checked(app.primary_monitor(), NativeIssue::Monitor).flatten())?;
    let (width, height) = notice_size(Platform::CURRENT);
    let scale = if cfg!(target_os = "macos") {
        1.0
    } else {
        monitor.scale_factor()
    };
    let (x, y) = notice_position(
        Platform::CURRENT,
        display(&monitor).usable,
        width * scale,
        height * scale,
    );
    // Builders and set_position take points; convert at the target's scale.
    Some((x / scale, y / scale))
}

fn placed(x: f64, y: f64) -> tauri::Position {
    tauri::LogicalPosition::new(x, y).into()
}

fn create(app: &AppHandle) -> Option<()> {
    let (width, height) = notice_size(Platform::CURRENT);
    // WebView2 refuses a second webview whose browser arguments differ from
    // the picker's, and they keep it offline (#201), so reuse them exactly.
    let browser_args = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .and_then(|window| window.additional_browser_args.clone());
    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("notice.html".into()))
        .title(TITLE)
        .inner_size(width, height)
        .min_inner_size(width, height)
        .max_inner_size(width, height)
        // GTK sizes a fixed-size window by its webview's request (200 px
        // tall), so on Linux the size limits above keep it to the toast.
        .resizable(cfg!(target_os = "linux"))
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .focused(false)
        .focusable(false);
    if let Some((x, y)) = position(app) {
        builder = builder.position(x, y);
    }
    if let Some(args) = browser_args.as_deref() {
        builder = builder.additional_browser_args(args);
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        builder = builder.transparent(true);
    }
    // Linux draws an opaque toast; start in its colour, not a white flash.
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        builder = builder.background_color(tauri::webview::Color(0x3a, 0x3a, 0x3e, 0xff));
    }
    // Windows and Linux show it as it is created: tao shows a window built
    // unfocused without activating it, which a later show would not do.
    // macOS shows it once it is a non-activating panel.
    builder = builder.visible(!cfg!(target_os = "macos"));
    let window = checked(builder.build(), NativeIssue::Notice)?;
    #[cfg(target_os = "macos")]
    macos::configure(app, &window);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
    Some(())
}

/// Bring a kept notice back to the front without activating Ibis.
fn present(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    macos::present(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Take the notice away. Windows and Linux close it, since showing a hidden
/// window again could activate it; macOS keeps its panel hidden for reuse.
fn dismiss(app: &AppHandle) {
    if let Ok(mut text) = app.state::<Notice>().text.lock() {
        *text = None;
    }
    #[cfg(target_os = "macos")]
    macos::hide(app);
    #[cfg(not(target_os = "macos"))]
    if let Some(window) = app.get_webview_window(LABEL) {
        report(window.destroy(), NativeIssue::Notice);
    }
}

/// macOS: a non-activating panel that cannot become key or main, joins every
/// Space including full-screen ones, ignores the mouse and stays visible
/// while Ibis is hidden, so the writing app stays active and in front.
#[cfg(target_os = "macos")]
mod macos {
    use tauri::AppHandle;
    use tauri_nspanel::{CollectionBehavior, ManagerExt, PanelLevel, WebviewWindowExt, tauri_panel};

    use crate::diagnostics::{NativeIssue, checked, report};

    tauri_panel! {
        panel!(NoticePanel {
            config: {
                can_become_key_window: false,
                can_become_main_window: false,
                is_floating_panel: true
            }
        })
    }

    pub(super) fn configure(app: &AppHandle, window: &tauri::WebviewWindow) {
        let window = window.clone();
        report(
            app.run_on_main_thread(move || {
                let Some(panel) = checked(window.to_panel::<NoticePanel>(), NativeIssue::Notice) else {
                    return;
                };
                if panel
                    .set_style_mask(
                        panel.as_panel().styleMask()
                            | tauri_nspanel::objc2_app_kit::NSWindowStyleMask::NonactivatingPanel,
                    )
                    .is_err()
                {
                    // Without non-activating behaviour it could take focus; never show it.
                    report(Err::<(), ()>(()), NativeIssue::Notice);
                    report(window.destroy(), NativeIssue::Notice);
                    return;
                }
                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .can_join_all_spaces()
                        .full_screen_auxiliary()
                        .ignores_cycle()
                        .value(),
                );
                panel.set_level(PanelLevel::Status.value());
                panel.set_hides_on_deactivate(false);
                panel.set_ignores_mouse_events(true);
                // The picker's dismissal hides the whole app; the notice must stay.
                panel.as_panel().setCanHide(false);
                panel.order_front_regardless();
            }),
            NativeIssue::Notice,
        );
    }

    pub(super) fn present(app: &AppHandle) {
        let handle = app.clone();
        report(
            app.run_on_main_thread(move || {
                if let Some(panel) = checked(handle.get_webview_panel(super::LABEL), NativeIssue::Notice) {
                    panel.order_front_regardless();
                }
            }),
            NativeIssue::Notice,
        );
    }

    pub(super) fn hide(app: &AppHandle) {
        let handle = app.clone();
        report(
            app.run_on_main_thread(move || {
                if let Some(panel) = checked(handle.get_webview_panel(super::LABEL), NativeIssue::Notice) {
                    panel.hide();
                }
            }),
            NativeIssue::Notice,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn rect(x: f64, y: f64, width: f64, height: f64) -> Area {
        Area { x, y, width, height }
    }

    /// A display with a menu bar or taskbar, and one left of it with
    /// negative coordinates.
    const USABLE: Area = rect(0.0, 38.0, 1728.0, 1079.0);
    const LEFT: Area = rect(-2560.0, 0.0, 2560.0, 1392.0);

    #[test]
    fn macos_shows_a_pill_near_the_top_centre() {
        let (width, height) = notice_size(Platform::MacOs);
        let (x, y) = notice_position(Platform::MacOs, USABLE, width, height);
        assert_eq!(x + width / 2.0, USABLE.x + USABLE.width / 2.0);
        assert_eq!(y, 38.0 + 24.0);
    }

    #[test]
    fn windows_shows_a_card_at_the_bottom_right_above_the_taskbar() {
        let (width, height) = notice_size(Platform::Windows);
        let (x, y) = notice_position(Platform::Windows, LEFT, width, height);
        assert_eq!(x + width, LEFT.x + LEFT.width);
        assert_eq!(y + height, LEFT.y + LEFT.height);
    }

    #[test]
    fn linux_shows_a_toast_at_the_bottom_centre() {
        let (width, height) = notice_size(Platform::Linux);
        let (x, y) = notice_position(Platform::Linux, LEFT, width, height);
        assert_eq!(x + width / 2.0, LEFT.x + LEFT.width / 2.0);
        assert_eq!(y + height, LEFT.y + LEFT.height - 28.0);
    }

    #[test]
    fn a_notice_larger_than_the_display_starts_at_its_corner() {
        let tiny = rect(100.0, 50.0, 200.0, 30.0);
        for platform in [Platform::MacOs, Platform::Windows, Platform::Linux] {
            let (width, height) = notice_size(platform);
            let (x, y) = notice_position(platform, tiny, width, height);
            assert!(x >= tiny.x && y >= tiny.y, "{platform:?} placed it off the display");
        }
    }

    #[test]
    fn the_summary_is_one_line_cut_at_a_character_boundary() {
        assert_eq!(summary("[@a;\n  @b]"), "[@a; @b]");
        assert_eq!(summary(""), "");
        let long = "研".repeat(TEXT_LIMIT + 10);
        let cut = summary(&long);
        assert_eq!(cut.chars().count(), TEXT_LIMIT);
        assert!(cut.ends_with('…'));
        assert_eq!(summary(&"a".repeat(TEXT_LIMIT)).chars().count(), TEXT_LIMIT);
    }
}
