import { Button, DropIndicator, GridList, GridListItem, useDragAndDrop } from "react-aria-components";
import { useRef } from "react";
import type { SearchResult } from "../../api";
import { chipLabelParts, type ChipLabel } from "./chipLabels";
import "./CitationShelf.css";
import "./SelectedChipList.css";

type Move = (ids: Set<string>, target: string, position: "before" | "after") => void;

/** The year and disambiguating letter never share the author's ellipsis. */
export function SelectedChipLabel({ label, title }: { label: ChipLabel; title: string }) {
  return <span className="chip-label" title={title} aria-hidden="true">
    {label.author && <bdi className="chip-author">{label.author}</bdi>}
    {(label.year || label.letter) && <bdi dir="ltr" className="chip-year">{label.year}{label.letter}</bdi>}
  </span>;
}

/** Every selected reference in the overflow, using React Aria's reorder model. */
export function SelectedChipList({ label, selected, removeLabel, reorderLabel, onRemove, onReorder }: {
  label: string; selected: Map<string, SearchResult>;
  removeLabel: (record: SearchResult) => string; reorderLabel: (record: SearchResult) => string;
  onRemove: (ids: Set<string>) => void; onReorder: Move;
}) {
  const composing = useRef(false);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const parts = chipLabelParts([...selected.values()]);
  const items = [...selected].map(([id, record], index) => ({
    id, record, label: parts[index]!,
    name: [parts[index]!.text, record.authors || record.first_author, record.key, record.title].filter(Boolean).join(" · "),
  }));
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map(() => ({ "application/x-ibis-selected-chip": "selected" })),
    getAllowedDropOperations: () => ["move"],
    renderDropIndicator: (target) => <DropIndicator target={target} className="selected-chip-drop" />,
    onReorder: ({ keys, target }) => {
      if (target.dropPosition !== "on") onReorder(new Set([...keys].map(String)), String(target.key), target.dropPosition);
    },
  });
  return <div onCompositionStartCapture={() => { composing.current = true; }}
    onCompositionEndCapture={() => { composing.current = false; }} onKeyDownCapture={(event) => {
      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return; }
      const remove = event.key === "Delete" || event.key === "Backspace";
      const move = event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown");
      if (!remove && !move) return;
      event.stopPropagation(); event.preventDefault();
      if ((move && event.repeat) || event.ctrlKey || event.metaKey || event.shiftKey || (remove && event.altKey)) return;
      const index = items.findIndex(({ id }) => rows.current.get(id)?.contains(event.target as Node));
      const item = items[index];
      if (!item) return;
      if (remove) onRemove(new Set([item.id]));
      else {
        const target = items[index + (event.key === "ArrowUp" ? -1 : 1)];
        if (target) onReorder(new Set([item.id]), target.id, event.key === "ArrowUp" ? "before" : "after");
      }
    }}>
    <GridList aria-label={label} className="selected-chip-list" items={items} selectionMode="none"
    layout="grid" orientation="horizontal" autoFocus="first" dragAndDropHooks={dragAndDropHooks}>
    {(item) => <GridListItem id={item.id} textValue={item.name} aria-label={item.name} className="selected-chip-item" data-chip-item=""
      ref={(node) => { if (node) rows.current.set(item.id, node); else rows.current.delete(item.id); }}>
      <Button slot="drag" className="chip-drag" aria-label={reorderLabel(item.record)}>↕</Button>
      <SelectedChipLabel label={item.label} title={item.name} />
      <Button className="chip-group-remove" aria-label={removeLabel(item.record)} onPress={() => onRemove(new Set([item.id]))}><span aria-hidden="true">×</span></Button>
    </GridListItem>}
    </GridList>
  </div>;
}
