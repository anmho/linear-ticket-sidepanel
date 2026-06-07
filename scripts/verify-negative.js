const { spawn } = require("node:child_process");
const { cp, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");

const requiredPermissions = [
  "sidePanel",
  "storage",
  "tabs",
  "activeTab",
  "contextMenus",
];

const requiredHostPermissions = [
  "https://api.linear.app/*",
  "https://*/*",
  "http://*/*",
  "http://localhost/*",
  "http://127.0.0.1/*",
];

async function makeFixture() {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "manifest-verify-"));
  await cp(path.join(appRoot, "scripts"), path.join(fixtureRoot, "scripts"), {
    recursive: true,
  });
  await cp(path.join(appRoot, "dist"), path.join(fixtureRoot, "dist"), {
    recursive: true,
  });
  await cp(
    path.join(appRoot, "package.json"),
    path.join(fixtureRoot, "package.json"),
  );
  return fixtureRoot;
}

function runVerify(cwd, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/verify.js", ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, output });
    });
  });
}

async function mutateJson(filePath, mutate) {
  const json = JSON.parse(await readFile(filePath, "utf8"));
  mutate(json);
  await writeFile(filePath, `${JSON.stringify(json, null, 2)}\n`);
}

async function expectVerifyFailure({ name, filePath, args, mutate, errorText }) {
  const fixtureRoot = await makeFixture();
  try {
    await mutateJson(path.join(fixtureRoot, filePath), mutate);
    const result = await runVerify(fixtureRoot, args);
    if (result.code === 0) {
      throw new Error(`${name} unexpectedly passed verification`);
    }
    if (!result.output.includes(errorText)) {
      throw new Error(
        `${name} failed without expected error text "${errorText}":\n${result.output}`,
      );
    }
    console.log(`ok ${name}`);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

function withoutValue(values, valueToRemove) {
  return values.filter((value) => value !== valueToRemove);
}

async function verifyMissingSourcePermission(permission) {
  await expectVerifyFailure({
    name: `source missing ${permission}`,
    filePath: "package.json",
    args: ["--source-only"],
    mutate: (packageJson) => {
      packageJson.manifest.permissions = withoutValue(
        packageJson.manifest.permissions,
        permission,
      );
    },
    errorText: `manifest override is missing ${permission} in permissions`,
  });
}

async function verifyMissingDistPermission(permission) {
  await expectVerifyFailure({
    name: `dist missing ${permission}`,
    filePath: path.join("dist", "manifest.json"),
    mutate: (manifest) => {
      manifest.permissions = withoutValue(manifest.permissions, permission);
    },
    errorText: `dist manifest is missing ${permission} in permissions`,
  });
}

async function verifyMissingSourceHostPermission(hostPermission) {
  await expectVerifyFailure({
    name: `source missing ${hostPermission}`,
    filePath: "package.json",
    args: ["--source-only"],
    mutate: (packageJson) => {
      packageJson.manifest.host_permissions = withoutValue(
        packageJson.manifest.host_permissions,
        hostPermission,
      );
    },
    errorText: `manifest override is missing ${hostPermission} in host_permissions`,
  });
}

async function verifyMissingDistHostPermission(hostPermission) {
  await expectVerifyFailure({
    name: `dist missing ${hostPermission}`,
    filePath: path.join("dist", "manifest.json"),
    mutate: (manifest) => {
      manifest.host_permissions = withoutValue(
        manifest.host_permissions,
        hostPermission,
      );
    },
    errorText: `dist manifest is missing ${hostPermission} in host_permissions`,
  });
}

async function verifyNegativeChecks() {
  for (const permission of requiredPermissions) {
    await verifyMissingSourcePermission(permission);
    await verifyMissingDistPermission(permission);
  }

  for (const hostPermission of requiredHostPermissions) {
    await verifyMissingSourceHostPermission(hostPermission);
    await verifyMissingDistHostPermission(hostPermission);
  }

  console.log("negative manifest verification checks passed");
}

verifyNegativeChecks().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
