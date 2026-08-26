// Install a locally packaged build into /Applications.
//
// This is a local install of a locally built app, not a distribution step: the
// bundle keeps its reconstructed identity and its ad-hoc signature. Installing
// it makes the result launchable from Launchpad and Spotlight like any other
// application, which is the last piece of friction after `npm run package`.
//
// Every decision lives in ./lib/install-plan.mjs so the refusal paths and the
// command ordering are testable off macOS. This file only executes the plan.
//
// Usage: npm run install-app [-- --force] [-- --dry-run]

import { access, rm } from "node:fs/promises";

import { outputApp } from "./lib/config.mjs";
import { planInstall } from "./lib/install-plan.mjs";
import { run } from "./lib/process.mjs";
import { SYSTEM_TOOLS } from "./lib/system-tools.mjs";

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const dryRun = argv.includes("--dry-run");

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

const plan = planInstall({
  platform: process.platform,
  outputApp,
  sourceExists: await exists(outputApp),
  targetExists: await exists(`/Applications/${outputApp.split("/").pop()}`),
  force,
});

if (plan.error) throw new Error(plan.error);

const describe = {
  verify: (target) => `verify signature: ${target}`,
  remove: (target) => `remove existing install: ${target}`,
  copy: (target) => `copy ${outputApp} -> ${target}`,
  "clear-quarantine": (target) => `clear quarantine attributes: ${target}`,
};

if (dryRun) {
  console.log("Planned installation steps:");
  for (const step of plan.steps) console.log(`  - ${describe[step.action](step.target)}`);
  console.log("\nNothing was changed. Re-run without --dry-run to install.");
  process.exit(0);
}

for (const step of plan.steps) {
  switch (step.action) {
    case "verify":
      await run(SYSTEM_TOOLS.codesign, ["--verify", "--deep", "--strict", step.target]);
      break;
    case "remove":
      await rm(step.target, { recursive: true, force: true });
      break;
    case "copy":
      await run(SYSTEM_TOOLS.ditto, [outputApp, step.target]);
      break;
    case "clear-quarantine":
      await run(SYSTEM_TOOLS.xattr, ["-cr", step.target]);
      break;
    default:
      throw new Error(`Unknown installation step: ${step.action}`);
  }
}

console.log(`Installed ${plan.target}`);
console.log("It is now available from Launchpad and Spotlight.");
