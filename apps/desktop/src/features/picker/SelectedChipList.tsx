import type { Ref } from "react";
import type { SearchResult } from "../../api";
import { ChipCollection } from "../../ui/ChipCollection";
import { chipLabelParts, type ChipLabel } from "./chipLabels";
import "./SelectedChipList.css";

/** The year and disambiguating letter never share the author's ellipsis. */
function SelectedChipLabel({ label, title }: { label: ChipLabel; title: string }) {
  return <span className="chip-label" title={title} aria-hidden="true">
    {label.author && <bdi className="chip-author">{label.author}</bdi>}
    {(label.year || label.letter) && <bdi dir="ltr" className="chip-year">{label.year}{label.letter}</bdi>}
  </span>;
}

/** Labels always come from the whole selection, including folded references. */
export function SelectedChipList({ label, selected, visibleCount, locale, listRef, removeLabel, reorderLabel, onRemove, onReorder }: {
  label: string; selected: Map<string, SearchResult>; visibleCount?: number; locale?: string; listRef?: Ref<HTMLDivElement>;
  removeLabel: (record: SearchResult) => string; reorderLabel: (record: SearchResult) => string;
  onRemove: (ids: Set<string>) => void;
  onReorder: (ids: Set<string>, target: string, position: "before" | "after") => void;
}) {
  const parts = chipLabelParts([...selected.values()]);
  const items = [...selected].map(([id, record], index) => {
    const name = [parts[index]!.text, record.authors || record.first_author, record.key, record.title].filter(Boolean).join(" · ");
    return { id, label: <SelectedChipLabel label={parts[index]!} title={name} />, textValue: name, removeLabel: removeLabel(record), reorderLabel: reorderLabel(record) };
  }).slice(0, visibleCount);
  return <div className="selected-chip-list"><ChipCollection label={label} items={items} inline={visibleCount !== undefined} locale={locale} listRef={listRef}
    onRemove={onRemove} onReorder={onReorder} /></div>;
}
