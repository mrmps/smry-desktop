#!/usr/bin/env bun

import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  desktopReleaseManifest,
  isRecord,
} from "./desktop-release-manifest";

export const PAKE_CLI_VERSION = "3.15.1";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceConfigPath = resolve(rootDir, "desktop/pake.json");
const bunPackageManagerShimDir = resolve(rootDir, "scripts/pake-bin");
const pakePackageRoot = resolve(rootDir, "node_modules/pake-cli");
const patchedPakeDirectoryName = "pake-cli-source";
const cargoTargetDir = resolve(rootDir, "dist/desktop-pake-target");

export type DesktopPlatform = "auto" | "macos" | "windows" | "linux";
type ResolvedDesktopPlatform = Exclude<DesktopPlatform, "auto">;

export type PakeOutput = {
  path: string;
  sizeBytes: number;
  format: string;
};

export type PakeResult = {
  ok: boolean;
  name: string;
  platform: string;
  arch: string;
  outputs: PakeOutput[];
  warnings: string[];
  error: { code: string; message: string; hint?: string } | null;
};

export type DesktopBuildOptions = {
  artifactsDir?: string;
  dryRun?: boolean;
  outputDir?: string;
  platform?: DesktopPlatform;
  targets?: string;
  version?: string;
};

export const desktopArtifactNames = {
  ...desktopReleaseManifest.artifacts,
  app: "SMRY-macOS-Apple-Silicon.app",
} as const;

type DesktopArtifactFormat = keyof typeof desktopArtifactNames;

const defaultTargets: Record<ResolvedDesktopPlatform, string> = {
  macos: "universal",
  windows: "x64",
  linux: "deb,appimage",
};

function normalizeVersion(version = process.env.DESKTOP_APP_VERSION ?? "0.1.0") {
  const normalized = version.trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`Desktop app version must be semver-like. Got: ${version}`);
  }
  return normalized;
}

export function getCurrentDesktopPlatform(): ResolvedDesktopPlatform {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

function resolvePlatform(platform: DesktopPlatform = "auto"): ResolvedDesktopPlatform {
  return platform === "auto" ? getCurrentDesktopPlatform() : platform;
}

function parseDesktopPlatform(value: string): DesktopPlatform {
  switch (value) {
    case "auto":
    case "macos":
    case "windows":
    case "linux":
      return value;
    default:
      throw new Error(
        `Unsupported desktop platform: ${value}. Expected auto, macos, windows, or linux.`,
      );
  }
}

export function getPakeCommand(
  options: DesktopBuildOptions = {},
  configPath = sourceConfigPath,
  pakeCliPath = resolve(pakePackageRoot, "dist/cli.js"),
) {
  const platform = resolvePlatform(options.platform);
  const targets = options.targets ?? defaultTargets[platform];
  validateTargets(platform, targets);
  return [
    "bun",
    pakeCliPath,
    "--config",
    configPath,
    "--app-version",
    normalizeVersion(options.version),
    "--targets",
    targets,
    "--json",
  ];
}

function validateTargets(platform: ResolvedDesktopPlatform, targets: string): void {
  if (platform === "macos") {
    if (targets === "app" || targets === "universal") return;
    throw new Error(
      `Unsupported macOS desktop target: ${targets}. Expected app or universal.`,
    );
  }
  if (platform === "windows") {
    if (targets === "x64") return;
    throw new Error(`Unsupported Windows desktop target: ${targets}. Expected x64.`);
  }

  for (const target of targets.split(",")) {
    const normalizedTarget = target.trim().toLowerCase();
    if (normalizedTarget !== "deb" && normalizedTarget !== "appimage") {
      throw new Error(
        `Unsupported Linux desktop target: ${target}. Expected deb or appimage.`,
      );
    }
  }
}

function requestedFormats(
  platform: ResolvedDesktopPlatform,
  targets: string,
): DesktopArtifactFormat[] {
  validateTargets(platform, targets);
  if (platform === "macos") {
    return targets === "app" ? ["app"] : ["dmg"];
  }
  if (platform === "windows") return ["msi"];
  return targets.split(",").map((target) =>
    target.trim().toLowerCase() === "deb" ? "deb" : "appimage",
  );
}

function normalizeFormat(format: string) {
  return format.toLowerCase().replace(/^\./, "");
}

function readString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`${context}.${key} must be a string`);
  return value;
}

