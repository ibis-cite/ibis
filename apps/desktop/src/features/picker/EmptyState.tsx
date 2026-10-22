import type React from "react";
import type { LibraryStatus } from "../../api";
import { keysFor } from "../../keys";
import { keyText, libraryMessages, pickerText } from "../../messages";
import { KeyHint } from "../../ui/KeyCaps";

/** Keep the start and extension without letting an unusually long name
 * push the recovery actions down the page. Older webviews keep the full
 * name rather than guessing where a grapheme can be split. */
function shortName(name: string | null): string | null {
  if (!name) return null;
  if (typeof Intl.Segmenter !== "function") return name;
  const parts = Array.from(new Intl.Segmenter().segment(name), ({ segment }) => segment);
  return parts.length > 40 ? `${parts.slice(0, 20).join("")}…${parts.slice(-19).join("")}` : name;
}

/** What the result list says when it has no rows: an empty library, no
 * matches and what to try next, a hint to type, or first-run setup. */
export function EmptyState({ library, query, narrowed, onChooseLibrary, onClearSearch, onSearchAll, onReload, setup }: {
  library: LibraryStatus | null;
  query: string;
  /** Some Zotero libraries are left out of the search, so searching all may help. */
  narrowed: boolean;
  onChooseLibrary: () => void;
  onClearSearch: () => void;
  onSearchAll: () => void;
  onReload: () => void;
  /** Shown while no library is chosen. */
  setup: React.ReactNode;
}) {
  if (!library) return <div className="empty-state" />;
  const loading = library.state === "loading" || library.state === "reloading";
  if (!library.name && !loading) return <div className="empty-state">{library.state === "none" ? setup : null}</div>;
  const empty = !loading && library.has_snapshot && library.references === 0;
  const progress = library.state === "reloading" ? libraryMessages.reloading : libraryMessages.opening;
  const fullTitle = loading ? progress(library.name) : libraryMessages.emptyTitle(library.snapshot_name || null);
  const title = loading ? progress(shortName(library.name)) : empty ? libraryMessages.emptyTitle(shortName(library.snapshot_name))
    : query ? pickerText.noMatches : pickerText.typeToFind;
  const description = loading ? pickerText.loadingHint : empty ? libraryMessages.emptyHint(library.zotero)
    : query ? pickerText.noMatchesHint : pickerText.typeToFindHint;
  return (
    <div className="empty-state empty-template">
      <svg className="empty-icon" aria-hidden="true" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {empty || loading ? <path d="M5 3h9l5 5v13H5zM14 3v5h5M8 12h8M8 16h6" />
          : <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>}
      </svg>
      <p className="empty-title" dir="auto" role={loading ? "status" : undefined}>{(empty || loading) && title !== fullTitle ? <>
        <span aria-hidden="true">{title}</span><span className="visually-hidden">{fullTitle}</span>
      </> : title}</p>
      <p className="empty-description">{description}</p>
      {loading || empty ? <div className="empty-actions">
        {empty && library.zotero && <button type="button" className="suggested-action" onClick={onReload}>{pickerText.reload}</button>}
        <button type="button" className={empty && library.zotero ? "empty-alternative" : "suggested-action"} onClick={onChooseLibrary}>{pickerText.chooseLibrary}</button>
      </div> : query ? <div className="empty-actions">
        <button type="button" className="suggested-action" onClick={onClearSearch}>{pickerText.clearSearch}</button>
        {narrowed && <button type="button" className="empty-alternative" onClick={onSearchAll}>{pickerText.searchAllLibraries}</button>}
      </div> : <div className="empty-actions">
        <button type="button" className="suggested-action" onClick={onClearSearch}>{pickerText.searchLabel}</button>
      </div>}
      {!loading && !empty && !query && <div className="empty-keys" aria-hidden="true">
        <KeyHint label={keyText.copy} keys={keysFor("copy")} />
        <KeyHint label={keyText.addToCitation} keys={keysFor("add")} />
      </div>}
    </div>
  );
}
