// Decide how to build a distributable disk image, without building it.
//
// The build runs macOS-only tools, so the decisions live here as a pure
// function and package-dmg.mjs executes what this returns. That keeps the
// refusal paths and the step ordering testable on any platform.

import path from "node:path";

/**
 * @returns {{error: string} | {dmgPath: string, volumeName: string, stagingDir: string, steps: Array<{action: string, target?: string}>}}
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

  return {
    dmgPath,
    volumeName,
    stagingDir,
    steps: [
      // Only image a bundle that verifies, so a broken build is never handed out.
      { action: "verify", target: outputApp },
      { action: "reset-staging", target: stagingDir },
      { action: "stage-app", target: path.join(stagingDir, appName) },
      { action: "link-applications", target: path.join(stagingDir, "Applications") },
      { action: "create-image", target: dmgPath },
      { action: "checksum", target: dmgPath },
      // The staging copy is large; it is scratch space, not an output.
      { action: "cleanup", target: stagingDir },
    ],
  };
}
