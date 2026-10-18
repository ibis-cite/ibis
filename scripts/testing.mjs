// Shared engineering-only reduction and issue lookup; no application imports.
// Keep the original signature during deletion reduction, including resource
// failures that have no sanitizer dedup token. Bound the entire reduction.
export function minimize(input, reproduce, signature, budgetMs = 120_000) {
  const deadline = Date.now() + budgetMs;
  for (let width = Math.ceil(input.length / 2); width >= 1 && Date.now() < deadline; width = Math.floor(width / 2)) {
    for (let start = 0; start < input.length && Date.now() < deadline;) {
      const candidate = Buffer.concat([input.subarray(0, start), input.subarray(start + width)]);
      if (reproduce(candidate) === signature) input = candidate;
      else start += width;
    }
  }
  return input;
}

export async function findIssue(repository, marker, request, state = "open", maxPages = Infinity) {
  for (let page = 1; page <= maxPages; page++) {
    const issues = await request(`/repos/${repository}/issues?state=${state}&labels=area%3Atesting&per_page=100&page=${page}`);
    const known = issues.find((issue) => issue.body?.includes(marker));
    if (known) return known;
    if (issues.length < 100) return null;
  }
  throw new Error("Issue lookup exceeded its page budget");
}
