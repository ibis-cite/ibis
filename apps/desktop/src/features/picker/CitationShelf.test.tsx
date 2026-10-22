import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { SearchResult } from "../../api";
import { chipLabels, CitationShelf } from "./CitationShelf";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function record(key: string, first_author = "García", year: number | null = 2021): SearchResult {
  return {
    revision: "1", id: { source: "refs.bib", native_key: key }, key, title: `Title ${key}`, authors: first_author,
    year, matched: ["title"], first_author, author_count: 1, container: null, item_type: "book",
  };
}

function chosen(records: SearchResult[]) {
  return new Map(records.map((r) => [r.key, r]));
}

const shelf = (props: Partial<Parameters<typeof CitationShelf>[0]>) => (
  <CitationShelf announce={false} selected={new Map()} removeLabel={(r) => `Remove ${r.key}`} onRemove={() => undefined}
    style={null} keys shown={undefined} focusable={false} {...props} />
);

test("chip labels keep unique author/year or key fallbacks", () => {
  expect(chipLabels([record("a"), record("b", "Okafor", 2019), record("c", "", null)])).toEqual(["García 2021", "Okafor 2019", "c"]);
  expect(chipLabels([record("a", "", 0), record("b", "Example", -42)])).toEqual(["0", "Example -42"]);
});

test("colliding chip labels use year letters even when titles and citation keys match", () => {
  const first = { ...record("shared"), title: "Same title", id: { source: "zotero:user", native_key: "A" } };
  const second = { ...first, id: { source: "zotero:group:3", native_key: "B" } };
  const differentTitle = { ...record("other"), title: "Different title" };
  const records = [first, second, differentTitle];
  const original = JSON.stringify(records);
  expect(chipLabels(records)).toEqual(["García 2021a", "García 2021b", "García 2021c"]);
  expect(JSON.stringify(records)).toBe(original);
  expect(chipLabels([second, first])).toEqual(["García 2021a", "García 2021b"]);
  expect(chipLabels([second])).toEqual(["García 2021"]);
});

test("collision letters follow each group in selection order beyond z", () => {
  const records = Array.from({ length: 50 }, (_, i) => record(`key${i}`));
  const labels = chipLabels(records);
  expect(labels.slice(0, 2)).toEqual(["García 2021a", "García 2021b"]);
  expect(labels.slice(25, 28)).toEqual(["García 2021z", "García 2021aa", "García 2021ab"]);
  expect(labels.at(-1)).toBe("García 2021ax");
  expect(new Set(labels).size).toBe(50);
  expect(chipLabels([record("a"), record("b", "Okafor"), record("c"), record("d", "Okafor")]))
    .toEqual(["García 2021a", "Okafor 2021a", "García 2021b", "Okafor 2021b"]);
});

test("visually identical whitespace and Unicode authors share a collision group", () => {
  expect(chipLabels([record("a", " Garci\u0301a "), record("b", "García")]))
    .toEqual(["García 2021a", "García 2021b"]);
  expect(chipLabels([record("a", "Example   Group"), record("b", "Example\tGroup")]))
    .toEqual(["Example Group 2021a", "Example Group 2021b"]);
});

test("equal titles do not merge different author/year groups, and missing dates still disambiguate", () => {
  expect(chipLabels([record("a", "García", null), record("b", "García", null)]))
    .toEqual(["García a", "García b"]);
  expect(chipLabels([record("a", "García", 2020), record("b", "Okafor", 2020), record("c", "García", 2021)]))
    .toEqual(["García 2020", "Okafor 2020", "García 2021"]);
});

test("chip labels preserve literal hostile, huge, RTL and CJK metadata without parsing authors", () => {
  const author = '<img src=x onerror="attack()"> العربية 漢字' + "長".repeat(10_000);
  const first = { ...record("a", author), authors: "Organization, Division, Other author" };
  const second = { ...record("b", author), authors: "Different, Joined, Authors" };
  expect(chipLabels([first, second])).toEqual([`${author} 2021a`, `${author} 2021b`]);
  expect(chipLabels([record("a", "", null), record("a", "", null)])).toEqual(["a a", "a b"]);
});

