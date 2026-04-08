import fs from 'fs';
import path from 'path';
import type { Page } from 'playwright';
import { getRuntimeConfig } from '../config';
import { ensureDir } from '../utils/fs';

function timeStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function saveScreenshot(page: Page, name: string): Promise<string> {
  const config = getRuntimeConfig();
  ensureDir(config.artifactsDir);
  const filePath = path.join(config.artifactsDir, `${timeStamp()}-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export function writeJson(name: string, data: unknown): string {
  const config = getRuntimeConfig();
  ensureDir(config.artifactsDir);
  const filePath = path.join(config.artifactsDir, `${timeStamp()}-${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}
