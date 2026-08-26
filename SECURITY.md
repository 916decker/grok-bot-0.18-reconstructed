# Security notes

This is a small-club reconstruction, not a supported production distribution.
Do not reuse real credentials or sensitive accounts while experimenting with it.

Reconstructed packages default the official updater, Sentry, and upstream
telemetry off at the Electron-main packaging boundary. The bootstrap download
and hydrated `app.asar` are checksum-pinned.

That default applies to packaged builds: the guard is injected into the emitted
Electron main bundle, so it is not present when running the sources directly.
Set `SAND_DISABLE_UPDATES=1`, `SAND_DISABLE_SENTRY=1`, and
`SAND_DISABLE_TELEMETRY=1` in the environment when running from source. The
Sentry adapter is additionally left uninstalled in this tree, so capture calls
are no-ops regardless of configuration.

`npm audit` still reports compatibility-bound advisories in the pinned Electron
42.1 runtime, Undici 5 / Connect 1 stack, AI SDK 4, and OpenTelemetry stack.
Patch-level fixes are applied where they do not change reconstructed runtime
contracts. The remaining major upgrades are intentionally tracked as follow-up
work rather than silently changing application behavior during publication
cleanup.

Please report issues privately to the repository owner rather than opening a
public disclosure against this experimental codebase.

## Removing the screenshot from published history

`docs/assets/router-settings.png` contained personal account data and has been
removed from the working tree. It is still reachable in commit `a9f633e`, so the
history itself needs rewriting:

```sh
# From a fresh mirror clone, so a mistake cannot damage the working checkout.
git clone --mirror <repository-url> rewrite.git
cd rewrite.git
git filter-repo --invert-paths --path docs/assets/router-settings.png
git push --force --all
git push --force --tags
```

`git filter-repo` replaces every affected commit, so anyone with a clone must
re-clone afterwards.

Two limits are worth knowing before relying on this. A rewrite does not retract
copies already fetched or indexed while the repository was public. And commits
in a fork network stay reachable by SHA through the parent repository even after
a fork is deleted or made private, so a rewrite on one fork does not necessarily
remove them. Ask GitHub Support to purge the objects if the exposure matters.
