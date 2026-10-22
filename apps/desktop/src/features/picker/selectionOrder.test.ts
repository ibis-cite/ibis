import { expect, test } from "vitest";
import type { SearchResult } from "../../api";
import { choiceKey, idKey } from "./choice";
import { reorderSelection } from "./selectionOrder";

const record = (source: string, native_key: string): SearchResult => ({
  revision: "1", id: { source, native_key }, key: "shared", title: "Same title", authors: "Example",
  first_author: "Example", author_count: 1, year: 2026, matched: ["title"], container: null, item_type: "book",
});
const records = [record("first.bib", "a"), record("second.bib", "a"), record("first.bib", "c")];
const [a, b, c] = records.map((item) => idKey(item.id)) as [string, string, string];
const selection = () => new Map(records.map((item) => [idKey(item.id), item]));

test("reordering uses source-qualified identity and sets preview and copy order without changing metadata", () => {
  const original = selection();
  const next = reorderSelection(original, new Set([b]), a, "before");
  expect([...next.keys()]).toEqual([b, a, c]);
  expect([...next.values()]).toEqual([records[1], records[0], records[2]]);
  expect(choiceKey([...next.values()])).toBe(choiceKey([records[1]!, records[0]!, records[2]!]));
  expect([...original.keys()]).toEqual([a, b, c]);
});

test("multiple moved records retain current relative order, not drag payload order", () => {
  const next = reorderSelection(selection(), new Set([c, a]), b, "after");
  expect([...next.keys()]).toEqual([b, a, c]);
});

test("unknown records and missing targets cannot add or move membership", () => {
  const original = selection();
  expect(reorderSelection(original, new Set(["Example 2026a"]), a, "after")).toBe(original);
  expect(reorderSelection(original, new Set([b]), "unknown", "before")).toBe(original);
  expect(reorderSelection(original, new Set([b]), b, "before")).toBe(original);
  expect(reorderSelection(original, new Set(), a, "before")).toBe(original);
  expect([...reorderSelection(original, new Set(["unknown", b]), a, "before").keys()]).toEqual([b, a, c]);
});

test("a stale operation cannot restore a removed record or target", () => {
  const latest = selection();
  latest.delete(b);
  expect(reorderSelection(latest, new Set([b]), a, "before")).toBe(latest);
  expect(reorderSelection(latest, new Set([a]), b, "after")).toBe(latest);
  const sameKey = record("new.bib", "a");
  latest.set(idKey(sameKey.id), sameKey);
  expect(reorderSelection(latest, new Set([b]), a, "after")).toBe(latest);
  expect([...latest.values()]).toEqual([records[0], records[2], sameKey]);
});

test("stale repeated operations preserve newer metadata, additions and focused identity", () => {
  const updated = { ...records[0]!, revision: "2", title: "Newer title" };
  const added = record("third.bib", "d");
  const latest = selection().set(a, updated).set(idKey(added.id), added);
  const moved = reorderSelection(latest, new Set([b]), a, "before");
  expect([...moved.keys()]).toEqual([b, a, c, idKey(added.id)]);
  expect(moved.get(a)).toBe(updated);
  expect(moved.get(b)).toBe(records[1]);
  expect(reorderSelection(moved, new Set([b]), a, "before")).toBe(moved);
  expect(reorderSelection(moved, new Set([a]), c, "before")).toBe(moved);
});

test("an empty selection remains empty under a stale reorder", () => {
  const empty = new Map<string, SearchResult>();
  expect(reorderSelection(empty, new Set([a]), b, "before")).toBe(empty);
});
