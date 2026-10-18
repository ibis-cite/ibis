//! macOS launcher panel. All AppKit calls run on the main thread.

use tauri::{AppHandle, Manager};
use tauri_nspanel::{CollectionBehavior, ManagerExt, PanelLevel, WebviewWindowExt, tauri_panel};

use crate::diagnostics::{NativeIssue, report};

tauri_panel! {
    panel!(PickerPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
}

/// Called by Tauri setup on its main thread. Fail startup rather than silently
/// leaving a normal window that cannot reach the user's full-screen document.
pub(crate) fn configure(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if tauri_nspanel::objc2::MainThreadMarker::new().is_none() {
        return Err("the launcher panel must be configured on the main thread".into());
    }
    app.plugin(tauri_nspanel::init())
        .map_err(|_| "the launcher panel plugin could not start")?;
    let window = app
        .get_webview_window("main")
        .ok_or("the picker window is unavailable")?;
    let panel = window
        .to_panel::<PickerPanel>()
        .map_err(|_| "the picker could not become a launcher panel")?;
    panel
        .set_style_mask(
            panel.as_panel().styleMask() | tauri_nspanel::objc2_app_kit::NSWindowStyleMask::NonactivatingPanel,
        )
        .map_err(|_| "the launcher panel could not use non-activating behavior")?;
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .full_screen_auxiliary()
            .value(),
    );
    panel.set_level(PanelLevel::Floating.value());
    panel.set_hides_on_deactivate(false);
    panel.set_works_when_modal(true);
    app.set_activation_policy(tauri::ActivationPolicy::Accessory)
        .map_err(|_| "the launcher activation policy could not be set")?;
    Ok(())
}

/// A panel takes keyboard focus without activating Ibis or switching Spaces.
/// Commands and global shortcut callbacks can arrive from worker threads.
pub(crate) fn show(app: &AppHandle) {
    let handle = app.clone();
    report(
        app.run_on_main_thread(move || match handle.get_webview_panel("main") {
            Ok(panel) => {
                if let Some(main_thread) = tauri_nspanel::objc2::MainThreadMarker::new() {
                    // Dismissal may have hidden Ibis after an activating file dialog.
                    tauri_nspanel::objc2_app_kit::NSApplication::sharedApplication(main_thread)
                        .unhideWithoutActivation();
                    panel.show_and_make_key();
                } else {
                    report(Err::<(), ()>(()), NativeIssue::Show);
                }
            }
            Err(_) => report(Err::<(), ()>(()), NativeIssue::Show),
        }),
        NativeIssue::Show,
    );
}

/// Native file dialogs belong to Ibis and need an active application. This is
/// queued before the dialog plugin queues its own AppKit work. DialogOpen
/// already guards the picker against the resulting focus changes.
pub(crate) fn activate_for_dialog(app: &AppHandle) {
    report(
        app.run_on_main_thread(|| {
            if let Some(main_thread) = tauri_nspanel::objc2::MainThreadMarker::new() {
                // Support Tauri's minimum macOS as well as current AppKit;
                // NSApplication.activate is only available on macOS 14+.
                #[allow(deprecated)]
                tauri_nspanel::objc2_app_kit::NSApplication::sharedApplication(main_thread)
                    .activateIgnoringOtherApps(true);
            } else {
                report(Err::<(), ()>(()), NativeIssue::Focus);
            }
        }),
        NativeIssue::Focus,
    );
}
