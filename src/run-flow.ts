import { loadWorkspaceEnv } from './utils/env';
loadWorkspaceEnv();

import { newSession } from './core/browser';
import { saveScreenshot, writeJson } from './core/report';
import type { FlowHandler } from './types';

export async function runFlow(name: string, flow: FlowHandler): Promise<void> {
  const session = await newSession();

  try {
    const result = await flow(session.page);
    const screenshotPath = await saveScreenshot(session.page, name);
    const reportPath = writeJson(name, {
      status: 'passed',
      ...result,
      screenshotPath,
      capturedAt: new Date().toISOString(),
    });

    console.log(JSON.stringify({ status: 'passed', name, screenshotPath, reportPath, result }, null, 2));
  } catch (error) {
    const err = error as Error;
    let screenshotPath: string | null = null;
    try {
      screenshotPath = await saveScreenshot(session.page, `${name}-failed`);
    } catch {}

    const reportPath = writeJson(name, {
      status: 'failed',
      error: err.message,
      screenshotPath,
      capturedAt: new Date().toISOString(),
    });

    console.error(JSON.stringify({ status: 'failed', name, error: err.message, screenshotPath, reportPath }, null, 2));
    process.exitCode = 1;
  } finally {
    await session.close();
  }
}
