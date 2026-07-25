#!/usr/bin/env bun

export const SMRY_PRODUCTION_APP_URL = "https://smry.ai/new";

export function hasProductionDesktopShellContract(stylesheets: string[]): boolean {
  const combinedStyles = stylesheets.join("\n");
  return (
    combinedStyles.includes("data-smry-desktop-macos") &&
    combinedStyles.includes("--smry-desktop-traffic-light-safe-width") &&
    combinedStyles.includes("data-sidebar-header")
  );
}

function getSameOriginStylesheetUrls(html: string, pageUrl: string): string[] {
  const page = new URL(pageUrl);
  const urls = new Set<string>();
  const linkPattern = /<link\b[^>]*\bhref=["']([^"']+\.css(?:\?[^"']*)?)["'][^>]*>/gi;

  for (const match of html.matchAll(linkPattern)) {
    const stylesheetUrl = new URL(match[1], page);
    if (stylesheetUrl.origin === page.origin) urls.add(stylesheetUrl.href);
  }
  return [...urls];
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

export async function checkProductionDesktopShell(
  pageUrl = SMRY_PRODUCTION_APP_URL,
): Promise<void> {
  const html = await fetchText(pageUrl);
  const stylesheetUrls = getSameOriginStylesheetUrls(html, pageUrl);
  if (stylesheetUrls.length === 0) {
    throw new Error(`${pageUrl} did not expose any same-origin stylesheets`);
  }

  const stylesheets = await Promise.all(stylesheetUrls.map(fetchText));
  if (!hasProductionDesktopShellContract(stylesheets)) {
    throw new Error("Production does not yet own the desktop frame layout contract");
  }

  console.log(`Production desktop shell contract is live at ${pageUrl}`);
}

if (import.meta.main) {
  checkProductionDesktopShell().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
