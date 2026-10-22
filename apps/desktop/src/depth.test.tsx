import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";
import { galleryProvider, galleryStates } from "./gallery-fixtures";
import { EmptyState } from "./features/picker/EmptyState";

const { existsSync, readFileSync } = await vi.importActual<{
  existsSync: (path: URL) => boolean; readFileSync: (path: URL, encoding: string) => string;
}>("node:fs");
const { URL: FileURL } = await vi.importActual<{ URL: typeof URL }>("node:url");
const read = (name: string) => { const path = new FileURL(`./${name}`, import.meta.url); return existsSync(path) ? readFileSync(path, "utf8") : ""; };
const depth = read("depth.css"), styles = read("styles.css"), tokens = read("tokens.css");
type Rule = { selector: string; style: CSSStyleDeclaration; guards: string[] };
function rules(): Rule[] {
  const element = document.createElement("style"); element.textContent = depth; document.head.append(element);
  const result: Rule[] = [];
  const visit = (list: CSSRuleList, guards: string[]) => {
    for (const rule of Array.from(list)) {
      if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules, [...guards, (rule as CSSConditionRule).conditionText]);
      if ("style" in rule && "selectorText" in rule) result.push({ selector: (rule as CSSStyleRule).selectorText, style: (rule as CSSStyleRule).style, guards });
    }
  };
  if (element.sheet) visit(element.sheet.cssRules, []);
  element.remove();
  expect(result.length, "depth contains live role definitions and consumers").toBeGreaterThan(8);
  return result;
}
const paints = new Set(["background", "background-color", "box-shadow", "border-color", "border-bottom-color", "color"]);
const matchingPaint = (element: Element) => rules().filter((rule) => element.matches(rule.selector)
  && Array.from(rule.style).some((name) => paints.has(name)));
const state = (id: string) => { const found = galleryStates.find((candidate) => candidate.id === id); expect(found).toBeTruthy(); return found!; };

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.platform;
  delete document.documentElement.dataset.nativeAppearance;
  delete document.documentElement.dataset.galleryTheme;
});

test("shared chip layout and touch roles keep the agreed physical values", () => {
  expect(tokens).toMatch(/--chip-count-only-width:\s*460px/);
  expect(tokens).toMatch(/--touch-target:\s*2\.75rem/);
});

