import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SearchResult } from "../../api";
import { ReferenceDetails } from "./ReferenceDetails";

afterEach(cleanup);

const reference: SearchResult = {
  revision: "1", id: { source: "SYNTHETIC_PRIVATE_SOURCE", native_key: "garcia2021" }, key: "garcia2021",
  title: "A synthetic reference", authors: "García, Okafor and Lindqvist", year: 2021, matched: [],
  first_author: "García", author_count: 3, container: "Synthetic Journal", item_type: "article-journal",
};

test("details preserve supplied reference text without source paths or further author abbreviation", () => {
  render(<ReferenceDetails reference={reference} />);
  const details = screen.getByRole("region", { name: "Reference details" });
  expect(screen.getByRole("heading", { level: 2, name: reference.title })).toBeTruthy();
  for (const text of ["Article", reference.authors, "2021", reference.container!, reference.key]) {
    expect(details.textContent).toContain(text);
  }
  expect(details.textContent).not.toContain(reference.id.source);
  expect(details.textContent).not.toContain("et al.");
});

test("moving the highlight replaces details and clearing it removes stale metadata", () => {
  const { rerender } = render(<ReferenceDetails reference={reference} />);
  rerender(<ReferenceDetails reference={{ ...reference, key: "other", title: "Another reference", authors: "Other author" }} />);
  expect(screen.queryByText(reference.title)).toBeNull();
  expect(screen.getByText("Other author")).toBeTruthy();
  rerender(<ReferenceDetails reference={null} />);
  expect(screen.queryByRole("region", { name: "Reference details" })).toBeNull();
});

test("missing metadata uses the key and no-date label without empty separators", () => {
  render(<ReferenceDetails reference={{ ...reference, title: "", authors: "", year: null, container: null, item_type: "unknown" }} />);
  expect(screen.getByRole("heading", { name: reference.key })).toBeTruthy();
  expect(screen.getByText("No date")).toBeTruthy();
  expect(document.querySelectorAll(".reference-details p:empty")).toHaveLength(0);
  expect(document.querySelector(".reference-details")!.textContent).not.toContain("·");
});

test("whitespace-only metadata uses the key without blank paragraphs or separators", () => {
  render(<ReferenceDetails reference={{ ...reference, title: " \n\t", authors: " \u00a0", container: "\t " }} />);
  expect(screen.getByRole("heading", { name: reference.key })).toBeTruthy();
  expect(document.querySelector(".reference-publication")!.textContent).toBe("2021");
  expect([...document.querySelectorAll(".reference-details p")].every((p) => p.textContent!.trim())).toBe(true);
});

test("hostile and mixed-direction metadata remains isolated literal text", () => {
  const title = "العربية <img src=x onerror=alert(1)> " + "🔬".repeat(4096);
  render(<ReferenceDetails reference={{ ...reference, title, authors: "עברית & Latin", key: "مفتاح2021", year: 0 }} />);
  expect(screen.getByRole("heading", { name: title }).querySelector("bdi")?.getAttribute("dir")).toBe("auto");
  expect(screen.getByText("עברית & Latin").getAttribute("dir")).toBe("auto");
  expect(screen.getByText("مفتاح2021").getAttribute("dir")).toBe("auto");
  expect(screen.getByText("0")).toBeTruthy();
  expect(document.querySelector("img, script")).toBeNull();
});
