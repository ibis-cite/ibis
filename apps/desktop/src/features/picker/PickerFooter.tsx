import type React from "react";
import type { LibraryStatus } from "../../api";
import { keysFor } from "../../keys";
import { LibraryStatusLine } from "../../LibraryStatusLine";
import { keyText, pickerText } from "../../messages";
import { KeyHint } from "../../ui/KeyCaps";

/** What the keys do now; null where a key does nothing. */
export type KeyHints = { enter: string | null; shiftEnter: string | null; escape: string };

/** The footer: library status, what Enter (or, with Alt held, the other keys)
 * does now, and the More button with its menu. */
export function PickerFooter({ library, groupName, hints, altHeld, searchFocused, more }: {
  library: LibraryStatus | null | undefined;
  groupName: (id: number) => string;
  hints: KeyHints;
  /** While Alt (⌥) is held, the footer shows the other keys instead of Enter. */
  altHeld: boolean;
  /** Search-box keys are hidden from screen readers while focus is elsewhere. */
  searchFocused: boolean;
  /** The More button and its menu. */
  more: React.ReactNode;
}) {
  return (
    <footer>
      <section aria-label={pickerText.libraryRegion} className="library-bar">
        <LibraryStatusLine library={library} groupName={groupName} />
        <small className="enter-hints" aria-label={keyText.footer} role="group">
          {altHeld ? <>
            {hints.shiftEnter && <span className="search-hint" aria-hidden={!searchFocused}><KeyHint primary label={hints.shiftEnter} keys={keysFor("add")} /></span>}
            <KeyHint label={hints.escape} keys={keysFor("escape")} />
          </> : <>
            {hints.enter && <span className="search-hint" aria-hidden={!searchFocused}><KeyHint primary label={hints.enter} keys={keysFor("copy")} /></span>}
            <KeyHint label={keyText.allKeys} keys={keysFor("keys")} />
          </>}
        </small>
        <span className="more">
          {more}
        </span>
        {library?.note && <p role="status">{library.note}</p>}
      </section>
    </footer>
  );
}
