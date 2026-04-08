import type { Page } from 'patchright';
import { getRuntimeConfig } from '../config';
import { expectUrlIncludes, expectVisible } from '../core/assertions';
import type { FlowResult } from '../types';

export async function verifyOpenAIHome(page: Page): Promise<FlowResult> {
  const config = getRuntimeConfig();
  await page.goto(config.openai.baseUrl, { waitUntil: 'domcontentloaded' });
  await expectUrlIncludes(page, 'openai.com');

  const body = page.locator('body');
  await expectVisible(body, 'OpenAI homepage body is not visible');

  const title = await page.title();
  const text = await body.innerText();
  const normalized = `${title}\n${text}`.toLowerCase();
  const signals = ['openai', 'chatgpt', 'api', 'research', 'developers', 'sora'];
  const matchedSignals = signals.filter((item) => normalized.includes(item));

  if (!matchedSignals.length) {
    throw new Error('OpenAI homepage did not expose expected business keywords');
  }

  return {
    pageName: 'openai-home',
    url: page.url(),
    title,
    matchedSignals,
  };
}

export async function verifyChatGPTEntry(page: Page): Promise<FlowResult> {
  const config = getRuntimeConfig();
  await page.goto(config.openai.chatgptUrl, { waitUntil: 'domcontentloaded' });

  const body = page.locator('body');
  await expectVisible(body, 'ChatGPT entry page body is not visible');

  const title = await page.title();
  const text = await body.innerText();
  const normalized = `${title}\n${text}`.toLowerCase();
  const signals = ['chatgpt', 'log in', 'sign up', 'openai', 'try'];
  const matchedSignals = signals.filter((item) => normalized.includes(item));

  if (!matchedSignals.length) {
    throw new Error('ChatGPT entry page did not expose expected entry keywords');
  }

  return {
    pageName: 'chatgpt-entry',
    url: page.url(),
    title,
    matchedSignals,
  };
}
