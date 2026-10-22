import type { SearchResult } from "../../api";

/** Apply a chip move to the latest source-qualified selection. */
export function reorderSelection(selected: Map<string, SearchResult>, moving: ReadonlySet<string>, target: string, position: "before" | "after"): Map<string, SearchResult> {
  if (!selected.has(target) || moving.has(target)) return selected;
  const entries = [...selected];
  const moved = entries.filter(([id]) => moving.has(id));
  if (moved.length === 0) return selected;
  const rest = entries.filter(([id]) => !moving.has(id));
  const index = rest.findIndex(([id]) => id === target) + (position === "after" ? 1 : 0);
  const reordered = [...rest.slice(0, index), ...moved, ...rest.slice(index)];
  return reordered.every(([id], i) => id === entries[i]![0]) ? selected : new Map(reordered);
}
