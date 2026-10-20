// UI conveniences around the generated Rust command contract.
import { copyFormatLabels } from "./messages";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { commands, type KeyFormat, type LibraryStatus } from "./bindings";

export type { Copied, LibraryStatus, RecordId, SearchResult, ShortcutStatus } from "./bindings";
export type CopyFormat = KeyFormat;

export const {
  chooseLibrary,
  useZotero,
  reloadLibrary,
  libraryStatus,
  hidePicker,
  quit,
  shortcutStatus,
  copyCitation,
  copyFormat,
} = commands;

let searchRequest = 0;

// The limit default and the request number are not part of the UI's API: each
// search is numbered so the app can stop searches for outdated queries.
export function search(query: string, limit = 20) {
  searchRequest += 1;
  return commands.search(query, limit, searchRequest);
}

/** Called whenever the picker is shown by the global shortcut or a second launch. */
export function onPickerShown(handler: () => void): Promise<UnlistenFn> {
  return listen("picker:shown", handler);
}

/** Called when a library finishes opening, or fails to open. */
export function onLibraryChanged(handler: (status: LibraryStatus) => void): Promise<UnlistenFn> {
  return listen<LibraryStatus>("library:changed", (event) => handler(event.payload));
}

export const COPY_FORMATS = Object.entries(copyFormatLabels).map(([value, label]) => ({
  value: value as KeyFormat,
  label,
}));
