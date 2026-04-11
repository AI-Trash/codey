import type { Page } from 'patchright';
import { pathToFileURL } from 'url';
import { getRuntimeConfig } from '../config';
import type { FlowResult } from '../types';
import { runSingleFileFlowFromCli, type SingleFileFlowDefinition } from '../modules/flow-cli/single-file';
import type { CommonOptions } from '../modules/flow-cli/helpers';
import { parseCommonCliArgs } from '../modules/flow-cli/parse-argv';

export async function verifyChatGPTEntry(page: Page): Promise<FlowResult> {
  const config = getRuntimeConfig();
  await page.goto(config.openai.chatgptUrl, { waitUntil: 'domcontentloaded' });
  const body = page.locator('body');
  await body.waitFor({ state: 'visible' });
  const title = await page.title();
  const text = await body.innerText();
  const normalized = `${title}\n${text}`.toLowerCase();
  const signals = ['chatgpt', 'log in', 'sign up', 'openai', 'try'];
  const matchedSignals = signals.filter((item) => normalized.includes(item));
  if (!matchedSignals.length) throw new Error('ChatGPT entry page did not expose expected entry keywords');
  return { pageName: 'chatgpt-entry', url: page.url(), title, matchedSignals };
}

export const chatgptEntryFlow: SingleFileFlowDefinition<CommonOptions, FlowResult> = {
  command: 'flow:chatgpt-entry',
  run: verifyChatGPTEntry,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSingleFileFlowFromCli(chatgptEntryFlow, parseCommonCliArgs(process.argv.slice(2)));
}
