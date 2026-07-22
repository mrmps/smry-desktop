# SMRY Desktop

The official lightweight desktop app for [smry.ai](https://smry.ai), packaged
with [Pake](https://github.com/tw93/Pake) and the operating system webview.

## Download

Download the current early-access installers from the stable
[SMRY Desktop release](https://github.com/mrmps/smry-desktop/releases/tag/desktop-latest):

- macOS universal DMG
- Windows x64 MSI
- Linux x64 AppImage
- Debian / Ubuntu x64 DEB

These packages are not yet signed by a verified publisher or notarized, so the
operating system may ask for confirmation before opening them.

## Build

The declarative Pake configuration lives at `desktop/pake.json`, and
`desktop/release-manifest.json` is the canonical machine-readable contract for
the stable public tag and distributed filenames. Builds use Pake CLI 3.15.1 in
structured JSON mode, validate its result, and fail if a requested output
format is missing.

```bash
bun run desktop:build -- --platform macos --targets app --version 0.1.0
```

Pushes that change the packaging source build all supported operating systems
and replace the stable `desktop-latest` release assets.

SMRY Desktop loads the live SMRY web app. Web features update with the site;
native wrapper changes require downloading a newer installer.

The shell uses the operating system title bar instead of Pake's immersive
header because Pake's generic header CSS can collide with Tailwind utility
classes in the live app. A narrow bootstrap marks the webview as SMRY Desktop
and resets Pake's persisted `htmlZoom` value to 100% on every page load so an
accidental zoom cannot leave future launches compressed or clipped.

On macOS, the wrapper keeps the native traffic-light controls above a reserved
32px title-bar canvas painted with SMRY's live `--sidebar` design token. The
live web stylesheet subtracts the same height from the app frame, so installed
apps follow theme and layout changes without freezing web selectors into a
released native binary.
