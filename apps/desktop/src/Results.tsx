import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { defaultRangeExtractor, useVirtualizer, useWindowVirtualizer, type Range } from "@tanstack/react-virtual";
import { composing, secondaryShortcut } from "./Actions";
import type { SearchResult } from "./api";

export function idKey(id: SearchResult["id"]): string { return `${id.source}\u0000${id.native_key}`; }
const narrowQuery = "(max-width: 460px)";
const subscribe = (callback: () => void) => {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};

export function Results({ results, active, setActive, selected, toggle, copy, details, pending, empty }: {
  results: SearchResult[]; active: number; setActive: (index: number) => void;
  selected: Map<string, SearchResult>; toggle: (result: SearchResult) => void;
  copy: () => void; details: (trigger: HTMLElement) => void; pending: boolean; empty: string;
}) {
  const narrow = useSyncExternalStore(subscribe, () => window.matchMedia(narrowQuery).matches);
  const viewport = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [margin, setMargin] = useState(0);
  const getItemKey = useCallback((index: number) => idKey(results[index]!.id), [results]);
  const rangeExtractor = useCallback((range: Range) => [...new Set([...defaultRangeExtractor(range), active])].sort((a, b) => a - b), [active]);
  const options = { count: results.length, estimateSize: () => 100, getItemKey, rangeExtractor, overscan: 4, gap: 3 };
  const elementRows = useVirtualizer({ ...options, getScrollElement: () => viewport.current, enabled: !narrow });
  const windowRows = useWindowVirtualizer({ ...options, scrollMargin: margin, enabled: narrow });
  const rows = narrow ? windowRows : elementRows;
  useLayoutEffect(() => {
    if (!narrow) return;
    const measure = () => setMargin((list.current?.getBoundingClientRect().top ?? 0) + window.scrollY);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.querySelector("main")!);
    return () => observer.disconnect();
  }, [narrow]);
  useEffect(() => { if (results.length) rows.scrollToIndex(active, { align: "auto", behavior: "auto" }); }, [active, results, rows]);
  return (
    <div className="results-area">
      <div className="results-heading"><span>References</span><span>{results.length ? `${results.length} results` : ""}</span>
        <button type="button" disabled={pending || !results[active]} onClick={(e) => details(e.currentTarget)} aria-label="Show reference details">Details</button>
      </div>
      {results.length === 200 && <p className="result-limit">Showing up to 200 matches; refine your search.</p>}
      <div className="results-scroll" ref={viewport} tabIndex={-1}>
        <ul id="results" className="virtual-results" ref={list} role="listbox" aria-label="Results" aria-multiselectable="true"
          tabIndex={0} aria-busy={pending} aria-activedescendant={results[active] ? `result-${active}` : undefined}
          style={{ height: rows.getTotalSize(), position: "relative" }}
          onKeyDown={(e) => {
            if (composing(e) || pending) return;
            if (secondaryShortcut(e)) {
              e.preventDefault(); if (results[active]) toggle(results[active]);
              return;
            }
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              setActive(e.key === "Home" ? 0 : e.key === "End" ? Math.max(results.length - 1, 0) : Math.min(Math.max(active + (e.key === "ArrowDown" ? 1 : -1), 0), Math.max(results.length - 1, 0)));
            } else if (e.key === " " || e.key === "Enter" && e.shiftKey) {
              e.preventDefault(); if (results[active]) toggle(results[active]);
            } else if (e.key === "Enter") { e.preventDefault(); copy(); }
          }}>
          {rows.getVirtualItems().map((row) => {
            const result = results[row.index];
            if (!result) return null;
            return <li key={row.key} ref={rows.measureElement} data-index={row.index} id={`result-${row.index}`} role="option"
              aria-selected={selected.has(idKey(result.id))} aria-posinset={row.index + 1} aria-setsize={results.length}
              data-active={row.index === active || undefined} style={{ transform: `translateY(${row.start - (narrow ? margin : 0)}px)` }}
              onClick={() => { if (!pending) { list.current?.focus({ preventScroll: true }); setActive(row.index); toggle(result); } }}>
              <span className="result-text"><strong>{result.title}</strong><span className="result-meta">{result.authors} · {result.year ?? "n.d."}</span>
                {result.matched.length > 0 && <span className="match-explanation">Matched: {result.matched.join(", ")}</span>}
              </span><code className="result-key">{result.key}</code>
            </li>;
          })}
        </ul>
        {results.length === 0 && <p className="empty-state">{empty}</p>}
      </div>
    </div>
  );
}
