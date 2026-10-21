import type React from "react";
import type { LibraryStatus } from "../../api";
import { keysFor } from "../../keys";
import { keyText, libraryMessages, pickerText } from "../../messages";
import { KeyHint } from "../../ui/KeyCaps";

/** What the result list says when it has no rows: an empty library, no
 * matches and what to try next, a hint to type, or first-run setup. */
export function EmptyState({ library, query, narrowed, onChooseLibrary, onClearSearch, onSearchAll, setup }: {
  library: LibraryStatus | null;
  query: string;
  /** Some Zotero libraries are left out of the search, so searching all may help. */
  narrowed: boolean;
  onChooseLibrary: () => void;
  onClearSearch: () => void;
  onSearchAll: () => void;
  /** Shown while no library is chosen. */
  setup: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      {library?.name ? (
        library.has_snapshot && library.references === 0
          ? <>
            <p>{libraryMessages.empty(library.snapshot_name, library.zotero)}</p>
            <button type="button" onClick={onChooseLibrary}>{pickerText.chooseLibrary}</button>
          </>
          : query
            ? <>
              <p>{pickerText.noMatches}</p>
              <p className="empty-hint">{pickerText.noMatchesHint}</p>
              <div className="empty-actions">
                <button type="button" onClick={onClearSearch}>{pickerText.clearSearch}</button>
                {narrowed && <button type="button" onClick={onSearchAll}>{pickerText.searchAllLibraries}</button>}
              </div>
            </>
            : <><p>{pickerText.typeToFind}</p><p className="empty-hint">{pickerText.typeToFindHint}</p>
              {/* The first keys to learn, in the footer's hint pattern; decorative,
                  since the keys dialog and More say the same in words. */}
              <p className="empty-keys" aria-hidden="true">
                <KeyHint label={keyText.copyShort} keys={keysFor("copy")} />
                <KeyHint label={keyText.addShort} keys={keysFor("add")} />
              </p></>
      ) : library?.state === "none" ? setup : null}
    </div>
  );
}
