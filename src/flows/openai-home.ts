import { getRuntimeConfig } from "../config";
import type { FlowResult } from "../types";
import type { Page } from "patchright";
import { pathToFileURL } from "url";
import {
  runSingleFileFlowFromCli,
  type SingleFileFlowDefinition,
} from "../modules/flow-cli/single-file";
import type { CommonOptions } from "../modules/flow-cli/helpers";
import { parseCommonCliArgs } from "../modules/flow-cli/parse-argv";

export async function verifyOpenAIHome(page: Page): Promise<FlowResult> {
  const config = getRuntimeConfig();
  await page.goto(config.openai.baseUrl, { waitUntil: "domcontentloaded" });
  const body = page.locator("body");
  await body.waitFor({ state: "visible" });
  const title = await page.title();
  const text = await body.innerText();
  const normalized = `${title}\n${text}`.toLowerCase();
  const signals = ["openai", "chatgpt", "api", "research", "developers", "sora"];
  const matchedSignals = signals.filter((item) => normalized.includes(item));
  if (!matchedSignals.length)
    throw new Error("OpenAI homepage did not expose expected business keywords");
  return { pageName: "openai-home", url: page.url(), title, matchedSignals };
}

export const openaiHomeFlow: SingleFileFlowDefinition<CommonOptions, FlowResult> = {
  command: "flow:openai-home",
  run: verifyOpenAIHome,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSingleFileFlowFromCli(openaiHomeFlow, parseCommonCliArgs(process.argv.slice(2)));
}
