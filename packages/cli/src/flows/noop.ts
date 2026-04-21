import type { Page } from 'patchright'
import { pathToFileURL } from 'url'
import type { FlowOptions } from '../modules/flow-cli/helpers'
import {
  runSingleFileFlowFromCli,
  type SingleFileFlowDefinition,
} from '../modules/flow-cli/single-file'
import { parseFlowCliArgs } from '../modules/flow-cli/parse-argv'

export interface NoopFlowResult {
  pageName: 'noop'
  url: string
  title: string
}

export async function openNoopFlow(page: Page): Promise<NoopFlowResult> {
  await page.goto('about:blank')
  return {
    pageName: 'noop',
    url: page.url(),
    title: await page.title(),
  }
}

export const noopFlow: SingleFileFlowDefinition<FlowOptions, NoopFlowResult> = {
  command: 'flow:noop',
  defaultOptions: {
    har: true,
    record: true,
  },
  run: openNoopFlow,
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runSingleFileFlowFromCli(noopFlow, parseFlowCliArgs(process.argv.slice(2)))
}
