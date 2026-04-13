import type { Page } from "patchright";
import { ACCOUNT_TYPES, normalizeAccountType, type AccountType } from "../common/account-types";
import { clickAny, clickIfPresent, typeIfPresent } from "../common/form-actions";
import { registrationDefaults, type RegistrationSelectors } from "./defaults";
import type { SelectorList } from "../../types";
import {
  createRegistrationMachine,
  markAuthOpened,
  markAuthStep,
  runWithAuthMachine,
  type AuthMachine,
} from "../auth-machine";
import {
  captureVirtualPasskeyStore,
  loadVirtualPasskeyStore,
  type VirtualAuthenticatorOptions,
  type VirtualPasskeyStore,
} from "../webauthn";

const unifiedRegistrationSelectors: RegistrationSelectors = {
  ...registrationDefaults.common,
  ...registrationDefaults.parent,
  ...registrationDefaults.child,
};

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
  machine?: AuthMachine<RegistrationResult>;
}

export interface RegistrationResult {
  module: "registration";
  accountType: AccountType;
  email: string | null;
  organizationName?: string | null;
  passkeyCreated: boolean;
  passkeyStore?: VirtualPasskeyStore;
}

function mergeSelectors(
  base: RegistrationSelectors,
  overrides: Partial<RegistrationSelectors> = {},
): RegistrationSelectors {
  return { ...base, ...overrides };
}

function resolveCreatePasskey(createPasskey?: boolean): boolean {
  return createPasskey ?? true;
}

async function openRegistration(page: Page, options: RegistrationOptions): Promise<void> {
  options.machine?.transition("opening", {
    event: "action.started",
    action: "open-registration",
    patch: {
      url: options.url || page.url(),
      lastMessage: "Opening registration entry",
      lastSelectors: options.openRegistrationSelectors,
    },
  });
  if (options.url) {
    await page.goto(options.url, { waitUntil: "domcontentloaded" });
  }
  if (options.openRegistrationSelectors?.length) {
    await clickAny(page, options.openRegistrationSelectors);
  }
  markAuthOpened(options.machine, page, options.openRegistrationSelectors);
  options.machine?.endAction({
    event: "auth.ready",
    patch: {
      url: page.url(),
      lastMessage: "Registration surface ready",
    },
  });
}

export async function registerParentAccount(
  page: Page,
  options: RegistrationOptions = {},
): Promise<RegistrationResult> {
  return registerAccount(page, { ...options, accountType: ACCOUNT_TYPES.PARENT });
}

export async function registerChildAccount(
  page: Page,
  options: RegistrationOptions = {},
): Promise<RegistrationResult> {
  return registerAccount(page, { ...options, accountType: ACCOUNT_TYPES.CHILD });
}

export async function registerAccount(
  page: Page,
  options: RegistrationOptions = {},
): Promise<RegistrationResult> {
  const type = normalizeAccountType(options.accountType);
  const machine = options.machine ?? createRegistrationMachine({ options });
  const selectors = mergeSelectors(unifiedRegistrationSelectors, options.selectors);
  const createPasskey = resolveCreatePasskey(options.createPasskey);

  return runWithAuthMachine(
    machine,
    {
      accountType: type,
      url: options.url,
      email: options.email || null,
      organizationName: options.organizationName || null,
      createPasskey,
      passkeyCreated: false,
    },
    async () => {
      await openRegistration(page, { ...options, machine });

      markAuthStep(machine, "typing-email", "auth.email.typed", {
        email: options.email || null,
        lastSelectors: selectors.email,
        lastMessage: "Typing registration email",
      });
      await typeIfPresent(page, selectors.email, options.email);

      markAuthStep(machine, "typing-password", "auth.password.typed", {
        lastSelectors: selectors.password,
        lastMessage: "Typing registration password",
      });
      await typeIfPresent(page, selectors.password, options.password);

      if (selectors.organizationName) {
        markAuthStep(machine, "typing-organization", "auth.organization.typed", {
          organizationName: options.organizationName || null,
          lastSelectors: selectors.organizationName,
          lastMessage: "Typing organization name",
        });
        await typeIfPresent(page, selectors.organizationName, options.organizationName);
      }

      markAuthStep(machine, "submitting", "auth.submitted", {
        lastSelectors: selectors.submit,
        lastMessage: "Submitting registration form",
      });
      await clickAny(page, selectors.submit);

      let passkeyCreated = false;
      let passkeyStore: VirtualPasskeyStore | undefined;
      if (createPasskey && selectors.createPasskey) {
        markAuthStep(machine, "choosing-passkey", "auth.passkey.chosen", {
          lastSelectors: selectors.createPasskey,
          lastMessage: "Trying to create passkey",
        });
        const virtualAuth = await loadVirtualPasskeyStore(
          page,
          options.passkeyStore,
          options.virtualAuthenticator,
        );
        passkeyCreated = await clickIfPresent(page, selectors.createPasskey);
        if (passkeyCreated) {
          markAuthStep(machine, "waiting-passkey", "auth.passkey.prompted", {
            passkeyCreated: true,
            lastSelectors: selectors.passkeyDialogConfirm,
            lastMessage: "Passkey creation prompt displayed",
          });
          await clickIfPresent(page, selectors.passkeyDialogConfirm || []);
          if (options.onPasskeySetup) {
            await options.onPasskeySetup(page);
          }
          markAuthStep(machine, "capturing-passkey", "auth.passkey.capture.started", {
            lastMessage: "Capturing created passkey",
          });
          passkeyStore = await captureVirtualPasskeyStore(
            virtualAuth.session,
            virtualAuth.authenticatorId,
          );
          markAuthStep(machine, "capturing-passkey", "auth.passkey.capture.finished", {
            passkeyCreated: true,
            passkeyStore,
            lastMessage: "Passkey captured",
          });
        }
      }

      if (options.afterSubmit) {
        markAuthStep(machine, "post-submit", "auth.after-submit.started", {
          lastMessage: "Running afterSubmit hook",
        });
        await options.afterSubmit(page);
        markAuthStep(machine, "post-submit", "auth.after-submit.finished", {
          url: page.url(),
          lastMessage: "afterSubmit hook finished",
        });
      }

      return {
        module: "registration",
        accountType: type,
        email: options.email || null,
        organizationName: options.organizationName || null,
        passkeyCreated,
        passkeyStore,
      };
    },
  );
}
