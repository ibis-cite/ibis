import type React from "react";
import type { LibraryStatus } from "../../api";
import { libraryMessages, pickerText } from "../../messages";

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
  if (!library?.name) return <div className="empty-state">{library?.state === "none" ? setup : null}</div>;
  const empty = library.has_snapshot && library.references === 0;
  const title = empty ? libraryMessages.emptyTitle(library.snapshot_name)
    : query ? pickerText.noMatches : pickerText.typeToFind;
  const description = empty ? libraryMessages.emptyHint(library.zotero)
    : query ? pickerText.noMatchesHint : pickerText.typeToFindHint;
  return (
    <div className="empty-state empty-template">
      <svg className="empty-icon" aria-hidden="true" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {empty ? <path d="M5 3h9l5 5v13H5zM14 3v5h5M8 12h8M8 16h6" />
          : <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>}
      </svg>
      <p className="empty-title">{title}</p>
      <p className="empty-description">{description}</p>
      {empty ? <div className="empty-actions">
        {library.zotero && <button type="button" onClick={onReload}>{pickerText.reload}</button>}
        <button type="button" onClick={onChooseLibrary}>{pickerText.chooseLibrary}</button>
      </div> : query ? <div className="empty-actions">
        <button type="button" onClick={onClearSearch}>{pickerText.clearSearch}</button>
        {narrowed && <button type="button" onClick={onSearchAll}>{pickerText.searchAllLibraries}</button>}
      </div> : null}
    </div>
  );
}
