import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { galleryStates } from "../../gallery-fixtures";
import { PickerFooter } from "./PickerFooter";

const library = galleryStates.find((state) => state.id === "tray-20")!.library;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function geometry(initial = 692, trailingMargin = 0) {
  let width = initial; let scale = 1; let copy = 162; let more = 129.75;
  const observers: { callback: () => void; nodes: Set<Element> }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    nodes = new Set<Element>(); constructor(callback: () => void) { observers.push({ callback, nodes: this.nodes }); }
    observe(node: Element) { this.nodes.add(node); } unobserve(node: Element) { this.nodes.delete(node); } disconnect() { this.nodes.clear(); }
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.matches(".library-bar") ? width : 0; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    let size = this.matches(".footer-status-size") ? 224 : this.matches(".pin-button") ? 32
      : this.getAttribute("aria-label")?.startsWith("Copy") ? copy : this.getAttribute("aria-label") === "More" ? more : 0;
    return new DOMRect(0, 0, this.hidden || this.style.display === "none" ? 0 : size * scale, 32 * scale);
  });
  const computed = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((node) => {
    if (!node.matches(".library-bar, .enter-hints")) return computed(node);
    const style = document.createElement("div").style; style.columnGap = `${(node.matches(".library-bar") ? 8 : 16) * scale}px`; style.marginInlineEnd = `${node.matches(".enter-hints") ? trailingMargin : 0}px`; return style;
  });
  return { resize(next: number, values: { scale?: number; copy?: number; more?: number } = {}) {
    width = next; scale = values.scale ?? scale; copy = values.copy ?? copy; more = values.more ?? more;
    act(() => { for (const observer of observers) if ([...observer.nodes].some((node) => node.matches(".library-bar"))) observer.callback(); });
  } };
}

function footer(label: string | null = "Copy 20 as Pandoc", pinned = true) {
  return <main><input aria-label="Search" /><button>Pointer destination</button><PickerFooter library={library} groupName={String}
    hints={{ enter: label, shiftEnter: "Add to citation", escape: "Hide" }} altHeld={false} pinned={pinned} onUnpin={() => undefined}
    actions={{ copy: () => undefined, add: () => undefined, escape: () => undefined }}
    more={<button aria-label="More">More</button>} /></main>;
}

test("the normal footer offers only Copy and More even when there is room for another hint", () => {
  geometry(900); render(footer("Copy 20 as Pandoc", false));
  const actions = [...document.querySelector("footer")!.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
  expect(actions).toEqual(["Copy 20 as Pandoc", "More"]);
});

test("pinned controls at 720px retain status, shorten it under pressure and restore on growth", () => {
  const fit = geometry(); render(footer());
  expect(document.querySelector(".library-bar")?.hasAttribute("data-status-compact")).toBe(false);
  fit.resize(520);
  expect(document.querySelector(".library-bar")?.hasAttribute("data-status-compact")).toBe(true);
  expect(screen.getByRole("button", { name: "Copy 20 as Pandoc" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
  for (let i = 0; i < 3; i++) fit.resize(900);
  expect(document.querySelector(".library-bar")?.hasAttribute("data-status-compact")).toBe(false);
});

test("changing count, format and key-cap widths recomputes fit without losing status detail", () => {
  const fit = geometry(900); const view = render(footer());
  const detail = document.querySelector(".library-status")?.getAttribute("title");
  fit.resize(692, { copy: 300, more: 150 }); view.rerender(footer("Copy 1000 as Chicago"));
  expect(document.querySelector(".library-bar")?.hasAttribute("data-status-compact")).toBe(true);
  expect(document.querySelector(".library-status")?.getAttribute("title")).toBe(detail);
  expect(screen.getByRole("button", { name: "Copy 1000 as Chicago" }).getAttribute("aria-keyshortcuts")).toBe("Enter");
  fit.resize(692, { copy: 162, more: 85 }); view.rerender(footer());
  expect(document.querySelector(".library-bar")?.hasAttribute("data-status-compact")).toBe(false);
});

test.each(["Copy 20 as Pandoc", "More", "Search", "Pointer destination"])("status reflow preserves the current focus (%s)", (owner) => {
  const fit = geometry(900); render(footer());
  const focused = owner === "Search" ? screen.getByRole("textbox", { name: owner }) : screen.getByRole("button", { name: owner });
  act(() => focused.focus()); fit.resize(332); fit.resize(900);
  expect(document.activeElement).toBe(focused);
});

test("RTL 200% pressure keeps core actions available", () => {
  const fit = geometry(); document.documentElement.dir = "rtl";
  try {
    render(footer()); fit.resize(332, { scale: 2 });
    expect(screen.getByRole("button", { name: "Copy 20 as Pandoc" })).toBeTruthy();
    const more = screen.getByRole("button", { name: "More" }); const clicked = vi.fn(); more.addEventListener("click", clicked); fireEvent.click(more);
    expect(clicked).toHaveBeenCalledOnce();
  } finally { document.documentElement.dir = ""; }
});

test("the live hint margin participates in status shortening", () => {
  const fit = geometry(600, 32); render(footer());
  expect(document.querySelector(".library-bar")?.hasAttribute("data-status-compact")).toBe(true);
  fit.resize(640);
  expect(document.querySelector(".library-bar")?.hasAttribute("data-status-compact")).toBe(false);
});

test("when there is no ready output the footer has More without an empty action group", () => {
  geometry(388); render(footer(null, false));
  expect(screen.queryByRole("group", { name: "Keys" })).toBeNull();
  expect([...document.querySelector("footer")!.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"))).toEqual(["More"]);
});
