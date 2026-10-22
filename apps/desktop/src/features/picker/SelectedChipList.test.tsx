import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type { SearchResult } from "../../api";
import { idKey } from "./choice";
import { reorderSelection } from "./selectionOrder";
import { SelectedChipList } from "./SelectedChipList";

afterEach(async () => {
  cleanup(); await act(async () => { await new Promise(requestAnimationFrame); });
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const record = (source: string, native_key: string): SearchResult => ({
  revision: "1", id: { source, native_key }, key: "shared", title: "Same title", authors: "Example, Division",
  first_author: "Example", author_count: 1, year: 2026, matched: ["title"], container: null, item_type: "book",
});
const records = [record("first.bib", "a"), record("second.bib", "b"), record("first.bib", "c")];
const [a, b] = records.map((item) => idKey(item.id)) as [string, string];
function mount() {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  const removed = vi.fn(); const reordered = vi.fn(); const parentKeys = vi.fn();
  function Example() {
    const [selected, setSelected] = useState(new Map(records.map((item) => [idKey(item.id), item])));
    return <main onKeyDown={parentKeys}><SelectedChipList label="All chosen references" selected={selected}
      removeLabel={(item) => `Remove ${item.id.source}/${item.id.native_key}`}
      reorderLabel={(item) => `Reorder ${item.id.source}/${item.id.native_key}`}
      onRemove={(ids) => { removed(ids); setSelected((latest) => new Map([...latest].filter(([id]) => !ids.has(id)))); }}
      onReorder={(ids, target, position) => {
        reordered(ids, target, position); setSelected((latest) => reorderSelection(latest, ids, target, position));
      }} /></main>;
  }
  render(<Example />);
  return { removed, reordered, parentKeys, grid: screen.getByRole("grid", { name: "All chosen references" }) };
}
const row = (grid: HTMLElement, label: string) => within(grid).getByText(label).closest<HTMLElement>('[role="row"]')!;

test("the disclosed grid exposes all full metadata and source-qualified remove/drag controls", () => {
  const { grid, removed } = mount();
  expect(within(grid).getAllByRole("row")).toHaveLength(3);
  const first = row(grid, "2026a");
  expect(first.querySelector(".chip-label")?.getAttribute("title")).toContain("Example, Division");
  expect(first.getAttribute("aria-label")).toContain("shared");
  expect(first.getAttribute("aria-label")).toContain("Same title");
  expect(within(grid).getAllByRole("button", { name: /^Reorder/ })).toHaveLength(3);
  fireEvent.click(within(grid).getByRole("button", { name: "Remove second.bib/b" }));
  expect(removed).toHaveBeenCalledWith(new Set([b]));
  expect(within(grid).getAllByRole("row")).toHaveLength(2);
});

test("Alt arrows reorder by identity while focus remains on that record", async () => {
  const { grid, reordered, parentKeys } = mount();
  const second = row(grid, "2026b"); act(() => second.focus());
  fireEvent.keyDown(second, { key: "ArrowUp", altKey: true });
  expect(reordered).toHaveBeenCalledWith(new Set([b]), a, "before");
  expect(within(grid).getAllByRole("row")[0]).toBe(second);
  expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second, { key: "ArrowDown", altKey: true });
  expect(reordered).toHaveBeenLastCalledWith(new Set([b]), a, "after");
  expect(within(grid).getAllByRole("row")[1]).toBe(second);
  expect(document.activeElement).toBe(second);
  expect(parentKeys).not.toHaveBeenCalled();
});

test("Delete removes the focused identity and React Aria keeps focus in the remaining collection", async () => {
  const { grid, removed, parentKeys } = mount();
  const second = row(grid, "2026b"); act(() => second.focus());
  fireEvent.keyDown(second, { key: "Delete" });
  expect(removed).toHaveBeenCalledWith(new Set([b]));
  await waitFor(() => expect(grid.contains(document.activeElement)).toBe(true));
  expect(within(grid).getByRole("button", { name: "Remove first.bib/c" })).toBeTruthy();
  expect(parentKeys).not.toHaveBeenCalled();
});

test("composition, 229, repeat and modified keys cannot remove or reorder a different record", () => {
  const { grid, removed, reordered, parentKeys } = mount();
  const second = row(grid, "2026b"); act(() => second.focus());
  fireEvent.compositionStart(second);
  fireEvent.keyDown(second, { key: "Backspace" });
  fireEvent.compositionEnd(second);
  fireEvent.keyDown(second, { key: "Delete", isComposing: true });
  fireEvent.keyDown(second, { key: "Delete", keyCode: 229 });
  fireEvent.keyDown(second, { key: "Delete", repeat: true });
  fireEvent.keyDown(second, { key: "Delete", ctrlKey: true });
  fireEvent.keyDown(second, { key: "ArrowUp", altKey: true, shiftKey: true });
  expect(removed).not.toHaveBeenCalled(); expect(reordered).not.toHaveBeenCalled();
  expect(parentKeys).not.toHaveBeenCalled();
  fireEvent.keyDown(second, { key: "Backspace" });
  expect(removed).toHaveBeenCalledWith(new Set([b]));
});
