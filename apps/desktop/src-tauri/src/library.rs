//! The open library: loading off the main thread, the search command and
//! choosing or reloading the library file.

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use ibis_core::model::{LoadWarning, RecordId, Reference};
use ibis_core::search::OwnedIndex;
use ibis_core::source::{SourceWatch, load_library_file};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::picker::{DialogOpen, show_picker};
use crate::preferences::SettingsFile;
use crate::tray::{LibraryMenuItem, library_line};

/// The library currently open in the app, indexed once when it is opened.
#[derive(Default)]
pub(crate) struct Library {
    pub(crate) path: Option<PathBuf>,
    pub(crate) index: OwnedIndex,
    pub(crate) warnings: Vec<LoadWarning>,
    /// Why the last attempt to open a library failed, shown until one opens.
    pub(crate) error: Option<String>,
    /// A problem that is not a failure to open, such as an unsaved choice.
    pub(crate) note: Option<String>,
}

/// Counts requests to open a library, so a load that finishes after a newer
/// request never replaces the newer library.
#[derive(Default)]
pub(crate) struct LoadRequests(pub(crate) AtomicU64);

/// The platform watcher and its worker stop when replaced or the app exits.
#[derive(Default)]
pub(crate) struct LibraryWatch(pub(crate) Mutex<Option<SourceWatch>>);

/// Sent to the interface with the `library:changed` event.
#[derive(Clone, Serialize, specta::Type)]
pub(crate) struct LibraryStatus {
    /// File name only; the full path is never shown.
    pub(crate) name: Option<String>,
    pub(crate) references: usize,
    pub(crate) warnings: usize,
    pub(crate) error: Option<String>,
    /// Something to tell the user that is not a failure to open.
    pub(crate) note: Option<String>,
}

#[derive(Serialize, specta::Type)]
pub(crate) struct SearchResult {
    /// Identity of the record; selection and copying use this, not the key.
    id: RecordId,
    key: String,
    title: String,
    authors: String,
    year: Option<i32>,
    matched: Vec<String>,
}

impl SearchResult {
    fn from(reference: &Reference, matched: Vec<String>) -> Self {
        SearchResult {
            id: reference.id.clone(),
            key: reference
                .citekey
                .clone()
                .unwrap_or_else(|| reference.id.native_key.clone()),
            title: reference.title_plain().unwrap_or_default(),
            authors: reference
                .authors
                .iter()
                .map(|n| {
                    if n.literal.is_some() {
                        n.display()
                    } else {
                        n.family.clone().unwrap_or_default()
                    }
                })
                .collect::<Vec<_>>()
                .join(", "),
            year: reference.year(),
            matched,
        }
    }
}

/// Display-only details, excluding original source text and any executable markup.
#[derive(Serialize, specta::Type)]
pub(crate) struct ReferenceDetails {
    id: RecordId,
    title: String,
    authors: String,
    year: Option<i32>,
    kind: String,
    container: Option<String>,
    doi: Option<String>,
    url: Option<String>,
    abstract_text: Option<String>,
}

fn details_from(references: &[Reference], id: &RecordId) -> Result<ReferenceDetails, String> {
    let reference = references
        .iter()
        .find(|r| &r.id == id)
        .ok_or_else(|| "the reference is no longer in the library".to_string())?;
    let plain = |text: &Option<String>| text.as_deref().map(ibis_core::model::strip_markup);
    Ok(ReferenceDetails {
        id: reference.id.clone(),
        title: reference.title_plain().unwrap_or_default(),
        authors: reference
            .authors
            .iter()
            .map(|name| name.display())
            .collect::<Vec<_>>()
            .join("; "),
        year: reference.year(),
        kind: reference.item_type.clone(),
        container: plain(&reference.container_title),
        doi: reference.doi.clone(),
        url: reference.url.clone(),
        abstract_text: plain(&reference.abstract_text),
    })
}

/// Resolve a detail request against the current read-only library snapshot.
#[tauri::command]
#[specta::specta]
pub(crate) async fn reference_details(
    id: RecordId,
    library: State<'_, Mutex<Library>>,
) -> Result<ReferenceDetails, String> {
    let library = library.lock().map_err(|_| "library state is unavailable".to_string())?;
    details_from(library.index.references(), &id)
}

pub(crate) fn status(library: &Library) -> LibraryStatus {
    LibraryStatus {
        name: library
            .path
            .as_ref()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned()),
        references: library.index.references().len(),
        warnings: library.warnings.len(),
        error: library.error.clone(),
        note: library.note.clone(),
    }
}

