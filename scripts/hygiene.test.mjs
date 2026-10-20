import assert from "node:assert/strict";
import { test } from "node:test";
import { findings } from "./hygiene.mjs";

const now = Date.parse("2026-11-01T00:00:00Z");
const base = { now, branches: [], pulls: [], issues: [], labels: [] };

test("deletes only branches whose pull requests all finished over a day ago", () => {
  const r = findings({
    ...base,
    branches: ["main", "fix/1-done", "fix/2-open", "fix/3-just-merged", "test/4-no-pr", "dependabot/cargo/x", "release-please--branches--main"],
    pulls: [
      { number: 1, head: "fix/1-done", state: "closed", closedAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z" },
      { number: 2, head: "fix/2-open", state: "open", closedAt: null, updatedAt: "2026-10-31T00:00:00Z" },
      { number: 5, head: "fix/2-open", state: "closed", closedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
      { number: 3, head: "fix/3-just-merged", state: "closed", closedAt: "2026-10-31T12:00:00Z", updatedAt: "2026-10-31T12:00:00Z" },
      { number: 6, head: "dependabot/cargo/x", state: "closed", closedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
    ],
  });
  assert.deepEqual(r.deleteBranches, ["fix/1-done"]);
});

test("reports stale pull requests, untyped or unscheduled issues, prefixed titles and stray labels", () => {
  const r = findings({
    ...base,
    pulls: [{ number: 7, head: "x", state: "open", closedAt: null, updatedAt: "2026-10-01T00:00:00Z" }],
    issues: [
      { number: 8, title: "Paste into the previous app", labels: ["type:feature"], milestone: "0.4 Insertion" },
      { number: 9, title: "fix: crash on empty file", labels: [], milestone: undefined },
      { number: 10, title: "Repository hygiene report", labels: [], milestone: undefined },
    ],
    labels: ["type:bug", "area:core", "tracking", "dependencies", "bug"],
  });
  assert.deepEqual(r.problems, [
    "#7: pull request with no activity for 14 days",
    "#9: no type: label",
    "#9: no milestone",
    "#9: title starts with a commit prefix",
    'label "bug" is outside the naming standard',
  ]);
});
