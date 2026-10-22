import { expect, test, vi } from "vitest";

const { readFileSync } = await vi.importActual<{ readFileSync: (path: URL, encoding: string) => string }>("node:fs");
const { URL: FileURL } = await vi.importActual<{ URL: typeof URL }>("node:url");

const styles = readFileSync(new FileURL("./CitationShelf.css", import.meta.url), "utf8");
const listStyles = readFileSync(new FileURL("./SelectedChipList.css", import.meta.url), "utf8");
const beforeContrast = styles.slice(0, styles.lastIndexOf("@media (prefers-contrast: more), (forced-colors: active) {"));

test("the chip strip keeps one shelf line and uses a fill instead of an outline", () => {
  expect(beforeContrast.match(/\.shelf-chips \{([^}]+)\}/)?.[1]).toMatch(/height:\s*var\(--shelf-line\)/);
  const chip = beforeContrast.match(/\.shelf-chips \.chip-group-item, \.selected-chip-item \{([^}]+)\}/)?.[1];
  expect(chip).toMatch(/background:\s*var\(--chip-fill\)/);
  expect(chip).not.toMatch(/border:/);
});

test("contrast chips retain an edge when fills disappear", () => {
  const contrast = styles.slice(beforeContrast.length);
  expect(contrast).toMatch(/\.shelf-chips \.chip-group-item, \.selected-chip-item \{\s*border:\s*var\(--border-width\) solid CanvasText/);
});

test("the React Aria insertion target has a visible token-coloured line", () => {
  expect(listStyles.match(/\.selected-chip-drop \{([^}]+)\}/)?.[1]).toMatch(/width:\s*var\(--focus-ring-width\)/);
  expect(listStyles.match(/\.selected-chip-drop\[data-drop-target\] \{([^}]+)\}/)?.[1]).toMatch(/background:\s*var\(--accent-text\)/);
});
