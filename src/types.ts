import type { Locator, Page } from 'patchright';

export type SelectorObject =
  | { css: string }
  | { role: Parameters<Page['getByRole']>[0]; options?: Parameters<Page['getByRole']>[1] }
  | { text: string | RegExp; options?: Parameters<Page['getByText']>[1] }
  | { label: string | RegExp; options?: Parameters<Page['getByLabel']>[1] }
  | { placeholder: string | RegExp; options?: Parameters<Page['getByPlaceholder']>[1] }
  | { testId: string };

export type SelectorTarget = string | SelectorObject;
export type SelectorList = SelectorTarget[];

export interface Session {
  browser: import('patchright').Browser;
  context: import('patchright').BrowserContext;
  page: Page;
  close(): Promise<void>;
}

export interface FlowResult {
  pageName: string;
  url: string;
  title: string;
  matchedSignals: string[];
}

export type FlowHandler<T = Record<string, unknown>> = (page: Page) => Promise<T>;
export type LocatorLike = Locator;
