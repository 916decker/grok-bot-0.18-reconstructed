import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const doctor = path.join(repoRoot, "scripts", "doctor.mjs");

// The preflight reports problems through its exit status, so a non-zero exit is
// an expected outcome rather than a failure to run.
async function runDoctor(args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [doctor, ...args], { cwd: repoRoot });
    return stdout;
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.length > 0) return error.stdout;
    throw error;
  }
}

function statusOf(output, check) {
  const line = output.split("\n").find((entry) => entry.includes(`  ${check}: `));
  assert.ok(line != null, `doctor did not report a ${check} check`);
  return line.trim().split(/\s+/)[0];
}

test("the preflight runs and reports every prerequisite it checks", async () => {
  const output = await runDoctor([]);
  assert.match(output, /Grok Bot 0\.18 reconstruction — environment check/);
  for (const check of ["platform", "node", "dependencies", "git-lfs", "bootstrap"]) {
    assert.ok(["OK", "WARN", "FAIL"].includes(statusOf(output, check)), `${check} lacks a status`);
  }
});

// Packaging is macOS-only. Contributors on other platforms still need the source
// checks, so the prerequisites that exist only for packaging must not block them.
test("--skip-package downgrades packaging-only prerequisites to warnings", async () => {
  const output = await runDoctor(["--skip-package"]);
  for (const check of ["platform", "git-lfs", "pinned-dmg"]) {
    assert.notEqual(statusOf(output, check), "FAIL", `${check} must not block a --skip-package run`);
  }
  // A missing toolchain or dependency graph is still fatal in either mode.
  assert.ok(["OK", "FAIL"].includes(statusOf(output, "node")));
});

// The single entry point has to work before dependencies exist, so it may only
// use the shell and the Node guard, never anything from node_modules.
test("the one-command entry point is executable and self-sufficient", async () => {
  const entry = path.join(repoRoot, "setup");
  const info = await stat(entry);
  assert.ok((info.mode & 0o111) !== 0, "./setup must be executable");

  const source = await readFile(entry, "utf8");
  assert.match(source, /^#!\/bin\/sh/);
  assert.match(source, /set -eu/);
  // The Node guard runs before npm fetches anything.
  assert.ok(
    source.indexOf("check-node-version.mjs") < source.indexOf("npm ci"),
    "the Node version must be checked before dependencies are installed",
  );
  assert.match(source, /--skip-package/);
});

test("setup can hydrate LFS and chain the install itself", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "setup.mjs"), "utf8");
  // A failed LFS fetch must not stop setup: bootstrap can still use the URL.
  assert.match(source, /runCommand\("git", \["lfs", "pull"\], \{ optional: true \}\)/);
  assert.match(source, /installAfterPackaging/);
  assert.ok(
    source.indexOf("hydratePreservedInstaller()") < source.indexOf('["run", "bootstrap"]'),
    "the installer must be fetched before bootstrap consumes it",
  );
});

test("setup skips the macOS-only bootstrap when packaging is skipped", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "setup.mjs"), "utf8");
  assert.match(source, /if \(!skipPackage\) \{[\s\S]*?\["run", "bootstrap"\][\s\S]*?\n\}/);
  assert.match(source, /skipPackage \? \["run", "doctor", "--", "--skip-package"\] : \["run", "doctor"\]/);
  // Packaging and the install that follows it are both inside the else branch.
  assert.ok(
    source.indexOf('["run", "package"]') > source.indexOf("if (skipPackage) {"),
    "packaging must not run when it is skipped",
  );
});

// The DMG and the runtime extracted from it are identical across checkouts, so
// they live outside the repository and are reused by a second clone. Build
// outputs stay repo-local so clones cannot corrupt each other's artifacts.
test("the expensive build inputs are cached per user, not per checkout", async () => {
  const config = await import("../scripts/lib/config.mjs");
  for (const shared of [config.cachedDmg, config.cachedRuntimeApp]) {
    assert.ok(
      !shared.startsWith(`${config.repoRoot}${path.sep}`),
      `${shared} must not live inside the checkout`,
    );
    assert.ok(shared.includes(config.upstreamVersion), `${shared} must be scoped to the pinned version`);
  }
  for (const local of [config.outputApp, config.buildDir, config.sourceAppDir]) {
    assert.ok(local.startsWith(`${config.repoRoot}${path.sep}`), `${local} must stay in the checkout`);
  }
});

test("the shared cache location is overridable", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["-e", "import('./scripts/lib/config.mjs').then(c => console.log(c.cachedDmg))"],
    { cwd: repoRoot, env: { ...process.env, GROK_BOT_018_CACHE_DIR: path.join(repoRoot, ".cache", "override-probe") } },
  );
  assert.match(stdout.trim(), /override-probe/);
});

test("the setup entry points are wired into package.json", async () => {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(manifest.scripts.doctor, "node scripts/doctor.mjs");
  assert.equal(manifest.scripts.setup, "node scripts/setup.mjs");
  assert.equal(manifest.scripts["install-app"], "node scripts/install-app.mjs");
  assert.equal(manifest.scripts.preinstall, "node scripts/check-node-version.mjs");
});

// The installer runs macOS-only tools, so its decisions live in a pure module
// (covered exhaustively by install-plan.test.mjs) and this file only guards the
// split: the executor must not reintroduce decisions of its own.
test("the installer executes a plan rather than deciding for itself", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "install-app.mjs"), "utf8");
  assert.match(source, /import \{ planInstall \} from "\.\/lib\/install-plan\.mjs"/);
  assert.match(source, /if \(plan\.error\) throw new Error\(plan\.error\)/);
  assert.match(source, /--dry-run/);
  // An unrecognised step must fail loudly instead of being silently skipped.
  assert.match(source, /Unknown installation step/);
});
