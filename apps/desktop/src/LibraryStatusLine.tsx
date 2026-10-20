import { useEffect, useState } from "react";
import type { LibraryStatus, ZoteroLibrary } from "./bindings";
import { appLocale, libraryMessages, pickerText } from "./messages";

/** Done, Look or Stop for the footer dot; words carry the same meaning. */
export function libraryHealth(library: LibraryStatus | null | undefined): "done" | "look" | "stop" | "idle" {
  if (library === null || library?.error) return "stop";
  if (!library?.has_snapshot) return "idle";
  return library.warnings > 0 || library.references === 0 ? "look" : "done";
}

const lists = new Intl.ListFormat(appLocale, { style: "long", type: "conjunction" });

/** "My Library and Lab group", naming groups once their names are known. */
export function zoteroLibraryNames(status: LibraryStatus, groupName: (id: number) => string) {
  const names = status.zotero_libraries.map((choice: ZoteroLibrary) =>
    typeof choice === "object" ? groupName(choice.group) : pickerText.myLibrary);
  return names.length > 0 ? lists.format(names) : pickerText.myLibrary;
}

/** Re-renders only its user, so a relative time stays right while the picker
 * is open: every 30 seconds while visible, and at once when shown again. */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const tick = () => setTick((n) => n + 1);
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") tick(); }, 30_000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, []);
}

/**
 * The footer's library item: a dot, the source and count, and an age only when
 * it matters (just updated, or an older copy kept after a failure). The full
 * detail is the tooltip; the live region holds no clock, so it is not repeated
 * every minute.
 */
export function LibraryStatusLine({ library, groupName }: {
  library: LibraryStatus | null | undefined; groupName: (id: number) => string;
}) {
  useMinuteTick();
  const now = Date.now();
  const health = libraryHealth(library);
  const age = libraryMessages.age(library, now);
  const detail = libraryMessages.detail(library, now, (status) => zoteroLibraryNames(status, groupName));
  return (
    <span className="library-status" data-health={health} title={detail}>
      <span className="status-dot" data-health={health} aria-hidden="true" />
      <span className="library-words">
        <span className="library-name" role="status" aria-label={pickerText.libraryStatus} aria-live="polite" aria-atomic="true">
          {libraryMessages.summary(library)}
        </span>
        {age && <span className="library-age"> · {age}</span>}
      </span>
    </span>
  );
}