test("soft depth is the default imported look, using role tokens without an opt-in gate or CSS glass", () => {
  expect(styles).toContain('@import "./depth.css";');
  expect(styles.indexOf('"./depth.css"')).toBeGreaterThan(styles.indexOf('"./nativeAppearance.css"'));
  expect(depth).not.toMatch(/data-depth|backdrop-filter|\bblur\(|--(?:layer-|cap-|band-shadow|card-shadow)/);
  for (const role of ["surface-window", "surface-raised", "shadow-card", "shadow-raised", "r-card", "r-row", "r-control"]) {
    expect(tokens).toContain(`--${role}:`);
    expect(depth).toContain(`var(--${role})`);
  }
  for (const { style } of rules()) for (const name of Array.from(style)) {
    if (paints.has(name)) expect(style.getPropertyValue(name), name).toMatch(/^(?:var\(--[\w-]+\)|none)$/);
  }
});

test("depth paint always excludes contrast and notice windows, while native tints respect reduced transparency", () => {
  for (const rule of rules()) {
    expect(rule.guards).toContain("(prefers-contrast: no-preference) and (forced-colors: none)");
    expect(rule.selector).toContain(':not([data-gallery-theme="contrast"])');
    expect(rule.selector).toContain(":not(.notice-window)");
    if (rule.selector.includes("data-native-appearance") && Array.from(rule.style).some((name) => /rgb\([^)]*\//.test(rule.style.getPropertyValue(name)))) {
      expect(rule.guards).toContain("(prefers-reduced-transparency: no-preference)");
    }
  }
  document.documentElement.dataset.platform = "macos";
  document.documentElement.dataset.nativeAppearance = "vibrancy";
  expect(matchingPaint(document.documentElement).filter((rule) => rule.style.getPropertyValue("background"))).toEqual([]);
});

test("depth preserves the geometry chain and puts no movement or layout changes on rows and controls", () => {
  expect(depth).not.toMatch(/--(?:r-[\w-]+|inset|row-height|row-pad|tile-size|control-min-size)\s*:/);
  for (const rule of rules()) for (const name of Array.from(rule.style)) {
    if (name.startsWith("--")) continue;
    if (rule.selector.endsWith(".setup-writing .setup-choices") && ["width", "margin-inline"].includes(name)) continue;
    if (rule.selector.endsWith("#results:not(:empty)") && name === "overflow") expect(rule.style.getPropertyValue(name)).toBe("clip");
    else expect(name).not.toMatch(/^(?:padding|margin|height|width|min-|max-|gap|position|display|flex|transform|animation|overflow)/);
  }
  expect(depth).toContain("(prefers-reduced-motion: no-preference)");
});

test.each(["macos", "windows", "linux"])("%s paints one real shelf and preserves selected-row colour pairs", async (platform) => {
  document.documentElement.dataset.platform = platform;
  render(<App {...galleryProvider(state("many-results"))} />);
  await screen.findByText("Memory study 20: a synthetic reference");
  fireEvent.keyDown(screen.getByLabelText("Search references"), { key: "Enter", shiftKey: true });
  const chosen = await screen.findByRole("list", { name: "Selected references" });
  const shelf = chosen.closest(".shelf")!;
  expect(matchingPaint(shelf).some((rule) => rule.style.getPropertyValue("box-shadow") === "var(--shadow-card)")).toBe(true);
  expect(matchingPaint(chosen)).toEqual([]);
  const output = await screen.findByRole("region", { name: "Preview" });
  expect(matchingPaint(output)).toEqual([]);
  const active = document.querySelector('[role="option"][data-active]')!;
  const painted = matchingPaint(active);
  expect(painted.flatMap((rule) => Array.from(rule.style))).not.toContain("color");
  expect(painted.flatMap((rule) => Array.from(rule.style))).not.toContain("background");
  expect(painted.some((rule) => rule.style.getPropertyValue("box-shadow") === "var(--shadow-row-lift)")).toBe(platform === "macos");
});

test.each(["macos", "windows", "linux"])("%s keeps neutral labels readable without replacing action, writing-choice or disabled roles", async (platform) => {
  document.documentElement.dataset.platform = platform;
  render(<App {...galleryProvider(state("first-run-found"))} />);
  await screen.findByText("research.bib");
  expect(document.querySelectorAll(".writing-choice").length).toBeGreaterThan(1);
  for (const button of document.querySelectorAll(".suggested-action, .writing-choice")) expect(matchingPaint(button)).toEqual([]);
  const track = document.querySelector(".setup-writing .setup-choices")!;
  expect(matchingPaint(track).some((rule) => rule.style.getPropertyValue("color") === "var(--text)")).toBe(true);
  const neutral = document.querySelector<HTMLButtonElement>(".empty-state button:not(.suggested-action, .writing-choice)");
  expect(neutral).toBeTruthy();
  expect(matchingPaint(neutral!).some((rule) => rule.style.getPropertyValue("color") === "var(--text)")).toBe(true);
  const folder = document.querySelector(".found-folder")!;
  expect(matchingPaint(folder).some((rule) => rule.style.getPropertyValue("color") === "var(--text)")).toBe(true);
  neutral!.setAttribute("aria-disabled", "true");
  expect(matchingPaint(neutral!)).toEqual([]);
  folder.closest("button")!.setAttribute("aria-disabled", "true");
  expect(matchingPaint(folder)).toEqual([]);
});

test("the real empty Zotero state keeps its primary and alternative action roles", () => {
  document.documentElement.dataset.platform = "macos";
  render(<EmptyState library={{ ...state("empty").library, zotero: true }} query="" narrowed={false}
    onChooseLibrary={vi.fn()} onClearSearch={vi.fn()} onSearchAll={vi.fn()} onReload={vi.fn()} setup={null} />);
  for (const selector of [".suggested-action", ".empty-alternative"]) {
    const button = document.querySelector(selector); expect(button).toBeTruthy(); expect(matchingPaint(button!)).toEqual([]);
  }
});
