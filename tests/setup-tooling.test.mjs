import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
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

test("setup skips the macOS-only bootstrap when packaging is skipped", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "setup.mjs"), "utf8");
  assert.match(source, /if \(!skipPackage\) \{\s*\n\s*await runStage\("Hydrating/);
  assert.match(source, /skipPackage \? \["run", "doctor", "--", "--skip-package"\] : \["run", "doctor"\]/);
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
});
