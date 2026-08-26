import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "release.yml");

const workflow = await readFile(workflowPath, "utf8");

test("the release build runs on macOS and proves it is Apple Silicon", async () => {
  assert.match(workflow, /runs-on: macos-/);
  // The runner image can change under a label, so the build asserts the
  // architecture rather than trusting it.
  assert.match(workflow, /uname -m/);
  assert.match(workflow, /!= "arm64"/);
});

test("the build input is fetched before bootstrap consumes it", async () => {
  assert.match(workflow, /lfs: true/);
  assert.ok(
    workflow.indexOf("lfs: true") < workflow.indexOf("npm run bootstrap"),
    "LFS objects must be checked out before bootstrap runs",
  );
});

test("the release pins the same Node the toolchain requires", async () => {
  const pinned = (await readFile(path.join(repoRoot, ".node-version"), "utf8")).trim();
  assert.match(workflow, new RegExp(`node-version: ${pinned.replace(/\./g, "\\.")}`));
});

// A workflow with contents: write can publish releases, so it must not run
// third-party code. Every action here is published by GitHub itself.
test("the release workflow uses only first-party actions", async () => {
  const used = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((match) => match[1]);
  assert.ok(used.length > 0, "expected the workflow to use actions");
  for (const action of used) {
    assert.match(action, /^actions\//, `${action} is not a first-party action`);
  }
});

test("the image is verified and only released from a tag", async () => {
  assert.match(workflow, /npm run verify/);
  assert.match(workflow, /shasum -a 256 -c/);
  assert.match(workflow, /if: startsWith\(github\.ref, 'refs\/tags\/'\)/);
  assert.match(workflow, /--prerelease/);
  // Packaging must precede imaging; the image is built from the packaged app.
  assert.ok(
    workflow.indexOf("package-macos.mjs") < workflow.indexOf("npm run package:dmg"),
    "the application must be packaged before it is imaged",
  );
});
