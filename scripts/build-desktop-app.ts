#!/usr/bin/env bun

import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PAKE_CLI_VERSION = "3.15.1";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceConfigPath = resolve(rootDir, "desktop/pake.json");
const bunPackageManagerShimDir = resolve(rootDir, "scripts/pake-bin");

export type DesktopPlatform = "auto" | "macos" | "windows" | "linux";
type ResolvedDesktopPlatform = Exclude<DesktopPlatform, "auto">;

type PakeOutput = {
  path: string;
  sizeBytes: number;
  format: string;
};

type PakeResult = {
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
  dmg: "SMRY-macOS-universal.dmg",
  app: "SMRY-macOS-Apple-Silicon.app",
  msi: "SMRY-Windows-x64.msi",
  deb: "SMRY-Linux-x64.deb",
  appimage: "SMRY-Linux-x64.AppImage",
} as const;

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

export function getPakeCommand(options: DesktopBuildOptions = {}, configPath = sourceConfigPath) {
  const platform = resolvePlatform(options.platform);
  return [
    "bunx",
    `pake-cli@${PAKE_CLI_VERSION}`,
    "--config",
    configPath,
    "--app-version",
    normalizeVersion(options.version),
    "--targets",
    options.targets ?? defaultTargets[platform],
    "--json",
  ];
}

function requestedFormats(platform: ResolvedDesktopPlatform, targets: string): string[] {
  if (platform === "macos") {
    return targets === "app" ? ["app"] : ["dmg"];
  }
  if (platform === "windows") return ["msi"];
  return targets.split(",").map((target) => target.trim().toLowerCase());
}

function normalizeFormat(format: string) {
  return format.toLowerCase().replace(/^\./, "");
}

async function writeResolvedConfig(destination: string) {
  const source = JSON.parse(await readFile(sourceConfigPath, "utf8")) as Record<string, unknown>;
  source.icon = resolve(rootDir, String(source.icon));
  await writeFile(destination, `${JSON.stringify(source, null, 2)}\n`);
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
    const artifactName = desktopArtifactNames[format as keyof typeof desktopArtifactNames];
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

  const command = getPakeCommand({ ...options, platform, targets }, resolvedConfigPath);
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
    result = JSON.parse(stdout) as PakeResult;
  } catch {
    throw new Error(`Pake returned invalid JSON: ${stdout.slice(0, 500)}`);
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
    CI: "true",
    TAURI_BUNDLER_DMG_IGNORE_CI: process.env.TAURI_BUNDLER_DMG_IGNORE_CI ?? "true",
  };
}

function parseArgs(argv: string[]): DesktopBuildOptions {
  const options: DesktopBuildOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };

    if (arg === "--platform") options.platform = next() as DesktopPlatform;
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
  runDesktopBuild(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
