import { useState } from "react";
import type { SearchResult } from "../../api";
import { provisional, type FormattedCitation } from "../../format/formatted";
import { render } from "../../format/markup";
import type { StyleId } from "../../format/styles";
import { pickerText } from "../../messages";

/** The shelf shows at most this many chips; the rest fold into "+N"
 * (docs/design/preview.md, "Chips before the count"). */
export const SHELF_CHIPS = 6;

/** "García 2021": the first author's family name and the year, or the key
 * when the record names neither. */
export function chipLabel(r: SearchResult): string {
  const label = [r.first_author, r.year ?? ""].join(" ").trim();
  return label || r.key;
}

/** Chip labels, with the key added to any label that two chips share. */
export function chipLabels(records: SearchResult[]): string[] {
  const labels = records.map(chipLabel);
  return labels.map((label, i) =>
    labels.indexOf(label) !== labels.lastIndexOf(label) && label !== records[i]!.key ? `${label} · ${records[i]!.key}` : label);
}

/** What Enter pastes, above the footer's Copy action (docs/design/preview.md):
 * a line of chips for the references chosen with Shift+Enter, then the exact
 * output on one line. Results above never move when a reference is added. */
export function CitationShelf({ announce, selected, removeLabel, onRemove, style, keys, shown, focusable }: {
  /** False until the selection first changes, so opening the picker is silent. */
  announce: boolean;
  selected: Map<string, SearchResult>;
  removeLabel: (r: SearchResult) => string;
  onRemove: (r: SearchResult) => void;
  /** The citation style, when one is chosen. */
  style: StyleId | null;
  /** True for a citation-key syntax, which is shown in monospace. */
  keys: boolean;
  /** What Enter would copy; null while it is being made, undefined when there is nothing to show. */
  shown: FormattedCitation | "failed" | "stale" | null | undefined;
  /** A built citation can be focused, to read it whole. */
  focusable: boolean;
}) {
  const records = [...selected.values()];
  const keysOf = [...selected.keys()];
  const labels = chipLabels(records);
  // More than SHELF_CHIPS fold into "+N", which shows every chip on a few
  // scrolling lines, so each chosen reference can always be removed here.
  const [expanded, setExpanded] = useState(false);
  if (expanded && selected.size === 0) setExpanded(false);
  const folded = records.length > SHELF_CHIPS ? records.length - SHELF_CHIPS : 0;
  const shownChips = folded > 0 && !expanded ? records.slice(0, SHELF_CHIPS) : records;
  return (
    <>
      <p className="visually-hidden" role="status" aria-label={pickerText.citationSelection} aria-live="polite" aria-atomic="true">
        {announce ? pickerText.selectionCount(selected.size) : ""}
      </p>
      {(records.length > 0 || shown !== undefined) && (
        <div className="shelf">
          {records.length > 0 && (
            <ul className="shelf-chips" aria-label={pickerText.selectedReferences} data-expanded={(folded > 0 && expanded) || undefined}>
              {shownChips.map((r, i) => (
                <li key={keysOf[i]} className="chip" title={r.key}>
                  <bdi className="chip-label">{labels[i]}</bdi>
                  <button type="button" className="chip-remove" onClick={() => onRemove(r)} aria-label={removeLabel(r)} />
                </li>
              ))}
              {folded > 0 && (
                <li className="chip-more">
                  <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
                    aria-label={expanded ? pickerText.fewerChosen : pickerText.allChosen(records.length)}>
                    {expanded ? pickerText.fewerChosenShort : pickerText.moreChosen(folded)}
                  </button>
                </li>
              )}
            </ul>
          )}
          {shown !== undefined && (
            <section aria-label={pickerText.preview} className="shelf-output" data-keys={keys || undefined}
              data-state={shown === null || typeof shown === "string" ? (shown ?? "pending") : undefined}
              tabIndex={focusable && shown && typeof shown === "object" ? 0 : undefined}>
              <span className="shelf-mark" aria-hidden="true">{"“"}</span>
              {shown === null && <p role="status">{pickerText.previewPending}</p>}
              {shown === "failed" && <p role="alert">{pickerText.previewError}</p>}
              {shown === "stale" && <p role="status">{pickerText.shelfStale}</p>}
              {shown && typeof shown === "object" && (
                <>
                  <bdi dir={keys ? "ltr" : "auto"} className="preview-text" title={shown.text}>
                    {shown.markup.length > 0 ? render(shown.markup) : shown.text}
                  </bdi>
                  {style && provisional(style) && (
                    <span className="shelf-pill" title={pickerText.provisional}>
                      <span aria-hidden="true">{pickerText.provisionalShort}</span>
                      <span className="visually-hidden">{pickerText.provisional}</span>
                    </span>
                  )}
                  {shown.warnings.length > 0 && (
                    <span className="shelf-pill" title={shown.warnings.join("\n")}>
                      <span aria-hidden="true">{pickerText.warningCount(shown.warnings.length)}</span>
                      <span className="visually-hidden">{shown.warnings.join(" ")}</span>
                    </span>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}
