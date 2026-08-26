// Build a double-clickable disk image from an already-packaged application.
//
// The image mounts as a volume containing the app beside an Applications
// symlink, so installing is the familiar drag across. This is the artifact to
// attach to a private release; it carries the reconstruction's own identity and
// ad-hoc signature, and is not a redistribution of the upstream application.
//
// Every decision lives in ./lib/dmg-plan.mjs so the refusal paths and the step
// ordering are testable off macOS. This file only executes the plan.
//
// Usage: npm run package:dmg [-- --force] [-- --dry-run]

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildDir, outputApp, outputDir, repoRoot, upstreamVersion } from "./lib/config.mjs";
import { planDmg } from "./lib/dmg-plan.mjs";
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

async function sha256(target) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return hash.digest("hex");
}

const provisionalName = `${path.basename(outputApp).replace(/\.app$/, "")}-${upstreamVersion}.dmg`;
const plan = planDmg({
  platform: process.platform,
  outputApp,
  version: upstreamVersion,
  appExists: await exists(outputApp),
  dmgExists: await exists(path.join(outputDir, provisionalName)),
  force,
  buildDir,
  distDir: outputDir,
});

if (plan.error) throw new Error(plan.error);

const describe = {
  verify: (target) => `verify signature: ${target}`,
  "reset-staging": (target) => `reset staging directory: ${target}`,
  "stage-app": (target) => `copy application into ${target}`,
  "link-applications": (target) => `link /Applications at ${target}`,
  "create-image": (target) => `create disk image: ${target}`,
  checksum: (target) => `record SHA-256 beside ${target}`,
  cleanup: (target) => `remove staging directory: ${target}`,
};

if (dryRun) {
  console.log("Planned disk image steps:");
  for (const step of plan.steps) console.log(`  - ${describe[step.action](step.target)}`);
  console.log("\nNothing was changed. Re-run without --dry-run to build.");
  process.exit(0);
}

for (const step of plan.steps) {
  switch (step.action) {
    case "verify":
      await run(SYSTEM_TOOLS.codesign, ["--verify", "--deep", "--strict", step.target]);
      break;
    case "reset-staging":
      await rm(step.target, { recursive: true, force: true });
      await mkdir(step.target, { recursive: true });
      break;
    case "stage-app":
      await run(SYSTEM_TOOLS.ditto, [outputApp, step.target]);
      break;
    case "link-applications":
      await symlink("/Applications", step.target);
      break;
    case "create-image":
      await rm(step.target, { force: true });
      await run(SYSTEM_TOOLS.hdiutil, [
        "create",
        "-volname", plan.volumeName,
        "-srcfolder", plan.stagingDir,
        "-fs", "HFS+",
        "-format", "UDZO",
        "-imagekey", "zlib-level=9",
        "-quiet",
        step.target,
      ]);
      break;
    case "checksum": {
      const digest = await sha256(step.target);
      await writeFile(`${step.target}.sha256`, `${digest}  ${path.basename(step.target)}\n`, "utf8");
      console.log(`SHA-256: ${digest}`);
      break;
    }
    case "cleanup":
      await rm(step.target, { recursive: true, force: true });
      break;
    default:
      throw new Error(`Unknown disk image step: ${step.action}`);
  }
}

console.log(`\nDisk image: ${path.relative(repoRoot, plan.dmgPath)}`);
console.log("Double-click it, then drag the application to Applications.");
console.log("See docs/PRIVATE-RELEASE.md to attach it to a private release.");
