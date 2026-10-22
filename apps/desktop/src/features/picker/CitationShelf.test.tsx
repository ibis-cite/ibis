import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { SearchResult } from "../../api";
import { chipLabels, CitationShelf } from "./CitationShelf";

afterEach(cleanup);

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

test("chips read as author and year, and add the key only where two would read the same", () => {
  expect(chipLabels([record("a"), record("b", "Okafor", 2019), record("c", "", null)])).toEqual(["García 2021", "Okafor 2019", "c"]);
  expect(chipLabels([record("garcia2021a"), record("garcia2021b")])).toEqual(["García 2021 · garcia2021a", "García 2021 · garcia2021b"]);
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
