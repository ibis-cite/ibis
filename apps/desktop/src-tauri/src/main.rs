//! Ibis desktop app: a thin Tauri shell over `ibis-core`.
//!
//! The window is the picker. All behaviour that can be tested without a
//! window lives in `ibis-core`; this file only translates between the web
//! interface and the core.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Mutex;

use ibis_core::bibtex;
use ibis_core::model::{LoadResult, Reference};
use ibis_core::search::Index;
use serde::Serialize;
use tauri::State;

/// The library currently open in the app.
#[derive(Default)]
struct Library {
    path: Option<PathBuf>,
    loaded: LoadResult,
}

#[derive(Serialize)]
struct LibraryStatus {
    path: Option<String>,
    references: usize,
    warnings: usize,
}

#[derive(Serialize)]
struct SearchResult {
    key: String,
    title: String,
    authors: String,
    year: Option<i32>,
    matched: Vec<String>,
}

impl SearchResult {
    fn from(reference: &Reference, matched: Vec<String>) -> Self {
        SearchResult {
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

fn status(library: &Library) -> LibraryStatus {
    LibraryStatus {
        path: library.path.as_ref().map(|p| p.display().to_string()),
        references: library.loaded.references.len(),
        warnings: library.loaded.warnings.len(),
    }
}

/// Load a BibTeX/BibLaTeX file read-only and make it the open library.
#[tauri::command]
fn open_library(path: String, library: State<'_, Mutex<Library>>) -> Result<LibraryStatus, String> {
    let path = PathBuf::from(path);
    let text = std::fs::read_to_string(&path).map_err(|e| format!("cannot read the library file: {e}"))?;
    let source = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
    let loaded = bibtex::load_str(&source.to_string_lossy(), &text);
    let mut library = library.lock().map_err(|_| "library state is unavailable".to_string())?;
    *library = Library {
        path: Some(path),
        loaded,
    };
    Ok(status(&library))
}

/// Search the open library. An empty query returns no results.
#[tauri::command]
fn search(query: String, limit: usize, library: State<'_, Mutex<Library>>) -> Result<Vec<SearchResult>, String> {
    let library = library.lock().map_err(|_| "library state is unavailable".to_string())?;
    if library.path.is_none() {
        return Err("no library is open".to_string());
    }
    let index = Index::new(&library.loaded.references);
    Ok(index
        .search(&query, limit.min(200))
        .into_iter()
        .map(|hit| {
            let matched = hit.matched.iter().map(|m| format!("{m:?}").to_lowercase()).collect();
            SearchResult::from(hit.reference, matched)
        })
        .collect())
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Mutex::new(Library::default()))
        .invoke_handler(tauri::generate_handler![open_library, search])
        .setup(|app| {
            // Development convenience until settings (#2) exist: open the
            // library named by IBIS_LIBRARY, if set.
            if let Ok(path) = std::env::var("IBIS_LIBRARY") {
                let state = tauri::Manager::state::<Mutex<Library>>(app);
                if let Err(err) = open_library(path, state) {
                    eprintln!("ibis: {err}");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!());
    if let Err(err) = app {
        eprintln!("ibis: the app could not start: {err}");
        std::process::exit(1);
    }
}
