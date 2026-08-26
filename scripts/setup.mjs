// One-command path from a fresh clone to a launchable application.
//
// Each stage is the same npm script a contributor would run by hand; running
// them here keeps the ordering, the preflight gate, and the failure messages in
// one place so a first-time setup does not have to know the sequence.
//
// Usage: npm run setup [-- --skip-package]

import path from "node:path";

import { outputApp, repoRoot } from "./lib/config.mjs";
import { spawnProcess } from "./lib/process.mjs";

const skipPackage = process.argv.slice(2).includes("--skip-package");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

async function runStage(title, args) {
  console.log(`\n=== ${title} ===`);
  const code = await new Promise((resolve, reject) => {
    const child = spawnProcess(npm, args, { cwd: repoRoot, stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => resolve(exitCode ?? `signal ${signal}`));
  });
  if (code !== 0) {
    console.error(`\nSetup stopped: \`npm ${args.join(" ")}\` failed (${code}).`);
    process.exit(1);
  }
}

// The preflight runs first so a missing prerequisite is reported before any
// long-running download or compile begins.
await runStage("Checking the environment", skipPackage ? ["run", "doctor", "--", "--skip-package"] : ["run", "doctor"]);

// Bootstrap exists to hydrate the packaging input and needs macOS to mount the
// pinned DMG, so it is skipped alongside packaging. The source checks do not
// depend on it, which is what makes --skip-package usable off macOS.
if (!skipPackage) {
  await runStage("Hydrating the checksum-pinned build input", ["run", "bootstrap"]);
}
await runStage("Running source and publication checks", ["run", "check"]);

if (skipPackage) {
  console.log("\nSetup complete (bootstrap and packaging skipped).");
  console.log("Run npm run setup on an Apple Silicon Mac to build the application bundle.");
} else {
  await runStage("Packaging the application", ["run", "package"]);
  console.log("\nSetup complete.");
  console.log(`Application: ${path.relative(repoRoot, outputApp)}`);
  console.log(`Launch it with: open "${path.relative(repoRoot, outputApp)}"`);
}
