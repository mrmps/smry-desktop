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

The macOS disk image is signed with Developer ID, notarized by Apple, and
includes a stapled notarization ticket. The Windows installer is not yet
code-signed, so Windows may ask for confirmation before opening it.

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
and replace the stable `desktop-latest` release assets. Publishing waits for the
companion production web shell to expose the marker-based desktop layout
contract, so a selector-free wrapper cannot ship before its live CSS.
The macOS job imports its Developer ID certificate into an ephemeral keychain,
enables Tauri's hardened-runtime signature, submits the signed disk image to
Apple, staples the accepted ticket, and verifies the disk image and embedded
app with `codesign`, `stapler`, and Gatekeeper before publishing.

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
