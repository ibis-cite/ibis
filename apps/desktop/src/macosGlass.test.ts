import { expect, test, vi } from "vitest";

// Vitest can load these existing runtime builtins without a Node-types dependency.
const { readFileSync } = await vi.importActual<{ readFileSync: (path: URL, encoding: string) => string }>("node:fs");
const { URL: FileURL } = await vi.importActual<{ URL: typeof URL }>("node:url");
const read = (name: string) => readFileSync(new FileURL(`./${name}`, import.meta.url), "utf8");
const tokens = read("tokens.css");
const native = read("nativeAppearance.css");

/** The macOS glass token block: one rule, inside its contrast guard. */
function macBlock(): { guard: string; body: string } {
  const match = tokens.match(/@supports \(color: light-dark\(white, black\)\) \{\s*(@media [^{]+)\{\s*:root\[data-platform="macos"\] \{([^{}]*)\}/);
  expect(match, "macOS glass tokens").toBeTruthy();
  return { guard: match![1]!.trim(), body: match![2]! };
}

function rgba(body: string, token: string): [number, number, number, number][] {
  const value = body.match(new RegExp(`${token}:\\s*light-dark\\(([^;]+)\\);`))?.[1];
  expect(value, token).toBeTruthy();
  return [...value!.matchAll(/rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)%\)/g)].map((m) => [+m[1]!, +m[2]!, +m[3]!, +m[4]! / 100]);
}

function hexes(body: string, token: string): number[][] {
  const value = body.match(new RegExp(`${token}:\\s*light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`));
  expect(value, token).toBeTruthy();
  return [value![1]!, value![2]!].map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
}

const luminance = (rgb: number[]) => rgb.map((c) => c / 255).map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
  .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
const contrast = (a: number[], b: number[]) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter! + .05) / (darker! + .05);
};

test("the macOS glass look applies only to macOS and never under increased contrast or forced colours", () => {
  const { guard } = macBlock();
  expect(guard).toBe("@media (prefers-contrast: no-preference) and (forced-colors: none)");
  expect(native).toMatch(/@media \(prefers-contrast: no-preference\) and \(forced-colors: none\) \{/);
  // Every macOS element rule is scoped to macOS and skips the contrast preview.
  const scoped = native.slice(native.indexOf("@media (prefers-contrast: no-preference)")).replace(/\/\*[^]*?\*\//g, "");
  for (const [, head] of scoped.matchAll(/\n\s*([^{}\n/][^{}]*)\{/g)) {
    expect(head!.trim()).toMatch(/^:root\[data-platform="macos"\][^ ]*:not\(\[data-gallery-theme="contrast"\]\)/);
  }
  // Windows and Linux rules are untouched by the macOS block.
  expect(macBlock().body).not.toMatch(/data-platform="(windows|linux)"/);
});

test("macOS fills and hairlines are translucent so the native material shows through", () => {
  const { body } = macBlock();
  for (const token of ["--line", "--hover-background", "--button-background", "--button-hover-background"]) {
    for (const [, , , alpha] of rgba(body, token)) expect(alpha, token).toBeLessThan(.2);
  }
  expect(body).toMatch(/--search-active-border:\s*var\(--line\)/);
});

test("only native success shows the material, under a veil; reduced transparency stays opaque", () => {
  // Never bare: webviews without light-dark() fall back to the surface at 55%.
  expect(native).toMatch(/:root\[data-native-appearance="vibrancy"\] \{ background: var\(--vibrancy-tint, color-mix\(in srgb, var\(--surface\) 55%, transparent\)\); \}/);
  expect(native).toMatch(/:root\[data-native-appearance="mica"\] \{ background: transparent; \}/);
  // The defensive override comes after, with the same specificity, so it wins.
  const veil = native.indexOf('[data-native-appearance="vibrancy"] { background');
  const fallback = native.indexOf("@media (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)");
  expect(fallback).toBeGreaterThan(veil);
  expect(native.slice(fallback)).toMatch(/:root\[data-native-appearance\] \{ background: var\(--surface\); \}/);
  // The panel edge and glass menus exist only while the material is applied.
  expect(native).toMatch(/\[data-native-appearance="vibrancy"\][^{]*body::after/);
  expect(native).toMatch(/\[data-native-appearance="vibrancy"\][^{]*\[role="menu"\][^{]*\{[^}]*backdrop-filter/);
});

test("secondary text keeps 4.5:1 over the veiled material, on the brightest and darkest backdrops", () => {
  const { body } = macBlock();
  const [light, dark] = rgba(body, "--vibrancy-tint");
  const muted = hexes(body, "--muted");
  const text = hexes(body, "--text");
  // CI's appearance probe (#232) saw the light Popover material lift a black
  // channel to 141; the dark material is assumed no brighter than 120 over white.
  const over = (veil: [number, number, number, number], under: number) => veil.slice(0, 3).map((c) => c * veil[3] + under * (1 - veil[3]));
  for (const under of [141, 255]) {
    expect(contrast(muted[0]!, over(light!, under))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text[0]!, over(light!, under))).toBeGreaterThanOrEqual(7);
  }
  for (const under of [0, 120]) {
    expect(contrast(muted[1]!, over(dark!, under))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text[1]!, over(dark!, under))).toBeGreaterThanOrEqual(7);
  }
});
