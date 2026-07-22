import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  desktopArtifactNames,
  getPakeCommand,
  parseDesktopBuildArgs,
  parsePakeResult,
  patchPakeCargoManifest,
  patchPakeWindowSource,
} from "../scripts/build-desktop-app";
import {
  desktopReleaseManifest,
  parseDesktopReleaseManifest,
} from "../scripts/desktop-release-manifest";

const root = join(import.meta.dir, "..");
const config = JSON.parse(
  readFileSync(join(root, "desktop/pake.json"), "utf8"),
) as Record<string, unknown>;
const bootstrap = readFileSync(join(root, "desktop/smry-desktop.js"), "utf8");
const releaseWorkflow = readFileSync(
  join(root, ".github/workflows/release-desktop-app.yml"),
  "utf8",
);

type BootstrapWindow = {
  __TAURI__: {
    core: {
      invoke: (command: string, payload: unknown) => Promise<void>;
    };
  };
  localStorage: {
    setItem: (key: string, value: string) => void;
  };
  setZoom?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
};

function executeBootstrap(platform: string, userAgent: string) {
  const dataset: Record<string, string> = {};
  const storedValues = new Map<string, string>();
  const nativeInvocations: Array<{ command: string; payload: unknown }> = [];
  const windowObject: BootstrapWindow = {
    localStorage: {
      setItem: (key, value) => storedValues.set(key, value),
    },
    __TAURI__: {
      core: {
        invoke: (command, payload) => {
          nativeInvocations.push({ command, payload });
          return Promise.resolve();
        },
      },
    },
  };

  runInNewContext(bootstrap, {
    document: { documentElement: { dataset } },
    navigator: { platform, userAgent },
    window: windowObject,
  });

  return { dataset, nativeInvocations, storedValues, windowObject };
}

describe("SMRY desktop shell", () => {
  test("marks the native host and resets persisted browser and native zoom", () => {
    const execution = executeBootstrap("MacIntel", "Macintosh");

    expect(execution.dataset).toEqual({
      smryDesktop: "true",
      smryDesktopMacos: "true",
    });
    expect(execution.storedValues.get("htmlZoom")).toBe("100%");
    expect(execution.nativeInvocations).toEqual([
      { command: "set_zoom", payload: { percent: 100 } },
    ]);

    execution.windowObject.zoomOut?.();
    expect(execution.nativeInvocations).toHaveLength(2);
  });

  test("leaves selector-specific layout in the live web app", () => {
    const execution = executeBootstrap("Win32", "Windows NT 10.0");

    expect(execution.dataset).toEqual({ smryDesktop: "true" });
    expect(bootstrap).not.toContain("data-app-frame");
    expect(bootstrap).not.toContain("createElement");
  });

  test("uses native overlay chrome without Pake's immersive CSS", () => {
    expect(config.hideTitleBar).toBe(false);
    expect(config.minWidth).toBe(920);
    expect(config.minHeight).toBe(640);

    const windowSource = readFileSync(
      join(root, "node_modules/pake-cli/src-tauri/src/app/window.rs"),
      "utf8",
    );
    const cargoManifest = readFileSync(
      join(root, "node_modules/pake-cli/src-tauri/Cargo.toml"),
      "utf8",
    );
    expect(patchPakeWindowSource(windowSource)).toContain(
      "title_bar_style(TitleBarStyle::Overlay)",
    );
    expect(patchPakeCargoManifest(cargoManifest)).toContain(
      'macos-proxy = ["tauri/macos-proxy"]',
    );
  });

  test("owns distributed artifact names in one validated release manifest", () => {
    expect(desktopReleaseManifest.releaseTag).toBe("desktop-latest");
    expect(desktopReleaseManifest.artifacts).toEqual({
      dmg: "SMRY-macOS-universal.dmg",
      msi: "SMRY-Windows-x64.msi",
      appimage: "SMRY-Linux-x64.AppImage",
      deb: "SMRY-Linux-x64.deb",
    });
    expect(desktopArtifactNames.dmg).toBe(desktopReleaseManifest.artifacts.dmg);
    expect(() =>
      parseDesktopReleaseManifest({
        ...desktopReleaseManifest,
        artifacts: { ...desktopReleaseManifest.artifacts, msi: "../unsafe.msi" },
      }),
    ).toThrow("must be a plain filename");
  });

  test("rejects unsupported CLI platforms before constructing a Pake command", () => {
    expect(() => parseDesktopBuildArgs(["--platform", "solaris", "--dry-run"])).toThrow(
      "Unsupported desktop platform: solaris",
    );
    expect(getPakeCommand({ platform: "linux" })).toContain("deb,appimage");
    expect(() => getPakeCommand({ platform: "macos", targets: "arm64" })).toThrow(
      "Unsupported macOS desktop target: arm64",
    );
    expect(() => getPakeCommand({ platform: "windows", targets: "arm64" })).toThrow(
      "Unsupported Windows desktop target: arm64",
    );
  });

  test("validates Pake's external JSON result boundary", () => {
    expect(
      parsePakeResult({
        ok: true,
        name: "SMRY",
        platform: "macos",
        arch: "universal",
        outputs: [],
        warnings: [],
        error: null,
      }),
    ).toEqual({
      ok: true,
      name: "SMRY",
      platform: "macos",
      arch: "universal",
      outputs: [],
      warnings: [],
      error: null,
    });
    expect(() =>
      parsePakeResult({
        ok: true,
        name: "SMRY",
        platform: "macos",
        arch: "universal",
        outputs: "not-an-array",
        warnings: [],
        error: null,
      }),
    ).toThrow("Pake result.outputs must be an array");
  });

  test("publishes the manifest and moves the stable tag to the exact build", () => {
    expect(releaseWorkflow).toContain("desktop/release-manifest.json");
    expect(releaseWorkflow).toContain("desktop-release-manifest.json");
    expect(releaseWorkflow).toContain("git/refs/tags/${RELEASE_TAG}");
    expect(releaseWorkflow).toContain('--target "$GITHUB_SHA"');
  });
});
