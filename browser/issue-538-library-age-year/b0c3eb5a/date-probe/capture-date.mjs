import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const source = "b0c3eb5a36b6e54eaccbd19708c6d589414dbbf4";
const checkout = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: checkout, encoding: "utf8" }).trim(), source);
assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: checkout, encoding: "utf8" }).trim(), "");
const { openGallery, PLATFORM_NAMES } = await import(pathToFileURL(path.join(checkout, "scripts/gallery-contact-sheet.mjs")));
await mkdir(output, { recursive: true });
const { browser, server } = await openGallery({ build: false, dist: path.join(checkout, "apps/desktop/dist") });
const rows = [];
try {
  for (const platform of ["macos", "windows", "linux"]) for (const theme of ["light", "dark"]) for (const text of ["normal", "large"]) {
    const context = await browser.newContext({ viewport: { width: 720, height: 480 }, timezoneId: "Pacific/Kiritimati", colorScheme: theme, reducedMotion: "reduce" });
    await context.addInitScript(({ name, now }) => {
      Object.defineProperty(navigator, "platform", { configurable: true, get: () => name });
      window.syntheticNow = now;
      Date.now = () => window.syntheticNow;
    }, { name: PLATFORM_NAMES[platform], now: Date.UTC(2026, 9, 22, 0, 0) });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/gallery.html?state=zotero-kept&platform=${platform}&theme=${theme}&text=${text}`);
    await page.waitForFunction(() => document.documentElement.dataset.galleryRendered === "zotero-kept");
    const liveBefore = await page.locator(".library-name").textContent();
    await page.evaluate(() => { window.syntheticNow = Date.UTC(2026, 10, 1, 0, 0); window.dispatchEvent(new Event("focus")); });
    await page.waitForFunction(() => document.querySelector(".library-age")?.textContent?.includes("on Oct 22"));
    const sameYear = await page.locator(".library-age").textContent();
    assert.ok(!sameYear.includes("2026"), sameYear);
    await page.evaluate(() => { window.syntheticNow = Date.UTC(2027, 0, 9, 0, 0); window.dispatchEvent(new Event("focus")); });
    await page.waitForFunction(() => document.querySelector(".library-age")?.textContent?.includes("on Oct 22, 2026"));
    const previousYear = await page.locator(".library-age").textContent();
    assert.equal(await page.locator(".library-name").textContent(), liveBefore);
    assert.equal(await page.locator(".library-age").getAttribute("aria-hidden"), "true");
    await page.getByRole("button", { name: /^More/ }).click();
    await page.waitForFunction(() => document.querySelector(".menu-detail")?.textContent?.includes("on Oct 22, 2026"));
    const detail = await page.locator(".menu-detail").textContent();
    await page.screenshot({ path: `${output}/${platform}-${theme}-${text}-menu.png` });
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    const name = `${platform}-${theme}-${text}`;
    await page.screenshot({ path: `${output}/${name}.png` });
    rows.push({ platform, theme, text, sameYear, previousYear, detail, unchangedLiveRegion: true, ageNotLive: true, errors });
    await context.close();
  }
  await writeFile(`${output}/results.json`, `${JSON.stringify({ source, browser: browser.version(), syntheticClock: true, timezone: "Pacific/Kiritimati", nativeValidation: false, rows }, null, 2)}\n`);
  console.log(JSON.stringify({ source, passed: rows.length, syntheticClock: true, nativeValidation: false }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
