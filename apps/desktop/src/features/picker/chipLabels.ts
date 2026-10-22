// Display labels only. Record identities, citation keys and copy order stay with the caller.
import type { SearchResult } from "../../api";
import { pickerText } from "../../messages";

type LabelSource = Pick<SearchResult, "first_author" | "year" | "key" | "title" | "id">;
/** Keep the year and collision letter separate so only the author can ellipsize. */
export type ChipLabel = { author: string; year: string; letter: string; text: string };
const alphabet = "abcdefghijklmnopqrstuvwxyz";
const display = (text: string) => text.trim().replace(/\s+/gu, " ").normalize("NFC");
const joined = (author: string, year: string) => [author, year].filter(Boolean).join(" ");

function letter(index: number): string {
  let value = "";
  do {
    value = alphabet.charAt(index % alphabet.length) + value;
    index = Math.floor(index / alphabet.length) - 1;
  } while (index >= 0);
  return value;
}

/** Collisions use a, b, … z, aa in selection order, not bibliography order.
 * Normalize only the display; the full source metadata remains untouched. */
export function chipLabelParts(records: readonly LabelSource[]): ChipLabel[] {
  const labels = records.map((record) => {
    const year = record.year === null ? "" : String(record.year);
    const author = display(record.first_author) || (year ? "" : display(record.key) || display(record.id.native_key)
      || display(record.title) || pickerText.unnamedReference);
    return { author, year, text: joined(author, year) };
  });
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label.text, (counts.get(label.text) ?? 0) + 1);
  const seen = new Map<string, number>();
  const parts = labels.map(({ author, year, text }) => {
    const index = seen.get(text) ?? 0;
    seen.set(text, index + 1);
    const suffix = (counts.get(text) ?? 0) > 1 ? letter(index) : "";
    return { author, year, letter: suffix, text: joined(author, year + suffix) };
  });
  // A natural author or fallback key can itself look like a generated label.
  // Keep year letters stable; repair the natural label without taking another
  // record's natural or generated display text.
  const reserved = new Set([...labels.map(({ text }) => text), ...parts.map(({ text }) => text)]);
  const used = new Set(parts.filter(({ letter }) => letter).map(({ text }) => text));
  return parts.map((part) => {
    if (part.letter) return part;
    if (!used.has(part.text)) { used.add(part.text); return part; }
    let index = 0;
    let suffix: string;
    let text: string;
    do {
      suffix = letter(index++);
      text = `${part.text} ${suffix}`;
    } while (reserved.has(text) || used.has(text));
    used.add(text);
    return { ...part, letter: suffix, text };
  });
}

export const chipLabels = (records: readonly LabelSource[]): string[] => chipLabelParts(records).map((label) => label.text);
