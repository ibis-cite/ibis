//! Debug evidence entry point. The release application does not compile this module.

use tauri::Url;

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
