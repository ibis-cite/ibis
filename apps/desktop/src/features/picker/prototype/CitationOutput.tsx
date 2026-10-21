// Preview prototype (design/preview-prototype), gallery only: three placements
// for "what will be pasted" and the citation tray. Active only when the
// evidence gallery sets :root[data-preview] from ?preview=a|b|c|h; the app
// never sets it, so the real picker is unchanged.
import type React from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { SearchResult } from "../../../api";
import { provisional, type FormattedCitation } from "../../../format/formatted";
import { render } from "../../../format/markup";
import type { StyleId } from "../../../format/styles";
import { TypeIcon } from "../../../icons";
import type { Choice } from "../choice";
import { choiceName, styleOf } from "../choice";

/** a: detail pane · b: citation shelf · c: token field · h: shelf with the preview hidden. */
export type OutputVariant = "a" | "b" | "c" | "h";

export function outputVariant(): OutputVariant | null {
  const value = typeof document === "undefined" ? undefined : document.documentElement.dataset.preview;
  return value === "a" || value === "b" || value === "c" || value === "h" ? value : null;
}

export type Shown = FormattedCitation | "failed" | "stale" | null;

/** "García 2021"; a second reference with the same label gets its second author or key. */
export function chipLabel(r: SearchResult, all: SearchResult[]): string {
  const base = `${r.first_author || r.title.split(" ").slice(0, 2).join(" ")}${r.year ? ` ${r.year}` : ""}`;
  const same = all.filter((other) => `${other.first_author} ${other.year}` === `${r.first_author} ${r.year}`);
  if (same.length < 2) return base;
  const second = r.authors.split(", ")[1];
  const withSecond = second ? `${r.first_author} & ${second} ${r.year ?? ""}`.trim() : null;
  const sameSecond = withSecond !== null && same.filter((other) => other.authors.split(", ")[1] === second).length > 1;
  return withSecond && !sameSecond ? withSecond : r.key;
}

/** The literal a key syntax produces, split so punctuation can be quieter than the keys. */
function keyParts(format: Choice, keys: string[]): { text: string; key?: boolean }[] {
  const join = (open: string, sep: string, close: string, prefix = "") => [
    { text: open }, ...keys.flatMap((key, i) => [...(i > 0 ? [{ text: sep }] : []), { text: prefix }, { text: key, key: true }]), { text: close },
  ].filter((part) => part.text !== "");
  switch (format) {
    case "pandoc": return join("[", "; ", "]", "@");
    case "typst": return join("", " ", "", "@");
    case "keys": return join("", ", ", "");
    default: return join(`\\${format}{`, ",", "}");
  }
}

function Glyph({ state }: { state: "ready" | "pending" | "failed" | "stale" }) {
  // The citation mark: a small quote, the one scarlet thing in the output area.
  if (state === "failed" || state === "stale") {
    return (
      <svg className="out-glyph" data-state={state} aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="10" cy="10" r="7.25" /><path d="M10 6.5v4.25M10 13.5v.01" />
      </svg>
    );
  }
  return (
    <svg className="out-glyph" data-state={state} aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
      <path d="M4 11.2C4 8 5.8 5.6 8.6 4.6l.6 1.3C7.6 6.7 6.8 7.9 6.7 9.3h2.1v5.1H4zm7.2 0c0-3.2 1.8-5.6 4.6-6.6l.6 1.3c-1.6.8-2.4 2-2.5 3.4H16v5.1h-4.8z" />
    </svg>
  );
}

/** The exact text Enter will paste, as one line or wrapped. */
export function OutputText({ format, chosen, shown, wrap = false }: { format: Choice; chosen: SearchResult[]; shown: Shown; wrap?: boolean }) {
  const style = styleOf(format);
  const state = shown === "failed" ? "failed" : shown === "stale" ? "stale" : style && shown === null ? "pending" : "ready";
  let body: React.ReactNode;
  if (state === "failed") body = <span className="out-problem">Couldn’t format in {choiceName(format)}. Choose another style, or copy keys.</span>;
  else if (state === "stale") body = <span className="out-problem">The library changed. Reading it again…</span>;
  else if (style && shown && typeof shown === "object") body = <span className="out-prose">{render(shown.markup)}</span>;
  else if (style) body = <span className="out-pending">Formatting…</span>;
  else body = <code className="out-keys">{keyParts(format, chosen.map((r) => r.key)).map((part, i) => <span key={i} className={part.key ? "k" : "p"}>{part.text}</span>)}</code>;
  const warnings = shown && typeof shown === "object" ? shown.warnings.length : 0;
  return (
    <div className="out-line" data-wrap={wrap || undefined} data-state={state}>
      <Glyph state={state} />
      <bdi className="out-text" dir="ltr">{body}</bdi>
      {style && provisional(style as StyleId) && <span className="out-flag">Numbers may change</span>}
      {warnings > 0 && <span className="out-flag" data-look>{warnings === 1 ? "1 warning" : `${warnings} warnings`}</span>}
    </div>
  );
}

function Remove({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button type="button" className="chip-remove" aria-label={`Remove ${label}`} title={`Remove ${label}`} onClick={onRemove}>
      <svg aria-hidden="true" viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 8 8M14 6l-8 8" /></svg>
    </button>
  );
}