/// Read, parse and index off the main thread. Initial loads tolerate damaged
/// entries; reloads retain the last good snapshot for demonstrably partial data.
pub(crate) fn load_library(path: PathBuf, reload: bool) -> Result<Library, String> {
    let loaded = load_library_file(&path, reload).map_err(|error| error.to_string())?;
    Ok(candidate(path, loaded))
}

fn candidate(path: PathBuf, loaded: ibis_core::model::LoadResult) -> Library {
    Library {
        path: Some(path),
        index: OwnedIndex::new(loaded.references),
        warnings: loaded.warnings,
        error: None,
        note: None,
    }
}

fn publish(app: &AppHandle, status: LibraryStatus) {
    for message in status.error.iter().chain(&status.note) {
        eprintln!("ibis: {message}");
    }
    if let Some(item) = app.try_state::<LibraryMenuItem>() {
        let _ = item.0.set_text(library_line(&status));
    }
    let _ = app.emit("library:changed", status);
}

fn watch_current(app: &AppHandle, request: u64) {
    let path = app
        .state::<Mutex<Library>>()
        .lock()
        .ok()
        .and_then(|library| library.path.clone());
    let Some(path) = path else {
        return;
    };
    let handle = app.clone();
    let selected = path.clone();
    let watch = SourceWatch::new(&path, move |loaded| {
        let loaded = loaded
            .map(|loaded| candidate(selected.clone(), loaded))
            .map_err(|e| e.to_string());
        if let Some(status) = install(&handle.state(), &handle.state(), request, loaded) {
            publish(&handle, status);
        }
    });
    let state = app.state::<LibraryWatch>();
    if let Ok(mut current) = state.0.lock() {
        if app.state::<LoadRequests>().0.load(Ordering::SeqCst) != request {
            return;
        }
        match watch {
            Ok(watch) => *current = Some(watch),
            Err(error) => {
                if let Some(status) = install(&app.state(), &app.state(), request, Err(error.to_string())) {
                    publish(app, status);
                }
            }
        }
    }
}

/// Start opening a library in the background. The request is numbered here,
/// synchronously and in the order requests arrive, so a load that finishes
/// after a newer request is discarded. The outcome reaches the interface as
/// the `library:changed` event.
///
/// With `remember`, a library that opens becomes the one opened at start.
pub(crate) fn start_open(app: &AppHandle, path: PathBuf, remember: bool) {
    let request = app.state::<LoadRequests>().0.fetch_add(1, Ordering::SeqCst) + 1;
    let reload = app
        .state::<Mutex<Library>>()
        .lock()
        .is_ok_and(|library| library.path.as_ref() == Some(&path));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let chosen = path.clone();
        let loaded = tauri::async_runtime::spawn_blocking(move || load_library(path, reload))
            .await
            .unwrap_or_else(|_| Err("loading the library stopped unexpectedly".to_string()));
        let current = install(&app.state(), &app.state(), request, loaded);
        if let Some(mut status) = current {
            if remember && status.error.is_none() {
                let saved = app.state::<SettingsFile>().update(|s| s.library = Some(chosen));
                if let Err(e) = saved {
                    let note = format!("the library opened but could not be saved for next time: {e}");
                    if let Ok(mut library) = app.state::<Mutex<Library>>().lock() {
                        library.note = Some(note.clone());
                    }
                    status.note = Some(note);
                    // The choice may have come from the tray; make sure it is seen.
                    show_picker(&app);
                }
            }
            publish(&app, status);
            // Reattach even after a failed choice so the retained source keeps updating.
            watch_current(&app, request);
        }
    });
}

/// Show the system file dialog and open the chosen library. Cancelling
/// changes nothing.
pub(crate) fn choose_library_file(app: &AppHandle) {
    // The dialog belongs to the picker: show the picker (the request may come
    // from the tray), attach the dialog to it, and keep the picker open while
    // the dialog has the focus.
    show_picker(app);
    if !app.state::<DialogOpen>().begin() {
        return; // a dialog is already open on the picker
    }
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Choose a BibTeX or BibLaTeX library")
        .add_filter("BibTeX and BibLaTeX", &["bib"]);
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let handle = app.clone();
    dialog.pick_file(move |picked| {
        handle.state::<DialogOpen>().end();
        match picked.map(|p| p.into_path()) {
            None => {}
            Some(Ok(path)) => start_open(&handle, path, true),
            Some(Err(_)) => {
                let _ = handle.emit(
                    "library:changed",
                    LibraryStatus {
                        error: Some("the chosen file is not on this computer".to_string()),
                        ..current_status(&handle)
                    },
                );
            }
        }
    });
}