export function parsePakeResult(value: unknown): PakeResult {
  if (!isRecord(value)) throw new Error("Pake result must be an object");
  if (typeof value.ok !== "boolean") throw new Error("Pake result.ok must be a boolean");
  if (!Array.isArray(value.outputs)) throw new Error("Pake result.outputs must be an array");
  if (!Array.isArray(value.warnings) || !value.warnings.every((item) => typeof item === "string")) {
    throw new Error("Pake result.warnings must contain only strings");
  }

  const outputs = value.outputs.map((output, index): PakeOutput => {
    if (!isRecord(output)) throw new Error(`Pake result.outputs[${index}] must be an object`);
    if (typeof output.sizeBytes !== "number" || !Number.isFinite(output.sizeBytes)) {
      throw new Error(`Pake result.outputs[${index}].sizeBytes must be a finite number`);
    }
    return {
      path: readString(output, "path", `Pake result.outputs[${index}]`),
      sizeBytes: output.sizeBytes,
      format: readString(output, "format", `Pake result.outputs[${index}]`),
    };
  });

  let error: PakeResult["error"] = null;
  if (value.error !== null && value.error !== undefined) {
    if (!isRecord(value.error)) throw new Error("Pake result.error must be an object or null");
    const hint = value.error.hint;
    if (hint !== undefined && typeof hint !== "string") {
      throw new Error("Pake result.error.hint must be a string when present");
    }
    error = {
      code: readString(value.error, "code", "Pake result.error"),
      message: readString(value.error, "message", "Pake result.error"),
      ...(hint === undefined ? {} : { hint }),
    };
  }

  return {
    ok: value.ok,
    name: readString(value, "name", "Pake result"),
    platform: readString(value, "platform", "Pake result"),
    arch: readString(value, "arch", "Pake result"),
    outputs,
    warnings: value.warnings,
    error,
  };
}

async function writeResolvedConfig(destination: string) {
  const parsedSource: unknown = JSON.parse(await readFile(sourceConfigPath, "utf8"));
  if (!isRecord(parsedSource)) throw new Error("Pake config must be a JSON object");
  if (typeof parsedSource.icon !== "string") throw new Error("Pake config icon must be a path");
  if (
    !Array.isArray(parsedSource.inject) ||
    !parsedSource.inject.every((path) => typeof path === "string")
  ) {
    throw new Error("Pake config inject must contain only paths");
  }

  const source = {
    ...parsedSource,
    icon: resolve(rootDir, parsedSource.icon),
    inject: parsedSource.inject.map((path) => resolve(rootDir, path)),
  };
  await writeFile(destination, `${JSON.stringify(source, null, 2)}\n`);
}

const originalMacImport = "use tauri::TitleBarStyle;";
const originalTitleBarSetup = `        let title_bar_style = if window_config.hide_title_bar {
            TitleBarStyle::Overlay
        } else {
            TitleBarStyle::Visible
        };
        window_builder = window_builder.title_bar_style(title_bar_style);`;

export function patchPakeWindowSource(originalWindowSource: string): string {
  if (
    !originalWindowSource.includes(originalMacImport) ||
    !originalWindowSource.includes(originalTitleBarSetup)
  ) {
    throw new Error(
      `Pake ${PAKE_CLI_VERSION} title-bar source changed; refusing to apply the SMRY native-shell patch`,
    );
  }

  return originalWindowSource.replace(
    originalTitleBarSetup,
    `        // The webview provides SMRY's own opaque title-bar canvas behind
        // native macOS controls. Pake's hideTitleBar flag stays false so its
        // broad immersive CSS is never injected into the product shell.
        window_builder = window_builder.title_bar_style(TitleBarStyle::Overlay);`,
  );
}

const featuresHeader = "[features]\n";

export function patchPakeCargoManifest(originalCargoManifest: string): string {
  if (!originalCargoManifest.includes(featuresHeader)) {
    throw new Error(
      `Pake ${PAKE_CLI_VERSION} Cargo features changed; refusing to apply the macOS proxy compatibility patch`,
    );
  }
  return originalCargoManifest.includes(
    'macos-proxy = ["tauri/macos-proxy"]',
  )
    ? originalCargoManifest
    : originalCargoManifest.replace(
        featuresHeader,
        `${featuresHeader}macos-proxy = ["tauri/macos-proxy"]\n`,
      );
}

export function configurePakeMacosSigning(
  config: unknown,
  signingIdentity: string | undefined,
) {
  if (!isRecord(config) || !isRecord(config.bundle) || !isRecord(config.bundle.macOS)) {
    throw new Error("Pake macOS config must define bundle.macOS");
  }

  const normalizedIdentity = signingIdentity?.trim();
  if (!normalizedIdentity) return config;
  if (!normalizedIdentity.startsWith("Developer ID Application: ")) {
    throw new Error(
      "APPLE_SIGNING_IDENTITY must be a Developer ID Application identity",
    );
  }

  return {
    ...config,
    bundle: {
      ...config.bundle,
      macOS: {
        ...config.bundle.macOS,
        signingIdentity: normalizedIdentity,
      },
    },
  };
}

