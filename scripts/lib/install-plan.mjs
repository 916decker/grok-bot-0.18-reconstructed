// Decide what installing a packaged build should do, without doing it.
//
// The install itself runs macOS-only tools, so keeping the decisions in a pure
// function lets every refusal path and the exact command ordering be tested on
// any platform. install-app.mjs executes the plan this returns and adds nothing
// to it.

import path from "node:path";

export const UPSTREAM_APP_NAME = "Grok Bot.app";

/**
 * @returns {{error: string} | {target: string, steps: Array<{action: string, target?: string}>}}
 */
export function planInstall({
  platform,
  outputApp,
  sourceExists,
  targetExists,
  force = false,
  applicationsDir = "/Applications",
}) {
  if (platform !== "darwin") {
    return { error: "The reconstructed application can only be installed on macOS." };
  }

  const appName = path.basename(outputApp);

  // The upstream application is a separate install with its own bundle
  // identity. Refuse to write over it whatever the configured output name is.
  if (appName === UPSTREAM_APP_NAME) {
    return {
      error: `Refusing to install over the upstream ${UPSTREAM_APP_NAME}. The reconstruction uses a distinct bundle name.`,
    };
  }

  if (!sourceExists) {
    return { error: `No packaged application at ${outputApp}. Run npm run package first.` };
  }

  const target = path.join(applicationsDir, appName);

  if (targetExists && !force) {
    return { error: `${target} already exists. Re-run with --force to replace it.` };
  }

  const steps = [
    // Verify before promoting, so a broken bundle never shadows a working install.
    { action: "verify", target: outputApp },
  ];
  if (targetExists) steps.push({ action: "remove", target });
  steps.push(
    { action: "copy", target },
    { action: "clear-quarantine", target },
    // Verify again in place: the copy and attribute strip must not have broken it.
    { action: "verify", target },
  );

  return { target, steps };
}
