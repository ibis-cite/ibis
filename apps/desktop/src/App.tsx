import { useEffect, useRef, useState } from "react";
import { Actions, actionsShortcut, composing, mac, secondaryShortcut, type PickerAction } from "./Actions";
import {
  COPY_FORMATS,
  chooseLibrary,
  libraryStatus,
  reloadLibrary,
  copyCitation,
  copyFormat,
  hidePicker,
  onLibraryChanged,
  onPickerShown,
  quit,
  search,
  shortcutStatus,
  type Copied,
  type CopyFormat,
  type LibraryStatus,
  type RecordId,
  type SearchResult,
  type ShortcutStatus,
} from "./api";

/** Selection is keyed by record identity, never by list position or citation key. */
function idKey(id: RecordId): string {
  return `${id.source}\u0000${id.native_key}`;
}

// The picker: search, choose one or more references, copy them as a citation.
export function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  // The query the shown results belong to; differs while a search is pending.
  const [resultsQuery, setResultsQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<Map<string, SearchResult>>(new Map());
  const [format, setFormat] = useState<CopyFormat>("pandoc");
  const [copied, setCopied] = useState<Copied | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [shortcut, setShortcut] = useState<ShortcutStatus | null>(null);
  // Changes whenever a library opens, so the current query is searched again.
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [library, setLibrary] = useState<LibraryStatus | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const closeActions = () => { dialog.current?.close(); setActionsOpen(false); input.current?.focus(); };

  // When the picker is shown, put the cursor in the search box with the
  // previous query selected, so typing replaces it.
  useEffect(() => {
    const focusSearch = () => {
      dialog.current?.close();
      setActionsOpen(false);
      input.current?.focus();
      input.current?.select();
    };
    const unlisten = onPickerShown(focusSearch);
    const unlistenLibrary = onLibraryChanged((status) => {
      setLibrary(status);
      setLibraryVersion((v) => v + 1);
    });
    libraryStatus()
      .then(setLibrary)
      .catch(() => setLibrary(null));
    shortcutStatus()
      .then(setShortcut)
      .catch(() => setShortcut(null));
    copyFormat()
      .then(setFormat)
      .catch(() => undefined);
    return () => {
      void unlisten.then((stop) => stop());
      void unlistenLibrary.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    let current = true;
    search(query)
      .then((found) => {
        if (current) {
          setResults(found);
          setResultsQuery(query);
          setActive(0);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        // Results of an earlier query must not sit beside this query's error.
        if (current) {
          setResults([]);
          setResultsQuery(query);
          setError(String(e));
        }
      });
    return () => {
      current = false;
    };
  }, [query, libraryVersion]);

  // Keep the highlighted result visible while moving with the arrow keys.
  useEffect(() => {
    document.getElementById(`result-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  // Success is brief; warnings stay available until explicitly dismissed.
  useEffect(() => {
    if (!copied || copied.warnings.length > 0) return;
    const timer = window.setTimeout(() => setCopied(null), 2400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const toggle = (result: SearchResult) => {
    setSelected((previous) => {
      const next = new Map(previous);
      if (!next.delete(idKey(result.id))) next.set(idKey(result.id), result);
      return next;
    });
  };

  // Copy the selection, or the highlighted result when nothing is selected.
  const copy = async () => {
    // Never copy a highlighted result that belongs to an earlier query.
    const current = resultsQuery === query ? results : [];
    const chosen = selected.size > 0 ? [...selected.values()] : current.slice(active, active + 1);
    if (chosen.length === 0) return;
    setCopied(null);
    setCopyError(null);
    let outcome: Copied;
    try {
      outcome = await copyCitation(
        chosen.map((r) => ({ id: r.id, locator: null })),
        format,
      );
    } catch (e: unknown) {
      setCopyError(String(e));
      return;
    }
    setCopied(outcome);
    setSelected(new Map());
    // Get out of the way so the user can paste, unless there is something to read.
    if (outcome.warnings.length === 0) void hidePicker();
  };

  const highlighted = resultsQuery === query ? results[active] : undefined;
  const canCopy = selected.size > 0 || !!highlighted;
  const actions: PickerAction[] = [
    { id: "copy", label: "Copy citation", shortcut: "↵", disabled: !canCopy, run: () => void copy() },
    { id: "selection", label: highlighted && selected.has(idKey(highlighted.id)) ? "Remove from selection" : "Add to selection",
      shortcut: mac ? "⌘↵" : "Ctrl+↵", disabled: !highlighted, run: () => { if (highlighted) toggle(highlighted); } },
    { id: "choose", label: "Choose library…", run: () => void chooseLibrary() },
    { id: "reload", label: "Reload library", disabled: !library?.name, run: () => void reloadLibrary() },
    ...COPY_FORMATS.map((f) => ({ id: `format-${f.value}`, label: `Copy as ${f.label}${format === f.value ? " (current)" : ""}`, run: () => setFormat(f.value) })),
    { id: "quit", label: "Quit Ibis", run: () => void quit() },
  ];

  return (
    <main
      onKeyDown={(e) => {
        if (composing(e)) return;
        if (actionsShortcut(e)) {
          e.preventDefault();
          setActionsOpen((open) => !open);
        } else if (e.key === "Escape") {
          e.preventDefault();
          void hidePicker();
        } else if (e.key === "q" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          void quit();
        }
      }}
    >
      {shortcut?.error && (
        <p role="status">
          {shortcut.registered
            ? `Your shortcut setting was not used: ${shortcut.error}.`
            : `The shortcut ${shortcut.shortcut} is not available: ${shortcut.error}.`}
        </p>
      )}
      <div className="search-bar" data-tauri-drag-region title="Drag the search bar edge to move the picker">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 5 5" />
        </svg>
        <label className="visually-hidden" htmlFor="search">
          Search references
        </label>
        <input
          id="search"
          type="search"
          placeholder="Search references…"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="results"
          aria-activedescendant={results[active] ? `result-${active}` : undefined}
          ref={input}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (composing(e)) return;
            if (secondaryShortcut(e)) {
              e.preventDefault();
              const secondary = actions[1];
              if (secondary && !secondary.disabled) secondary.run();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((i) => Math.min(Math.max(i + step, 0), Math.max(results.length - 1, 0)));
            } else if (e.key === "Enter" && e.shiftKey) {
              e.preventDefault();
              const result = resultsQuery === query ? results[active] : undefined;
              if (result) toggle(result);
            } else if (e.key === "Enter") {
              e.preventDefault();
              void copy();
            }
          }}
        />
      </div>
      <div className="notices">
        {error && <p role="alert">{error}</p>}
        {copyError && <p role="alert">Nothing was copied: {copyError}</p>}
        {copied && (
          <div role="status" className="copy-notice">
            <p>
              Copied <code>{copied.text}</code>
            </p>
            {copied.warnings.length > 0 && (
              <>
                <button type="button" className="dismiss" aria-label="Dismiss copy warnings" onClick={() => setCopied(null)}>
                  Dismiss
                </button>
                <ul aria-label="Copy warnings">
                  {copied.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
      {selected.size > 0 && (
        <ul aria-label="Selected references">
          {[...selected.entries()].map(([key, r]) => (
            <li key={key}>
              <code>{r.key}</code>{" "}
              <button type="button" onClick={() => toggle(r)} aria-label={`Remove ${r.key} from the selection`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="results-area">
        <div className="results-heading" aria-hidden="true">
          <span>References</span><span>{results.length > 0 ? `${results.length} results` : ""}</span>
        </div>
        <ul id="results" role="listbox" aria-label="Results" aria-multiselectable="true">
          {results.map((r, i) => (
            <li
              key={idKey(r.id)}
              id={`result-${i}`}
              role="option"
              aria-selected={selected.has(idKey(r.id))}
              data-active={i === active || undefined}
              onClick={() => {
                setActive(i);
                toggle(r);
              }}
            >
              <span className="result-text">
                <strong>{r.title}</strong>
                <span className="result-meta">
                  {r.authors} · {r.year ?? "n.d."}
                </span>
              </span>
              <code className="result-key">{r.key}</code>
            </li>
          ))}
        </ul>
        {results.length === 0 && !error && (
          <p className="empty-state">
            {library?.name ? (query ? "No matching references" : "Type to find a reference") : "Choose a library to get started"}
          </p>
        )}
      </div>
      <div className="library-notices">
        {library?.error && <p role="alert">The library could not be opened: {library.error}</p>}
        {library?.note && <p role="status">{library.note}</p>}
      </div>
      <footer>
        <section aria-label="Library" className="footer-context">
          <span className="library-name" title={library?.name ?? undefined}>
            {library?.name
              ? `${library.name}: ${library.references} references` +
                (library.warnings > 0 ? `, ${library.warnings} could not be read fully` : "")
              : "No library chosen"}
          </span>
          <label className="visually-hidden" htmlFor="format">Copy as</label>
          <select id="format" value={format} onChange={(e) => setFormat(e.target.value as CopyFormat)}>
            {COPY_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </section>
        <div className="footer-actions">
          <button type="button" disabled={!canCopy} onClick={() => void copy()}>Copy citation <kbd>↵</kbd></button>
          <button type="button" aria-haspopup="dialog" aria-expanded={actionsOpen} aria-keyshortcuts={mac ? "Meta+k" : "Control+k"}
            onClick={() => setActionsOpen(true)}>Actions <kbd>{mac ? "⌘K" : "Ctrl+K"}</kbd></button>
        </div>
      </footer>
      {actionsOpen && <Actions actions={actions} close={closeActions} dialog={dialog} />}

    </main>
  );
}