async function preparePakeSource(outputDir: string) {
  const destination = resolve(outputDir, patchedPakeDirectoryName);
  await cp(pakePackageRoot, destination, { dereference: true, recursive: true });

  const windowSourcePath = resolve(destination, "src-tauri/src/app/window.rs");
  const originalWindowSource = await readFile(windowSourcePath, "utf8");
  await writeFile(windowSourcePath, patchPakeWindowSource(originalWindowSource));

  const cargoManifestPath = resolve(destination, "src-tauri/Cargo.toml");
  const originalCargoManifest = await readFile(cargoManifestPath, "utf8");
  await writeFile(cargoManifestPath, patchPakeCargoManifest(originalCargoManifest));

  const macosConfigPath = resolve(destination, "src-tauri/tauri.macos.conf.json");
  const macosConfig: unknown = JSON.parse(await readFile(macosConfigPath, "utf8"));
  const configuredMacosConfig = configurePakeMacosSigning(
    macosConfig,
    process.env.APPLE_SIGNING_IDENTITY,
  );
  await writeFile(
    macosConfigPath,
    `${JSON.stringify(configuredMacosConfig, null, 2)}\n`,
  );

  return resolve(destination, "dist/cli.js");
}

async function copyOutput(output: PakeOutput, destination: string) {
  if (normalizeFormat(output.format) === "app") {
    await cp(output.path, destination, { recursive: true });
    return;
  }
  await copyFile(output.path, destination);
}

export async function collectDesktopArtifacts(
  result: PakeResult,
  platform: ResolvedDesktopPlatform,
  targets: string,
  artifactsDir: string,
) {
  const formats = requestedFormats(platform, targets);
  const outputsByFormat = new Map(
    result.outputs.map((output) => [normalizeFormat(output.format), output]),
  );

  await rm(artifactsDir, { force: true, recursive: true });
  await mkdir(artifactsDir, { recursive: true });

  const copied: string[] = [];
  for (const format of formats) {
    const output = outputsByFormat.get(format);
    if (!output) {
      throw new Error(
        `Pake did not produce requested ${format} output. Produced: ${[...outputsByFormat.keys()].join(", ") || "none"}`,
      );
    }
    const artifactName = desktopArtifactNames[format];
    const destination = resolve(artifactsDir, artifactName);
    await copyOutput(output, destination);
    copied.push(destination);
  }
  return copied;
}

async function runDesktopBuild(options: DesktopBuildOptions) {
  const platform = resolvePlatform(options.platform);
  const targets = options.targets ?? defaultTargets[platform];
  const outputDir = resolve(rootDir, options.outputDir ?? "dist/desktop");
  const artifactsDir = resolve(rootDir, options.artifactsDir ?? "dist/desktop-artifacts");
  const resolvedConfigPath = resolve(outputDir, "smry.pake.resolved.json");

  if (options.dryRun) {
    console.log(getPakeCommand({ ...options, platform, targets }, resolvedConfigPath).join(" "));
    return;
  }

  await rm(outputDir, { force: true, recursive: true });
  await mkdir(outputDir, { recursive: true });
  await writeResolvedConfig(resolvedConfigPath);
  const pakeCliPath = await preparePakeSource(outputDir);

  const command = getPakeCommand(
    { ...options, platform, targets },
    resolvedConfigPath,
    pakeCliPath,
  );
  const process = Bun.spawn(command, {
    cwd: outputDir,
    env: processEnv(),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);

  let result: PakeResult;
  try {
    result = parsePakeResult(JSON.parse(stdout));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Pake returned an invalid result (${detail}): ${stdout.slice(0, 500)}`);
  }

  if (exitCode !== 0 || !result.ok) {
    const detail = result.error
      ? `${result.error.code}: ${result.error.message}${result.error.hint ? ` (${result.error.hint})` : ""}`
      : `exit ${exitCode}`;
    throw new Error(`Pake desktop build failed: ${detail}`);
  }

  for (const warning of result.warnings) console.warn(`Pake warning: ${warning}`);
  const artifacts = await collectDesktopArtifacts(result, platform, targets, artifactsDir);
  console.log(JSON.stringify({ ok: true, platform, targets, artifacts }));
}

function processEnv() {
  return {
    ...process.env,
    // Pake 3.15 only probes pnpm/npm for its internal Tauri workspace. This
    // narrow pnpm-compatible command delegates install/run to Bun so the SMRY
    // build remains Bun-only without modifying the third-party package.
    PATH: `${bunPackageManagerShimDir}${delimiter}${process.env.PATH ?? ""}`,
    // Keep compiled Rust dependencies outside the disposable patched Pake
    // source tree so local rebuilds and CI caches remain incremental.
    CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? cargoTargetDir,
    CI: "true",
    TAURI_BUNDLER_DMG_IGNORE_CI: process.env.TAURI_BUNDLER_DMG_IGNORE_CI ?? "true",
  };
}

export function parseDesktopBuildArgs(argv: string[]): DesktopBuildOptions {
  const options: DesktopBuildOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };

    if (arg === "--platform") options.platform = parseDesktopPlatform(next());
    else if (arg === "--version") options.version = next();
    else if (arg === "--targets") options.targets = next();
    else if (arg === "--output") options.outputDir = next();
    else if (arg === "--artifacts") options.artifactsDir = next();
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: bun run desktop:build -- [--platform macos|windows|linux] [--targets app|universal|x64|deb,appimage] [--version 0.1.0] [--dry-run]",
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (import.meta.main) {
  runDesktopBuild(parseDesktopBuildArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