pub(crate) fn current_status(app: &AppHandle) -> LibraryStatus {
    app.state::<Mutex<Library>>()
        .lock()
        .map(|l| status(&l))
        .unwrap_or_else(|_| LibraryStatus {
            name: None,
            references: 0,
            warnings: 0,
            error: Some("library state is unavailable".to_string()),
            note: None,
        })
}

/// Open the current library file again, for example after editing it.
pub(crate) fn reload_library_file(app: &AppHandle) {
    let path = app.state::<Mutex<Library>>().lock().ok().and_then(|l| l.path.clone());
    match path {
        Some(path) => start_open(app, path, false),
        None => choose_library_file(app),
    }
}

/// Make a loaded library current, or record why it failed to open. Returns
/// `None` when a newer request has been made since this one.
pub(crate) fn install(
    library: &Mutex<Library>,
    requests: &LoadRequests,
    request: u64,
    loaded: Result<Library, String>,
) -> Option<LibraryStatus> {
    let mut library = library.lock().ok()?;
    if requests.0.load(Ordering::SeqCst) != request {
        return None;
    }
    match loaded {
        Ok(new) => *library = new,
        Err(error) => library.error = Some(error),
    }
    Some(status(&library))
}

/// Choose a library with the system file dialog. The interface never passes
/// file paths; the result arrives as the `library:changed` event.
#[tauri::command]
#[specta::specta]
pub(crate) fn choose_library(app: AppHandle) {
    choose_library_file(&app);
}

/// Open the current library again; the result arrives as `library:changed`.
#[tauri::command]
#[specta::specta]
pub(crate) fn reload_library(app: AppHandle) {
    reload_library_file(&app);
}

/// The library as it is now, for the interface when it starts.
#[tauri::command]
#[specta::specta]
pub(crate) fn library_status(app: AppHandle) -> LibraryStatus {
    current_status(&app)
}

/// Search the open library. An empty query returns no results. Async so it
/// runs off the main thread.
#[tauri::command]
#[specta::specta]
pub(crate) async fn search(
    query: String,
    limit: usize,
    library: State<'_, Mutex<Library>>,
) -> Result<Vec<SearchResult>, String> {
    let library = library.lock().map_err(|_| "library state is unavailable".to_string())?;
    search_library(&library, &query, limit)
}

