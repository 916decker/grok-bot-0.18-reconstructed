import assert from "node:assert/strict";
import test from "node:test";

import { UPSTREAM_APP_NAME, planInstall } from "../scripts/lib/install-plan.mjs";

const base = {
  platform: "darwin",
  outputApp: "/repo/dist/Grok Bot 0.18 Reconstructed.app",
  sourceExists: true,
  targetExists: false,
  force: false,
};

const actions = (plan) => plan.steps.map((step) => step.action);

test("installing is refused off macOS", () => {
  const plan = planInstall({ ...base, platform: "linux" });
  assert.match(plan.error, /only be installed on macOS/);
});

test("the upstream application is never overwritten", () => {
  const plan = planInstall({ ...base, outputApp: `/repo/dist/${UPSTREAM_APP_NAME}` });
  assert.match(plan.error, /Refusing to install over the upstream/);
});

test("installing without a packaged build points at packaging", () => {
  const plan = planInstall({ ...base, sourceExists: false });
  assert.match(plan.error, /Run npm run package first/);
});

test("an existing install is kept unless replacing it is explicit", () => {
  const plan = planInstall({ ...base, targetExists: true });
  assert.match(plan.error, /Re-run with --force to replace it/);
});

test("a first install verifies, copies, clears quarantine, then re-verifies", () => {
  const plan = planInstall(base);
  assert.equal(plan.target, "/Applications/Grok Bot 0.18 Reconstructed.app");
  assert.deepEqual(actions(plan), ["verify", "copy", "clear-quarantine", "verify"]);
  // The bundle must prove itself before it is promoted into /Applications.
  assert.equal(plan.steps[0].target, base.outputApp);
  assert.equal(plan.steps.at(-1).target, plan.target);
});

test("replacing an install removes the old one only after the new one verifies", () => {
  const plan = planInstall({ ...base, targetExists: true, force: true });
  assert.deepEqual(actions(plan), ["verify", "remove", "copy", "clear-quarantine", "verify"]);
  assert.ok(
    actions(plan).indexOf("verify") < actions(plan).indexOf("remove"),
    "a working install must not be removed for a bundle that fails verification",
  );
});

test("every step targets the packaged bundle or the install location", () => {
  const plan = planInstall({ ...base, targetExists: true, force: true });
  for (const step of plan.steps) {
    assert.ok(
      step.target === base.outputApp || step.target === plan.target,
      `unexpected step target: ${step.target}`,
    );
  }
});
