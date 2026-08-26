// One command from a fresh clone to a launchable application.
//
// Each stage is the same npm script a contributor would run by hand; running
// them here keeps the ordering, the preflight gate, and the failure messages in
// one place so a first-time setup does not have to know the sequence.
//
// Usage: npm run setup [-- --skip-package] [-- --install]

import { stat } from "node:fs/promises";
import path from "node:path";

import { archivedDmg, outputApp, repoRoot } from "./lib/config.mjs";
import { spawnProcess } from "./lib/process.mjs";

const argv = process.argv.slice(2);
const skipPackage = argv.includes("--skip-package");
const installAfterPackaging = argv.includes("--install");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

async function runCommand(command, args, { optional = false } = {}) {
  const code = await new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { cwd: repoRoot, stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", (error) => (optional ? resolve(error.code ?? 1) : reject(error)));
    child.once("exit", (exitCode, signal) => resolve(exitCode ?? `signal ${signal}`));
  });
  if (code !== 0 && !optional) {
    console.error(`\nSetup stopped: \`${command} ${args.join(" ")}\` failed (${code}).`);
    process.exit(1);
  }
  return code === 0;
}

function stage(title) {
  console.log(`\n=== ${title} ===`);
}

// An LFS pointer stands in for the preserved installer until the objects are
// fetched. Doing that here means a fresh clone does not have to know about LFS;
// if it fails, bootstrap still falls back to the pinned public download.
async function hydratePreservedInstaller() {
  let size = 0;
  try {
    ({ size } = await stat(archivedDmg));
  } catch {
    return; // No archive in this tree; bootstrap will resolve the input itself.
  }
  if (size >= 1024 * 1024) return;

  stage("Fetching the preserved installer");
  const installed = await runCommand("git", ["lfs", "install"], { optional: true });
  const pulled = installed && (await runCommand("git", ["lfs", "pull"], { optional: true }));
  if (!pulled) {
    console.log("Could not fetch LFS objects; bootstrap will use the pinned download URL instead.");
  }
}

stage("Checking the environment");
await runCommand(npm, skipPackage ? ["run", "doctor", "--", "--skip-package"] : ["run", "doctor"]);

// Bootstrap exists to hydrate the packaging input and needs macOS to mount the
// pinned DMG, so it is skipped alongside packaging. The source checks do not
// depend on it, which is what makes --skip-package usable off macOS.
if (!skipPackage) {
  await hydratePreservedInstaller();
  stage("Hydrating the checksum-pinned build input");
  await runCommand(npm, ["run", "bootstrap"]);
}

stage("Running source and publication checks");
await runCommand(npm, ["run", "check"]);

if (skipPackage) {
  console.log("\nSetup complete (bootstrap and packaging skipped).");
  console.log("Run npm run setup on an Apple Silicon Mac to build the application bundle.");
} else {
  stage("Packaging the application");
  await runCommand(npm, ["run", "package"]);

  if (installAfterPackaging) {
    stage("Installing into /Applications");
    await runCommand(npm, ["run", "install-app", "--", "--force"]);
    console.log("\nSetup complete. The application is available from Launchpad and Spotlight.");
  } else {
    console.log("\nSetup complete.");
    console.log(`Application: ${path.relative(repoRoot, outputApp)}`);
    console.log(`Launch it with: open "${path.relative(repoRoot, outputApp)}"`);
    console.log("Install it into /Applications with: npm run install-app");
  }
}