fn search_library(library: &Library, query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
    if library.path.is_none() {
        return Err(match &library.error {
            Some(error) => format!("the library could not be opened: {error}"),
            None => "no library is open".to_string(),
        });
    }
    Ok(library
        .index
        .search(query, limit.min(200))
        .into_iter()
        .map(|hit| {
            let matched = hit.matched.iter().map(|m| format!("{m:?}").to_lowercase()).collect();
            SearchResult::from(hit.reference, matched)
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "manual synthetic scale measurement; no machine-dependent timing assertion"]
    fn search_100000_references() {
        use std::time::Instant;
        let seed = ibis_core::bibtex::load_str("synthetic.bib", "@article{seed,title={Synthetic research 睡眠 والذاكرة},author={García, Alex},year={2024},abstract={A synthetic summary for scale measurement}}")
            .references.remove(0);
        let references = (0..100_000)
            .map(|i| {
                let mut reference = seed.clone();
                reference.id.native_key = format!("ref{i}");
                reference.citekey = Some(format!("ref{i}"));
                reference
            })
            .collect();
        let start = Instant::now();
        let library = Library {
            path: Some(PathBuf::from("synthetic.bib")),
            index: OwnedIndex::new(references),
            ..Library::default()
        };
        eprintln!("scale: records=100000 index_ms={}", start.elapsed().as_millis());
        for query in ["research", "睡眠", "ref99999", "missing"] {
            let start = Instant::now();
            let mut bytes = 0;
            let mut count = 0;
            for _ in 0..10 {
                let found = search_library(&library, query, 200).unwrap_or_else(|e| panic!("{e}"));
                count = found.len();
                bytes = serde_json::to_vec(&found).unwrap_or_else(|e| panic!("{e}")).len();
                assert!(count <= 200);
                if query == "ref99999" {
                    assert_eq!(found.first().map(|r| r.key.as_str()), Some("ref99999"));
                }
            }
            eprintln!(
                "scale: case={} mean_us={} results={} payload_bytes={}",
                if query == "research" {
                    "many"
                } else if query == "睡眠" {
                    "nonlatin"
                } else if query == "missing" {
                    "none"
                } else {
                    "exact"
                },
                start.elapsed().as_micros() / 10,
                count,
                bytes
            );
        }
    }

    #[test]
    fn details_resolve_full_identity_and_return_plain_display_text() {
        let mut loaded = ibis_core::bibtex::load_str(
            "a.bib",
            "@article{same, title={Protected {NASA} <b>title</b>}, author={Smith, Alex}, journal={Journal}, abstract={Synthetic summary}, doi={10.0000/example}, url={https://example.invalid}}\n",
        );
        let id = loaded.references[0].id.clone();
        let details = details_from(&loaded.references, &id).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(details.id, id);
        assert!(details.title.contains("<b>title</b>")); // literal source angles remain literal text
        loaded.references[0].title = Some("<i>Rich</i> &amp; protected".into());
        assert_eq!(
            details_from(&loaded.references, &id).map(|d| d.title),
            Ok("Rich & protected".into())
        );
        assert_eq!(details.authors, "Alex Smith");
        assert_eq!(details.abstract_text.as_deref(), Some("Synthetic summary"));
        assert!(
            details_from(
                &loaded.references,
                &RecordId {
                    source: "other.bib".into(),
                    native_key: "same".into()
                }
            )
            .is_err()
        );
    }

    #[test]
    fn only_regular_files_are_read() {
        assert!(ibis_core::source::read_library_file(std::path::Path::new(".")).is_err());
        #[cfg(unix)]
        assert!(ibis_core::source::read_library_file(std::path::Path::new("/dev/zero")).is_err());
        let file = std::env::temp_dir().join(format!("ibis-read-{}.bib", std::process::id()));
        std::fs::write(&file, "@misc{k}").unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(ibis_core::source::read_library_file(&file).as_deref(), Ok("@misc{k}"));
    }

    #[test]
    fn a_loaded_library_is_indexed_once_and_searchable() {
        let file = std::env::temp_dir().join(format!("ibis-load-{}.bib", std::process::id()));
        std::fs::write(&file, "@article{smith2020, title={Sleep and memory}}\n@article{bad,\n")
            .unwrap_or_else(|e| panic!("{e}"));
        let library = load_library(file, false).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(library.index.references().len(), 1);
        assert_eq!(library.warnings.len(), 1);
        assert_eq!(library.index.search("sleep", 10).len(), 1);
        assert!(load_library(std::env::temp_dir().join("ibis-missing-library.bib"), false).is_err());
    }

    #[test]
    fn failed_reloads_preserve_the_index_but_valid_empty_reloads_replace_it() {
        let file = std::env::temp_dir().join(format!("ibis-reload-{}.bib", std::process::id()));
        std::fs::write(&file, "@misc{good, title={Retained}}").unwrap_or_else(|e| panic!("{e}"));
        let initial = load_library(file.clone(), false).unwrap_or_else(|e| panic!("{e}"));
        let library = Mutex::new(initial);
        let requests = LoadRequests::default();
        for contents in ["@misc{partial,", "@string{incomplete = {Value}"] {
            std::fs::write(&file, contents).unwrap_or_else(|e| panic!("{e}"));
            let status = install(&library, &requests, 0, load_library(file.clone(), true));
            assert_eq!(status.as_ref().map(|s| s.references), Some(1));
            assert!(status.and_then(|s| s.error).is_some());
        }
        std::fs::remove_file(&file).unwrap_or_else(|e| panic!("{e}"));
        let unavailable = install(&library, &requests, 0, load_library(file.clone(), true));
        assert_eq!(unavailable.as_ref().map(|s| s.references), Some(1));
        assert!(unavailable.and_then(|s| s.error).is_some());
        std::fs::write(&file, "").unwrap_or_else(|e| panic!("{e}"));
        let empty = install(&library, &requests, 0, load_library(file.clone(), true));
        assert_eq!(empty.as_ref().map(|s| s.references), Some(0));
        assert!(empty.and_then(|s| s.error).is_none());
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn a_load_that_finishes_after_a_newer_request_is_discarded() {
        let library = Mutex::new(Library::default());
        let requests = LoadRequests::default();
        let named = |key: &str| Library {
            path: Some(PathBuf::from(format!("{key}.bib"))),
            ..Library::default()
        };
        requests.0.store(2, Ordering::SeqCst); // requests 1 and 2 were made, in that order
        assert!(install(&library, &requests, 2, Ok(named("newer"))).is_some());
        assert!(install(&library, &requests, 1, Ok(named("older"))).is_none());
        let current = library.lock().map(|l| l.path.clone()).unwrap_or_default();
        assert_eq!(current, Some(PathBuf::from("newer.bib")));
        let failed = install(&library, &requests, 2, Err("unreadable".into()));
        assert_eq!(failed.and_then(|s| s.error).as_deref(), Some("unreadable"));
    }
}
