import { useEffect, useRef, useState } from "react";
import type React from "react";

export function composing(e: React.KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

export const mac = navigator.platform.startsWith("Mac");
export function actionsShortcut(e: React.KeyboardEvent): boolean {
  return e.key.toLowerCase() === "k" && (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey;
}

export type PickerAction = { id: string; label: string; disabled?: boolean; run: () => void };

/** Native modal focus containment; the filter owns virtual listbox focus. */
export function Actions({ actions, close }: { actions: PickerAction[]; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const matches = actions.filter((a) => a.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const enabled = matches.filter((a) => !a.disabled);
  const current = enabled[active] ?? enabled[0];
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    filter.current?.focus();
    return () => element.close();
  }, []);
  useEffect(() => {
    if (current) document.getElementById(`action-${current.id}`)?.scrollIntoView?.({ block: "nearest" });
  }, [current?.id]);
  const dismiss = () => { dialog.current?.close(); close(); };
  const execute = (action: PickerAction) => {
    if (action.disabled) return;
    dismiss();
    action.run();
  };
  return (
    <dialog ref={dialog} className="actions-panel" aria-label="Actions" onCancel={(e) => { e.preventDefault(); dismiss(); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (composing(e)) { if (e.key === "Escape") e.preventDefault(); return; }
        if (e.key === "Escape" || actionsShortcut(e)) { e.preventDefault(); dismiss(); }
      }}>
      <div className="actions-heading"><strong>Actions</strong><button type="button" aria-label="Close Actions" onClick={dismiss}>×</button></div>
      <ul id="actions-list" role="listbox" aria-label="Available actions">
        {matches.map((action) => <li key={action.id} id={`action-${action.id}`} role="option"
          aria-selected={current?.id === action.id} aria-disabled={action.disabled || undefined}
          onClick={() => execute(action)}>{action.label}</li>)}
      </ul>
      {matches.length === 0 && <p role="status">No matching actions</p>}
      <label className="visually-hidden" htmlFor="action-search">Search actions</label>
      <input id="action-search" ref={filter} type="search" placeholder="Search actions…" autoFocus
        role="combobox" aria-expanded="true" aria-controls="actions-list" aria-autocomplete="list"
        aria-activedescendant={current ? `action-${current.id}` : undefined} value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={(e) => {
          if (composing(e) || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.min(Math.max(i + (e.key === "ArrowDown" ? 1 : -1), 0), Math.max(enabled.length - 1, 0)));
          } else if (e.key === "Enter") { e.preventDefault(); if (current) execute(current); }
        }} />
    </dialog>
  );
}
