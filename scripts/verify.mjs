import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const distRoot = path.join(appRoot, "dist");
const sourceOnly = process.argv.includes("--source-only");

const requiredFiles = [
  "manifest.json",
  "background.js",
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js",
];

async function verifySourceManifest() {
  const manifest = JSON.parse(await readFile(path.join(appRoot, "manifest.json"), "utf8"));

  if (manifest.manifest_version !== 3) {
    throw new Error("manifest_version must be 3");
  }
  if (manifest.side_panel?.default_path !== "sidepanel.html") {
    throw new Error("manifest side_panel.default_path must be sidepanel.html");
  }

  const permissions = new Set(manifest.permissions || []);
  for (const permission of ["sidePanel", "storage", "tabs"]) {
    if (!permissions.has(permission)) {
      throw new Error(`manifest is missing ${permission} permission`);
    }
  }
}

async function verifyDistFiles() {
  for (const file of requiredFiles) {
    await access(path.join(distRoot, file));
  }
}

async function verify() {
  await verifySourceManifest();
  if (!sourceOnly) {
    await verifyDistFiles();
  }
  console.log("linear-ticket-sidepanel checks passed");
}

await verify();
