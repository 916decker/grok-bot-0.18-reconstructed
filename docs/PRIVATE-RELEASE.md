# Private releases

`npm run package:dmg` turns an already-packaged build into a double-clickable
disk image. Attaching that image to a release on the private repository gives
your own machines the same install experience as any other Mac application:
download, double-click, drag across. No build toolchain is needed on the
receiving machine.

This is for machines you control. The image carries the reconstruction's own
bundle identity and ad-hoc signature, and it is not a redistribution of the
upstream application. Keep the repository and its releases private; see
`NOTICE.md` for why that matters.

## Building the image

```sh
npm run package          # produces dist/Grok Bot 0.18 Reconstructed.app
npm run package:dmg      # produces the .dmg and a .dmg.sha256 beside it
```

Add `-- --dry-run` to print the steps without changing anything, or
`-- --force` to replace an image that already exists.

The build verifies the application's signature before imaging it, so a bundle
that fails verification is never handed out. The recorded SHA-256 is what the
receiving machine should check.

## Letting CI build it

`.github/workflows/release.yml` does all of the above on an Apple Silicon
runner. Pushing a tag builds the application, runs the checks, verifies the
packaged bundle, builds the image, and attaches it to a pre-release:

```sh
git tag -a v0.18.0-reconstructed.1 -m "Reconstructed 0.18.0"
git push origin v0.18.0-reconstructed.1
```

`workflow_dispatch` runs the same build against an existing tag without
creating a release; the image is still uploaded as a workflow artifact.

This is also the only place the macOS-only build path runs automatically, so a
tag push is what proves packaging, imaging, and signing still work. macOS
runners bill at a higher rate than Linux ones, which is why this is tag
triggered rather than running on every push.

## Attaching it to a private release

Releases on a private repository are visible only to people who can see the
repository.

1. Tag the commit the build came from, so the image is traceable to a source
   state: `git tag -a v0.18.0-reconstructed.1 -m "Reconstructed 0.18.0" && git push origin v0.18.0-reconstructed.1`
2. Create a release from that tag in the GitHub UI, or with the CLI:
   `gh release create v0.18.0-reconstructed.1 --repo <owner>/<repo> --prerelease --notes "Reconstructed build" "dist/Grok Bot 0.18 Reconstructed-0.18.0.dmg" "dist/Grok Bot 0.18 Reconstructed-0.18.0.dmg.sha256"`
3. Mark it a pre-release. It is an unsigned reconstruction, not a supported
   distribution.

Release assets on a private repository require authentication to download, so
fetching one on another machine means signing in to GitHub there, or using a
token.

## Signing and notarization

By default the image is ad-hoc signed. That is enough to install and run, but
Gatekeeper asks for a confirmation the first time on each machine.

Supplying an Apple Developer ID removes that prompt. The build signs the app
with the hardened runtime, signs the image, submits it to Apple, and staples the
returned ticket so the receiving machine does not need to reach Apple itself:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_NOTARY_KEYCHAIN_PROFILE=grok-bot   # or the Apple ID variables below
npm run package:dmg -- --force
```

Store the notarytool profile once, so no password sits in your shell history:

```sh
xcrun notarytool store-credentials grok-bot   --apple-id you@example.com --team-id TEAMID --password <app-specific-password>
```

`APPLE_ID`, `APPLE_TEAM_ID` and `APPLE_APP_PASSWORD` work as an alternative and
must all three be set. Setting an identity with no notarization credentials
signs but does not notarize, and the build says so rather than failing.

Only the staged copy inside the image is signed; `dist/…app` is left as the
packager produced it.

This requires a paid Apple Developer Program membership. Without one, ad-hoc
signing and the one-time right-click step below are the alternative.

### In CI

The release workflow picks these up from repository secrets, all optional:

| Secret | Purpose |
| --- | --- |
| `APPLE_CERTIFICATE` | Developer ID certificate as a base64-encoded `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password for that `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` | Notarization credentials |

With none of them set the workflow still succeeds and produces an ad-hoc signed
image. The certificate is imported into a keychain created for that job alone.

## Installing on another Mac

```sh
shasum -a 256 -c "Grok Bot 0.18 Reconstructed-0.18.0.dmg.sha256"
```

Then double-click the image and drag the application to Applications.

A notarized image opens with no prompt at all. If the build was ad-hoc signed,
Gatekeeper will refuse the first launch. Open it once from the right-click menu ("Open", then confirm),
or clear the quarantine attribute:

```sh
xattr -cr "/Applications/Grok Bot 0.18 Reconstructed.app"
```

Later releases install over the previous one; the upstream `Grok Bot.app` keeps
its own identity and is never replaced.