/** The chosen references as chips on one line; those that do not fit fold into "+N". */
export function Chips({ selected, onRemove, max = 6, wrap = false }: { selected: SearchResult[]; onRemove: (r: SearchResult) => void; max?: number; wrap?: boolean }) {
  const row = useRef<HTMLUListElement>(null);
  const [fit, setFit] = useState(Math.min(max, selected.length));
  useLayoutEffect(() => {
    const list = row.current;
    if (!list) return;
    if (wrap) { setFit(Math.min(max, selected.length)); return; }
    const measure = () => {
      // Lay out every chip, then keep those on the first line with room for "+N".
      list.dataset.measuring = "true";
      const items = [...list.querySelectorAll<HTMLElement>("li[data-chip]")];
      const top = items[0]?.offsetTop ?? 0;
      let count = items.filter((item) => item.offsetTop === top).length;
      const overflow = list.querySelector<HTMLElement>("li[data-more]");
      if (count < selected.length && overflow) {
        const room = list.clientWidth - overflow.offsetWidth - 6;
        while (count > 1 && items[count - 1]!.offsetLeft + items[count - 1]!.offsetWidth > room) count--;
      }
      delete list.dataset.measuring;
      setFit(Math.max(1, Math.min(max, count)));
    };
    measure();
    void document.fonts?.ready.then(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [selected.length, max, wrap]);
  const hidden = selected.length - fit;
  return (
    <ul className="out-chips" ref={row} data-wrap={wrap || undefined} aria-label="Selected references">
      {selected.map((r, i) => {
        const label = chipLabel(r, selected);
        return (
          <li key={`${r.id.source}\u0000${r.id.native_key}`} data-chip data-hidden={i >= fit || undefined} title={`${r.title} · ${r.key}`}>
            <span className="chip-label">{label}</span>
            <Remove label={label} onRemove={() => onRemove(r)} />
          </li>
        );
      })}
      <li data-more data-hidden={hidden <= 0 || undefined}><button type="button" className="chip-more" title="Show all chosen references">+{Math.max(hidden, 1)}</button></li>
    </ul>
  );
}

/** B (and h): the citation shelf above the footer, next to the primary action. */
export function CitationShelf({ variant, format, chosen, selected, shown, onRemove }: {
  variant: OutputVariant; format: Choice; chosen: SearchResult[]; selected: SearchResult[]; shown: Shown; onRemove: (r: SearchResult) => void;
}) {
  if (chosen.length === 0) return null;
  const hidePreview = variant === "h";
  if (hidePreview && selected.length === 0) return null;
  return (
    <section className="out-shelf" aria-label="Citation">
      {selected.length > 0 && (
        <div className="out-shelf-tray">
          <Chips selected={selected} onRemove={onRemove} />
        </div>
      )}
      {!hidePreview && <OutputText format={format} chosen={chosen} shown={shown} />}
    </section>
  );
}

/** A: the detail pane beside the list: the focused reference, the citation and its output. */
export function DetailPane({ format, chosen, selected, focused, shown, onRemove }: {
  format: Choice; chosen: SearchResult[]; selected: SearchResult[]; focused: SearchResult | undefined; shown: Shown; onRemove: (r: SearchResult) => void;
}) {
  return (
    <aside className="out-pane" aria-label="Details">
      {focused && (
        <div className="out-focus">
          <div className="out-focus-type"><span className="out-focus-tile"><TypeIcon itemType={focused.item_type} /></span>{typeWord(focused.item_type)}</div>
          <h2 className="out-focus-title">{focused.title}</h2>
          <dl className="out-meta">
            <dt>Authors</dt><dd>{focused.authors}</dd>
            <dt>Year</dt><dd>{focused.year ?? "n.d."}</dd>
            {focused.container && <><dt>In</dt><dd>{focused.container}</dd></>}
            <dt>Key</dt><dd><code>{focused.key}</code></dd>
          </dl>
        </div>
      )}
      {selected.length > 0 && (
        <div className="out-pane-tray">
          <h3>In this citation · {selected.length}</h3>
          <Chips selected={selected} onRemove={onRemove} max={9} wrap />
        </div>
      )}
      {chosen.length > 0 && (
        <div className="out-pane-output">
          <h3>Pastes as {choiceName(format)}</h3>
          <OutputText format={format} chosen={chosen} shown={shown} wrap />
        </div>
      )}
    </aside>
  );
}

/** C: the chosen references as tokens in the search field, like mail recipients. */
export function SearchTokens({ selected, onRemove }: { selected: SearchResult[]; onRemove: (r: SearchResult) => void }) {
  if (selected.length === 0) return null;
  const shownChips = selected.slice(0, 2);
  const rest = selected.length - shownChips.length;
  return (
    <ul className="out-tokens" aria-label="Selected references">
      {shownChips.map((r) => {
        const label = chipLabel(r, selected);
        return <li key={r.key} title={`${r.title} · ${r.key}`}><span className="chip-label">{label}</span><Remove label={label} onRemove={() => onRemove(r)} /></li>;
      })}
      {rest > 0 && <li data-more><span className="chip-label">+{rest}</span></li>}
    </ul>
  );
}

/** C: the output folded into the footer's Enter hint. */
export function plainOutput(format: Choice, chosen: SearchResult[], shown: Shown): string | null {
  if (styleOf(format)) return shown && typeof shown === "object" ? shown.text : null;
  return keyParts(format, chosen.map((r) => r.key)).map((part) => part.text).join("");
}

const TYPE_WORDS: Record<string, string> = { "article-journal": "Journal article", "paper-conference": "Conference paper", book: "Book", chapter: "Book chapter", thesis: "Thesis", report: "Report", webpage: "Web page" };
function typeWord(type: string) {
  return TYPE_WORDS[type] ?? "Reference";
}
