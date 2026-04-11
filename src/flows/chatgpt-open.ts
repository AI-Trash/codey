import type { Page } from "patchright";
import { pathToFileURL } from "url";
import type { FlowOptions } from "../modules/flow-cli/helpers";
import { getRuntimeConfig } from "../config";
import { parseNumberFlag } from "../modules/flow-cli/helpers";
import {
  runSingleFileFlowFromCli,
  type SingleFileFlowDefinition,
} from "../modules/flow-cli/single-file";
import { parseFlowCliArgs } from "../modules/flow-cli/parse-argv";

export interface ChatGPTOpenFlowResult {
  status: "opened";
  url: string;
  waitMs: number;
  note: string;
}

export async function openChatGPT(
  page: Page,
  options: FlowOptions = {},
): Promise<ChatGPTOpenFlowResult> {
  const config = getRuntimeConfig();
  const waitMs = parseNumberFlag(options.waitMs, 300000) ?? 300000;
  await page.goto(config.openai.chatgptUrl, { waitUntil: "domcontentloaded" });
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return {
    status: "opened",
    url: page.url(),
    waitMs,
    note: "ChatGPT has been opened and no automated actions will be performed.",
  };
}

export const chatgptOpenFlow: SingleFileFlowDefinition<FlowOptions, ChatGPTOpenFlowResult> = {
  command: "flow:chatgpt-open",
  run: openChatGPT,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSingleFileFlowFromCli(chatgptOpenFlow, parseFlowCliArgs(process.argv.slice(2)));
}
