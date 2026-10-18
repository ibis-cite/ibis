import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => { await page.goto("/e2e/picker.html"); });

test("bounded virtual results support distant keyboard targets, Space and independent locator drafts", async ({ page }) => {
  const search = page.getByLabel("Search references");
  await search.fill("reference");
  await search.press("Space");
  await expect(search).toHaveValue("reference ");
  await expect(page.locator("#results [role=option]").first()).toBeVisible();
  expect(await page.locator("#results [role=option]").count()).toBeLessThan(40);
  await expect(page.getByText("Showing up to 200 matches; refine your search.")).toBeVisible();
  const list = page.getByRole("listbox", { name: "Results" });
  await list.focus();
  await list.press("End");
  await expect(page.locator("#result-199")).toBeVisible();
  await expect(list).toHaveAttribute("aria-activedescendant", "result-199");
  await list.press("Space");
  await page.getByLabel(/Page\(s\) for ref199/).fill("iv-vi");
  await search.fill("reverse");
  await list.focus();
  await list.press("End");
  await list.press("Space");
  await page.getByLabel(/Page\(s\) for ref0 /).fill("12, 18-20");
  await search.press("Enter");
  await expect.poll(() => page.evaluate(() => window.pickerTest.copies)).toEqual([{ items: [
    { id: { source: "synthetic.bib", native_key: "ref199" }, locator: { label: "page", value: "iv-vi" } },
    { id: { source: "synthetic.bib", native_key: "ref0" }, locator: { label: "page", value: "12, 18-20" } },
  ], format: "pandoc" }]);
});

test("IME Enter remains text confirmation and Escape unwinds details before the picker", async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on("request", (request) => { if (request.url().startsWith("https://example.invalid")) remoteRequests.push(request.url()); });
  const search = page.getByLabel("Search references");
  await search.fill("reference");
  await search.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await search.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  expect(await page.evaluate(() => window.pickerTest.copies)).toEqual([]);
  await search.press("Shift+Enter");
  const trigger = page.getByRole("button", { name: "Show reference details" });
  await trigger.click();
  await expect(page.getByText("<script>literal synthetic text</script>")).toBeVisible();
  expect(remoteRequests).toEqual([]);
  await page.getByRole("button", { name: "Close details" }).press("Escape");
  await expect(page.getByRole("region", { name: "Reference details" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => window.pickerTest.hidden)).toBe(0);
  await expect(page.getByRole("button", { name: "Remove ref0 from the selection" })).toBeVisible();
  await search.press("Escape");
  expect(await page.evaluate(() => window.pickerTest.hidden)).toBe(1);
});

test("narrow 200 percent text reflows and window virtualization keeps the distant active row visible", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 480 });
  await page.addStyleTag({ content: ":root { font-size: 200%; }" });
  await page.getByLabel("Search references").fill("reference");
  const list = page.getByRole("listbox", { name: "Results" });
  await list.focus();
  await list.press("End");
  await expect(page.locator("#result-199")).toBeInViewport();
  expect(await page.locator("#results [role=option]").count()).toBeLessThan(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test("forced colours and narrow details keep locator and close controls reachable", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 480 });
  await page.addStyleTag({ content: ":root { font-size: 200%; }" });
  const search = page.getByLabel("Search references");
  await search.fill("reference");
  await search.press("Shift+Enter");
  const locator = page.getByLabel(/Page\(s\) for ref0 /);
  await locator.fill("12-14");
  await page.getByRole("button", { name: "Details for ref0" }).click();
  const close = page.getByRole("button", { name: "Close details" });
  await expect(close).toBeFocused();
  await expect(close).toBeInViewport();
  await close.press("Escape");
  await expect(page.getByRole("button", { name: "Details for ref0" })).toBeFocused();
  await expect(locator).toHaveValue("12-14");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
