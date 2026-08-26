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

## Installing on another Mac

```sh
shasum -a 256 -c "Grok Bot 0.18 Reconstructed-0.18.0.dmg.sha256"
```

Then double-click the image and drag the application to Applications.

Because the build is ad-hoc signed rather than notarized, Gatekeeper will refuse
the first launch. Open it once from the right-click menu ("Open", then confirm),
or clear the quarantine attribute:

```sh
xattr -cr "/Applications/Grok Bot 0.18 Reconstructed.app"
```

Later releases install over the previous one; the upstream `Grok Bot.app` keeps
its own identity and is never replaced.
