import { expect, test } from "vitest";
import type { SearchResult } from "../../api";
import { chipLabelParts, chipLabels } from "./chipLabels";

function record(key: string, first_author = "García", year: number | null = 2021): SearchResult {
  return {
    revision: "1", id: { source: "refs.bib", native_key: key }, key, title: `Title ${key}`, authors: first_author,
    year, matched: ["title"], first_author, author_count: 1, container: null, item_type: "book",
  };
}

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
  expect(chipLabels([record("a", "García", 2020), record("b", "Okafor", 2020), record("c", "García", 2021)]
    .map((item) => ({ ...item, title: "Same title" }))))
    .toEqual(["García 2020", "Okafor 2020", "García 2021"]);
});

test("chip labels preserve literal hostile, huge, RTL and CJK metadata without parsing authors", () => {
  const author = '<img src=x onerror="attack()"> العربية 漢字' + "長".repeat(10_000);
  const first = { ...record("a", author), authors: "Organization, Division, Other author" };
  const second = { ...record("b", author), authors: "Different, Joined, Authors" };
  expect(chipLabels([first, second])).toEqual([`${author} 2021a`, `${author} 2021b`]);
  expect(chipLabels([record("a", "", null), record("a", "", null)])).toEqual(["a a", "a b"]);
});

test("label parts separate the year and letter from the author", () => {
  expect(chipLabelParts([record("a"), record("b")])).toEqual([
    { author: "García", year: "2021", letter: "a", text: "García 2021a" },
    { author: "García", year: "2021", letter: "b", text: "García 2021b" },
  ]);
  expect(chipLabelParts([])).toEqual([]);
});

test("empty metadata falls back through the key, native key, title and a named reference", () => {
  const empty = { ...record("", "", null), title: "" };
  expect(chipLabels([{ ...empty, id: { source: "synthetic", native_key: "opaque" } }])).toEqual(["opaque"]);
  expect(chipLabels([{ ...empty, title: "Synthetic title" }])).toEqual(["Synthetic title"]);
  expect(chipLabels([empty, empty])).toEqual(["Untitled reference a", "Untitled reference b"]);
});
