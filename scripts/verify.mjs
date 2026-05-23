import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  requiredHostPermissions,
  requiredPermissions,
} from "./manifest-requirements.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const distRoot = path.join(appRoot, "dist");
const sourceOnly = process.argv.includes("--source-only");

function assertManifestIncludes(manifest, propertyName, requiredValues, label) {
  const values = new Set(
    Array.isArray(manifest[propertyName]) ? manifest[propertyName] : [],
  );

  for (const value of requiredValues) {
    if (!values.has(value)) {
      throw new Error(`${label} is missing ${value} in ${propertyName}`);
    }
  }
}

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

  assertManifestIncludes(
    manifest,
    "permissions",
    requiredPermissions,
    "manifest override",
  );
  assertManifestIncludes(
    manifest,
    "host_permissions",
    requiredHostPermissions,
    "manifest override",
  );
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

  assertManifestIncludes(
    manifest,
    "permissions",
    requiredPermissions,
    "dist manifest",
  );
  assertManifestIncludes(
    manifest,
    "host_permissions",
    requiredHostPermissions,
    "dist manifest",
  );

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
