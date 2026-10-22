import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import type { SearchResult } from "../../api";
import { idKey } from "./choice";
import { reorderSelection } from "./selectionOrder";
import { CitationShelf } from "./CitationShelf";

afterEach(async () => { cleanup(); await act(async () => { await new Promise(requestAnimationFrame); }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function record(key: string, first_author = "García", year: number | null = 2021): SearchResult {
  return {
    revision: "1", id: { source: "refs.bib", native_key: key }, key, title: `Title ${key}`, authors: first_author,
    year, matched: ["title"], first_author, author_count: 1, container: null, item_type: "book",
  };
}

function chosen(records: SearchResult[]) {
  return new Map(records.map((r) => [idKey(r.id), r]));
}

const shelf = (props: Partial<Parameters<typeof CitationShelf>[0]>) => (
  <CitationShelf announce={false} selected={new Map()} removeLabel={(r) => `Remove ${r.key}`} onRemove={() => undefined} onReorder={() => undefined} fallbackFocusRef={{ current: null }}
    style={null} keys shown={undefined} focusable={false} {...props} />
);

function layout(countOnlyWidth = 40) {
  let width = 420; let scale = 1;
  const observations: { callback: () => void; nodes: Set<Element> }[] = [];
  vi.stubGlobal("innerWidth", 720);
  vi.stubGlobal("ResizeObserver", class {
    nodes = new Set<Element>();
    constructor(callback: () => void) { observations.push({ callback, nodes: this.nodes }); }
    observe(node: Element) { this.nodes.add(node); }
    unobserve(node: Element) { this.nodes.delete(node); }
    disconnect() { this.nodes.clear(); }
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("shelf-chips") ? width : 0; });
  const computed = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    if (element === document.documentElement) {
      const style = document.createElement("div").style;
      style.setProperty("--chip-count-only-width", "460px"); return style;
    }
    if (!element.matches(".chip-group-item, .shelf-chips")) return computed(element);
    const style = document.createElement("div").style;
    style.minWidth = `${80 * scale}px`; style.columnGap = `${4 * scale}px`;
    style.paddingInlineStart = style.paddingInlineEnd = `${12 * scale}px`;
    return style;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = this.matches(".chip-disclosure-trigger") ? (this.textContent?.includes("references") ? countOnlyWidth : 40) : this.matches(".shelf-chip-minimum") ? 80 : this.matches(".shelf-author-measure") ? 42 : this.matches(".shelf-chip-measure bdi") ? 35 : this.matches(".shelf-chip-target, .chip-group-remove") ? 32 : 0;
    return new DOMRect(0, 0, width * scale, 24 * scale);
  });
  return { resize(next: number, larger = 1) {
    width = next; scale = larger;
    act(() => { for (const observation of observations) if ([...observation.nodes].some((node) => node.classList.contains("shelf-chips"))) observation.callback(); });
  } };
}

test("six chips stay inline and +N discloses every source-qualified reference in a separate popover", async () => {
  const geometry = layout(); geometry.resize(1000);
  const records = Array.from({ length: 9 }, (_, i) => record(`k${i}`, `Author${i}`));
  const onRemove = vi.fn();
  render(shelf({ selected: chosen(records), onRemove }));
  const inline = screen.getByRole("grid", { name: "Selected references" });
  expect(within(inline).getAllByRole("row")).toHaveLength(6);
  const more = screen.getByRole("button", { name: "Show all 9 selected references" });
  expect(more.textContent).toBe("+3");
  act(() => more.focus()); fireEvent.click(more);
  const dialog = await screen.findByRole("dialog", { name: "Selected references" });
  expect(within(dialog).getAllByRole("row")).toHaveLength(9);
  expect(inline.querySelectorAll("[data-chip-item]")).toHaveLength(6);
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove k8" }));
  expect(onRemove).toHaveBeenCalledWith(new Set([idKey(records[8]!.id)]));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(more));
});

