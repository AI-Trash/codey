import path from "path";
import { chromium, type Browser, type BrowserContext } from "patchright";
import { getRuntimeConfig } from "../config";
import { ensureDir } from "../utils/fs";
import type { Session } from "../types";

function timeStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizeArtifactName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "flow"
  );
}

function buildHarPath(artifactsDir: string, artifactName?: string, command?: string): string {
  ensureDir(artifactsDir);
  const safeName = sanitizeArtifactName(artifactName || command || "flow");
  return path.join(artifactsDir, `${timeStamp()}-${safeName}.har`);
}

export async function launchBrowser(): Promise<Browser> {
  const config = getRuntimeConfig();
  ensureDir(config.artifactsDir);

  return chromium.launch({
    channel: "chrome",
    headless: config.browser.headless,
    slowMo: config.browser.slowMo,
  });
}

export async function newSession(
  options: {
    artifactName?: string;
    context?: Parameters<Browser["newContext"]>[0];
  } = {},
): Promise<Session> {
  const config = getRuntimeConfig();
  const browser = await launchBrowser();
  const harPath = config.browser.recordHar
    ? buildHarPath(config.artifactsDir, options.artifactName, config.command)
    : undefined;
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    ignoreHTTPSErrors: true,
    ...(harPath ? ({ recordHar: { path: harPath } } as object) : {}),
    ...options.context,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(config.browser.defaultTimeoutMs);
  page.setDefaultNavigationTimeout(config.browser.navigationTimeoutMs);

  return {
    browser,
    context,
    page,
    harPath,
    async close() {
      await context.close();
      await browser.close();
    },
  };
}
