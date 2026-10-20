// ADR 0021: feature code uses Ibis wrappers; only ui imports React Aria.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export function forbiddenUiImports(root) {
  const forbidden = [];
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { if (file !== join(root, "ui")) scan(file); continue; }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      // Keep quoted strings whole; comments and example text cannot invent imports.
      const tokens = [...readFileSync(file, "utf8").matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[\w$]+|[^\s]/g)]
        .map(([token]) => token).filter((token) => !token.startsWith("//") && !token.startsWith("/*"));
      if (tokens.some((token, i) => /^["'`]react-aria(?:-components)?(?:\/|["'`])/.test(token)
        && (["from", "import"].includes(tokens[i - 1]) || tokens[i - 1] === "(" && ["import", "require"].includes(tokens[i - 2])))) {
        forbidden.push(relative(root, file).split(sep).join("/"));
      }
    }
  }
  scan(root);
  return forbidden.sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const forbidden = forbiddenUiImports("apps/desktop/src");
  if (forbidden.length) {
    console.error(`React Aria imports must stay in src/ui/: ${forbidden.join(", ")}`);
    process.exitCode = 1;
  }
}
