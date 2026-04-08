import { chromium, type Browser, type BrowserContext } from 'patchright';
import { getRuntimeConfig } from '../config';
import { ensureDir } from '../utils/fs';
import type { Session } from '../types';

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
  options: { context?: Parameters<Browser['newContext']>[0] } = {},
): Promise<Session> {
  const config = getRuntimeConfig();
  const browser = await launchBrowser();
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    ignoreHTTPSErrors: true,
    ...options.context,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(config.browser.defaultTimeoutMs);
  page.setDefaultNavigationTimeout(config.browser.navigationTimeoutMs);

  return {
    browser,
    context,
    page,
    async close() {
      await context.close();
      await browser.close();
    },
  };
}
