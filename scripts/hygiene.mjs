// Weekly repository hygiene (#443), run by .github/workflows/hygiene.yml.
//
//   node scripts/hygiene.mjs           report only: prints what it would do
//   node scripts/hygiene.mjs --apply   deletes finished branches and updates
//                                      the "Repository hygiene report" issue
//
// Needs the GitHub CLI signed in (GH_TOKEN in CI) and GITHUB_REPOSITORY or
// --repo owner/name. The label standard below mirrors "Issues, labels and
// milestones" in docs/development.md; change both together.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LABEL_FAMILIES = /^(type|area|platform|source|status|needs):/;
const LABEL_EXTRAS = new Set([
  "tracking", "good first issue", "help wanted", "upstream",
  "autorelease: pending", "autorelease: tagged", "dependencies", "rust", "github_actions", "javascript",
]);
const KEEP_BRANCH = /^(main|nightly|stable|evidence|release-please--.*|dependabot\/.*)$/;
const TITLE_PREFIX = /^\s*(\[|(feat|fix|ci|test|docs|refactor|perf|chore|build|style|revert)(\([^)]*\))?!?:)/;
const DAY = 86_400_000;
const STALE_DAYS = 14;
const REPORT_TITLE = "Repository hygiene report";

export function findings({ now, branches, pulls, issues, labels }) {
  const out = { deleteBranches: [], problems: [] };
  for (const branch of branches) {
    if (KEEP_BRANCH.test(branch)) continue;
    const own = pulls.filter((p) => p.head === branch);
    if (own.length === 0 || own.some((p) => p.state === "open")) continue;
    const lastClosed = Math.max(...own.map((p) => Date.parse(p.closedAt)));
    if (now - lastClosed > DAY) out.deleteBranches.push(branch);
  }
  for (const p of pulls) {
    if (p.state === "open" && now - Date.parse(p.updatedAt) > STALE_DAYS * DAY) {
      out.problems.push(`#${p.number}: pull request with no activity for ${STALE_DAYS} days`);
    }
  }
  for (const i of issues) {
    if (i.title === REPORT_TITLE) continue;
    if (!i.labels.some((l) => l.startsWith("type:"))) out.problems.push(`#${i.number}: no type: label`);
    if (!i.milestone) out.problems.push(`#${i.number}: no milestone`);
    if (TITLE_PREFIX.test(i.title)) out.problems.push(`#${i.number}: title starts with a commit prefix`);
  }
  for (const name of labels) {
    if (!LABEL_FAMILIES.test(name) && !LABEL_EXTRAS.has(name)) out.problems.push(`label "${name}" is outside the naming standard`);
  }
  return out;
}

function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input, maxBuffer: 1 << 30, stdio: ["pipe", "pipe", "inherit"] });
}

function list(repo, path) {
  const all = [];
  for (let page = 1; ; page++) {
    const items = JSON.parse(gh(["api", `repos/${repo}/${path}&per_page=100&page=${page}`]));
    all.push(...items);
    if (items.length < 100) return all;
  }
}

function main() {
  const apply = process.argv.includes("--apply");
  const at = process.argv.indexOf("--repo");
  const repo = at > 0 ? process.argv[at + 1] : process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("set GITHUB_REPOSITORY or pass --repo owner/name");

  const pulls = list(repo, "pulls?state=all")
    .filter((p) => p.head.repo?.full_name === repo)
    .map((p) => ({ number: p.number, head: p.head.ref, state: p.state, closedAt: p.closed_at, updatedAt: p.updated_at }));
  const issues = list(repo, "issues?state=open")
    .filter((i) => !i.pull_request)
    .map((i) => ({ number: i.number, title: i.title, labels: i.labels.map((l) => l.name), milestone: i.milestone?.title }));
  const branches = list(repo, "branches?").map((b) => b.name);
  const labels = list(repo, "labels?sort=name").map((l) => l.name);

  const result = findings({ now: Date.now(), branches, pulls, issues, labels });
  for (const branch of result.deleteBranches) {
    console.log(`${apply ? "Deleting" : "Would delete"} branch ${branch}`);
    if (apply) gh(["api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${branch}`]);
  }
  for (const problem of result.problems) console.log(problem);
  console.log(`Checked ${branches.length} branches, ${pulls.length} pull requests, ${issues.length} open issues and ${labels.length} labels: ${result.deleteBranches.length} finished branches, ${result.problems.length} problems.`);

  const report = issues.find((i) => i.title === REPORT_TITLE);
  const body = `Found by the weekly hygiene run. Fix these, then the next run closes this issue.\n\n${result.problems.map((p) => `- ${p}`).join("\n")}\n`;
  if (!apply) return;
  if (result.problems.length && report) gh(["api", "-X", "PATCH", `repos/${repo}/issues/${report.number}`, "-f", `body=${body}`]);
  else if (result.problems.length) gh(["api", `repos/${repo}/issues`, "-f", `title=${REPORT_TITLE}`, "-f", `body=${body}`, "-f", "labels[]=type:chore", "-f", "labels[]=needs:triage"]);
  else if (report) gh(["api", "-X", "PATCH", `repos/${repo}/issues/${report.number}`, "-f", "state=closed", "-f", "state_reason=completed"]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
