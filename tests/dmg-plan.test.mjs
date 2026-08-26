import assert from "node:assert/strict";
import test from "node:test";

import { planDmg } from "../scripts/lib/dmg-plan.mjs";

const base = {
  platform: "darwin",
  outputApp: "/repo/dist/Grok Bot 0.18 Reconstructed.app",
  version: "0.18.0",
  appExists: true,
  dmgExists: false,
  force: false,
  buildDir: "/repo/.build",
  distDir: "/repo/dist",
};

const actions = (plan) => plan.steps.map((step) => step.action);

test("a disk image is only built on macOS", () => {
  assert.match(planDmg({ ...base, platform: "linux" }).error, /only be built on macOS/);
});

test("building without a packaged application points at packaging", () => {
  assert.match(planDmg({ ...base, appExists: false }).error, /Run npm run package first/);
});

test("an existing image is kept unless replacing it is explicit", () => {
  assert.match(planDmg({ ...base, dmgExists: true }).error, /Re-run with --force to replace it/);
  assert.ok(planDmg({ ...base, dmgExists: true, force: true }).steps);
});

test("the image is named for the bundle and the pinned version", () => {
  const plan = planDmg(base);
  assert.equal(plan.volumeName, "Grok Bot 0.18 Reconstructed");
  assert.equal(plan.dmgPath, "/repo/dist/Grok Bot 0.18 Reconstructed-0.18.0.dmg");
});

test("the volume is laid out for drag-to-install", () => {
  const plan = planDmg(base);
  const staged = plan.steps.find((step) => step.action === "stage-app");
  const link = plan.steps.find((step) => step.action === "link-applications");
  // hdiutil images the staging directory verbatim, so the app and the
  // Applications symlink must be siblings inside it.
  assert.equal(staged.target, `${plan.stagingDir}/Grok Bot 0.18 Reconstructed.app`);
  assert.equal(link.target, `${plan.stagingDir}/Applications`);
});

test("the bundle verifies before it is imaged, and staging is cleaned up after", () => {
  const order = actions(planDmg(base));
  assert.deepEqual(order, [
    "verify",
    "reset-staging",
    "stage-app",
    "link-applications",
    "create-image",
    "checksum",
    "cleanup",
  ]);
  assert.ok(order.indexOf("verify") < order.indexOf("create-image"), "a broken build must never be imaged");
  assert.ok(order.indexOf("checksum") < order.indexOf("cleanup"), "the image is hashed before scratch is removed");
});

test("staging is scratch space inside the build directory, not an output", () => {
  const plan = planDmg(base);
  assert.ok(plan.stagingDir.startsWith(`${base.buildDir}/`));
  assert.ok(plan.dmgPath.startsWith(`${base.distDir}/`));
});
