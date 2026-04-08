import type { Page } from 'playwright';
import { ACCOUNT_TYPES, normalizeAccountType, type AccountType } from '../common/account-types';
import { checkIfPresent, clickAny, clickIfPresent, fillIfPresent } from '../common/form-actions';
import { loginDefaults, type LoginSelectors } from './defaults';
import type { SelectorList } from '../../types';

export interface LoginOptions {
  accountType?: string;
  url?: string;
  email?: string;
  password?: string;
  preferPasskey?: boolean;
  selectors?: Partial<LoginSelectors>;
  openLoginSelectors?: SelectorList;
  rememberMeSelectors?: SelectorList;
  onPasskeyPrompt?: (page: Page) => Promise<void>;
  afterSubmit?: (page: Page) => Promise<void>;
}

export interface LoginResult {
  module: 'login';
  accountType: AccountType;
  method: 'password' | 'passkey';
  email: string | null;
}

function mergeSelectors(base: LoginSelectors, overrides: Partial<LoginSelectors> = {}): LoginSelectors {
  return { ...base, ...overrides };
}

async function openLogin(page: Page, options: LoginOptions): Promise<void> {
  if (options.url) {
    await page.goto(options.url, { waitUntil: 'domcontentloaded' });
  }
  if (options.openLoginSelectors?.length) {
    await clickAny(page, options.openLoginSelectors);
  }
}

export async function loginParentAccount(page: Page, options: LoginOptions = {}): Promise<LoginResult> {
  const selectors = mergeSelectors(loginDefaults.common, options.selectors);
  await openLogin(page, options);
  await fillIfPresent(page, selectors.email, options.email);
  await fillIfPresent(page, selectors.password, options.password);
  if (options.rememberMeSelectors) {
    await checkIfPresent(page, options.rememberMeSelectors);
  }
  await clickAny(page, selectors.submit);

  if (options.afterSubmit) {
    await options.afterSubmit(page);
  }

  return {
    module: 'login',
    accountType: ACCOUNT_TYPES.PARENT,
    method: 'password',
    email: options.email || null,
  };
}

export async function loginChildAccount(page: Page, options: LoginOptions = {}): Promise<LoginResult> {
  const selectors = mergeSelectors(
    { ...loginDefaults.common, ...loginDefaults.child } as LoginSelectors,
    options.selectors,
  );

  await openLogin(page, options);

  let method: 'password' | 'passkey' = 'password';

  if (options.preferPasskey !== false && selectors.passkeyEntry) {
    const triggered = await clickIfPresent(page, selectors.passkeyEntry);
    if (triggered) {
      method = 'passkey';
      if (options.onPasskeyPrompt) {
        await options.onPasskeyPrompt(page);
      }
    }
  }

  if (method !== 'passkey') {
    await fillIfPresent(page, selectors.email, options.email);
    await fillIfPresent(page, selectors.password, options.password);
    await clickAny(page, selectors.submit);
  }

  if (options.afterSubmit) {
    await options.afterSubmit(page);
  }

  return {
    module: 'login',
    accountType: ACCOUNT_TYPES.CHILD,
    method,
    email: options.email || null,
  };
}

export async function loginAccount(page: Page, options: LoginOptions = {}): Promise<LoginResult> {
  const type = normalizeAccountType(options.accountType);
  if (type === ACCOUNT_TYPES.PARENT) return loginParentAccount(page, options);
  return loginChildAccount(page, options);
}
