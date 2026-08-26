import assert from "node:assert/strict";
import test from "node:test";

import { planDmg, resolveSigning } from "../scripts/lib/dmg-plan.mjs";

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

// Signing has two modes: ad-hoc by default, Developer ID plus notarization when
// credentials exist. Nothing here embeds a credential; the caller supplies them.
test("without a Developer ID the build stays ad-hoc", () => {
  const signing = resolveSigning({});
  assert.equal(signing.mode, "adhoc");
  const order = actions(planDmg({ ...base, signing }));
  assert.ok(!order.includes("sign-app"), "ad-hoc builds must not Developer ID sign");
  assert.ok(!order.includes("notarize"));
});

test("a Developer ID without notarization credentials warns instead of failing", () => {
  const signing = resolveSigning({ identity: "Developer ID Application: Example" });
  assert.equal(signing.mode, "developer-id");
  assert.equal(signing.notarize, null);
  assert.match(signing.warning, /silent first launch/);
  const order = actions(planDmg({ ...base, signing }));
  assert.ok(order.includes("sign-app"), "signing still happens");
  assert.ok(!order.includes("notarize"), "notarization needs credentials");
});

test("a keychain profile is sufficient to notarize", () => {
  const signing = resolveSigning({ identity: "Developer ID Application: Example", keychainProfile: "grok" });
  assert.deepEqual(signing.notarize, { keychainProfile: "grok" });
});

test("an Apple ID notarizes only when team and password are all present", () => {
  const partial = resolveSigning({ identity: "Developer ID Application: Example", appleId: "a@b.c" });
  assert.equal(partial.notarize, null);
  const full = resolveSigning({
    identity: "Developer ID Application: Example",
    appleId: "a@b.c",
    teamId: "TEAM",
    appPassword: "secret",
  });
  assert.deepEqual(full.notarize, { appleId: "a@b.c", teamId: "TEAM", appPassword: "secret" });
});

test("a notarized build signs, images, notarizes, then staples", () => {
  const signing = resolveSigning({ identity: "Developer ID Application: Example", keychainProfile: "grok" });
  const order = actions(planDmg({ ...base, signing }));
  assert.deepEqual(order, [
    "verify",
    "reset-staging",
    "stage-app",
    "sign-app",
    "link-applications",
    "create-image",
    "sign-image",
    "notarize",
    "staple",
    "checksum",
    "cleanup",
  ]);
  // The ticket must be stapled after notarization or it will not travel.
  assert.ok(order.indexOf("notarize") < order.indexOf("staple"));
  // The image is signed before it is submitted; Apple rejects unsigned input.
  assert.ok(order.indexOf("sign-image") < order.indexOf("notarize"));
});

test("only the staged copy is signed, never the packaged output", () => {
  const signing = resolveSigning({ identity: "Developer ID Application: Example", keychainProfile: "grok" });
  const plan = planDmg({ ...base, signing });
  const signApp = plan.steps.find((step) => step.action === "sign-app");
  assert.ok(signApp.target.startsWith(plan.stagingDir), "signing must not mutate dist/");
  assert.notEqual(signApp.target, base.outputApp);
});
