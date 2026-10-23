import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "../website/build.mjs";

test("website deployment contains only public files and current brand assets", async () => {
  const output = await mkdtemp(join(tmpdir(), "ibis-site-"));
  try {
    await writeFile(join(output, "old-private-config.txt"), "synthetic stale file");
    await build(output);
    assert.deepEqual((await readdir(output)).sort(), [".htaccess", "assets", "index.html", "style.css"]);
    const html = await readFile(join(output, "index.html"), "utf8");
    assert.doesNotMatch(html, /<script\b|<form\b/i);
    for (const [, path] of html.matchAll(/(?:src|href)="(assets\/[^"#]+|style\.css)"/g)) {
      const deployed = await readFile(join(output, path));
      if (path.startsWith("assets/")) {
        assert.deepEqual(deployed, await readFile(new URL(`../brand/exports/${path.slice(7)}`, import.meta.url)), path);
      }
    }
    const manifest = JSON.parse(await readFile(join(output, "assets/site.webmanifest"), "utf8"));
    for (const icon of manifest.icons) await readFile(join(output, "assets", icon.src));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
