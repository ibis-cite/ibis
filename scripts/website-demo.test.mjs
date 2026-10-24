import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemo } from "../website/demo-model.mjs";

test("demo adds in order and captures copied output independently of later edits", () => {
  const demo = createDemo();
  assert.equal(demo.output(), "[@okafor2023]");
  demo.add("okafor2021"); demo.add("okafor2023");
  assert.equal(demo.output(), "[@okafor2021; @okafor2023]");
  demo.copy(); demo.state.format = "cite";
  assert.equal(demo.output(), "\\cite{okafor2021,okafor2023}");
  demo.paste();
  assert.equal(demo.state.pasted, "[@okafor2021; @okafor2023]");
  demo.add("okafor2021");
  assert.equal(demo.output(), "\\cite{okafor2023}");
});
test("demo searches across fields and steps back without discarding added references", () => {
  const demo = createDemo();
  demo.state.query = "okafor ecology 2023";
  assert.equal(demo.found().length, 1);
  demo.add("okafor2023");
  demo.back(); assert.equal(demo.state.preview, false);
  demo.back(); assert.equal(demo.state.query, "");
  demo.back(); assert.equal(demo.state.open, false);
  assert.deepEqual(demo.state.added, ["okafor2023"]);
});
test("empty and huge unmatched input never copies an invalid reference", () => {
  const demo = createDemo();
  demo.state.query = "not present ".repeat(10000);
  assert.equal(demo.found().length, 0);
  assert.equal(demo.output(), "");
  assert.equal(demo.copy(), false);
  assert.equal(demo.state.copied, null);
});

test("browser keeps navigation, keyboard selection and long output visible", { skip: !process.env.IBIS_WEBSITE_URL }, async () => {
  const url = new URL(process.env.IBIS_WEBSITE_URL);
  assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1");
  const { loadPlaywright } = await import("./gallery-contact-sheet.mjs");
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ executablePath: process.env.IBIS_CHROMIUM_EXECUTABLE });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 600 }, colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(url.href);
    const input = page.getByRole("combobox", { name: "Search the made-up library" }); await input.waitFor();
    assert.match(await page.locator(".logo-light img").evaluate(e => e.currentSrc), /\/ibis-logo\.svg$/);
    await page.mouse.move(300, 300); await page.mouse.wheel(0, 1200); await page.waitForTimeout(100);
    const before = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 750); await page.waitForTimeout(100);
    assert.equal(Math.round(await page.evaluate(() => scrollY) - before), 750, "chip updates preserve ordinary scrolling");
    await input.fill(""); await input.press("ArrowDown");
    assert.notEqual(await input.evaluate(e => getComputedStyle(e).outlineStyle), "none", "keyboard focus remains visible");
    await input.press("Home");
    // Start at the first result again, then add every invented reference.
    await input.fill("x"); await input.fill("");
    for (let i = 0; i < 6; i++) {
      await input.press("Shift+Enter");
      await input.dispatchEvent("keydown", { key: "Enter", shiftKey: true, repeat: true, bubbles: true });
      assert.equal(await page.locator(".tile.is-added").count(), i + 1, "held Enter never toggles a reference twice");
      if (i < 5) await input.press("ArrowDown");
    }
    const fits = await page.locator('.pick[aria-selected="true"]').evaluate(e => {
      const row = e.getBoundingClientRect(), list = e.closest(".picker-results").getBoundingClientRect();
      return row.top >= list.top - 1 && row.bottom <= list.bottom + 1;
    });
    assert.ok(fits, "keyboard-selected result stays inside the list");
    assert.ok(await page.locator(".picker-shelf").evaluate(e => e.scrollWidth <= e.clientWidth + 1));
    await input.press("Enter"); await page.getByRole("button", { name: "Paste in the sentence", exact: true }).click();
    assert.equal((await page.locator("[data-result]").textContent()).match(/@/g).length, 6);
    assert.ok(await page.locator("[data-result]").evaluate(e => e.scrollWidth <= e.clientWidth + 1));
    await page.getByRole("button", { name: "Open the picker again" }).click();
    await page.emulateMedia({ forcedColors: "active" });
    assert.equal(await page.locator('.pick[aria-selected="true"]').evaluate(e => getComputedStyle(e).forcedColorAdjust), "none");
    await page.locator('.index nav a[href="#how"]').click();
    await page.waitForFunction(() => document.querySelector('.index nav a[href="#how"]').hasAttribute("aria-current"));
    assert.equal(await page.locator('.index a[aria-current] .key').evaluate(e => getComputedStyle(e).forcedColorAdjust), "none");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  } finally { await browser.close(); }
});
