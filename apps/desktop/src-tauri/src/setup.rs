//! First-run setup: what Ibis can offer to read, found without reading it.
//!
//! Zotero is asked whether it is open through its local API root, which
//! reads no library. `.bib` files are found by name in the usual document
//! folders. The interface sees each file's name and folder name only, and
//! opens one by its place in the list, so it never sends a path to open.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use ibis_core::find;
use ibis_core::zotero::api::{self, Presence};
use ibis_zotero_local::LocalZotero;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::library::{Source, start_open};

/// The files last offered, so a choice names one by its place in the list.
#[derive(Default)]
pub(crate) struct Offered(pub(crate) Mutex<Vec<PathBuf>>);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ZoteroPresence {
    Available,
    AccessOff,
    Absent,
}

/// A `.bib` file found on this computer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
pub(crate) struct FoundFile {
    /// The file name, such as `refs.bib`.
    pub(crate) name: String,
    /// The name of the folder holding it, without the rest of its path.
    pub(crate) folder: String,
}

/// What first-run setup can offer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
pub(crate) struct Sources {
    pub(crate) zotero: ZoteroPresence,
    pub(crate) files: Vec<FoundFile>,
}

fn presence(found: Presence) -> ZoteroPresence {
    match found {
        Presence::Available => ZoteroPresence::Available,
        Presence::AccessOff => ZoteroPresence::AccessOff,
        Presence::Absent => ZoteroPresence::Absent,
    }
}

fn shown(path: &Path) -> FoundFile {
    let name = |p: Option<&Path>| {
        p.and_then(Path::file_name)
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    FoundFile {
        name: name(Some(path)),
        folder: name(path.parent()),
    }
}

/// Find what setup can offer: whether Zotero is open, and `.bib` files in
/// the documents, desktop and downloads folders.
#[tauri::command]
#[specta::specta]
pub(crate) async fn find_sources(app: AppHandle) -> Result<Sources, String> {
    let paths = app.path();
    let roots: Vec<PathBuf> = [paths.document_dir(), paths.desktop_dir(), paths.download_dir()]
        .into_iter()
        .flatten()
        .collect();
    let (zotero, found) = tauri::async_runtime::spawn_blocking(move || {
        (api::presence(&mut LocalZotero::default()), find::bib_files(&roots))
    })
    .await
    .map_err(|_| "looking for libraries stopped unexpectedly".to_string())?;
    let paths: Vec<PathBuf> = found.into_iter().map(|f| f.path).collect();
    let files = paths.iter().map(|p| shown(p)).collect();
    if let Ok(mut offered) = app.state::<Offered>().0.lock() {
        *offered = paths;
    }
    Ok(Sources {
        zotero: presence(zotero),
        files,
    })
}

/// Open the file at `index` in the list [`find_sources`] last returned and
/// remember it; the result arrives as `library:changed`.
#[tauri::command]
#[specta::specta]
pub(crate) fn open_found_library(app: AppHandle, offered: State<'_, Offered>, index: u32) -> Result<(), String> {
    let path = offered
        .0
        .lock()
        .ok()
        .and_then(|paths| paths.get(index as usize).cloned())
        .ok_or("That file is no longer offered; look for libraries again")?;
    start_open(&app, Source::File(path), true);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_found_file_is_shown_by_name_and_folder_name_only() {
        let path = PathBuf::from("/synthetic/home/Documents/thesis/refs.bib");
        assert_eq!(
            shown(&path),
            FoundFile {
                name: "refs.bib".into(),
                folder: "thesis".into()
            }
        );
        assert_eq!(presence(Presence::AccessOff), ZoteroPresence::AccessOff);
    }
}
