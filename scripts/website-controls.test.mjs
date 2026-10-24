import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
const script = await readFile(new URL("../website/site.js", import.meta.url), "utf8");
function context(choice = null) {
  const stored = new Map(choice ? [["ibis-theme", choice]] : []);
  const media = { matches: false, addEventListener(_name, fn) { this.change = fn; } };
  const ctx = { document: { documentElement: { dataset: {} }, addEventListener() {} },
    navigator: { platform: "MacIntel", userAgent: "Desktop", maxTouchPoints: 0 },
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    matchMedia: () => media };
  runInNewContext(script, ctx);
  return { ctx, media, stored };
}
const control = () => ({ attrs: {}, handlers: {}, setAttribute(k, v) { this.attrs[k] = v; },
  addEventListener(k, fn) { this.handlers[k] = fn; }, focus() { this.focused = true; } });

test("appearance is applied before paint; both controls sync, persist and reset focus", () => {
  const { ctx, media, stored } = context("light");
  assert.equal(ctx.document.documentElement.dataset.theme, "light");
  assert.equal(ctx.document.documentElement.dataset.platform, "macos");
  const groups = Array.from({ length: 2 }, () => {
    const toggle = control(), reset = control();
    return { toggle, reset, hidden: true, querySelector: selector => selector.includes("switch") ? toggle : reset };
  });
  ctx.document.querySelectorAll = () => groups; ctx.appearance();
  groups[0].toggle.handlers.click();
  assert.equal(stored.get("ibis-theme"), "dark");
  for (const group of groups) { assert.equal(group.hidden, false); assert.equal(group.toggle.attrs["aria-checked"], "true"); }
  groups[1].reset.handlers.click();
  assert.equal(stored.has("ibis-theme"), false);
  assert.equal(groups[1].toggle.focused, true);
  media.matches = true; media.change();
  assert.equal(groups[0].toggle.attrs["aria-checked"], "true");
  assert.equal(context("untrusted").ctx.document.documentElement.dataset.theme, undefined);
});

test("navigation updates one current chip and scrolls it only when the section changes", () => {
  const { ctx, media } = context(); media.matches = true;
  const names = ["how", "download", "setup", "roadmap", "why", "shape"], frames = [], handlers = {};
  const calls = [];
  const links = names.map(name => ({ attrs: {}, getAttribute: () => `#${name}`, hasAttribute(k) { return k in this.attrs; },
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, querySelector: () => ({ scrollIntoView: args => calls.push([name, args]) }) }));
  const bar = { scrollLeft: 0, clientWidth: 200, scrollWidth: 600, addEventListener() {}, toggleAttribute() {} };
  ctx.window = { scrollY: 0, innerHeight: 1000, addEventListener: (name, fn) => { handlers[name] = fn; } };
  ctx.requestAnimationFrame = fn => frames.push(fn);
  ctx.document.documentElement.scrollHeight = 7000;
  ctx.document.querySelectorAll = () => links;
  ctx.document.querySelector = selector => selector === ".index nav ul" ? bar : { getBoundingClientRect: () => ({ top: names.indexOf(selector.slice(1)) * 1000 - ctx.window.scrollY }) };
  ctx.navigation(); assert.equal(calls.length, 1);
  ctx.window.scrollY = 1000; handlers.scroll(); handlers.scroll();
  assert.equal(frames.length, 1); frames.shift()();
  assert.equal(calls.at(-1)[0], "download");
  assert.equal(calls.at(-1)[1].inline, "nearest"); assert.equal(calls.at(-1)[1].block, "nearest");
  ctx.window.scrollY = 1010; handlers.scroll(); frames.shift()(); assert.equal(calls.length, 2);
  ctx.window.scrollY = 6000; handlers.scroll(); frames.shift()(); assert.equal(calls.at(-1)[0], "shape");
  assert.equal(links.filter(link => link.hasAttribute("aria-current")).length, 1);
});

test("resizing into a tablet or phone restores all platform downloads", () => {
  const { ctx, media } = context();
  const blocks = ["mac", "windows", "linux"].map(os => ({ dataset: { os }, hidden: false, before() {} }));
  const cta = {}, choice = { replaceChildren(...items) { this.items = items; } };
  ctx.document.querySelectorAll = () => blocks;
  ctx.document.querySelector = () => cta;
  ctx.document.createElement = tag => tag === "p" ? choice : control();
  ctx.platforms(); assert.deepEqual(blocks.map(block => block.hidden), [false, true, true]);
  choice.items[3].handlers.click();
  assert.equal(cta.textContent, "Get Ibis for Linux");
  media.matches = true; media.change();
  assert.deepEqual(blocks.map(block => block.hidden), [false, false, false]); assert.equal(choice.hidden, true);
  assert.equal(cta.textContent, "Get the early preview");
  media.matches = false; media.change(); assert.deepEqual(blocks.map(block => block.hidden), [true, true, false]);
  assert.equal(cta.textContent, "Get Ibis for Linux", "explicit platform choice survives a resize");
});

test("desktop sidebar remains clickable over every scrolled section", { skip: !process.env.IBIS_WEBSITE_URL }, async () => {
  const url = new URL(process.env.IBIS_WEBSITE_URL);
  assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1");
  const { loadPlaywright } = await import("./gallery-contact-sheet.mjs");
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ executablePath: process.env.IBIS_CHROMIUM_EXECUTABLE });
  try {
    for (const width of [1180, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "no-preference" });
      await page.goto(url.href);
      for (const id of ["setup", "shape", "how", "roadmap", "download"]) {
        await page.locator(`.index nav a[href="#${id}"]`).click({ timeout: 1500 });
        await page.waitForFunction(id => location.hash === `#${id}`, id, { timeout: 1500 });
        await page.waitForFunction(id => {
          const top = document.querySelector(`#${id}`).getBoundingClientRect().top;
          return top >= 0 && top < innerHeight / 2;
        }, id, { timeout: 1500 });
      }
      await page.close();
    }
  } finally { await browser.close(); }
});
