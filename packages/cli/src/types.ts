import type { Page } from 'patchright'

export type SelectorObject =
  | { css: string }
  | {
      role: Parameters<Page['getByRole']>[0]
      options?: Parameters<Page['getByRole']>[1]
    }
  | { text: string | RegExp; options?: Parameters<Page['getByText']>[1] }
  | { label: string | RegExp; options?: Parameters<Page['getByLabel']>[1] }
  | {
      placeholder: string | RegExp
      options?: Parameters<Page['getByPlaceholder']>[1]
    }
  | { testId: string }

export type SelectorTarget = string | SelectorObject
export type SelectorList = SelectorTarget[]

export interface Session {
  sessionId?: string
  browser: import('patchright').Browser | null
  context: import('patchright').BrowserContext
  page: Page
  harPath?: string
  close(): Promise<void>
}
