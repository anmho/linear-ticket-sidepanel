import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const distRoot = path.join(appRoot, "dist");
const plasmoBuildRoot = path.join(appRoot, "build", "chrome-mv3-prod");
const require = createRequire(import.meta.url);

function run(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function canOpenLmdbCache() {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "plasmo-lmdb-"));
  try {
    const lmdb = require("lmdb");
    const store = lmdb.open(cacheDir, {
      name: "parcel-cache",
      encoding: "binary",
      compression: true,
    });
    store.close();
    return true;
  } catch {
    return false;
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
}

async function getPlasmoBuildEnv() {
  if (await canOpenLmdbCache()) {
    return process.env;
  }

  const preloadPath = path.join(__dirname, "parcel-fs-cache-preload.cjs");
  const nodeOptions = [process.env.NODE_OPTIONS, `--require=${preloadPath}`]
    .filter(Boolean)
    .join(" ");

  return {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    PARCEL_FS_CACHE_APP_ROOT: appRoot,
  };
}

async function copyPlasmoOutput() {
  await rm(distRoot, { recursive: true, force: true });
  await mkdir(distRoot, { recursive: true });
  await cp(plasmoBuildRoot, distRoot, { recursive: true });

  const iconsInDist = path.join(distRoot, "icons");
  const iconsInSource = path.join(appRoot, "icons");
  try {
    await stat(iconsInDist);
  } catch {
    await cp(iconsInSource, iconsInDist, { recursive: true });
  }
}

async function verifyManifest() {
  const manifestPath = path.join(distRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  if (manifest.manifest_version !== 3) {
    throw new Error("dist manifest.json must declare manifest_version 3");
  }

  const permissions = new Set(manifest.permissions || []);
  for (const permission of ["sidePanel", "storage", "tabs"]) {
    if (!permissions.has(permission)) {
      throw new Error(`dist manifest missing ${permission} permission`);
    }
  }
}

async function build() {
  await run("npm", ["run", "build:plasmo"], appRoot, await getPlasmoBuildEnv());
  await copyPlasmoOutput();
  await verifyManifest();
  console.log(`built linear-ticket-sidepanel to ${distRoot}`);
}

await build();
