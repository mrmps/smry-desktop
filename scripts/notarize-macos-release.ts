#!/usr/bin/env bun

import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { desktopReleaseManifest } from "./desktop-release-manifest";

type CommandResult = {
  stdout: string;
  stderr: string;
};

type NotarytoolSubmission = {
  id: string;
  status: "Accepted";
};

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function redactSensitiveValues(value: string, sensitiveValues: string[]): string {
  return sensitiveValues.reduce(
    (redacted, sensitiveValue) =>
      sensitiveValue ? redacted.replaceAll(sensitiveValue, "[REDACTED]") : redacted,
    value,
  );
}

async function runCommand(
  command: string[],
  sensitiveValues: string[] = [],
): Promise<CommandResult> {
  const child = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (exitCode !== 0) {
    const detail = redactSensitiveValues(
      `${stderr}\n${stdout}`.trim(),
      sensitiveValues,
    );
    throw new Error(
      `${basename(command[0] ?? "command")} failed with exit ${exitCode}${
        detail ? `: ${detail}` : ""
      }`,
    );
  }

  return { stdout, stderr };
}

export function parseNotarytoolSubmission(value: unknown): NotarytoolSubmission {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("status" in value) ||
    value.status !== "Accepted"
  ) {
    throw new Error("Apple notarization did not return an Accepted submission");
  }
  return { id: value.id, status: value.status };
}

export function findMacosAppBundle(entries: string[]): string {
  const appBundles = entries.filter((entry) => entry.endsWith(".app"));
  if (appBundles.length !== 1) {
    throw new Error(
      `Expected one app bundle in the disk image, found ${appBundles.length}`,
    );
  }
  return appBundles[0]!;
}

async function verifyDeveloperIdApp(appPath: string): Promise<void> {
  await runCommand([
    "codesign",
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appPath,
  ]);

  const signature = await runCommand([
    "codesign",
    "--display",
    "--verbose=4",
    appPath,
  ]);
  const signatureDetails = `${signature.stdout}\n${signature.stderr}`;
  if (!signatureDetails.includes("Authority=Developer ID Application:")) {
    throw new Error("The app is not signed with a Developer ID Application identity");
  }
  if (!/^flags=.*\bruntime\b/m.test(signatureDetails)) {
    throw new Error("The app signature does not enable the hardened runtime");
  }

  await runCommand([
    "spctl",
    "--assess",
    "--type",
    "exec",
    "--verbose=4",
    appPath,
  ]);
}

async function verifyNotarizedDiskImage(dmgPath: string): Promise<void> {
  await runCommand(["codesign", "--verify", "--strict", "--verbose=2", dmgPath]);
  await runCommand(["xcrun", "stapler", "validate", dmgPath]);
  await runCommand([
    "spctl",
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose=4",
    dmgPath,
  ]);

  const mountDirectory = await mkdtemp(join(tmpdir(), "smry-notarized-dmg-"));
  let isMounted = false;
  try {
    await runCommand([
      "hdiutil",
      "attach",
      dmgPath,
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mountDirectory,
    ]);
    isMounted = true;
    const appBundle = findMacosAppBundle(await readdir(mountDirectory));
    await verifyDeveloperIdApp(join(mountDirectory, appBundle));
  } finally {
    try {
      if (isMounted) {
        await runCommand(["hdiutil", "detach", mountDirectory]);
      }
    } finally {
      await rm(mountDirectory, { force: true, recursive: true });
    }
  }
}

export async function notarizeMacosRelease(dmgPath: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("macOS notarization must run on macOS");
  }

  const resolvedDmgPath = resolve(dmgPath);
  const file = await stat(resolvedDmgPath);
  if (!file.isFile()) throw new Error(`Notarization target is not a file: ${dmgPath}`);

  const signingIdentity = requireEnvironmentVariable("APPLE_SIGNING_IDENTITY");
  if (!signingIdentity.startsWith("Developer ID Application: ")) {
    throw new Error(
      "APPLE_SIGNING_IDENTITY must be a Developer ID Application identity",
    );
  }
  const appleId = requireEnvironmentVariable("APPLE_ID");
  const applePassword = requireEnvironmentVariable("APPLE_PASSWORD");
  const appleTeamId = requireEnvironmentVariable("APPLE_TEAM_ID");
  const sensitiveValues = [appleId, applePassword, appleTeamId];

  await runCommand([
    "codesign",
    "--force",
    "--sign",
    signingIdentity,
    "--timestamp",
    resolvedDmgPath,
  ]);

  const submission = await runCommand(
    [
      "xcrun",
      "notarytool",
      "submit",
      resolvedDmgPath,
      "--apple-id",
      appleId,
      "--password",
      applePassword,
      "--team-id",
      appleTeamId,
      "--wait",
      "--output-format",
      "json",
    ],
    sensitiveValues,
  );
  const acceptedSubmission = parseNotarytoolSubmission(
    JSON.parse(submission.stdout),
  );

  await runCommand(["xcrun", "stapler", "staple", resolvedDmgPath]);
  await verifyNotarizedDiskImage(resolvedDmgPath);
  console.log(
    JSON.stringify({
      ok: true,
      dmg: resolvedDmgPath,
      notarizationId: acceptedSubmission.id,
      status: acceptedSubmission.status,
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dmgPath =
    process.argv[2] ??
    resolve("dist/desktop-artifacts", desktopReleaseManifest.artifacts.dmg);
  notarizeMacosRelease(dmgPath).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
