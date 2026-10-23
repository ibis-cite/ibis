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
    assert.doesNotMatch(html, /<script\b/i);
    assert.doesNotMatch(html, /<form\b|\son[a-z]+=/i);
    for (const [, path] of html.matchAll(/(?:src|href)="(assets\/[^"#]+|style\.css|site\.js)"/g)) {
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

test("website names the app's default picker shortcuts", async () => {
  const policy = await readFile(new URL("../apps/desktop/src-tauri/src/picker/shortcut_policy.rs", import.meta.url), "utf8");
  const html = await readFile(new URL("../website/index.html", import.meta.url), "utf8");
  const defaults = [...policy.matchAll(/Platform::\w+(?: \| Platform::\w+)* => &\["([^"]+)"\]/g)].map(([, shortcut]) => shortcut);
  assert.ok(defaults.length >= 2, "default shortcuts not found in shortcut_policy.rs");
  for (const shortcut of defaults) assert.match(html, new RegExp(shortcut.replaceAll("+", "\\+")), shortcut);
});
