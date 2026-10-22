import { Button, DropIndicator, GridList, GridListItem, I18nProvider, useDragAndDrop, useLocale } from "react-aria-components";
import { useRef, type ReactNode, type Ref } from "react";
import "./ChipCollection.css";

export type ChipCollectionItem = { id: string; label: ReactNode; textValue: string; removeLabel: string; reorderLabel: string };
type Props = {
  label: string; items: readonly ChipCollectionItem[]; inline?: boolean; locale?: string; listRef?: Ref<HTMLDivElement>;
  onRemove: (ids: Set<string>) => void;
  onReorder: (ids: Set<string>, target: string, position: "before" | "after") => void;
};

/** React Aria owns spatial navigation, dragging and insertion in both views. */
export function ChipCollection(props: Props) {
  return props.locale ? <I18nProvider locale={props.locale}><Chips {...props} /></I18nProvider> : <Chips {...props} />;
}

function Chips({ label, items: controlled, inline = false, listRef, onRemove, onReorder }: Props) {
  const { direction } = useLocale();
  const composing = useRef(false);
  const rows = useRef(new Map<string, HTMLDivElement>());
  // CSS selectors cannot address a raw NUL; JSON also preserves lone surrogates.
  const items = controlled.map((item) => ({ ...item, id: JSON.stringify(item.id), recordId: item.id }));
  const identities = new Map(items.map(({ id, recordId }) => [id, recordId]));
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map(() => ({ "application/x-ibis-chip": "chip" })),
    getAllowedDropOperations: () => ["move"],
    renderDropIndicator: (target) => <DropIndicator target={target} className="chip-collection-drop" />,
    onReorder: ({ keys, target }) => {
      const targetId = identities.get(String(target.key));
      const moved = new Set([...keys].flatMap((key) => identities.get(String(key)) ?? []));
      if (targetId !== undefined && moved.size > 0 && target.dropPosition !== "on") onReorder(moved, targetId, target.dropPosition);
    },
  });
  return <div className="chip-collection" dir={direction} onCompositionStartCapture={() => { composing.current = true; }}
    onCompositionEndCapture={() => { composing.current = false; }}
    onKeyUpCapture={(event) => { if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) event.stopPropagation(); }}
    onKeyDownCapture={(event) => {
      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return; }
      const remove = event.key === "Delete" || event.key === "Backspace";
      const move = event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown");
      if (!remove && !move) return;
      event.stopPropagation(); event.preventDefault();
      if ((move && event.repeat) || event.ctrlKey || event.metaKey || event.shiftKey || (remove && event.altKey)) return;
      const index = items.findIndex(({ recordId }) => rows.current.get(recordId)?.contains(event.target as Node));
      const item = items[index];
      if (!item) return;
      if (remove) onRemove(new Set([item.recordId]));
      else {
        const target = items[index + (event.key === "ArrowUp" ? -1 : 1)];
        if (target) onReorder(new Set([item.recordId]), target.recordId, event.key === "ArrowUp" ? "before" : "after");
      }
    }}>
    <GridList ref={listRef} data-chip-list={inline ? "" : undefined} data-inline={inline || undefined} aria-label={label} className="chip-collection-list" items={items} selectionMode="none"
    layout="grid" orientation="horizontal" autoFocus={inline ? false : "first"} dragAndDropHooks={dragAndDropHooks}>
    {(item) => <GridListItem id={item.id} textValue={item.textValue} aria-label={item.textValue} className="chip-collection-item" data-chip-item="" data-chip-id={item.id}
      ref={(node) => { if (node) rows.current.set(item.recordId, node); else rows.current.delete(item.recordId); }}>
      <Button slot="drag" className={inline ? "chip-collection-drag visually-hidden" : "chip-collection-drag"} aria-label={item.reorderLabel}>↕</Button>
      {item.label}
      <Button className="chip-collection-remove" aria-label={item.removeLabel} onPress={() => onRemove(new Set([item.recordId]))}><span aria-hidden="true">×</span></Button>
    </GridListItem>}
    </GridList>
  </div>;
}
