import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const config = JSON.parse(
  readFileSync(join(root, "desktop/pake.json"), "utf8"),
) as Record<string, unknown>;
const bootstrap = readFileSync(join(root, "desktop/smry-desktop.js"), "utf8");
const buildWrapper = readFileSync(join(root, "scripts/build-desktop-app.ts"), "utf8");
const releaseWorkflow = readFileSync(
  join(root, ".github/workflows/release-desktop-app.yml"),
  "utf8",
);

describe("SMRY desktop shell", () => {
  test("uses native window chrome without Pake's broad immersive CSS", () => {
    expect(config.hideTitleBar).toBe(false);
    expect(config.minWidth).toBe(920);
    expect(config.minHeight).toBe(640);
    expect(buildWrapper).toContain("TitleBarStyle::Overlay");
    expect(buildWrapper).toContain('macos-proxy = ["tauri/macos-proxy"]');
    expect(bootstrap).toContain('navigator.platform.startsWith("Mac")');
    expect(bootstrap).toContain("data-smry-desktop-macos");
    expect(bootstrap).toContain("--smry-desktop-titlebar-height: 32px");
    expect(bootstrap).toContain("background: var(--sidebar)");
    expect(bootstrap).toContain("[data-app-frame]");
    expect(bootstrap).toContain("[data-app-sidebar]");
  });

  test("starts at the designed scale and prevents persisted Pake zoom", () => {
    expect(config.zoom).toBe(100);
    expect(config.disabledWebShortcuts).toBe(true);
    expect(config.inject).toEqual(["desktop/smry-desktop.js"]);
    expect(bootstrap).toContain('localStorage.setItem(SMRY_DESKTOP_ZOOM_KEY, SMRY_DESKTOP_ZOOM)');
    expect(bootstrap).toContain('invoke("set_zoom", { percent: 100 })');
    expect(bootstrap).toContain("window.zoomOut = resetSmryDesktopZoom");
  });

  test("resolves injected source files before running Pake from the output directory", () => {
    expect(buildWrapper).toContain("source.inject.map((path) => resolve(rootDir, String(path)))");
    expect(buildWrapper).toContain("CARGO_TARGET_DIR");
    expect(releaseWorkflow).toContain("dist/desktop-pake-target");
  });

  test("moves the stable release tag to the exact published desktop build", () => {
    expect(releaseWorkflow).toContain("git/refs/tags/${RELEASE_TAG}");
    expect(releaseWorkflow).toContain('--target "$GITHUB_SHA"');
  });
});
