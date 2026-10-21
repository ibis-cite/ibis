import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { galleryStates } from "../../gallery-fixtures";
import { EmptyState } from "./EmptyState";

afterEach(cleanup);
const loaded = galleryStates.find((state) => state.id === "no-results")!.library;

function mount(query = "", empty = false) {
  const choose = vi.fn(), clear = vi.fn(), searchAll = vi.fn();
  const { container } = render(<EmptyState library={empty ? { ...loaded, references: 0 } : loaded} query={query}
    narrowed onChooseLibrary={choose} onClearSearch={clear} onSearchAll={searchAll} setup={<p>Setup preserved</p>} />);
  return { container, choose, clear, searchAll };
}

test.each(["", "unmatched"])("one empty-state template has a plain title, description and decorative icon (query=%s)", (query) => {
  const { container } = mount(query);
  expect(container.querySelector(".empty-title")?.textContent).toBe(query ? "No matching references" : "Type to find a reference");
  expect(container.querySelector(".empty-description")?.textContent).toBe(query
    ? "Check the spelling, or try fewer words, an author's surname or a year."
    : "Search by title, author, year, citation key or DOI.");
  expect(container.querySelector(".empty-icon")?.getAttribute("aria-hidden")).toBe("true");
  expect(screen.queryByRole("heading")).toBeNull();
});

test("idle instructions use the footer label-then-keys pattern without offering unavailable actions", () => {
  const { container } = mount();
  const keys = container.querySelector(".empty-keys");
  expect(keys?.getAttribute("aria-hidden")).toBe("true");
  expect([...container.querySelectorAll(".key-hint-label")].map((label) => label.textContent)).toEqual(["Copy", "Add to citation"]);
  expect([...container.querySelectorAll(".key-hint")].every((hint) => hint.firstElementChild?.className === "key-hint-label")).toBe(true);
  expect(screen.queryByRole("button")).toBeNull();
});

test("no matches retain clear-search and search-all actions", () => {
  const { container, clear, searchAll } = mount("unmatched");
  expect(container.querySelector(".empty-actions")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  fireEvent.click(screen.getByRole("button", { name: "Search all Zotero libraries" }));
  expect(clear).toHaveBeenCalledOnce();
  expect(searchAll).toHaveBeenCalledOnce();
});

test("an empty file gets a separate title and recovery line, keeping the chooser", () => {
  const { container, choose } = mount("", true);
  expect(container.querySelector(".empty-title")?.textContent).toBe("No references in example.bib");
  expect(container.querySelector(".empty-description")?.textContent).toBe("Choose a BibTeX or BibLaTeX export with references.");
  fireEvent.click(screen.getByRole("button", { name: "Choose library…" }));
  expect(choose).toHaveBeenCalledOnce();
});