test("six chips show, the rest fold into +N, and +N shows every chip so each can be removed", () => {
  const records = Array.from({ length: 9 }, (_, i) => record(`k${i}`, `Author${i}`));
  const onRemove = vi.fn();
  render(shelf({ selected: chosen(records), onRemove }));
  const list = screen.getByRole("list", { name: "Selected references" });
  expect(within(list).getAllByRole("button", { name: /^Remove/ })).toHaveLength(6);
  const more = within(list).getByRole("button", { name: "Show all 9 selected references" });
  expect(more.textContent).toBe("+3");
  expect(more.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(more);
  expect(within(list).getAllByRole("button", { name: /^Remove/ })).toHaveLength(9);
  fireEvent.click(within(list).getByRole("button", { name: "Remove k8" }));
  expect(onRemove).toHaveBeenCalledWith(records[8]);
  // Each chip names its whole key to the pointer.
  expect(within(list).getByText("Author8 2021").closest("li")?.getAttribute("title")).toBe("k8");
});

test("50 choices fit narrow and 200% text rows, keeping hidden source identities removable", () => {
  let scale = 1;
  let width = 344;
  const observers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    disconnect = vi.fn();
    observe = vi.fn();
    constructor(callback: () => void) {
      let active = false;
      this.observe = vi.fn(() => { active = true; });
      this.disconnect = vi.fn(() => { active = false; });
      observers.push({ callback: () => { if (active) callback(); }, disconnect: this.disconnect });
    }
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("shelf-chips") ? width : 0; });
  const computed = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    if (!element.matches(".chip, .shelf-chips")) return computed(element);
    const style = document.createElement("div").style;
    style.minWidth = `${80 * scale}px`;
    style.columnGap = `${4 * scale}px`;
    style.paddingInlineStart = style.paddingInlineEnd = `${12 * scale}px`;
    return style;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, this.matches(".chip-more button") ? 40 * scale : 0, 24 * scale);
  });
  const records = Array.from({ length: 50 }, (_, i) => ({ ...record(`shared${i % 25}`, `Author${i}`),
    id: { source: i < 25 ? "first.bib" : "second.bib", native_key: `entry${i}` } }));
  const onRemove = vi.fn();
  function Picker() {
    const [selected, setSelected] = useState(new Map(records.map((r, i) => [`identity${i}`, r])));
    return shelf({ selected, removeLabel: (r) => `Remove ${r.id.source}/${r.id.native_key}`, onRemove: (r) => {
      onRemove(r); setSelected((previous) => new Map([...previous].filter(([, value]) => value !== r)));
    } });
  }
  const view = render(<Picker />);
  const list = screen.getByRole("list", { name: "Selected references" });
  const removeButtons = () => within(list).getAllByRole("button", { name: /^Remove/ });
  expect(removeButtons()).toHaveLength(3);
  expect(within(list).getByRole("button", { name: "Show all 50 selected references" }).textContent).toBe("+47");
  scale = 2; width = 328;
  act(() => { for (const observer of [...observers]) observer.callback(); });
  expect(removeButtons()).toHaveLength(1);
  const more = within(list).getByRole("button", { name: "Show all 50 selected references" });
  expect(more.textContent).toBe("+49");
  fireEvent.click(more);
  expect(removeButtons().map((button) => button.getAttribute("aria-label"))).toEqual(records.map((r) => `Remove ${r.id.source}/${r.id.native_key}`));
  fireEvent.click(within(list).getByRole("button", { name: "Remove second.bib/entry49" }));
  expect(onRemove).toHaveBeenCalledWith(records[49]);
  expect(removeButtons()).toHaveLength(49);
  expect(within(list).getByRole("button", { name: "Remove first.bib/entry24" })).toBeTruthy();
  fireEvent.click(within(list).getByRole("button", { name: "Show fewer selected references" }));
  expect(within(list).getByRole("button", { name: "Show all 49 selected references" }).textContent).toBe("+48");
  scale = 1; width = 1000;
  act(() => { for (const observer of [...observers]) observer.callback(); });
  expect(removeButtons()).toHaveLength(6);
  expect(within(list).getByRole("button", { name: "Show all 49 selected references" }).textContent).toBe("+43");
  removeButtons()[5]!.focus();
  width = 344;
  act(() => { for (const observer of [...observers]) observer.callback(); });
  expect(removeButtons()).toHaveLength(3);
  expect(document.activeElement).toBe(within(list).getByRole("button", { name: "Show all 49 selected references" }));
  width = 1000;
  act(() => { for (const observer of [...observers]) observer.callback(); });
  fireEvent.click(within(list).getByRole("button", { name: "Show all 49 selected references" }));
  scale = 2; width = 328;
  act(() => { for (const observer of [...observers]) observer.callback(); });
  for (let remaining = 49; remaining > 6; remaining--) fireEvent.click(removeButtons().at(-1)!);
  expect(list.hasAttribute("data-expanded")).toBe(true);
  fireEvent.click(within(list).getByRole("button", { name: "Show fewer selected references" }));
  expect(removeButtons()).toHaveLength(1);
  expect(within(list).getByRole("button", { name: "Show all 6 selected references" }).textContent).toBe("+5");
  scale = 1; width = 1000;
  act(() => { for (const observer of [...observers]) observer.callback(); });
  expect(within(list).queryByRole("button", { name: "Show all 6 selected references" })).toBeNull();
  removeButtons()[5]!.focus();
  width = 344;
  act(() => { for (const observer of [...observers]) observer.callback(); });
  expect(document.activeElement).toBe(within(list).getByRole("button", { name: "Show all 6 selected references" }));
  view.unmount();
  expect(observers.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(true);
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

test("nothing chosen and nothing to show draws no shelf", () => {
  const { container } = render(shelf({}));
  expect(container.querySelector(".shelf")).toBeNull();
});
