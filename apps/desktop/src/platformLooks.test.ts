import { afterEach, expect, test, vi } from "vitest";
import { platformOf, setPlatform } from "./nativeAppearance";

// Vitest can load these existing runtime builtins without a Node-types dependency.
const { readFileSync } = await vi.importActual<{ readFileSync: (path: URL, encoding: string) => string }>("node:fs");
const { URL: FileURL } = await vi.importActual<{ URL: typeof URL }>("node:url");

const tokens = readFileSync(new FileURL("./tokens.css", import.meta.url), "utf8");
const styles = readFileSync(new FileURL("./styles.css", import.meta.url), "utf8");
const corners = readFileSync(new FileURL("../src-tauri/src/native_corners.rs", import.meta.url), "utf8");

afterEach(() => { delete document.documentElement.dataset.platform; });

/** Every declaration block whose selector list is, or includes, `selector`, joined. */
function rules(css: string, selector: string): string {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, head]) => {
      const list = head!.replace(/\/\*[^]*?\*\//g, "").trim();
      return list === selector || list.split(/\s*,\s*/).includes(selector);
    })
    .map(([, , body]) => body)
    .join(";");
}

test("the platform comes from the same signal as the shortcut labels", () => {
  expect(platformOf("MacIntel")).toBe("macos");
  expect(platformOf("iPad")).toBe("macos");
  expect(platformOf("Win32")).toBe("windows");
  expect(platformOf("Linux x86_64")).toBe("linux");
  expect(platformOf("")).toBe("linux");
  setPlatform("Win32");
  expect(document.documentElement.dataset.platform).toBe("windows");
});

test("the search header is the 48–56 px search bar, not an 80 px block", () => {
  const bar = rules(styles, ".search-bar");
  expect(bar).toMatch(/min-height:\s*var\(--search-bar-height\)/);
  const padding = tokens.match(/--search-padding:\s*([^;]+);/)?.[1];
  expect(padding).toBe("var(--space-1) var(--space-4)");
  expect(tokens).toMatch(/--search-bar-height:\s*3\.5rem/);
});

test("Windows and Linux search in a 16 px framed box; macOS stays frameless and large", () => {
  const framed = rules(tokens, ':root[data-platform="windows"], :root[data-platform="linux"]');
  expect(framed).toMatch(/--search-size:\s*1rem/);
  expect(rules(styles, ':root[data-platform="windows"] #search')).toMatch(/border:/);
  expect(rules(styles, ':root[data-platform="windows"] #search:focus')).toMatch(/var\(--accent\)/);
  expect(rules(styles, ':root[data-platform="linux"] #search')).toMatch(/border-radius:/);
  expect(tokens).toMatch(/--search-size:\s*var\(--type-search-size\)/);
});

test("the selected row follows each platform", () => {
  const active = rules(styles, '[role="option"][data-active]');
  expect(active).toMatch(/background:\s*var\(--row-active-background\)/);
  expect(active).toMatch(/color:\s*var\(--row-active-text\)/);
  // macOS (the default): filled accent with white text.
  expect(tokens).toMatch(/--row-active-background:\s*var\(--selected-background\)/);
  expect(tokens).toMatch(/--selected-background:\s*AccentColor/);
  expect(tokens).toMatch(/--selected-text:\s*AccentColorText/);
  // Windows: soft grey with an accent pill; Linux: accent tint.
  expect(rules(tokens, ':root[data-platform="windows"]')).toMatch(/--row-active-background:\s*color-mix\(in srgb, var\(--text\)/);
  expect(rules(styles, ':root[data-platform="windows"] [role="option"][data-active]::before')).toMatch(/background:\s*var\(--accent\)/);
  expect(rules(tokens, ':root[data-platform="linux"]')).toMatch(/--row-active-background:\s*color-mix\(in srgb, var\(--accent\)/);
});

test("high contrast keeps a non-colour edge on the active row", () => {
  const contrast = styles.slice(styles.indexOf("@media (prefers-contrast: more)"));
  expect(rules(contrast, '[role="option"][data-active]')).toMatch(/border-color:\s*var\(--active-edge\)/);
});

test("window radius follows each platform and macOS matches the native corner", () => {
  // macOS keeps the natively verified 12 pt corner for 0.2; the token must agree with it.
  const native = corners.match(/CORNER_RADIUS_POINTS: f64 = ([\d.]+);/)?.[1];
  expect(rules(tokens, ":root")).toMatch(new RegExp(`--window-radius:\\s*${Number(native)}px`));
  expect(rules(tokens, ':root[data-platform="windows"]')).toMatch(/--window-radius:\s*8px/);
  expect(rules(tokens, ':root[data-platform="windows"]')).toMatch(/--button-radius:\s*4px/);
  expect(rules(tokens, ':root[data-platform="linux"]')).toMatch(/--window-radius:\s*14px/);
});

test("scarlet marks only the citation: copied text, preview and tray", () => {
  const scarlet = [...styles.matchAll(/([^{}]+)\{[^{}]*var\(--citation\)[^{}]*\}/g)].map(([, head]) => head!.trim()).join(",");
  for (const target of [".copy-notice code", ".format-preview .preview-text", '[aria-label="Selected references"] code']) {
    expect(scarlet, target).toContain(target);
  }
  // Selection, the pin and the main controls keep the system accent.
  expect(scarlet).not.toMatch(/button|\.search-bar|::before|\[role="option"\]\[data-active\]\s*(,|$)/);
  // Contrast and forced colours fall back to CanvasText.
  for (const media of ["@media (prefers-contrast: more)", "@media (forced-colors: active)"]) {
    expect(tokens.slice(tokens.indexOf(media))).toMatch(/--citation:\s*CanvasText/);
  }
});

test("meta text on the Windows grey row stays at 4.5:1 in both themes", () => {
  const hex = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const luminance = (rgb: number[]) => rgb.map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
  const pair = (token: string) => tokens.match(new RegExp(`${token}:\\s*light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`))!.slice(1, 3).map(hex);
  const tint = Number(rules(tokens, ':root[data-platform="windows"]').match(/--row-active-background:\s*color-mix\(in srgb, var\(--text\) (\d+)%/)?.[1]) / 100;
  const [surface, text, muted] = [pair("--surface"), pair("--text"), pair("--muted")];
  for (const mode of [0, 1]) {
    const row = surface[mode]!.map((c: number, i: number) => c * (1 - tint) + text[mode]![i]! * tint);
    const [lighter, darker] = [luminance(muted[mode]!), luminance(row)].sort((a, b) => b - a);
    expect((lighter! + .05) / (darker! + .05)).toBeGreaterThanOrEqual(4.5);
  }
});
