import { expect, test, vi } from "vitest";

const { readFileSync } = await vi.importActual<{ readFileSync: (path: URL, encoding: string) => string }>("node:fs");
const { URL: FileURL } = await vi.importActual<{ URL: typeof URL }>("node:url");

const styles = readFileSync(new FileURL("./CitationShelf.css", import.meta.url), "utf8");
const beforeContrast = styles.slice(0, styles.lastIndexOf("@media (prefers-contrast: more), (forced-colors: active) {"));

test("the chip strip keeps one shelf line and uses a fill instead of an outline", () => {
  expect(beforeContrast.match(/\.shelf-chips \{([^}]+)\}/)?.[1]).toMatch(/height:\s*var\(--shelf-line\)/);
  const chip = beforeContrast.match(/\.chip \{([^}]+)\}/)?.[1];
  expect(chip).toMatch(/background:\s*var\(--chip-fill\)/);
  expect(chip).not.toMatch(/border:/);
});

test("contrast chips retain an edge when fills disappear", () => {
  const contrast = styles.slice(beforeContrast.length);
  expect(contrast).toMatch(/\.chip \{\s*border:\s*var\(--border-width\) solid CanvasText/);
});
