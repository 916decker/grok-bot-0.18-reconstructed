// Preflight environment check for the reconstruction toolchain.
//
// Every prerequisite that `npm run setup` depends on is verified here first, so
// a missing tool or an unpulled LFS object is reported as one actionable line
// instead of surfacing later as an opaque failure inside bootstrap or packaging.
//
// Exit status is 0 when nothing blocking was found, 1 otherwise. Warnings never
// fail the run: they mark optional capabilities such as the local Docker box.

import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { archivedDmg, cachedRuntimeApp, repoRoot } from "./lib/config.mjs";
import { capture } from "./lib/process.mjs";
import { SYSTEM_TOOLS } from "./lib/system-tools.mjs";

const PASS = "pass";
const FAIL = "fail";
const WARN = "warn";

// Packaging is macOS-only, but the source checks run anywhere. When packaging is
// out of scope, the prerequisites that exist only to serve it are reported as
// warnings so a Linux or Windows contributor still gets a clean, usable result.
const skipPackage = process.argv.slice(2).includes("--skip-package");
const packagingSeverity = skipPackage ? WARN : FAIL;

const results = [];

function record(name, status, detail, fix) {
  results.push({ name, status, detail, fix });
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function commandVersion(command, args) {
  try {
    return await capture(command, args);
  } catch {
    return null;
  }
}

function checkPlatform() {
  const { platform, arch } = process;
  if (platform !== "darwin") {
    record(
      "platform",
      packagingSeverity,
      `${platform}/${arch} cannot build the macOS application`,
      skipPackage
        ? "Source checks run here; run npm run package on an Apple Silicon Mac to build the app."
        : "Packaging requires macOS on Apple Silicon. Use npm run setup -- --skip-package to run the source checks here."
    );
    return;
  }
  if (arch !== "arm64") {
    record(
      "platform",
      packagingSeverity,
      `macOS ${arch} is unsupported`,
      "The pinned upstream build input is darwin-arm64 only. Use an Apple Silicon Mac."
    );
    return;
  }
  record("platform", PASS, "macOS on Apple Silicon");
}

async function checkNode() {
  const required = await readRequiredNodeRange();
  const current = process.versions.node;
  const major = Number(current.split(".")[0]);
  if (major !== 26) {
    record(
      "node",
      FAIL,
      `Node ${current} is active, but this toolchain targets ${required}`,
      "Install Node 26.5.x (see .node-version) — for example: nvm install 26.5.0 && nvm use"
    );
    return;
  }
  record("node", PASS, `Node ${current}`);
}

async function readRequiredNodeRange() {
  try {
    const manifest = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    return manifest.engines?.node ?? ">=26.5.0 <27";
  } catch {
    return ">=26.5.0 <27";
  }
}

async function checkDependencies() {
  if (await exists(path.join(repoRoot, "node_modules"))) {
    record("dependencies", PASS, "node_modules is installed");
    return;
  }
  record(
    "dependencies",
    FAIL,
    "node_modules is missing",
    "Run npm ci to install the locked dependency graph."
  );
}

async function checkGitLfs() {
  const version = await commandVersion("git", ["lfs", "version"]);
  if (version == null) {
    record(
      "git-lfs",
      packagingSeverity,
      "git-lfs is not installed",
      "Install Git LFS (brew install git-lfs) and run git lfs install. Only the preserved installer needs it."
    );
    return;
  }
  record("git-lfs", PASS, version.split("\n")[0]);
}

// An LFS pointer is a small text stub. Treating one as the real DMG is the most
// common bootstrap failure, so distinguish "absent" from "present but unpulled".
async function checkPreservedInstaller() {
  if (!(await exists(archivedDmg))) {
    record(
      "pinned-dmg",
      WARN,
      "No archived 0.18.0 DMG in the working tree",
      "Bootstrap will fall back to the public download URL, or set GROK_BOT_018_APP to an existing app copy."
    );
    return;
  }
  const { size } = await stat(archivedDmg);
  if (size < 1024 * 1024) {
    record(
      "pinned-dmg",
      packagingSeverity,
      `${path.relative(repoRoot, archivedDmg)} is an unpulled LFS pointer (${size} bytes)`,
      "Run git lfs install && git lfs pull to fetch the preserved installer."
    );
    return;
  }
  record("pinned-dmg", PASS, `archived DMG present (${(size / 1e6).toFixed(1)} MB)`);
}

async function checkXcodeTools() {
  if (process.platform !== "darwin") return;
  const developerDir = await commandVersion("/usr/bin/xcode-select", ["--print-path"]);
  if (developerDir == null) {
    record(
      "xcode-clt",
      FAIL,
      "Xcode Command Line Tools are not selected",
      "Run xcode-select --install (native modules and codesign depend on them)."
    );
    return;
  }
  record("xcode-clt", PASS, developerDir);
}

async function checkSystemTools() {
  if (process.platform !== "darwin") return;
  const missing = [];
  for (const [name, toolPath] of Object.entries(SYSTEM_TOOLS)) {
    if (!(await exists(toolPath))) missing.push(`${name} (${toolPath})`);
  }
  if (missing.length > 0) {
    record(
      "system-tools",
      FAIL,
      `Missing required system tools: ${missing.join(", ")}`,
      "These ship with macOS and the Command Line Tools; reinstall the tools if they are absent."
    );
    return;
  }
  record("system-tools", PASS, "hdiutil, codesign, ditto, plutil and xattr are available");
}

async function checkBootstrapState() {
  if (await exists(cachedRuntimeApp)) {
    record("bootstrap", PASS, "a cached upstream runtime is present");
    return;
  }
  record(
    "bootstrap",
    WARN,
    "No cached runtime yet",
    "Run npm run bootstrap to hydrate the checksum-pinned build input."
  );
}

async function checkDocker() {
  const version = await commandVersion("docker", ["--version"]);
  if (version == null) {
    record(
      "docker",
      WARN,
      "Docker is unavailable",
      "Optional: only the local sandbox toggle needs it. Remote mode is the default."
    );
    return;
  }
  record("docker", PASS, version);
}

await checkPlatform();
await checkNode();
await checkDependencies();
await checkGitLfs();
await checkPreservedInstaller();
await checkXcodeTools();
await checkSystemTools();
await checkBootstrapState();
await checkDocker();

const symbols = { [PASS]: "OK  ", [FAIL]: "FAIL", [WARN]: "WARN" };
console.log("Grok Bot 0.18 reconstruction — environment check\n");
for (const { name, status, detail, fix } of results) {
  console.log(`  ${symbols[status]}  ${name}: ${detail}`);
  if (status !== PASS && fix) console.log(`        → ${fix}`);
}

const failures = results.filter((result) => result.status === FAIL);
const warnings = results.filter((result) => result.status === WARN);
console.log();
if (failures.length === 0) {
  console.log(`No blocking problems found (${warnings.length} warning(s)).`);
  console.log(skipPackage ? "Next: npm run setup -- --skip-package" : "Next: npm run setup");
} else {
  console.log(`${failures.length} blocking problem(s) found. Resolve the items marked FAIL, then re-run npm run doctor.`);
  process.exitCode = 1;
}
