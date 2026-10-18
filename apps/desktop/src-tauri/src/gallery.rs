//! Debug evidence entry point. The release application does not compile this module.

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Listener, Manager, Url, WebviewWindow};

const STATES: [&str; 14] = [
    "first-run",
    "loading",
    "empty",
    "no-results",
    "many-results",
    "long-titles",
    "rtl",
    "missing-file",
    "invalid-settings",
    "damaged-library",
    "copy-confirmation",
    "large-text",
    "dark",
    "high-contrast",
];

struct ReadyAck {
    state: String,
    path: PathBuf,
    acknowledged: AtomicBool,
}

impl ReadyAck {
    fn new(window: &str, state: Option<&str>, path: Option<PathBuf>) -> Option<Self> {
        let state = state.filter(|state| STATES.contains(state))?;
        let path = path?;
        if window != "main" || !path.is_absolute() || path.file_name()?.to_str()? != format!("{state}.ready") {
            return None;
        }
        Some(Self {
            state: state.to_string(),
            path,
            acknowledged: AtomicBool::new(false),
        })
    }

    fn accept(&self, payload: &str) -> std::io::Result<bool> {
        if payload.len() > 128
            || serde_json::from_str::<String>(payload).ok().as_deref() != Some(self.state.as_str())
            || self.acknowledged.swap(true, Ordering::SeqCst)
        {
            return Ok(false);
        }
        // The renderer supplies only a fixed state. Its destination came from
        // the capture process environment; no web command accepts a file path.
        let temporary = self.path.with_extension("ready.tmp");
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        let written = (|| {
            writeln!(file, "{{\"state\":\"{}\"}}", self.state)?;
            drop(file);
            std::fs::rename(&temporary, &self.path)
        })();
        if written.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        written.map(|()| true)
    }
}

/// Called before navigation, and only inside the debug gallery opt-in block.
/// Normal and release windows retain their default event permissions.
pub(crate) fn install_readiness(
    app: &AppHandle,
    window: &WebviewWindow,
    selected: Option<&str>,
    ready_file: Option<PathBuf>,
) -> tauri::Result<()> {
    let Some(ready) = ReadyAck::new(window.label(), selected, ready_file) else {
        return Ok(());
    };
    app.add_capability(
        CapabilityBuilder::new("debug-gallery-rendered")
            .window("main")
            .permission("core:event:allow-emit-to"),
    )?;
    window.listen("gallery:rendered", move |event| {
        if ready.accept(event.payload()).is_err() {
            eprintln!("ibis: the debug gallery render could not be acknowledged");
        }
    });
    Ok(())
}

/// Change only the local document and its query, retaining the webview's origin
/// for both Tauri's custom protocol and its development HTTP server.
pub(crate) fn gallery_url(mut current: Url, enabled: Option<&str>, state: Option<&str>) -> Option<Url> {
    if enabled != Some("1") {
        return None;
    }
    current.set_path("/gallery.html");
    current.set_query(None);
    current.set_fragment(None);
    if let Some(state) = state {
        current.query_pairs_mut().append_pair("state", state);
    }
    Some(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(value: &str) -> Url {
        Url::parse(value).unwrap_or_else(|error| panic!("synthetic URL was invalid: {error}"))
    }

    #[test]
    fn readiness_requires_the_main_window_known_state_and_a_configured_destination() {
        let directory = tempfile::tempdir().unwrap_or_else(|e| panic!("{e}"));
        let path = directory.path().join("loading.ready");
        assert!(ReadyAck::new("other", Some("loading"), Some(path.clone())).is_none());
        assert!(ReadyAck::new("main", Some("../loading"), Some(path.clone())).is_none());
        assert!(ReadyAck::new("main", Some("loading"), None).is_none());
        assert!(ReadyAck::new("main", None, Some(path.clone())).is_none());
        assert!(ReadyAck::new("main", Some("empty"), Some(path.clone())).is_none());
        assert!(ReadyAck::new("main", Some("loading"), Some(PathBuf::from("loading.ready"))).is_none());
        assert!(!path.exists());
    }

    #[test]
    fn only_the_selected_render_writes_one_atomic_acknowledgment() {
        let directory = tempfile::tempdir().unwrap_or_else(|e| panic!("{e}"));
        let path = directory.path().join("loading.ready");
        let ready =
            ReadyAck::new("main", Some("loading"), Some(path.clone())).unwrap_or_else(|| panic!("no ready target"));
        for invalid in ["not JSON", "\"empty\"", "{\"state\":\"loading\",\"path\":\"other\"}"] {
            assert!(!ready.accept(invalid).unwrap_or_else(|e| panic!("{e}")));
            assert!(!path.exists());
        }
        assert!(ready.accept("\"loading\"").unwrap_or_else(|e| panic!("{e}")));
        assert_eq!(
            std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{e}")),
            "{\"state\":\"loading\"}\n"
        );
        assert!(!path.with_extension("ready.tmp").exists());
        std::fs::write(&path, "duplicate sentinel").unwrap_or_else(|e| panic!("{e}"));
        assert!(!ready.accept("\"loading\"").unwrap_or_else(|e| panic!("{e}")));
        assert_eq!(
            std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{e}")),
            "duplicate sentinel"
        );
    }

    #[test]
    fn gallery_navigation_preserves_custom_protocol_and_development_origins() {
        for original in [
            "tauri://localhost/index.html?stale=1#old",
            "http://tauri.localhost/index.html?stale=1#old",
            "https://tauri.localhost/index.html?stale=1#old",
            "http://localhost:5173/index.html?stale=1#old",
        ] {
            let current = parse(original);
            let destination =
                gallery_url(current.clone(), Some("1"), None).unwrap_or_else(|| panic!("gallery was not enabled"));
            assert_eq!(destination.scheme(), current.scheme());
            assert_eq!(destination.host_str(), current.host_str());
            assert_eq!(destination.port(), current.port());
            assert_eq!(destination.path(), "/gallery.html");
            assert_eq!(destination.query(), None);
            assert_eq!(destination.fragment(), None);
        }
    }

    #[test]
    fn state_is_one_encoded_query_value_and_cannot_change_the_destination() {
        for state in [
            "loaded",
            "//attacker.invalid/other?state=empty#fragment",
            "loaded&state=error&extra=1",
            "../index.html?\n#<script>alert(1)</script>",
            "日本語 + % ? & #",
            "",
        ] {
            let destination = gallery_url(parse("tauri://localhost/"), Some("1"), Some(state))
                .unwrap_or_else(|| panic!("gallery was not enabled"));
            assert_eq!(destination.scheme(), "tauri");
            assert_eq!(destination.host_str(), Some("localhost"));
            assert_eq!(destination.path(), "/gallery.html");
            assert_eq!(destination.fragment(), None);
            let pairs: Vec<_> = destination.query_pairs().collect();
            assert_eq!(pairs.len(), 1);
            assert_eq!(pairs[0].0, "state");
            assert_eq!(pairs[0].1, state);
        }
    }

    #[test]
    fn only_the_exact_gallery_opt_in_changes_navigation() {
        for enabled in [None, Some(""), Some("0"), Some("true"), Some(" 1"), Some("1 ")] {
            assert!(gallery_url(parse("http://localhost:5173/"), enabled, Some("loaded")).is_none());
        }
    }
}