test("measured fitting reserves overflow width at 200% text and moves newly folded focus to +N", async () => {
  const geometry = layout();
  const records = Array.from({ length: 50 }, (_, i) => record(`k${i}`, `Author${i}`));
  render(shelf({ selected: chosen(records) }));
  const inline = screen.getByRole("grid", { name: "Selected references" });
  expect(within(inline).getAllByRole("row")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Show all 50 selected references" }).textContent).toBe("+47");
  act(() => within(inline).getAllByRole("row")[2]!.focus());
  geometry.resize(420, 2);
  expect(within(inline).getAllByRole("row")).toHaveLength(1);
  const more = screen.getByRole("button", { name: "Show all 50 selected references" });
  expect(more.textContent).toBe("+49");
  expect(document.activeElement).toBe(more);
  fireEvent.click(more);
  const dialog = await screen.findByRole("dialog", { name: "Selected references" });
  expect(within(dialog).getAllByRole("row")).toHaveLength(50);
});

test("under the count-only width no hidden inline chips remain in the keyboard collection", async () => {
  layout(); vi.stubGlobal("innerWidth", 360);
  render(shelf({ selected: chosen([record("a"), record("b"), record("c")]) }));
  expect(screen.queryByRole("grid")).toBeNull();
  const count = screen.getByRole("button", { name: "Show all 3 selected references" });
  expect(count.textContent).toBe("3 references ›");
  expect(count.closest(".shelf-chips")?.hasAttribute("data-count-only")).toBe(true);
  fireEvent.click(count);
  const dialog = await screen.findByRole("dialog", { name: "Selected references" });
  expect(within(dialog).getAllByRole("row")).toHaveLength(3);
});

test("growing from count-only measures the inline +N independently of the longer count label", () => {
  const geometry = layout(240); vi.stubGlobal("innerWidth", 360);
  render(shelf({ selected: chosen(Array.from({ length: 50 }, (_, i) => record(`k${i}`))) }));
  expect(screen.queryByRole("grid")).toBeNull();
  expect(screen.getByRole("button", { name: "Show all 50 selected references" }).textContent).toBe("50 references ›");
  vi.stubGlobal("innerWidth", 720); geometry.resize(200);
  expect(within(screen.getByRole("grid", { name: "Selected references" })).getAllByRole("row")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Show all 50 selected references" }).textContent).toBe("+49");
});

test.each([false, true])("final removal returns owned inline/overflow focus to Search (overflow=%s)", async (overflow) => {
  layout(); if (overflow) vi.stubGlobal("innerWidth", 360);
  function Picker() {
    const [selected, setSelected] = useState(chosen([record("a")]));
    const search = useRef<HTMLInputElement>(null);
    return <><input ref={search} aria-label="Search" />{shelf({ selected, fallbackFocusRef: search,
      onRemove: (ids) => setSelected((latest) => new Map([...latest].filter(([id]) => !ids.has(id)))),
      onReorder: (ids, target, position) => setSelected((latest) => reorderSelection(latest, ids, target, position)),
    })}</>;
  }
  render(<Picker />);
  if (overflow) fireEvent.click(screen.getByRole("button", { name: "Show all 1 selected references" }));
  const chip = await screen.findByRole("row"); act(() => chip.focus());
  fireEvent.keyDown(chip, { key: "Delete" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search" })));
  expect(screen.queryByRole("row")).toBeNull();
});

test("the output is one line in text colours: keys in monospace, failures and pending in words", () => {
  const { rerender } = render(shelf({ keys: true, shown: { markup: [], text: "[@a; @b]", html: "", warnings: [] } }));
  const output = screen.getByRole("region", { name: "Preview" });
  expect(output.hasAttribute("data-keys")).toBe(true);
  expect(within(output).getByText("[@a; @b]").getAttribute("title")).toBe("[@a; @b]");
  rerender(shelf({ keys: false, style: "apa", shown: null }));
  expect(screen.getByRole("region", { name: "Preview" }).getAttribute("data-state")).toBe("pending");
  expect(within(screen.getByRole("region", { name: "Preview" })).getByRole("status").textContent).toBe("Formatting…");
  rerender(shelf({ keys: false, style: "apa", shown: "failed" }));
  expect(screen.getByRole("alert").textContent).toMatch(/could not be formatted/);
  rerender(shelf({ keys: false, style: "ieee", shown: { markup: [], text: "[1]", html: "", warnings: ["Missing year"] } }));
  expect(screen.getByText("Numbers may change")).toBeTruthy();
  expect(screen.getByText("1 warning")).toBeTruthy();
  expect(screen.getByText("Missing year")).toBeTruthy();
});

test("proportional overflow digits cannot cycle the fitted count, and growth restores chips", async () => {
  let width = 350;
  const observers: (() => void)[] = [];
  vi.stubGlobal("innerWidth", 720);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { observers.push(callback); }
    observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.matches(".shelf-chips") ? width : 0;
  });
  const computed = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    if (!element.matches(".shelf-chips, .shelf-chip-measure")) return computed(element);
    const style = document.createElement("div").style;
    style.columnGap = "4px"; style.paddingInlineStart = style.paddingInlineEnd = "0px";
    return style;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    // Three chips produce the wider +20; two produce the narrower +21.
    const width = this.matches(".shelf-chip-minimum") ? 100
      : this.matches(".shelf-chip-target") ? 32
      : this.matches(".shelf-author-measure, .shelf-label-measure bdi") ? 0
      : this.textContent === "+20" ? 40 : this.textContent === "+21" ? 30 : 35;
    return new DOMRect(0, 0, width, 24);
  });
  const records = Array.from({ length: 23 }, (_, i) => record(`k${i}`, `Author${i}`));
  const { container } = render(shelf({ selected: chosen(records) }));
  const visible = () => within(screen.getByRole("grid", { name: "Selected references" })).getAllByRole("row");
  const more = () => screen.getByRole("button", { name: "Show all 23 selected references" });
  expect(visible()).toHaveLength(2);
  expect(more().textContent).toBe("+21");
  expect(container.querySelectorAll(".chip-fit-measure > button").length).toBeLessThanOrEqual(7);
  act(() => more().focus());
  act(() => { for (const observer of [...observers]) observer(); });
  expect(document.activeElement).toBe(more());
  expect(visible()).toHaveLength(2);
  width = 1000;
  act(() => { for (const observer of [...observers]) observer(); });
  expect(visible()).toHaveLength(6);
  width = 350;
  act(() => { for (const observer of [...observers]) observer(); });
  expect(visible()).toHaveLength(2);
  fireEvent.click(more());
  const popup = await screen.findByRole("dialog", { name: "Selected references" });
  expect(within(popup).getAllByRole("button", { name: /^Remove/ }).map((button) => button.getAttribute("aria-label")))
    .toEqual(records.map((r) => `Remove ${r.key}`));
});

