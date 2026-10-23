import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const source = fileURLToPath(new URL(".", import.meta.url));
const brand = fileURLToPath(new URL("../brand/exports/", import.meta.url));
// Publish an explicit public set, never a checkout or a recursive brand copy.
export async function build(output = join(source, "dist")) {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const file of ["index.html", "setup.html", "style.css", ".htaccess"]) await copyFile(join(source, file), join(output, file));
  for (const file of ["ibis-logo.svg", "ibis-logo-on-dark.svg", "colors.css", "favicon.svg", "favicon.ico", "site.webmanifest",
    "png/og-image.png", "png/apple-touch-icon.png", "png/icon-192.png", "png/icon-512.png", "png/icon-maskable-512.png"]) {
    const target = join(output, "assets", file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(brand, file), target);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await build();
  console.log("Built website/dist; publish only its contents.");
}
