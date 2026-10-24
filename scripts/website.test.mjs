import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "../website/build.mjs";

test("public build copies canonical tokens, keys and only allowlisted assets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ibis-website-"));
  try {
    const source = join(dir, "source"), output = join(dir, "public");
    await mkdir(source); await mkdir(output);
    for (const name of ["index.html", "style.css", "site.js", ".htaccess"]) await writeFile(join(source, name), "synthetic");
    await writeFile(join(source, "private.txt"), "must not publish");
    await writeFile(join(output, "stale.txt"), "stale");
    await build(output, source);
    assert.deepEqual((await readdir(output)).sort(), [".htaccess", "assets", "index.html", "keys.js", "site.js", "style.css", "tokens.css"]);
    assert.equal(await readFile(join(output, "tokens.css"), "utf8"), await readFile(new URL("../apps/desktop/src/tokens.css", import.meta.url), "utf8"));
    const keys = await import(pathToFileURL(join(output, "keys.js")).href);
    assert.equal(keys.keysFor("add"), "Shift+Enter");
    assert.ok(!/from ["']/.test(await readFile(join(output, "keys.js"), "utf8")), "keys have no runtime dependencies");
    const manifest = JSON.parse(await readFile(join(output, "assets/site.webmanifest"), "utf8"));
    for (const icon of manifest.icons) await readFile(join(output, "assets", icon.src));
    for (const file of ["favicon.svg", "png/og-image.png"]) assert.deepEqual(await readFile(join(output, "assets", file)), await readFile(new URL(`../brand/exports/${file}`, import.meta.url)));
    await rm(join(source, "index.html"));
    await assert.rejects(build(output, source));
    assert.equal(await readFile(join(output, "index.html"), "utf8"), "synthetic", "failed build preserves last good output");
    await assert.rejects(build(source, source), /source/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
