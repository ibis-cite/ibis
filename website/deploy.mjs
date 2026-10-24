import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "./build.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const sshOptions = ["-oBatchMode=yes", "-oStrictHostKeyChecking=yes", "-oConnectTimeout=15", "-oServerAliveInterval=15", "-oServerAliveCountMax=3"];
const quote = text => "'" + text + "'"; // All remote paths are validated below.
export function deployment(env = process.env) {
  const host = env.IBIS_DEPLOY_HOST || "ibis-hosting";
  const web = env.IBIS_WEB_ROOT || "";
  const backups = resolve(env.IBIS_BACKUP_DIR || join(homedir(), "Downloads", "Ibis website backups"));
  if (!/^[a-zA-Z][\w.-]*$/.test(host)) throw Error("Use a local SSH host alias");
  if (!/^\/home\/[a-zA-Z0-9_-]+\/domains\/ibiscite\.org\/public_html$/.test(web)) throw Error("Set the exact ibiscite.org document root locally");
  if ((env.IBIS_BACKUP_DIR && !isAbsolute(env.IBIS_BACKUP_DIR)) || backups === root || backups.startsWith(root + "/")) throw Error("Backups must stay outside the repository");
  return { host, web, backups };
}
function run(label, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "ignore"] });
  // Never print commands, connection details or remote diagnostics.
  if (result.status !== 0) throw Error(`${label} failed; check local access/configuration. Nothing sensitive was logged.`);
  return result.stdout.trim();
}
export async function deploy(publish = false, env = process.env) {
  const { host, web, backups } = deployment(env);
  const head = run("Source check", "git", ["rev-parse", "HEAD"]);
  if (head !== run("Main check", "git", ["rev-parse", "origin/main"]) ||
      run("Clean checkout check", "git", ["status", "--porcelain"])) throw Error("Deploy only a clean, fetched main checkout");
  await build();
  const ssh = (label, command) => run(label, "ssh", [...sshOptions, host, command]);
  // realpath and no symlinks prevent a mistaken alias/root from touching another site.
  ssh("Remote preflight", `test -d ${quote(web)} && test ! -L ${quote(web)} && test "$(realpath ${quote(web)})" = ${quote(web)} && command -v rsync >/dev/null && command -v tar >/dev/null`);
  if (!publish) { console.log("Deployment preflight passed; use --publish to back up and upload dist."); return; }
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const remoteBackup = web.replace(/public_html$/, ".ibis-backups") + "/" + stamp + ".tar.gz";
  const localBackup = join(backups, stamp);
  await mkdir(localBackup, { recursive: true, mode: 0o700 });
  ssh("Remote backup", `umask 077; mkdir -p ${quote(web.replace(/public_html$/, ".ibis-backups"))} && tar -czf ${quote(remoteBackup)} -C ${quote(web)} .`);
  const shell = ["ssh", ...sshOptions].join(" ");
  run("Private backup download", "rsync", ["-a", "-e", shell, `${host}:${remoteBackup}`, join(localBackup, "previous-site.tar.gz")]);
  await writeFile(join(localBackup, "deployment.json"), JSON.stringify({ commit: head, deployedAt: stamp }, null, 2) + "\n", { mode: 0o600 });
  run("Public upload", "rsync", ["-a", "--checksum", "--delay-updates", "--delete-delay", "-e", shell, join(root, "website/dist/"), `${host}:${web}/`]);
  const difference = run("Upload verification", "rsync", ["-anrc", "--delete", "--out-format=%n", "-e", shell, join(root, "website/dist/"), `${host}:${web}/`]);
  if (difference) throw Error("Remote files differ from dist; retain the backup and investigate before continuing");
  console.log("Published public dist; private rollback archive and source commit retained.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(arg => arg !== "--publish")) throw Error("Usage: node website/deploy.mjs [--publish]");
  try { await deploy(process.argv.includes("--publish")); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
