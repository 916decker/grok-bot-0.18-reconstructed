// Decide how to build a distributable disk image, without building it.
//
// The build runs macOS-only tools, so the decisions live here as a pure
// function and package-dmg.mjs executes what this returns. That keeps the
// refusal paths and the step ordering testable on any platform.
//
// Signing has two modes. With no Developer ID the build stays ad-hoc signed and
// Gatekeeper asks for a confirmation on first launch. Given a Developer ID
// identity, the app and image are signed with the hardened runtime, submitted
// to Apple for notarization, and stapled, which is what makes the first launch
// silent. Credentials are supplied by the caller; nothing is embedded here.

import path from "node:path";

/**
 * Notarization needs an identity to sign with and a way to authenticate to
 * Apple. A stored notarytool keychain profile covers both; otherwise an Apple
 * ID, team, and app-specific password are required together.
 */
export function resolveSigning({
  identity,
  keychainProfile,
  appleId,
  teamId,
  appPassword,
} = {}) {
  if (!identity) return { mode: "adhoc" };
  if (keychainProfile) return { mode: "developer-id", identity, notarize: { keychainProfile } };
  if (appleId && teamId && appPassword) {
    return { mode: "developer-id", identity, notarize: { appleId, teamId, appPassword } };
  }
  // Signing without notarizing still improves on ad-hoc, but Gatekeeper will
  // continue to prompt, so the caller is told why.
  return {
    mode: "developer-id",
    identity,
    notarize: null,
    warning:
      "Signing with a Developer ID but not notarizing: set APPLE_NOTARY_KEYCHAIN_PROFILE, or APPLE_ID with APPLE_TEAM_ID and APPLE_APP_PASSWORD, for a silent first launch.",
  };
}

/**
 * @returns {{error: string} | {dmgPath: string, volumeName: string, stagingDir: string, signing: object, steps: Array<{action: string, target?: string}>}}
 */
export function planDmg({
  platform,
  outputApp,
  version,
  appExists,
  dmgExists = false,
  force = false,
  buildDir,
  distDir,
  signing = { mode: "adhoc" },
}) {
  if (platform !== "darwin") {
    return { error: "A disk image can only be built on macOS." };
  }
  if (!appExists) {
    return { error: `No packaged application at ${outputApp}. Run npm run package first.` };
  }

  const appName = path.basename(outputApp);
  const volumeName = appName.replace(/\.app$/, "");
  const dmgPath = path.join(distDir, `${volumeName}-${version}.dmg`);

  if (dmgExists && !force) {
    return { error: `${dmgPath} already exists. Re-run with --force to replace it.` };
  }

  // hdiutil images the staging directory verbatim, so the layout of that
  // directory is the layout of the mounted volume: the app beside an
  // Applications symlink, which is what makes drag-to-install work.
  const stagingDir = path.join(buildDir, "dmg", volumeName);
  const stagedApp = path.join(stagingDir, appName);
  const signed = signing.mode === "developer-id";

  const steps = [
    // Only image a bundle that verifies, so a broken build is never handed out.
    { action: "verify", target: outputApp },
    { action: "reset-staging", target: stagingDir },
    { action: "stage-app", target: stagedApp },
  ];

  // The staged copy is signed, never the build output, so re-running does not
  // mutate what `npm run package` produced.
  if (signed) steps.push({ action: "sign-app", target: stagedApp });

  steps.push(
    { action: "link-applications", target: path.join(stagingDir, "Applications") },
    { action: "create-image", target: dmgPath },
  );

  if (signed) {
    steps.push({ action: "sign-image", target: dmgPath });
    if (signing.notarize) {
      // Staple after notarizing so the ticket travels with the image and the
      // receiving machine does not need to reach Apple.
      steps.push({ action: "notarize", target: dmgPath }, { action: "staple", target: dmgPath });
    }
  }

  steps.push(
    { action: "checksum", target: dmgPath },
    // The staging copy is large; it is scratch space, not an output.
    { action: "cleanup", target: stagingDir },
  );

  return { dmgPath, volumeName, stagingDir, signing, steps };
}
