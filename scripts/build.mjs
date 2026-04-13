import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const distRoot = path.join(appRoot, "dist");

async function ensureManifestVersion() {
  const manifestPath = path.join(appRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.manifest_version !== 3) {
    throw new Error("manifest.json must declare manifest_version 3");
  }

  await writeFile(
    path.join(distRoot, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
}

async function copyAppFiles() {
  const entries = await readdir(appRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "scripts" || entry.name === "package.json" || entry.name === "dist") {
      continue;
    }

    const source = path.join(appRoot, entry.name);
    const destination = path.join(distRoot, entry.name);
    if (entry.isDirectory()) {
      await cp(source, destination, { recursive: true });
      continue;
    }
    await cp(source, destination);
  }
}

async function build() {
  await rm(distRoot, { recursive: true, force: true });
  await mkdir(distRoot, { recursive: true });
  await copyAppFiles();
  await ensureManifestVersion();

  const manifestStats = await stat(path.join(distRoot, "manifest.json"));
  if (!manifestStats.isFile()) {
    throw new Error("dist manifest.json was not generated");
  }

  console.log(`built linear-ticket-sidepanel to ${distRoot}`);
}

await build();
