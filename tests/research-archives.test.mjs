import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const archiveRoot = path.join(repositoryRoot, "research-archives", "original", "0.18.0");

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

// A checkout without `git lfs pull` leaves a small text pointer in place of the
// installer. The pointer still carries the object's oid and size, so the
// manifest can be checked against it without the multi-hundred-megabyte payload.
function parseLfsPointer(contents) {
  const oid = contents.match(/^oid sha256:([0-9a-f]{64})$/m);
  const size = contents.match(/^size (\d+)$/m);
  if (!contents.startsWith("version https://git-lfs.github.com/spec/v1") || oid == null || size == null) {
    return null;
  }
  return { oid: oid[1], size: Number(size[1]) };
}

test("preserved 0.18.0 installers match the exact public release inventory", async () => {
  const manifest = JSON.parse(await readFile(path.join(archiveRoot, "artifacts.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest).sort(), ["artifacts", "product", "schemaVersion", "version"]);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.product, "Grok Bot");
  assert.equal(manifest.version, "0.18.0");
  assert.equal(manifest.artifacts.length, 2);

  for (const artifact of manifest.artifacts) {
    assert.deepEqual(
      Object.keys(artifact).sort(),
      ["architecture", "bytes", "path", "platform", "sha256", "sourceUrl"],
    );
    assert.match(artifact.path, /^(macos-arm64\/[^/]+\.dmg|windows-x64\/[^/]+\.exe)$/);
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
    assert.match(artifact.sourceUrl, /^https:\/\/downloads\.cursor\.com\/grokbot\/stable\//);
    const file = path.join(archiveRoot, artifact.path);
    assert.ok(file.startsWith(`${archiveRoot}${path.sep}`));
    const metadata = await lstat(file);
    assert.equal(metadata.isFile(), true);
    assert.equal(metadata.isSymbolicLink(), false);

    // Verify the resolved object when LFS content is present, and fall back to
    // the pointer's own recorded identity when it is not. Both paths assert the
    // manifest agrees with Git's view of the artifact, so a clone that has not
    // run `git lfs pull` still validates the inventory instead of failing.
    const pointer = metadata.size < 1024 ? parseLfsPointer(await readFile(file, "utf8")) : null;
    if (pointer == null) {
      assert.equal(metadata.size, artifact.bytes, `${artifact.path} requires git lfs pull`);
      assert.equal(await sha256(file), artifact.sha256);
    } else {
      assert.equal(pointer.size, artifact.bytes, `${artifact.path} pointer size disagrees with the manifest`);
      assert.equal(pointer.oid, artifact.sha256, `${artifact.path} pointer oid disagrees with the manifest`);
    }
  }
});

test("bootstrap prefers the hash-pinned local archive before the network", async () => {
  const [attributes, config, bootstrap] = await Promise.all([
    readFile(path.join(repositoryRoot, ".gitattributes"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts", "lib", "config.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts", "bootstrap-runtime.mjs"), "utf8"),
  ]);
  assert.match(attributes, /research-archives\/original\/\*\*\/\*\.dmg filter=lfs diff=lfs merge=lfs -text/);
  assert.match(attributes, /research-archives\/original\/\*\*\/\*\.exe filter=lfs diff=lfs merge=lfs -text/);
  assert.match(config, /export const archivedDmg = path\.join\(repoRoot, "research-archives", "original", "0\.18\.0", "macos-arm64", "Grok_Bot_0\.18\.0\.dmg"\)/);
  assert.match(bootstrap, /const archivedDigest = await sha256\(archivedDmg\)/);
  assert.match(bootstrap, /if \(archivedDigest !== dmgSha256\)/);
  assert.match(bootstrap, /await copyFile\(archivedDmg, cachedDmg\)/);
  assert.ok(bootstrap.indexOf("await copyFile(archivedDmg, cachedDmg)") < bootstrap.indexOf("await fetch(dmgUrl"));
});
