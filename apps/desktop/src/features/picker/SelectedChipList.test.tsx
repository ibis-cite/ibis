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
const [a, b, c] = records.map((item) => idKey(item.id)) as [string, string, string];
function mount(visibleCount?: number, locale?: string, entries = records) {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const grid = this.closest('[role="grid"]');
    const rows = grid ? [...grid.querySelectorAll('[role="row"]')] : [];
    const index = rows.indexOf(this.closest('[role="row"]')!);
    return new DOMRect((locale === "ar-AE" ? rows.length - 1 - index : index) * 120, 0, 116, 24);
  });
  const removed = vi.fn(); const reordered = vi.fn(); const parentKeys = vi.fn();
  function Example() {
    const [selected, setSelected] = useState(new Map(entries.map((item) => [idKey(item.id), item])));
    return <main onKeyDown={parentKeys}><input aria-label="Search" /><SelectedChipList label="All chosen references" selected={selected} visibleCount={visibleCount} locale={locale}
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
  await waitFor(() => expect((document.activeElement as HTMLElement).closest<HTMLElement>('[role="row"]')?.dataset.chipId).toBe(JSON.stringify(c)));
  expect(within(grid).getByRole("button", { name: "Remove first.bib/c" })).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Delete", repeat: true });
  expect(removed).toHaveBeenLastCalledWith(new Set([c]));
  expect(parentKeys).not.toHaveBeenCalled();
});

test("composition, 229 and modified keys cannot remove or reorder a different record", () => {
  const { grid, removed, reordered, parentKeys } = mount();
  const second = row(grid, "2026b"); act(() => second.focus());
  fireEvent.compositionStart(second);
  fireEvent.keyDown(second, { key: "Backspace" });
  fireEvent.compositionEnd(second);
  fireEvent.keyDown(second, { key: "Delete", isComposing: true });
  fireEvent.keyDown(second, { key: "Delete", keyCode: 229 });
  fireEvent.keyDown(second, { key: "ArrowUp", altKey: true, repeat: true });
  fireEvent.keyDown(second, { key: "Delete", ctrlKey: true });
  fireEvent.keyDown(second, { key: "ArrowUp", altKey: true, shiftKey: true });
  expect(removed).not.toHaveBeenCalled(); expect(reordered).not.toHaveBeenCalled();
  expect(parentKeys).not.toHaveBeenCalled();
  fireEvent.keyDown(second, { key: "Backspace" });
  expect(removed).toHaveBeenCalledWith(new Set([b]));
});

test("React Aria keyboard dragging delivers source-qualified reorder keys", async () => {
  const { grid, reordered } = mount();
  const handle = within(grid).getByRole("button", { name: "Reorder second.bib/b" });
  act(() => handle.closest<HTMLElement>('[role="row"]')!.focus());
  act(() => handle.focus());
  fireEvent.keyDown(handle, { key: "Enter" }); fireEvent.keyUp(handle, { key: "Enter" });
  const beforeFirst = await screen.findByRole("button", { name: /^Insert before Example 2026a/ });
  act(() => beforeFirst.focus());
  expect(beforeFirst.closest(".chip-collection-drop")?.hasAttribute("data-drop-target")).toBe(true);
  fireEvent.keyDown(beforeFirst, { key: "Enter" }); fireEvent.keyUp(beforeFirst, { key: "Enter" });
  await waitFor(() => expect(reordered).toHaveBeenCalledWith(new Set([b]), a, "before"));
  expect(within(grid).getAllByRole("row")[0]?.getAttribute("data-chip-id")).toBe(JSON.stringify(b));
});


test.each(["en-US", "ar-AE"])("inline %s uses the live grid, mirrors arrows and keeps identity through reorder/removal", async (locale) => {
  const { grid, reordered, removed } = mount(3, locale);
  expect(grid.hasAttribute("data-chip-list")).toBe(true);
  expect(grid.closest("[dir]")?.getAttribute("dir")).toBe(locale === "ar-AE" ? "rtl" : "ltr");
  expect(document.activeElement).not.toBe(row(grid, "2026a"));
  const first = row(grid, "2026a"); const second = row(grid, "2026b");
  act(() => first.focus());
  fireEvent.keyDown(first, { key: locale === "ar-AE" ? "ArrowLeft" : "ArrowRight" });
  expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second, { key: "ArrowUp", altKey: true });
  expect(reordered).toHaveBeenCalledWith(new Set([b]), a, "before");
  expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second, { key: "Backspace" });
  expect(removed).toHaveBeenCalledWith(new Set([b]));
  await waitFor(() => expect((document.activeElement as HTMLElement).closest('[role="row"]')).toBe(first));
});

test("inline labels retain suffixes from the whole selection and support React Aria keyboard drag", async () => {
  const { grid, reordered } = mount(2);
  expect(within(grid).getAllByRole("row")).toHaveLength(2);
  expect(within(grid).getByText("2026a")).toBeTruthy();
  const handle = within(grid).getByRole("button", { name: "Reorder second.bib/b" });
  expect(handle.classList.contains("visually-hidden")).toBe(true);
  act(() => handle.closest<HTMLElement>('[role="row"]')!.focus());
  act(() => handle.focus());
  fireEvent.keyDown(handle, { key: "Enter" }); fireEvent.keyUp(handle, { key: "Enter" });
  const target = await screen.findByRole("button", { name: /^Insert before Example 2026a/ });
  act(() => target.focus());
  fireEvent.keyDown(target, { key: "Enter" }); fireEvent.keyUp(target, { key: "Enter" });
  await waitFor(() => expect(reordered).toHaveBeenCalledWith(new Set([b]), a, "before"));
  expect(within(grid).getAllByRole("row")[0]?.dataset.chipId).toBe(JSON.stringify(b));
});


test("NUL, lone-surrogate and quoted source identities remain distinct in the real collection lookup", async () => {
  const entries = [record("first\0source", "same"), record("\ud800العربية", "same"), record('quoted"\n]', "same")];
  const ids = entries.map((entry) => idKey(entry.id));
  const { grid, reordered } = mount(3, "en-US", entries);
  const first = row(grid, "2026a"); const second = row(grid, "2026b");
  act(() => first.focus()); fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second, { key: "ArrowUp", altKey: true });
  expect(reordered).toHaveBeenCalledWith(new Set([ids[1]]), ids[0], "before");
  expect(within(grid).getAllByRole("row")[0]).toBe(second);
  expect(new Set(within(grid).getAllByRole("row").map((element) => element.dataset.chipId)).size).toBe(3);
  const handle = within(first).getByRole("button", { name: /^Reorder/ });
  act(() => first.focus()); act(() => handle.focus());
  fireEvent.keyDown(handle, { key: "Enter" }); fireEvent.keyUp(handle, { key: "Enter" });
  const target = await screen.findByRole("button", { name: /^Insert before Example 2026a/ });
  act(() => target.focus());
  fireEvent.keyDown(target, { key: "Enter" }); fireEvent.keyUp(target, { key: "Enter" });
  await waitFor(() => expect(reordered).toHaveBeenLastCalledWith(new Set([ids[0]]), ids[1], "before"));
});
