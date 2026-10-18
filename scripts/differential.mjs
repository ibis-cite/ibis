// Engineering-only Pandoc differential comparison; accepts synthetic/CC0 input.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findIssue, minimize } from "./testing.mjs";

class InfrastructureError extends Error {}

export function differenceClass(difference) {
  assert.ok(["render", "parser", "export"].includes(difference.kind));
  const fields = [...new Set(difference.fields.map((field) => field.replace(/\[\d+\]/g, "[*]")))].sort();
  return createHash("sha256").update(JSON.stringify([difference.disposition ?? "comparable", difference.kind, difference.entry_type, fields])).digest("hex");
}

export function compare(binary, input, output, spawn = spawnSync) {
  const result = spawn(binary, [input, output], { encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    const error = new InfrastructureError("Differential runner/tool failed; see preserved diagnostics");
    error.diagnostics = result.stderr ?? "";
    throw error;
  }
  let report;
  try { report = JSON.parse(result.stdout); } catch { throw new InfrastructureError("Runner returned invalid JSON"); }
  assert.ok(report && Number.isSafeInteger(report.entries) && report.entries >= 0 && report.entries <= 64 &&
    Number.isSafeInteger(report.warnings) && report.warnings >= 0 && typeof report.unrenderable === "boolean" &&
    Array.isArray(report.differences) && report.differences.length <= 64, "invalid runner JSON schema");
  return report;
}
const indent = (text) => String(text).replaceAll("\r", "").split("\n").map((line) => `    ${line}`).join("\n");

const excerpt = (text) => Buffer.byteLength(text) <= 4096 ? text : Buffer.from(text).subarray(0, 4096).toString("utf8") + "\n[excerpt; full content in the workflow artifact]";
export async function reportDifference(repository, input, difference, runUrl, request) {
  if ((difference.disposition ?? "comparable") !== "comparable") return null;
  assert.ok(input.length <= 16_384, "report input exceeds 16 KiB");
  const signature = differenceClass(difference);
  const marker = `<!-- differential:${signature} -->`;
  const known = await findIssue(repository, marker, request, "all", 100);
  if (known) return known.html_url;
  const issue = await request(`/repos/${repository}/issues`, {
    title: `fidelity: ${difference.kind} difference (${signature.slice(0, 12)})`,
    labels: ["area:testing"],
    body: `${marker}\nNightly Pandoc comparison found a ${difference.kind} difference. [Workflow run](${runUrl}).\n\nStructural class (entry type, changed field paths):\n\n${indent(JSON.stringify([difference.entry_type, difference.fields]))}\n\nMinimized input:\n\n${indent(excerpt(input.toString("utf8")))}\n\nLossless base64:\n\n${indent(input.toString("base64"))}\n\nFrom original BibTeX:\n\n${indent(excerpt(difference.bib_rendering))}\n\nFrom Ibis CSL-JSON:\n\n${indent(excerpt(difference.ibis_rendering))}\n\nReduction preserves this structural class and is bounded; the reproducer need not be globally minimal. Large text excerpts link to complete renderings in summary.json. Source/tool versions and original inputs are retained with the workflow summary. Add a synthetic regression fixture before fixing a reader difference.`,
  });
  return issue.html_url;
}


const semanticFields = (difference) => difference.fields.filter((field) => field !== "extra:citation-key").map((field) => field.replace(/\[\d+\]/g, "[*]"));
const sameTarget = (original, candidate) => {
  if ((original.disposition ?? "comparable") !== (candidate.disposition ?? "comparable")) return false;
  if (original.kind !== candidate.kind || original.entry_type !== candidate.entry_type || original.key !== candidate.key) return false;
  const before = new Set(semanticFields(original));
  const after = semanticFields(candidate);
  // Removing unrelated discrepancies is fine; switching to another field or
  // another failure operation is not. citation-key is an Ibis-only ID alias.
  return after.every((field) => before.has(field)) && (before.size === 0 || after.length > 0);
};
export function reduceDifference(input, difference, reproduce, budgetMs = 60_000) {
  // Classify after reduction: unrelated metadata discrepancies must not prevent
  // deleting unrelated fields. Preserve the target entry and failure outcome.
  return minimize(input, (candidate) => reproduce(candidate).differences.some((item) => sameTarget(difference, item)) ? "same-target" : null,
    "same-target", budgetMs);
}

export async function run(binary, output, directories, request, repository, runUrl) {
  assert.ok(directories.length > 0 && directories.length <= 5, "expected one to five input directories");
  mkdirSync(output, { recursive: true });
  const deadline = Date.now() + 10 * 60_000;
  const summary = { inputs: 0, entries: 0, unrenderable: 0, unrenderable_entries: 0, over_limit: 0, warnings: 0, oversized: 0, omitted: 0, classes: {}, errors: [] };
  const inputs = [];
  const seen = new Map();
  try {
    for (const directory of directories) {
      const names = readdirSync(directory).sort();
      // Generated files and the single CC0 bibliography; fuzz corpus hashes have no suffix.
      const eligible = names.filter((name) => !name.endsWith(".json") && !name.startsWith("seed-") && lstatSync(join(directory, name)).isFile());
      const fuzz = /(?:^|[/\\])fuzz[/\\]corpus[/\\]/.test(directory);
      if (fuzz && !eligible.length) throw new InfrastructureError("No generated fuzz inputs restored; run Nightly fuzzing first");
      const cap = fuzz ? 8 : 64;
      summary.omitted += Math.max(0, eligible.length - cap);
      for (const name of eligible.slice(0, cap)) {
        const path = join(directory, name);
        if (lstatSync(path).size > 16_384) { summary.oversized++; continue; }
        inputs.push(path);
      }
    }
    summary.omitted += Math.max(0, inputs.length - 128);
    for (const input of inputs.slice(0, 128)) {
      if (Date.now() >= deadline) throw new InfrastructureError("Differential run exceeded ten-minute budget");
      const data = readFileSync(input);
      const result = compare(binary, input, join(output, "current"));
      summary.inputs++;
      summary.entries += result.entries;
      summary.unrenderable += Number(result.unrenderable);
      summary.warnings += result.warnings;
      summary.over_limit += Number(result.over_limit ?? false);
      summary.unrenderable_entries += result.unrenderable_entries ?? 0;
      for (const difference of result.differences) {
        const originalClass = differenceClass(difference);
        if (seen.has(originalClass)) { summary.classes[seen.get(originalClass)].occurrences++; continue; }
        if ((difference.disposition ?? "comparable") !== "comparable") {
          summary.classes[originalClass] = { ...difference, occurrences: 1, signature: originalClass, minimized: false };
          seen.set(originalClass, originalClass);
          writeFileSync(join(output, `${originalClass}.original.bib`), data);
          continue;
        }
        const candidate = join(output, "candidate.bib");
        const reproduce = (bytes) => {
          if (Date.now() >= deadline) throw new InfrastructureError("Differential run exceeded ten-minute budget");
          writeFileSync(candidate, bytes);
          return compare(binary, candidate, join(output, "reduce"));
        };
        console.log(`Reducing difference after ${summary.inputs} inputs (${summary.entries} entries compared)`);
        const reduced = reduceDifference(data, difference, reproduce, Math.min(60_000, deadline - Date.now()));
        writeFileSync(candidate, reduced);
        const final = compare(binary, candidate, join(output, "final"));
        const reducedDifference = final.differences.find((item) => sameTarget(difference, item));
        assert.ok(reducedDifference, "minimized difference did not reproduce");
        const signature = differenceClass(reducedDifference);
        seen.set(originalClass, signature);
        if (summary.classes[signature]) { summary.classes[signature].occurrences++; continue; }
        const finding = { ...reducedDifference, occurrences: 1, signature, minimized: true };
        summary.classes[signature] = finding;
        writeFileSync(join(output, `${signature}.original.bib`), data);
        writeFileSync(join(output, `${signature}.bib`), reduced);
        if (request) finding.issue = await reportDifference(repository, reduced, reducedDifference, runUrl, request);
      }
      console.log(`Compared ${summary.inputs} inputs, ${summary.entries} entries, ${Object.keys(summary.classes).length} classes`);
    }
  } catch (error) {
    summary.errors.push(error instanceof InfrastructureError ? error.message : "Differential infrastructure failure; see diagnostics");
    writeFileSync(join(output, "runner-error.log"), error.diagnostics ?? "");
  } finally {
    summary.categories = {};
    for (const item of Object.values(summary.classes)) {
      const category = item.disposition ?? "comparable";
      summary.categories[category] = (summary.categories[category] ?? 0) + item.occurrences;
    }
    writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    const rows = Object.values(summary.classes).map((item) => `| ${item.signature.slice(0, 12)} | ${item.disposition ?? "comparable"} | ${item.kind} | ${item.occurrences} | ${item.issue ?? "local artifact"} |`);
    const markdown = `# Pandoc differential comparison\n\n${summary.inputs} inputs; ${summary.entries} entries compared; ${summary.unrenderable} empty/unrenderable inputs and ${summary.unrenderable_entries} entries rejected by both renderers; ${summary.warnings} Ibis warnings. ${summary.oversized} oversized, ${summary.over_limit} over-entry-limit and ${summary.omitted} over-limit inputs omitted.\n\n| Class | Category | Kind | Occurrences | Issue |\n|---|---|---|---:|---|\n${rows.join("\n")}\n\nInfrastructure errors: ${summary.errors.length}. See summary.json and preserved diagnostics.\n`;
    writeFileSync(join(output, "summary.md"), markdown);
  }
  return summary;
}

const expectedCategories = new Set(["pandoc-parenthesis-rejection", "warned-parser-recovery", "warned-language-fallback"]);
export function shouldFail(summary) {
  return summary.errors.length > 0 || Object.values(summary.classes).some((item) => !expectedCategories.has(item.disposition));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [binary, output, ...directories] = process.argv.slice(2);
  assert.ok(binary && output && directories.length, "usage: differential.mjs BINARY OUTPUT INPUT_DIRECTORIES...");
  const trusted = ["workflow_run", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME) && process.env.GITHUB_REF === "refs/heads/main";
  const requestDeadline = Date.now() + 10 * 60_000;
  const request = trusted && process.env.GITHUB_TOKEN ? async (path, body) => {
    if (Date.now() >= requestDeadline) throw new InfrastructureError("Issue reporting exceeded total run budget");
    const response = await fetch(`https://api.github.com${path}`, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, requestDeadline - Date.now()))),
    });
    if (!response.ok) throw new InfrastructureError(`Issue reporting failed: HTTP ${response.status}`);
    return response.json();
  } : null;
  const summary = await run(resolve(binary), output, directories, request, process.env.GITHUB_REPOSITORY,
    `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`);
  process.exitCode = shouldFail(summary) ? 1 : 0;
}
