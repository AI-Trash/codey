import type { Page } from 'playwright';
import { ACCOUNT_TYPES, normalizeAccountType, type AccountType } from '../common/account-types';
import { clickAny, clickIfPresent, fillIfPresent } from '../common/form-actions';
import { registrationDefaults, type RegistrationSelectors } from './defaults';
import type { SelectorList } from '../../types';
import {
  captureVirtualPasskeyStore,
  loadVirtualPasskeyStore,
  type VirtualAuthenticatorOptions,
  type VirtualPasskeyStore,
} from '../webauthn';

export interface RegistrationOptions {
  accountType?: string;
  url?: string;
  email?: string;
  password?: string;
  organizationName?: string;
  createPasskey?: boolean;
  selectors?: Partial<RegistrationSelectors>;
  openRegistrationSelectors?: SelectorList;
  passkeyStore?: VirtualPasskeyStore;
  virtualAuthenticator?: VirtualAuthenticatorOptions;
  onPasskeySetup?: (page: Page) => Promise<void>;
  afterSubmit?: (page: Page) => Promise<void>;
}

export interface RegistrationResult {
  module: 'registration';
  accountType: AccountType;
  email: string | null;
  organizationName?: string | null;
  passkeyCreated: boolean;
  passkeyStore?: VirtualPasskeyStore;
}

function mergeSelectors(base: RegistrationSelectors, overrides: Partial<RegistrationSelectors> = {}): RegistrationSelectors {
  return { ...base, ...overrides };
}

async function openRegistration(page: Page, options: RegistrationOptions): Promise<void> {
  if (options.url) {
    await page.goto(options.url, { waitUntil: 'domcontentloaded' });
  }
  if (options.openRegistrationSelectors?.length) {
    await clickAny(page, options.openRegistrationSelectors);
  }
}

export async function registerParentAccount(page: Page, options: RegistrationOptions = {}): Promise<RegistrationResult> {
  const selectors = mergeSelectors(
    { ...registrationDefaults.common, ...registrationDefaults.parent } as RegistrationSelectors,
    options.selectors,
  );

  await openRegistration(page, options);
  await fillIfPresent(page, selectors.email, options.email);
  await fillIfPresent(page, selectors.password, options.password);
  if (selectors.organizationName) {
    await fillIfPresent(page, selectors.organizationName, options.organizationName);
  }
  await clickAny(page, selectors.submit);

  if (options.afterSubmit) {
    await options.afterSubmit(page);
  }

  return {
    module: 'registration',
    accountType: ACCOUNT_TYPES.PARENT,
    email: options.email || null,
    organizationName: options.organizationName || null,
    passkeyCreated: false,
  };
}

export async function registerChildAccount(page: Page, options: RegistrationOptions = {}): Promise<RegistrationResult> {
  const selectors = mergeSelectors(
    { ...registrationDefaults.common, ...registrationDefaults.child } as RegistrationSelectors,
    options.selectors,
  );

  await openRegistration(page, options);
  await fillIfPresent(page, selectors.email, options.email);
  await fillIfPresent(page, selectors.password, options.password);
  await clickAny(page, selectors.submit);

  let passkeyCreated = false;
  let passkeyStore: VirtualPasskeyStore | undefined;
  if (options.createPasskey !== false && selectors.createPasskey) {
    const virtualAuth = await loadVirtualPasskeyStore(
      page,
      options.passkeyStore,
      options.virtualAuthenticator,
    );
    passkeyCreated = await clickIfPresent(page, selectors.createPasskey);
    if (passkeyCreated) {
      await clickIfPresent(page, selectors.passkeyDialogConfirm || []);
      if (options.onPasskeySetup) {
        await options.onPasskeySetup(page);
      }
      passkeyStore = await captureVirtualPasskeyStore(
        virtualAuth.session,
        virtualAuth.authenticatorId,
      );
    }
  }

  if (options.afterSubmit) {
    await options.afterSubmit(page);
  }

  return {
    module: 'registration',
    accountType: ACCOUNT_TYPES.CHILD,
    email: options.email || null,
    passkeyCreated,
    passkeyStore,
  };
}

export async function registerAccount(page: Page, options: RegistrationOptions = {}): Promise<RegistrationResult> {
  const type = normalizeAccountType(options.accountType);
  if (type === ACCOUNT_TYPES.PARENT) return registerParentAccount(page, options);
  return registerChildAccount(page, options);
}
