import type { Page } from 'patchright'

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
