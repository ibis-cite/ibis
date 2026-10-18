import assert from "node:assert/strict";
import test from "node:test";
import { differenceClass, reportDifference, compare, reduceDifference, run, shouldFail } from "./differential.mjs";

const difference = { kind: "render", entry_type: "article-journal", fields: ["value:title"], bib_rendering: "Expected title", ibis_rendering: "Changed title" };

test("classes ignore identities/prose/order but keep different fields, operations, types and outcomes", () => {
  const signature = differenceClass(difference);
  assert.equal(signature, differenceClass({ ...difference, key: "another", bib_rendering: "Different prose" }));
  assert.equal(differenceClass({ ...difference, fields: ["value:author[2].family", "value:title"] }),
    differenceClass({ ...difference, fields: ["value:title", "value:author[0].family"] }));
  for (const change of [{ fields: ["missing:title"] }, { fields: ["value:author[*].given"] }, { entry_type: "book" }, { kind: "parser" }])
    assert.notEqual(signature, differenceClass({ ...difference, ...change }));
});

test("closed known classes are linked rather than reported again after pagination", async () => {
  let calls = 0;
  const signature = differenceClass(difference);
  const result = await reportDifference("owner/repo", Buffer.from("@book{x,title={Synthetic}}"), difference, "https://example.org/run", async (path, body) => {
    calls++;
    assert.equal(body, undefined);
    assert.ok(path.includes("state=all"));
    return path.endsWith("page=1") ? Array(100).fill({ body: "unrelated" }) : [{ body: `<!-- differential:${signature} -->`, html_url: "https://example.org/known", state: "closed" }];
  });
  assert.equal(result, "https://example.org/known");
  assert.equal(calls, 2);
});

test("new report preserves minimal input and both renderings without markdown injection", async () => {
  let created;
  const input = Buffer.from("@book{x,title={``` synthetic}}\n");
  await reportDifference("owner/repo", input, { ...difference, bib_rendering: "``` hostile", ibis_rendering: "# synthetic" }, "https://example.org/run", async (_path, body) => {
    if (!body) return [];
    created = body;
    return { html_url: "https://example.org/new" };
  });
  assert.deepEqual(created.labels, ["area:testing"]);
  assert.ok(created.body.includes(input.toString("base64")));
  assert.ok(created.body.includes("    ``` hostile"));
  assert.ok(created.body.includes("    # synthetic"));
  assert.ok(created.body.includes("value:title"));
});

test("tool errors and malformed runner output are infrastructure failures, never differences", () => {
  for (const result of [{ status: 1, stderr: "tool error" }, { status: null, error: new Error("timed out") }, { status: 0, stdout: "not JSON" }, { status: 0, stdout: "{}" }])
    assert.throws(() => compare("runner", "input", "output", () => result), /runner|tool|JSON/i);
});

test("reduction removes unrelated fields before classification and rejects a different outcome", () => {
  const original = { ...difference, key: "x", fields: ["value:title", "extra:language"] };
  const reduced = reduceDifference(Buffer.from("irrelevant!"), original, (input) => ({ differences: input.includes(33)
    ? [{ ...original, fields: ["value:title"] }] : [{ ...original, kind: "parser" }] }));
  assert.deepEqual(reduced, Buffer.from("!"));
  assert.equal(differenceClass({ ...original, fields: ["value:title"] }), differenceClass(difference));
});

import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("infrastructure failures still produce a complete JSON/Markdown summary", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ibis-differential-test-"));
  try {
    const output = join(directory, "output");
    const summary = await run("unused", output, [join(directory, "missing")]);
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.inputs, 0);
    assert.equal(JSON.parse(readFileSync(join(output, "summary.json"))).entries, 0);
    assert.match(readFileSync(join(output, "summary.md"), "utf8"), /Infrastructure errors: 1/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("reduction cannot migrate a title difference into an unrelated author failure", () => {
  const original = { ...difference, key: "x" };
  const reduced = reduceDifference(Buffer.from("prefix!suffix"), original, (input) => ({ differences: [
    input.includes(33) ? original : { ...original, fields: ["missing:author[0].family"] },
  ] }));
  assert.deepEqual(reduced, Buffer.from("!"));
});

test("file sampling is bounded and oversized data is counted", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ibis-differential-bounds-"));
  try {
    const inputs = join(directory, "inputs"); mkdirSync(inputs);
    for (let index = 0; index < 130; index++) writeFileSync(join(inputs, `sample-${index}`), Buffer.alloc(16_385));
    const summary = await run("unused", join(directory, "output"), [inputs]);
    assert.equal(summary.oversized, 64);
    assert.equal(summary.omitted, 66);
    assert.equal(summary.inputs, 0);
    assert.deepEqual(summary.errors, []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("large findings remain reportable without losing the input or artifact link", async () => {
  let created;
  const input = Buffer.alloc(16_384, 97);
  await reportDifference("owner/repo", input, { ...difference, bib_rendering: "বাংলা".repeat(10000), ibis_rendering: "x".repeat(100000) },
    "https://example.org/run", async (_path, body) => { if (!body) return []; created = body; return { html_url: "https://example.org/issue" }; });
  assert.ok(Buffer.byteLength(created.body) < 60_000);
  assert.ok(created.body.includes(input.toString("base64")));
  assert.ok(created.body.includes("full content in the workflow artifact"));
});

// Symlink creation requires a privilege absent from some Windows hosts; the
// scheduled differential workflow is Linux and this probe also runs on macOS.
test("symlinks are never comparison inputs", { skip: process.platform === "win32" }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "ibis-differential-symlink-"));
  try {
    const inputs = join(directory, "inputs"); mkdirSync(inputs);
    symlinkSync(join(directory, "missing-private-file"), join(inputs, "private-link"));
    const summary = await run("unused", join(directory, "output"), [inputs]);
    assert.equal(summary.inputs, 0);
    assert.deepEqual(summary.errors, []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("supported differences report, intentional/unsupported/unrecognized categories never auto-file", async () => {
  for (const disposition of ["pandoc-parenthesis-rejection", "warned-parser-recovery", "warned-language-fallback", "review-required-parser"]) {
    const unsupported = { ...difference, disposition };
    assert.notEqual(differenceClass(unsupported), differenceClass(difference));
    const result = await reportDifference("owner/repo", Buffer.from("synthetic"), unsupported, "https://example.org/run", () => {
      assert.fail("a non-comparable category must not make any issue API request");
    });
    assert.equal(result, null);
  }
  let created = false;
  await reportDifference("owner/repo", Buffer.from("synthetic"), { ...difference, disposition: "comparable" }, "https://example.org/run", async (_path, body) => {
    if (!body) return [];
    created = true;
    return { html_url: "https://example.org/issue" };
  });
  assert.ok(created);
});

test("known categories are visible without false failure; new cases and real differences require attention", () => {
  assert.equal(shouldFail({ errors: [], classes: { x: { disposition: "warned-language-fallback" } } }), false);
  for (const disposition of ["comparable", "review-required-warning", "future-unrecognized-category"])
    assert.equal(shouldFail({ errors: [], classes: { x: { disposition } } }), true);
  assert.equal(shouldFail({ errors: ["tool failure"], classes: {} }), true);
});
