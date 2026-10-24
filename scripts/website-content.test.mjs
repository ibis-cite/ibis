import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { content } from "../website/content.mjs";

test("website headline and planned features come from the canonical sources", async () => {
  const html = await content(await readFile(new URL("../website/index.html", import.meta.url), "utf8"));
  const brand = JSON.parse(await readFile(new URL("../brand/settings.json", import.meta.url), "utf8"));
  assert.ok(html.includes(`<h1>${brand.words.tagline}</h1>`));
  assert.doesNotMatch(html, /\{\{\w+\}\}/);
  const design = await readFile(new URL("../docs/design.md", import.meta.url), "utf8");
  for (const [, label] of html.matchAll(/<li><strong>([^<]+)<\/strong><span>Planned/g)) assert.ok(design.replace(/\s*\([^)]*\)/g, "").includes(label));
  assert.match(html, /not a stable release/);
  assert.match(html, /does not generate your document’s bibliography/);
  assert.ok(html.indexOf("not a stable release") < html.indexOf("/releases/download/"));
  for (const [, target] of html.matchAll(/href="#([^"\s]+)"/g)) assert.ok(html.includes(`id="${target}"`), target);
});
