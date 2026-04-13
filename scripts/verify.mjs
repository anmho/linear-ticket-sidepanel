import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const distRoot = path.join(appRoot, "dist");
const sourceOnly = process.argv.includes("--source-only");

const requiredPermissions = ["sidePanel", "storage", "tabs"];

async function verifySourceConfig() {
  const packageJson = JSON.parse(
    await readFile(path.join(appRoot, "package.json"), "utf8"),
  );

  if (!packageJson.scripts?.["build:plasmo"]) {
    throw new Error("package.json must define scripts.build:plasmo");
  }

  const manifest = packageJson.manifest;
  if (!manifest || typeof manifest !== "object") {
    throw new Error("package.json must define a Plasmo manifest override");
  }

  const permissions = new Set(manifest.permissions || []);
  for (const permission of requiredPermissions) {
    if (!permissions.has(permission)) {
      throw new Error(`manifest override is missing ${permission} permission`);
    }
  }
}

async function verifyDistManifest() {
  const manifestPath = path.join(distRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  if (manifest.manifest_version !== 3) {
    throw new Error("dist manifest_version must be 3");
  }

  if (!manifest.side_panel?.default_path) {
    throw new Error("dist manifest is missing side_panel.default_path");
  }

  const permissions = new Set(manifest.permissions || []);
  for (const permission of requiredPermissions) {
    if (!permissions.has(permission)) {
      throw new Error(`dist manifest is missing ${permission} permission`);
    }
  }

  await access(path.join(distRoot, manifest.side_panel.default_path));

  const iconPaths = Object.values(manifest.icons || {});
  for (const iconPath of iconPaths) {
    await access(path.join(distRoot, iconPath));
  }

  const serviceWorkerPath = manifest.background?.service_worker;
  if (!serviceWorkerPath) {
    throw new Error("dist manifest is missing background.service_worker");
  }
  await access(path.join(distRoot, serviceWorkerPath));
}

async function verify() {
  await verifySourceConfig();
  if (!sourceOnly) {
    await verifyDistManifest();
  }
  console.log("linear-ticket-sidepanel checks passed");
}

await verify();
