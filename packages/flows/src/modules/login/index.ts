import type { Page } from 'patchright'
import {
  ACCOUNT_TYPES,
  normalizeAccountType,
  type AccountType,
} from '../common/account-types'
import {
  checkIfPresent,
  clickAny,
  clickIfPresent,
  typeIfPresent,
} from '../common/form-actions'
import { loginDefaults, type LoginSelectors } from './defaults'
import type { SelectorList } from '../../types'
import {
  createLoginMachine,
  markAuthOpened,
  markAuthStep,
  resolveAuthMethod,
  runWithAuthMachine,
  type AuthMachine,
} from '../auth-machine'
import {
  loadVirtualPasskeyStore,
  type VirtualAuthenticatorOptions,
  type VirtualPasskeyStore,
} from '../webauthn'

export interface LoginOptions {
  accountType?: string
  url?: string
  email?: string
  password?: string
  preferPasskey?: boolean
  selectors?: Partial<LoginSelectors>
  openLoginSelectors?: SelectorList
  rememberMeSelectors?: SelectorList
  passkeyStore?: VirtualPasskeyStore
  virtualAuthenticator?: VirtualAuthenticatorOptions
  onPasskeyPrompt?: (page: Page) => Promise<void>
  afterSubmit?: (page: Page) => Promise<void>
  machine?: AuthMachine<LoginResult>
}

export interface LoginResult {
  module: 'login'
  accountType: AccountType
  method: 'password' | 'passkey'
  email: string | null
}

function mergeSelectors(
  base: LoginSelectors,
  overrides: Partial<LoginSelectors> = {},
): LoginSelectors {
  return { ...base, ...overrides }
}

async function openLogin(page: Page, options: LoginOptions): Promise<void> {
  await markAuthStep(options.machine, 'opening', 'action.started', {
    url: options.url || page.url(),
    lastMessage: 'Opening login entry',
    lastSelectors: options.openLoginSelectors,
  })
  if (options.url) {
    await page.goto(options.url, { waitUntil: 'domcontentloaded' })
  }
  if (options.openLoginSelectors?.length) {
    await clickAny(page, options.openLoginSelectors)
  }
  await markAuthOpened(options.machine, page, options.openLoginSelectors)
  await markAuthStep(options.machine, 'ready', 'auth.ready', {
    url: page.url(),
    lastMessage: 'Login surface ready',
  })
}

export async function loginParentAccount(
  page: Page,
  options: LoginOptions = {},
): Promise<LoginResult> {
  const machine = options.machine ?? createLoginMachine({ options })
  return runWithAuthMachine(
    machine,
    {
      accountType: ACCOUNT_TYPES.PARENT,
      url: options.url,
      email: options.email || null,
      method: 'password',
      preferPasskey: false,
    },
    async () => {
      const selectors = mergeSelectors(loginDefaults.common, options.selectors)
      await openLogin(page, { ...options, machine })
      await markAuthStep(machine, 'typing-email', 'auth.email.typed', {
        email: options.email || null,
        lastSelectors: selectors.email,
        lastMessage: 'Typing login email',
      })
      await typeIfPresent(page, selectors.email, options.email, {
        settleMs: 500,
        strategy: 'sequential',
      })

      await markAuthStep(machine, 'typing-password', 'auth.password.typed', {
        lastSelectors: selectors.password,
        lastMessage: 'Typing login password',
      })
      await typeIfPresent(page, selectors.password, options.password, {
        settleMs: 500,
        strategy: 'sequential',
      })

      if (options.rememberMeSelectors) {
        await markAuthStep(
          machine,
          'toggling-remember-me',
          'auth.remember-me.checked',
          {
            lastSelectors: options.rememberMeSelectors,
            lastMessage: 'Checking remember-me',
          },
        )
        await checkIfPresent(page, options.rememberMeSelectors)
      }

      await markAuthStep(machine, 'submitting', 'auth.submitted', {
        lastSelectors: selectors.submit,
        lastMessage: 'Submitting login form',
      })
      await clickAny(page, selectors.submit)

      if (options.afterSubmit) {
        await markAuthStep(
          machine,
          'post-submit',
          'auth.after-submit.started',
          {
            lastMessage: 'Running afterSubmit hook',
          },
        )
        await options.afterSubmit(page)
        await markAuthStep(
          machine,
          'post-submit',
          'auth.after-submit.finished',
          {
            url: page.url(),
            lastMessage: 'afterSubmit hook finished',
          },
        )
      }

      return {
        module: 'login',
        accountType: ACCOUNT_TYPES.PARENT,
        method: 'password',
        email: options.email || null,
      }
    },
  )
}

