import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DesktopReleaseManifest = {
  schemaVersion: 1;
  releaseTag: string;
  artifacts: {
    dmg: string;
    msi: string;
    appimage: string;
    deb: string;
  };
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readArtifactFileName(
  artifacts: Record<string, unknown>,
  format: keyof DesktopReleaseManifest["artifacts"],
): string {
  const fileName = artifacts[format];
  if (
    typeof fileName !== "string" ||
    fileName.length === 0 ||
    basename(fileName) !== fileName
  ) {
    throw new Error(`Desktop release artifact ${format} must be a plain filename`);
  }
  return fileName;
}

export function parseDesktopReleaseManifest(value: unknown): DesktopReleaseManifest {
  if (!isRecord(value)) throw new Error("Desktop release manifest must be a JSON object");
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported desktop release manifest schema: ${String(value.schemaVersion)}`);
  }
  if (
    typeof value.releaseTag !== "string" ||
    !/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(value.releaseTag)
  ) {
    throw new Error("Desktop release tag must be a safe Git tag name");
  }
  if (!isRecord(value.artifacts)) {
    throw new Error("Desktop release manifest artifacts must be an object");
  }

  const artifactKeys = Object.keys(value.artifacts).sort();
  const expectedArtifactKeys = ["appimage", "deb", "dmg", "msi"];
  if (artifactKeys.join(",") !== expectedArtifactKeys.join(",")) {
    throw new Error(
      `Desktop release manifest must define exactly: ${expectedArtifactKeys.join(", ")}`,
    );
  }

  return {
    schemaVersion: 1,
    releaseTag: value.releaseTag,
    artifacts: {
      dmg: readArtifactFileName(value.artifacts, "dmg"),
      msi: readArtifactFileName(value.artifacts, "msi"),
      appimage: readArtifactFileName(value.artifacts, "appimage"),
      deb: readArtifactFileName(value.artifacts, "deb"),
    },
  };
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = resolve(rootDir, "desktop/release-manifest.json");

export const desktopReleaseManifest = parseDesktopReleaseManifest(
  JSON.parse(readFileSync(manifestPath, "utf8")),
);
