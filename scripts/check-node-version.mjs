// Fail an install on the wrong Node before dependencies are fetched.
//
// The toolchain pins a single Node major. Without this guard the mismatch first
// surfaces much later as an unrelated compiler or native-build error, which is a
// poor first impression for a fresh clone. npm's own engine-strict is not used
// here because it would also enforce every dependency's declared range.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const required = manifest.engines?.node ?? ">=26.5.0 <27";

// The pinned range is a single major, so comparing the major is sufficient and
// avoids depending on a semver library before node_modules exists.
const expectedMajor = Number(required.match(/(\d+)/)?.[1]);
const actualMajor = Number(process.versions.node.split(".")[0]);

if (Number.isFinite(expectedMajor) && actualMajor !== expectedMajor) {
  const lines = [
    "",
    `  This toolchain requires Node ${required}, but Node ${process.versions.node} is active.`,
    "",
    `  Install the pinned version (see .node-version) before installing dependencies:`,
    `    nvm install ${expectedMajor} && nvm use`,
    "",
  ];
  console.error(lines.join("\n"));
  process.exit(1);
}