export async function loginChildAccount(
  page: Page,
  options: LoginOptions = {},
): Promise<LoginResult> {
  const machine = options.machine ?? createLoginMachine({ options })
  return runWithAuthMachine(
    machine,
    {
      accountType: ACCOUNT_TYPES.CHILD,
      url: options.url,
      email: options.email || null,
      method: options.preferPasskey === false ? 'password' : undefined,
      preferPasskey: options.preferPasskey,
    },
    async () => {
      const selectors = mergeSelectors(
        { ...loginDefaults.common, ...loginDefaults.child } as LoginSelectors,
        options.selectors,
      )

      await openLogin(page, { ...options, machine })

      const requestedMethod = await resolveAuthMethod(machine, {
        supportsPasskey:
          options.preferPasskey !== false &&
          Boolean(selectors.passkeyEntry?.length),
        passkeySelectors: selectors.passkeyEntry,
        emailSelectors: selectors.email,
        passkeyMessage: 'Trying passkey login',
        passwordMessage: 'Typing login email',
      })
      let method: 'password' | 'passkey' = 'password'

      if (requestedMethod === 'passkey' && selectors.passkeyEntry) {
        await markAuthStep(machine, 'choosing-passkey', 'auth.passkey.chosen', {
          method: 'passkey',
          lastSelectors: selectors.passkeyEntry,
          lastMessage: 'Trying passkey login',
        })
        await loadVirtualPasskeyStore(
          page,
          options.passkeyStore,
          options.virtualAuthenticator,
        )
        const triggered = await clickIfPresent(page, selectors.passkeyEntry)
        if (triggered) {
          method = 'passkey'
          await markAuthStep(
            machine,
            'waiting-passkey',
            'auth.passkey.prompted',
            {
              method,
              lastMessage: 'Passkey prompt displayed',
            },
          )
          if (options.onPasskeyPrompt) {
            await options.onPasskeyPrompt(page)
          }
        }
      }

      if (method !== 'passkey') {
        await markAuthStep(machine, 'typing-email', 'auth.email.typed', {
          email: options.email || null,
          method,
          lastSelectors: selectors.email,
          lastMessage: 'Typing login email',
        })
        await typeIfPresent(page, selectors.email, options.email, {
          settleMs: 500,
          strategy: 'sequential',
        })

        await markAuthStep(machine, 'typing-password', 'auth.password.typed', {
          method,
          lastSelectors: selectors.password,
          lastMessage: 'Typing login password',
        })
        await typeIfPresent(page, selectors.password, options.password, {
          settleMs: 500,
          strategy: 'sequential',
        })

        await markAuthStep(machine, 'submitting', 'auth.submitted', {
          method,
          lastSelectors: selectors.submit,
          lastMessage: 'Submitting login form',
        })
        await clickAny(page, selectors.submit)
      }

      if (options.afterSubmit) {
        await markAuthStep(
          machine,
          'post-submit',
          'auth.after-submit.started',
          {
            method,
            lastMessage: 'Running afterSubmit hook',
          },
        )
        await options.afterSubmit(page)
        await markAuthStep(
          machine,
          'post-submit',
          'auth.after-submit.finished',
          {
            method,
            url: page.url(),
            lastMessage: 'afterSubmit hook finished',
          },
        )
      }

      return {
        module: 'login',
        accountType: ACCOUNT_TYPES.CHILD,
        method,
        email: options.email || null,
      }
    },
  )
}

export async function loginAccount(
  page: Page,
  options: LoginOptions = {},
): Promise<LoginResult> {
  const type = normalizeAccountType(options.accountType)
  if (type === ACCOUNT_TYPES.PARENT) return loginParentAccount(page, options)
  return loginChildAccount(page, options)
}
