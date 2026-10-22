import { useEffect, useLayoutEffect, useRef, useState, type Ref, type RefObject } from "react";
import type { SearchResult } from "../../api";
import { provisional, type FormattedCitation } from "../../format/formatted";
import { render } from "../../format/markup";
import type { StyleId } from "../../format/styles";
import { pickerText } from "../../messages";
import { ChipDisclosure } from "../../ui/ChipDisclosure";
import { SelectedChipList } from "./SelectedChipList";
import { chipLabelParts } from "./chipLabels";
import "./CitationShelf.css";

/** The shelf shows at most this many chips; the rest fold into "+N"
 * (docs/design/preview.md, "Chips before the count"). */
export const SHELF_CHIPS = 6;

/** What Enter pastes, above the footer's Copy action (docs/design/preview.md):
 * a line of chips for the references chosen with Shift+Enter, then the exact
 * output on one line. Results above never move when a reference is added. */
export function CitationShelf({ announce, selected, removeLabel, onRemove, onReorder, fallbackFocusRef, style, keys, shown, focusable, outputRef }: {
  /** False until the selection first changes, so opening the picker is silent. */
  announce: boolean;
  selected: Map<string, SearchResult>;
  removeLabel: (r: SearchResult) => string;
  onRemove: (ids: ReadonlySet<string>) => void;
  onReorder: (ids: ReadonlySet<string>, target: string, position: "before" | "after") => void;
  fallbackFocusRef: RefObject<HTMLElement | null>;
  /** The citation style, when one is chosen. */
  style: StyleId | null;
  /** True for a citation-key syntax, which is shown in monospace. */
  keys: boolean;
  /** What Enter would copy; null while it is being made, undefined when there is nothing to show. */
  shown: FormattedCitation | "failed" | "stale" | null | undefined;
  /** A built citation can be focused, to read it whole. */
  focusable: boolean;
  outputRef?: Ref<HTMLElement>;
}) {
  const records = [...selected.values()];
  const ids = [...selected.keys()];
  const labels = chipLabelParts(records);
  const [expanded, setExpanded] = useState(false);
  const [visibleChips, setVisibleChips] = useState(SHELF_CHIPS);
  const strip = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const foldedFocus = useRef(false);
  const emptyFocus = useRef(false);
  const popupReturn = useRef<string | null | undefined>(undefined);
  useEffect(() => { if (selected.size === 0) setExpanded(false); }, [selected.size]);
  useLayoutEffect(() => {
    const band = strip.current;
    const sizing = measure.current;
    if (!band || !sizing) return;
    const fit = () => {
      const threshold = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--chip-count-only-width"));
      const countOnly = window.innerWidth < threshold;
      if (band.clientWidth <= 0 && !countOnly) return;
      const style = getComputedStyle(band);
      const gap = parseFloat(style.columnGap) || 0;
      const available = band.clientWidth - (parseFloat(style.paddingInlineStart) || 0) - (parseFloat(style.paddingInlineEnd) || 0);
      const calibration = [...sizing.children] as HTMLElement[];
      const minimum = calibration[0]?.getBoundingClientRect().width ?? 0;
      const target = calibration[1]?.getBoundingClientRect().width ?? 0;
      const sizingStyle = getComputedStyle(sizing);
      const pad = (parseFloat(sizingStyle.paddingInlineStart) || 0) + 2 * (parseFloat(sizingStyle.borderInlineStartWidth) || 0);
      const widths = calibration.slice(2).map((label) => {
        const author = label.querySelector<HTMLElement>(".shelf-author-measure")!.getBoundingClientRect().width;
        const year = label.querySelector("bdi")!.getBoundingClientRect().width;
        return Math.max(minimum, author + year + target + pad + (author > 0 && year > 0 ? gap : 0));
      });
      const capacity = Math.min(records.length, SHELF_CHIPS);
      let next = countOnly ? 0 : capacity;
      if (!countOnly && !(minimum > 0)) return;
      for (; next > 0; next--) {
        const overflow = records.length > next || expanded;
        if (overflow && !more.current) { next--; break; }
        const width = widths.slice(0, next).reduce((sum, width) => sum + width, 0) + Math.max(0, next - 1) * gap
          + (overflow ? more.current!.getBoundingClientRect().width + gap : 0);
        if (width <= available) break;
      }
      const hidden = [...(chips.current?.querySelectorAll<HTMLElement>("[data-chip-item]") ?? [])].slice(next);
      if (!expanded && hidden.some((chip) => chip.contains(document.activeElement))) foldedFocus.current = true;
      if (!expanded && next === records.length && more.current === document.activeElement && popupReturn.current === undefined) popupReturn.current = null;
      setVisibleChips(next);
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(band); observer?.observe(sizing);
    window.addEventListener("resize", fit);
    return () => { observer?.disconnect(); window.removeEventListener("resize", fit); };
  }, [selected, expanded, visibleChips]);
  useLayoutEffect(() => {
    if (foldedFocus.current && more.current) {
      foldedFocus.current = false;
      if (document.activeElement === document.body || strip.current?.contains(document.activeElement)) more.current.focus();
    }
    if (selected.size === 0 && emptyFocus.current) {
      emptyFocus.current = false;
      if (document.activeElement === document.body || strip.current?.contains(document.activeElement) || popup.current?.contains(document.activeElement)) fallbackFocusRef.current?.focus({ preventScroll: true });
    }
    if (!expanded && popupReturn.current !== undefined) {
      // Closing may remove the trigger after the fitting layout update. Let
      // React Aria restore it first; only replace a destination that vanished.
      const frame = requestAnimationFrame(() => {
        const id = popupReturn.current; popupReturn.current = undefined;
        if (more.current?.isConnected) return;
        if (document.activeElement === document.body || popup.current?.contains(document.activeElement)) {
          const rows = [...(chips.current?.querySelectorAll<HTMLElement>("[data-chip-item]") ?? [])];
          (rows.find((row) => row.dataset.chipId === id) ?? rows[0] ?? fallbackFocusRef.current)?.focus({ preventScroll: true });
        }
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [selected.size, visibleChips, expanded, fallbackFocusRef]);
  const remove = (keys: ReadonlySet<string>) => {
    emptyFocus.current = ids.every((id) => keys.has(id)) && Boolean(strip.current?.contains(document.activeElement) || popup.current?.contains(document.activeElement));
    onRemove(keys);
  };
  const folded = Math.max(0, records.length - visibleChips);
  return (
    <>
      <p className="visually-hidden" role="status" aria-label={pickerText.citationSelection} aria-live="polite" aria-atomic="true">
        {announce ? pickerText.selectionCount(selected.size) : ""}
      </p>
      {(records.length > 0 || shown !== undefined) && (
        <div className="shelf">
          {records.length > 0 && (
            <div ref={strip} className="shelf-chips">
              <div ref={measure} className="shelf-chip-measure" aria-hidden="true">
                <span className="shelf-chip-minimum" /><span className="shelf-chip-target" />
                {labels.slice(0, SHELF_CHIPS).map((label, index) => <span className="shelf-label-measure" key={ids[index]}>
                  <span className="shelf-author-measure">{label.author}</span><bdi>{label.year}{label.letter}</bdi>
                </span>)}
              </div>
              {visibleChips > 0 && <SelectedChipList label={pickerText.selectedReferences} selected={selected} visibleCount={visibleChips} listRef={chips}
                locale={document.documentElement.dir === "rtl" ? "ar-AE" : undefined} removeLabel={removeLabel}
                reorderLabel={(record) => pickerText.reorderReference(record.key)} onRemove={remove} onReorder={onReorder} />}
              {(folded > 0 || expanded) && <ChipDisclosure label={pickerText.selectedReferences} triggerLabel={pickerText.allChosen(records.length)}
                trigger={visibleChips === 0 || folded === 0 ? pickerText.chosenCount(records.length) : pickerText.moreChosen(folded)}
                triggerRef={more} contentRef={popup} isOpen={expanded} onOpenChange={(open) => {
                  if (!open && popup.current?.contains(document.activeElement)) popupReturn.current = (document.activeElement as HTMLElement).closest<HTMLElement>("[data-chip-item]")?.dataset.chipId ?? null;
                  setExpanded(open);
                }}>
                <SelectedChipList label={pickerText.selectedReferences} selected={selected} locale={document.documentElement.dir === "rtl" ? "ar-AE" : undefined} removeLabel={removeLabel}
                  reorderLabel={(record) => pickerText.reorderReference(record.key)} onRemove={remove} onReorder={onReorder} />
              </ChipDisclosure>}
            </div>
          )}
          {shown !== undefined && (
            <section ref={outputRef} aria-label={pickerText.preview} className="shelf-output" data-keys={keys || undefined}
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
