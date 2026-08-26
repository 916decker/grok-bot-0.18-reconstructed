// Install a locally packaged build into /Applications.
//
// This is a local install of a locally built app, not a distribution step: the
// bundle keeps the reconstructed identity and its ad-hoc signature. Installing
// it makes the result launchable from Launchpad and Spotlight like any other
// application, which is the last piece of friction after `npm run package`.
//
// Usage: npm run install-app [-- --force]

import { access, rm } from "node:fs/promises";
import path from "node:path";

import { outputApp } from "./lib/config.mjs";
import { run } from "./lib/process.mjs";
import { SYSTEM_TOOLS } from "./lib/system-tools.mjs";

if (process.platform !== "darwin") {
  throw new Error("The reconstructed application can only be installed on macOS.");
}

const force = process.argv.slice(2).includes("--force");
const appName = path.basename(outputApp);

// The upstream application is a separate install with its own bundle identity.
// Refuse outright to write over it, whatever the configured output name is.
if (appName === "Grok Bot.app") {
  throw new Error("Refusing to install over the upstream Grok Bot.app. The reconstruction uses a distinct bundle name.");
}

const target = path.join("/Applications", appName);

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(outputApp))) {
  throw new Error(`No packaged application at ${outputApp}. Run npm run package first.`);
}

// Install only what already verifies, so a broken bundle is never promoted into
// /Applications where it would shadow a previously working install.
await run(SYSTEM_TOOLS.codesign, ["--verify", "--deep", "--strict", outputApp]);

if (await exists(target)) {
  if (!force) {
    throw new Error(`${target} already exists. Re-run with --force to replace it.`);
  }
  await rm(target, { recursive: true, force: true });
}

await run(SYSTEM_TOOLS.ditto, [outputApp, target]);
await run(SYSTEM_TOOLS.xattr, ["-cr", target]);
await run(SYSTEM_TOOLS.codesign, ["--verify", "--deep", "--strict", target]);

console.log(`Installed ${target}`);
console.log("It is now available from Launchpad and Spotlight.");