test("nothing chosen and nothing to show draws no shelf", () => {
  const { container } = render(shelf({}));
  expect(container.querySelector(".shelf")).toBeNull();
});

test("removing overflow down to one inline row keeps the open collection and its focused identity", async () => {
  const geometry = layout(); geometry.resize(1000);
  const records = Array.from({ length: 9 }, (_, i) => record(`k${i}`, `Author${i}`));
  function Picker() {
    const [selected, setSelected] = useState(chosen(records));
    return shelf({ selected, onRemove: (ids) => setSelected((latest) => new Map([...latest].filter(([id]) => !ids.has(id)))) });
  }
  render(<Picker />);
  const trigger = screen.getByRole("button", { name: "Show all 9 selected references" });
  act(() => trigger.focus()); fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Selected references" });
  for (let i = 0; i < 3; i++) fireEvent.click(within(dialog).getByRole("button", { name: `Remove k${i}` }));
  expect(screen.getByRole("dialog", { name: "Selected references" })).toBe(dialog);
  expect(within(dialog).getAllByRole("row")).toHaveLength(6);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect((document.activeElement as HTMLElement).closest<HTMLElement>("[data-chip-item]")?.dataset.chipId).toBe(JSON.stringify(idKey(records[3]!.id))));
});


test.each([false, true])("widening removes the count-only trigger without losing owned focus or stealing another control (elsewhere=%s)", async (elsewhere) => {
  const geometry = layout(); vi.stubGlobal("innerWidth", 360);
  render(<><input aria-label="Elsewhere" />{shelf({ selected: chosen([record("a"), record("b"), record("c")]) })}</>);
  const trigger = screen.getByRole("button", { name: "Show all 3 selected references" });
  const other = screen.getByRole("textbox", { name: "Elsewhere" });
  act(() => (elsewhere ? other : trigger).focus());
  vi.stubGlobal("innerWidth", 720); geometry.resize(1000);
  expect(screen.queryByRole("button", { name: "Show all 3 selected references" })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(elsewhere ? other : screen.getAllByRole("row")[0]));
});

test("closing a resized disclosure returns the same identity when its trigger no longer fits the closed strip", async () => {
  const geometry = layout(); geometry.resize(400);
  const records = Array.from({ length: 9 }, (_, i) => record(`k${i}`, `Author${i}`));
  function Picker() {
    const [selected, setSelected] = useState(chosen(records));
    return shelf({ selected, onRemove: (ids) => setSelected((latest) => new Map([...latest].filter(([id]) => !ids.has(id)))) });
  }
  render(<Picker />);
  fireEvent.click(screen.getByRole("button", { name: "Show all 9 selected references" }));
  const dialog = await screen.findByRole("dialog", { name: "Selected references" });
  for (let i = 0; i < 6; i++) fireEvent.click(within(dialog).getByRole("button", { name: `Remove k${i}` }));
  const identity = idKey(records[7]!.id);
  act(() => within(dialog).getAllByRole("row").find((row) => row.dataset.chipId === JSON.stringify(identity))!.focus());
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("button", { name: "Show all 3 selected references" })).toBeNull();
  await waitFor(() => expect((document.activeElement as HTMLElement).closest<HTMLElement>("[data-chip-item]")?.dataset.chipId).toBe(JSON.stringify(identity)));
});
