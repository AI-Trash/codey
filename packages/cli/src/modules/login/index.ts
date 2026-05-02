import type { Page } from 'patchright'
import {
  ACCOUNT_TYPES,
  normalizeAccountType,
  type AccountType,
} from '../common/account-types'
import { checkIfPresent, clickAny, typeIfPresent } from '../common/form-actions'
import { loginDefaults, type LoginSelectors } from './defaults'
import type { SelectorList } from '../../types'
import {
  createLoginMachine,
  markAuthOpened,
  markAuthStep,
  runWithAuthMachine,
  type AuthMachine,
} from '../auth-machine'

export interface LoginOptions {
  accountType?: string
  url?: string
  email?: string
  password?: string
  selectors?: Partial<LoginSelectors>
  openLoginSelectors?: SelectorList
  rememberMeSelectors?: SelectorList
  afterSubmit?: (page: Page) => Promise<void>
  machine?: AuthMachine<LoginResult>
}

export interface LoginResult {
  module: 'login'
  accountType: AccountType
  method: 'password'
  email: string | null
}

function mergeSelectors(
  base: LoginSelectors,
  overrides: Partial<LoginSelectors> = {},
): LoginSelectors {
  return { ...base, ...overrides }
}

async function openLogin(page: Page, options: LoginOptions): Promise<void> {
  await markAuthStep(options.machine, 'action.started', {
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
  await markAuthStep(options.machine, 'auth.ready', {
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
    },
    async () => {
      const selectors = mergeSelectors(loginDefaults.common, options.selectors)
      await openLogin(page, { ...options, machine })
      await markAuthStep(machine, 'auth.email.typed', {
        email: options.email || null,
        lastSelectors: selectors.email,
        lastMessage: 'Typing login email',
      })
      await typeIfPresent(page, selectors.email, options.email, {
        settleMs: 500,
        strategy: 'sequential',
      })

      await markAuthStep(machine, 'auth.password.typed', {
        lastSelectors: selectors.password,
        lastMessage: 'Typing login password',
      })
      await typeIfPresent(page, selectors.password, options.password, {
        settleMs: 500,
        strategy: 'sequential',
      })

      if (options.rememberMeSelectors) {
        await markAuthStep(machine, 'auth.remember-me.checked', {
          lastSelectors: options.rememberMeSelectors,
          lastMessage: 'Checking remember-me',
        })
        await checkIfPresent(page, options.rememberMeSelectors)
      }

      await markAuthStep(machine, 'auth.submitted', {
        lastSelectors: selectors.submit,
        lastMessage: 'Submitting login form',
      })
      await clickAny(page, selectors.submit)

      if (options.afterSubmit) {
        await markAuthStep(machine, 'auth.after-submit.started', {
          lastMessage: 'Running afterSubmit hook',
        })
        await options.afterSubmit(page)
        await markAuthStep(machine, 'auth.after-submit.finished', {
          url: page.url(),
          lastMessage: 'afterSubmit hook finished',
        })
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
      method: 'password',
    },
    async () => {
      const selectors = mergeSelectors(
        { ...loginDefaults.common, ...loginDefaults.child } as LoginSelectors,
        options.selectors,
      )

      await openLogin(page, { ...options, machine })
      const method = 'password' as const

      await markAuthStep(machine, 'auth.email.typed', {
        email: options.email || null,
        method,
        lastSelectors: selectors.email,
        lastMessage: 'Typing login email',
      })
      await typeIfPresent(page, selectors.email, options.email, {
        settleMs: 500,
        strategy: 'sequential',
      })

      await markAuthStep(machine, 'auth.password.typed', {
        method,
        lastSelectors: selectors.password,
        lastMessage: 'Typing login password',
      })
      await typeIfPresent(page, selectors.password, options.password, {
        settleMs: 500,
        strategy: 'sequential',
      })

      await markAuthStep(machine, 'auth.submitted', {
        method,
        lastSelectors: selectors.submit,
        lastMessage: 'Submitting login form',
      })
      await clickAny(page, selectors.submit)

      if (options.afterSubmit) {
        await markAuthStep(machine, 'auth.after-submit.started', {
          method,
          lastMessage: 'Running afterSubmit hook',
        })
        await options.afterSubmit(page)
        await markAuthStep(machine, 'auth.after-submit.finished', {
          method,
          url: page.url(),
          lastMessage: 'afterSubmit hook finished',
        })
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
