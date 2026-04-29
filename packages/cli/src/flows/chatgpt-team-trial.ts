import type { Page } from 'patchright'
import path from 'path'
import { pathToFileURL } from 'url'
import {
  composeStateMachineConfig,
  createStateMachine,
  declareStateMachineStates,
  type StateMachineController,
  type StateMachineSnapshot,
} from '../state-machine'
import { createFlowLifecycleFragment } from './machine-fragments'
import {
  CHATGPT_HOME_URL,
  buildChatGPTTrialPricingPromoUrl,
  clickChatGPTCheckoutSubscribeAndCapturePaypalLink,
  clickTrialPricingFreeTrial,
  fillChatGPTCheckoutBillingAddress,
  getChatGPTTrialPromoPlan,
  gotoTrialPricingPromo,
  selectChatGPTCheckoutPaypalPaymentMethodIfPresent,
  selectEligibleChatGPTTrialPromoCoupon,
  type ChatGPTTeamTrialBillingAddress,
  type ChatGPTTrialPromoCoupon,
  type ChatGPTTrialPromoPlan,
  waitForAuthenticatedSession,
  waitForChatGPTCheckoutReady,
  waitForTrialPricingFreeTrialReady,
} from '../modules/chatgpt/shared'
import { getRuntimeConfig } from '../config'
import type { FlowOptions } from '../modules/flow-cli/helpers'
import {
  attachStateMachineProgressReporter,
  sanitizeErrorForOutput,
} from '../modules/flow-cli/helpers'
import { saveLocalChatGPTStorageState } from '../modules/chatgpt/storage-state'
import {
  runSingleFileFlowFromCommandLine,
  type SingleFileFlowDefinition,
} from '../modules/flow-cli/single-file'
import { writeFileAtomic } from '../utils/fs'
import { loginChatGPT, type ChatGPTLoginFlowResult } from './chatgpt-login'
import { reportChatGPTAccountDeactivationToCodeyApp } from '../modules/chatgpt/account-deactivation'

export const DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME = 'Summpot'

export const DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_ADDRESS = {
  name: DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME,
  country: 'NL',
  line1: 'Bertha von Suttnerlaan 97',
  line2: '762 Effertz Stream',
  city: 'Amstelveen',
  state: undefined,
  postalCode: '1187 ST',
} as const satisfies ChatGPTTeamTrialBillingAddress

export type ChatGPTTeamTrialFlowKind = 'chatgpt-team-trial'

export type ChatGPTTeamTrialFlowState =
  | 'idle'
  | 'logging-in'
  | 'home-ready'
  | 'opening-pricing'
  | 'pricing-ready'
  | 'claiming-trial'
  | 'trial-claimed'
  | 'checkout-ready'
  | 'selecting-paypal-payment-method'
  | 'paypal-payment-method-selected'
  | 'filling-billing-address'
  | 'billing-address-filled'
  | 'subscribing'
  | 'paypal-link-captured'
  | 'retrying'
  | 'completed'
  | 'failed'

export type ChatGPTTeamTrialFlowEvent =
  | 'machine.started'
  | 'chatgpt.login.started'
  | 'chatgpt.login.completed'
  | 'chatgpt.home.ready'
  | 'chatgpt.pricing.opening'
  | 'chatgpt.pricing.ready'
  | 'chatgpt.trial.claiming'
  | 'chatgpt.trial.claimed'
  | 'chatgpt.checkout.ready'
  | 'chatgpt.paypal_payment_method.selecting'
  | 'chatgpt.paypal_payment_method.selected'
  | 'chatgpt.billing_address.filling'
  | 'chatgpt.billing_address.filled'
  | 'chatgpt.subscription.submitting'
  | 'chatgpt.paypal_link.captured'
  | 'chatgpt.retry.requested'
  | 'chatgpt.completed'
  | 'chatgpt.failed'
  | 'context.updated'
  | 'action.started'
  | 'action.finished'

export interface ChatGPTTeamTrialFlowContext<Result = unknown> {
  kind: ChatGPTTeamTrialFlowKind
  url?: string
  title?: string
  email?: string
  login?: ChatGPTLoginFlowResult
  checkoutUrl?: string
  coupon?: ChatGPTTrialPromoCoupon
  trialPlan?: ChatGPTTrialPromoPlan
  couponState?: string
  billingCountry?: string
  paypalPaymentMethodSelected?: boolean
  billingAddressFilled?: boolean
  subscribeClicked?: boolean
  paypalBaTokenCaptured?: boolean
  paypalApprovalUrl?: string
  paypalApprovalUrlPath?: string
  retryCount?: number
  retryReason?: string
  retryFromState?: ChatGPTTeamTrialFlowState
  lastAttempt?: number
  lastMessage?: string
  result?: Result
}

export type ChatGPTTeamTrialFlowMachine<Result = unknown> =
  StateMachineController<
    ChatGPTTeamTrialFlowState,
    ChatGPTTeamTrialFlowContext<Result>,
    ChatGPTTeamTrialFlowEvent
  >

export type ChatGPTTeamTrialFlowSnapshot<Result = unknown> =
  StateMachineSnapshot<
    ChatGPTTeamTrialFlowState,
    ChatGPTTeamTrialFlowContext<Result>,
    ChatGPTTeamTrialFlowEvent
  >

export interface ChatGPTTeamTrialFlowResult {
  pageName: 'chatgpt-team-trial'
  url: string
  title: string
  email: string
  authenticated: boolean
  coupon: ChatGPTTrialPromoCoupon
  plan: ChatGPTTrialPromoPlan
  pricingUrl: string
  checkoutUrl: string
  trialClaimClicked: boolean
  billingAddressFilled: boolean
  subscribeClicked: boolean
  paypalBaTokenCaptured: boolean
  paypalApprovalUrl: string
  paypalApprovalUrlPath: string
  login: ChatGPTLoginFlowResult
  machine: ChatGPTTeamTrialFlowSnapshot<ChatGPTTeamTrialFlowResult>
}

export interface ChatGPTTeamTrialPostLoginResult {
  url: string
  title: string
  email: string
  authenticated: true
  coupon: ChatGPTTrialPromoCoupon
  plan: ChatGPTTrialPromoPlan
  pricingUrl: string
  checkoutUrl: string
  trialClaimClicked: true
  billingAddressFilled: true
  subscribeClicked: true
  paypalBaTokenCaptured: true
  paypalApprovalUrl: string
  paypalApprovalUrlPath: string
}

export type ChatGPTTrialPostLoginResult = ChatGPTTeamTrialPostLoginResult

export interface ChatGPTTeamTrialPostLoginOptions<Result = unknown> {
  email: string
  options?: FlowOptions
  machine?: ChatGPTTeamTrialFlowMachine<Result>
  storageStateIdentity?: {
    id: string
    email: string
  }
  storageStateFlowType?: string
}

const chatgptTeamTrialEventTargets = {
  'machine.started': 'idle',
  'chatgpt.login.started': 'logging-in',
  'chatgpt.login.completed': 'home-ready',
  'chatgpt.home.ready': 'home-ready',
  'chatgpt.pricing.opening': 'opening-pricing',
  'chatgpt.pricing.ready': 'pricing-ready',
  'chatgpt.trial.claiming': 'claiming-trial',
  'chatgpt.trial.claimed': 'trial-claimed',
  'chatgpt.checkout.ready': 'checkout-ready',
  'chatgpt.paypal_payment_method.selecting': 'selecting-paypal-payment-method',
  'chatgpt.paypal_payment_method.selected': 'paypal-payment-method-selected',
  'chatgpt.billing_address.filling': 'filling-billing-address',
  'chatgpt.billing_address.filled': 'billing-address-filled',
  'chatgpt.subscription.submitting': 'subscribing',
  'chatgpt.paypal_link.captured': 'paypal-link-captured',
  'chatgpt.completed': 'completed',
  'chatgpt.failed': 'failed',
} as const satisfies Partial<
  Record<ChatGPTTeamTrialFlowEvent, ChatGPTTeamTrialFlowState>
>

const chatgptTeamTrialMutableContextEvents = [
  'context.updated',
  'action.started',
  'action.finished',
] as const satisfies ChatGPTTeamTrialFlowEvent[]

const chatgptTeamTrialStates = [
  'idle',
  'logging-in',
  'home-ready',
  'opening-pricing',
  'pricing-ready',
  'claiming-trial',
  'trial-claimed',
  'checkout-ready',
  'selecting-paypal-payment-method',
  'paypal-payment-method-selected',
  'filling-billing-address',
  'billing-address-filled',
  'subscribing',
  'paypal-link-captured',
  'retrying',
  'completed',
  'failed',
] as const satisfies readonly ChatGPTTeamTrialFlowState[]

function createChatGPTTeamTrialLifecycleFragment<Result>() {
  return createFlowLifecycleFragment<
    ChatGPTTeamTrialFlowState,
    ChatGPTTeamTrialFlowContext<Result>,
    ChatGPTTeamTrialFlowEvent
  >({
    eventTargets: chatgptTeamTrialEventTargets,
    mutableContextEvents: chatgptTeamTrialMutableContextEvents,
    retryEvent: 'chatgpt.retry.requested',
    retryTarget: 'retrying',
    defaultRetryMessage: 'Retrying ChatGPT trial flow',
  })
}

export function createChatGPTTeamTrialMachine<
  Result = ChatGPTTeamTrialFlowResult,
>(): ChatGPTTeamTrialFlowMachine<Result> {
  return createStateMachine<
    ChatGPTTeamTrialFlowState,
    ChatGPTTeamTrialFlowContext<Result>,
    ChatGPTTeamTrialFlowEvent
  >(
    composeStateMachineConfig(
      {
        id: 'flow.chatgpt.team_trial',
        initialState: 'idle',
        initialContext: {
          kind: 'chatgpt-team-trial',
          url: CHATGPT_HOME_URL,
        },
        historyLimit: 200,
        states: declareStateMachineStates<
          ChatGPTTeamTrialFlowState,
          ChatGPTTeamTrialFlowContext<Result>,
          ChatGPTTeamTrialFlowEvent
        >(chatgptTeamTrialStates),
      },
      createChatGPTTeamTrialLifecycleFragment<Result>(),
    ),
  )
}

async function sendTeamTrialMachine<Result>(
  machine: ChatGPTTeamTrialFlowMachine<Result>,
  state: ChatGPTTeamTrialFlowState,
  event: ChatGPTTeamTrialFlowEvent,
  patch?: Partial<ChatGPTTeamTrialFlowContext<Result>>,
): Promise<void> {
  await machine.send(event, {
    target: state,
    patch,
  })
}

function nonEmptyString(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

export function resolveChatGPTTeamTrialBillingAddress(
  options: FlowOptions = {},
): ChatGPTTeamTrialBillingAddress {
  const config = getRuntimeConfig().chatgptTeamTrial?.billingAddress

  return {
    name:
      nonEmptyString(options.billingName) ||
      nonEmptyString(config?.name) ||
      DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME,
    country:
      nonEmptyString(options.billingCountry) ||
      nonEmptyString(config?.country) ||
      DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_ADDRESS.country,
    line1:
      nonEmptyString(options.billingAddressLine1) ||
      nonEmptyString(config?.line1) ||
      DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_ADDRESS.line1,
    line2:
      nonEmptyString(options.billingAddressLine2) ||
      nonEmptyString(config?.line2) ||
      DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_ADDRESS.line2,
    city:
      nonEmptyString(options.billingCity) ||
      nonEmptyString(config?.city) ||
      DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_ADDRESS.city,
    state:
      nonEmptyString(options.billingState) ||
      nonEmptyString(config?.state) ||
      DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_ADDRESS.state,
    postalCode:
      nonEmptyString(options.billingPostalCode) ||
      nonEmptyString(config?.postalCode) ||
      DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_ADDRESS.postalCode,
  }
}

function formatArtifactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

function savePaypalApprovalUrl(url: string): string {
  const runtimeConfig = getRuntimeConfig()
  const filePath = path.join(
    runtimeConfig.artifactsDir,
    `${formatArtifactTimestamp()}-chatgpt-team-trial-paypal-link.txt`,
  )
  writeFileAtomic(filePath, `${url}\n`)
  return filePath
}

function formatTrialCouponChecks(
  checked: Array<{
    coupon: ChatGPTTrialPromoCoupon
    state?: string
    status: number
    error?: string
  }>,
): string {
  if (checked.length === 0) {
    return 'no coupons were checked'
  }

  return checked
    .map((check) => {
      const state =
        check.state || (check.status > 0 ? `HTTP ${check.status}` : 'failed')
      return `${check.coupon}: ${state}${check.error ? ` (${check.error})` : ''}`
    })
    .join('; ')
}

export async function completeChatGPTTeamTrialAfterAuthenticatedSession<
  Result = unknown,
>(
  page: Page,
  input: ChatGPTTeamTrialPostLoginOptions<Result>,
): Promise<ChatGPTTeamTrialPostLoginResult> {
  const options = input.options ?? {}
  const email = input.email
  const machine = input.machine

  const authenticated = await waitForAuthenticatedSession(page, 30000)
  if (!authenticated) {
    throw new Error(
      'ChatGPT trial flow lost the authenticated session before checkout.',
    )
  }

  if (machine) {
    await sendTeamTrialMachine(machine, 'home-ready', 'chatgpt.home.ready', {
      email,
      url: page.url(),
      lastMessage: 'Authenticated ChatGPT home is ready',
    })
  }

  if (machine) {
    await machine.send('context.updated', {
      patch: {
        email,
        url: page.url(),
        lastMessage: 'Checking ChatGPT trial coupon eligibility',
      },
    })
  }
  const couponSelection = await selectEligibleChatGPTTrialPromoCoupon(page)
  const selectedCoupon = couponSelection.selected?.coupon
  if (!selectedCoupon) {
    throw new Error(
      `No eligible ChatGPT trial coupon was found (${formatTrialCouponChecks(couponSelection.checked)}).`,
    )
  }
  const selectedPlan = getChatGPTTrialPromoPlan(selectedCoupon)
  const selectedCouponState = couponSelection.selected?.state
  const pricingUrl = buildChatGPTTrialPricingPromoUrl(selectedCoupon)
  options.progressReporter?.({
    message: `Selected ChatGPT ${selectedPlan} trial coupon ${selectedCoupon}`,
  })

  if (machine) {
    await machine.send('context.updated', {
      patch: {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        couponState: selectedCouponState,
        url: page.url(),
        lastMessage: `Selected ChatGPT ${selectedPlan} trial coupon ${selectedCoupon}`,
      },
    })
  }

  if (machine) {
    await sendTeamTrialMachine(
      machine,
      'opening-pricing',
      'chatgpt.pricing.opening',
      {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        couponState: selectedCouponState,
        url: pricingUrl,
        lastMessage: `Opening ChatGPT ${selectedPlan} pricing promo`,
      },
    )
  }
  await gotoTrialPricingPromo(page, selectedCoupon)

  const pricingReady = await waitForTrialPricingFreeTrialReady(
    page,
    selectedCoupon,
    30000,
  )
  if (!pricingReady) {
    throw new Error(
      `ChatGPT ${selectedPlan} pricing free trial button was not visible.`,
    )
  }

  if (machine) {
    await sendTeamTrialMachine(
      machine,
      'pricing-ready',
      'chatgpt.pricing.ready',
      {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        couponState: selectedCouponState,
        url: page.url(),
        lastMessage: `ChatGPT ${selectedPlan} pricing free trial button is ready`,
      },
    )
  }

  if (machine) {
    await sendTeamTrialMachine(
      machine,
      'claiming-trial',
      'chatgpt.trial.claiming',
      {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        url: page.url(),
        lastMessage: `Clicking ChatGPT ${selectedPlan} free trial button`,
      },
    )
  }
  await clickTrialPricingFreeTrial(page, selectedCoupon)
  const trialClaimTitle = await page.title()

  if (input.storageStateIdentity) {
    try {
      await saveLocalChatGPTStorageState(page, {
        identityId: input.storageStateIdentity.id,
        email: input.storageStateIdentity.email,
        flowType: input.storageStateFlowType || 'chatgpt-team-trial',
      })
      options.progressReporter?.({
        message: `Saved local ChatGPT storage state for ${input.storageStateIdentity.email}`,
      })
    } catch (error) {
      options.progressReporter?.({
        message: `Local ChatGPT storage state save failed: ${sanitizeErrorForOutput(error).message}`,
      })
    }
  }

  if (machine) {
    await sendTeamTrialMachine(
      machine,
      'trial-claimed',
      'chatgpt.trial.claimed',
      {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        url: page.url(),
        title: trialClaimTitle,
        lastMessage: `ChatGPT ${selectedPlan} free trial button clicked`,
      },
    )
  }

  const checkoutReady = await waitForChatGPTCheckoutReady(page, 60000)
  if (!checkoutReady) {
    throw new Error(
      `ChatGPT ${selectedPlan} trial checkout did not become ready.`,
    )
  }

  const checkoutUrl = page.url()
  const checkoutTitle = await page.title()

  if (machine) {
    await sendTeamTrialMachine(
      machine,
      'checkout-ready',
      'chatgpt.checkout.ready',
      {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        url: checkoutUrl,
        checkoutUrl,
        title: checkoutTitle,
        lastMessage: `ChatGPT ${selectedPlan} checkout is ready`,
      },
    )
  }

  const billingAddress = resolveChatGPTTeamTrialBillingAddress(options)

  if (machine) {
    await sendTeamTrialMachine(
      machine,
      'selecting-paypal-payment-method',
      'chatgpt.paypal_payment_method.selecting',
      {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        url: checkoutUrl,
        checkoutUrl,
        lastMessage:
          'Selecting PayPal payment method before filling billing address',
      },
    )
  }
  const paypalPaymentMethodSelected =
    await selectChatGPTCheckoutPaypalPaymentMethodIfPresent(page, {
      timeoutMs: 30000,
    })
  if (!paypalPaymentMethodSelected) {
    throw new Error(
      'ChatGPT checkout PayPal payment method was not visible before billing address.',
    )
  }

  if (machine) {
    await sendTeamTrialMachine(
      machine,
      'paypal-payment-method-selected',
      'chatgpt.paypal_payment_method.selected',
      {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        url: page.url(),
        checkoutUrl,
        paypalPaymentMethodSelected: true,
        lastMessage: 'ChatGPT checkout PayPal payment method selected',
      },
    )
  }

  if (machine) {
    await sendTeamTrialMachine(
      machine,
      'filling-billing-address',
      'chatgpt.billing_address.filling',
      {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        url: checkoutUrl,
        checkoutUrl,
        billingCountry: billingAddress.country,
        paypalPaymentMethodSelected: true,
        lastMessage: 'Filling ChatGPT checkout billing address',
      },
    )
  }
  await fillChatGPTCheckoutBillingAddress(page, billingAddress)

  if (machine) {
    await sendTeamTrialMachine(
      machine,
      'billing-address-filled',
      'chatgpt.billing_address.filled',
      {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        url: page.url(),
        checkoutUrl,
        billingCountry: billingAddress.country,
        billingAddressFilled: true,
        lastMessage: 'ChatGPT checkout billing address filled',
      },
    )
  }

  if (machine) {
    await sendTeamTrialMachine(
      machine,
      'subscribing',
      'chatgpt.subscription.submitting',
      {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        url: page.url(),
        checkoutUrl,
        billingAddressFilled: true,
        lastMessage: `Submitting ChatGPT ${selectedPlan} trial subscription`,
      },
    )
  }
  const paypalApproval =
    await clickChatGPTCheckoutSubscribeAndCapturePaypalLink(page)
  const paypalApprovalUrlPath = savePaypalApprovalUrl(paypalApproval.url)

  if (machine) {
    await sendTeamTrialMachine(
      machine,
      'paypal-link-captured',
      'chatgpt.paypal_link.captured',
      {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        url: page.url(),
        checkoutUrl,
        billingAddressFilled: true,
        subscribeClicked: true,
        paypalBaTokenCaptured: true,
        paypalApprovalUrl: paypalApproval.url,
        paypalApprovalUrlPath,
        lastMessage: `Captured PayPal billing agreement link: ${paypalApproval.url}`,
      },
    )
  }

  const title = await page.title()
  return {
    url: page.url(),
    title,
    email,
    authenticated: true,
    coupon: selectedCoupon,
    plan: selectedPlan,
    pricingUrl,
    checkoutUrl,
    trialClaimClicked: true,
    billingAddressFilled: true,
    subscribeClicked: true,
    paypalBaTokenCaptured: true,
    paypalApprovalUrl: paypalApproval.url,
    paypalApprovalUrlPath,
  }
}

export const completeChatGPTTrialAfterAuthenticatedSession =
  completeChatGPTTeamTrialAfterAuthenticatedSession

export async function runChatGPTTeamTrial(
  page: Page,
  options: FlowOptions = {},
): Promise<ChatGPTTeamTrialFlowResult> {
  const machine = createChatGPTTeamTrialMachine()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )
  let completedLogin: ChatGPTLoginFlowResult | undefined

  try {
    machine.start(
      {
        url: CHATGPT_HOME_URL,
        lastMessage: 'Starting ChatGPT trial flow',
      },
      {
        source: 'runChatGPTTeamTrial',
      },
    )

    await sendTeamTrialMachine(machine, 'logging-in', 'chatgpt.login.started', {
      url: page.url(),
      lastMessage: 'Logging in before opening pricing promo',
    })
    const login = await loginChatGPT(page, options)
    completedLogin = login

    await sendTeamTrialMachine(
      machine,
      'home-ready',
      'chatgpt.login.completed',
      {
        email: login.email,
        login,
        url: login.url,
        title: login.title,
        lastMessage: 'ChatGPT login completed',
      },
    )

    const postLoginResult =
      await completeChatGPTTeamTrialAfterAuthenticatedSession(page, {
        email: login.email,
        options,
        machine,
        storageStateIdentity: login.storedIdentity,
        storageStateFlowType: 'chatgpt-team-trial',
      })
    const result = {
      pageName: 'chatgpt-team-trial' as const,
      ...postLoginResult,
      login,
      machine:
        undefined as unknown as ChatGPTTeamTrialFlowSnapshot<ChatGPTTeamTrialFlowResult>,
    }

    const snapshot = machine.succeed('completed', {
      event: 'chatgpt.completed',
      patch: {
        email: login.email,
        login,
        url: result.url,
        title: result.title,
        checkoutUrl: result.checkoutUrl,
        coupon: result.coupon,
        trialPlan: result.plan,
        billingAddressFilled: true,
        subscribeClicked: true,
        paypalBaTokenCaptured: true,
        paypalApprovalUrl: result.paypalApprovalUrl,
        paypalApprovalUrlPath: result.paypalApprovalUrlPath,
        result,
        lastMessage: 'ChatGPT trial checkout flow completed',
      },
    })
    result.machine = snapshot
    return result
  } catch (error) {
    const message = sanitizeErrorForOutput(error).message
    await reportChatGPTAccountDeactivationToCodeyApp({
      error,
      identity: completedLogin?.storedIdentity,
      progressReporter: options.progressReporter,
    })
    machine.fail(error, 'failed', {
      event: 'chatgpt.failed',
      patch: {
        url: page.url(),
        lastMessage: message,
      },
    })
    throw error
  } finally {
    detachProgress()
  }
}

export const chatgptTeamTrialFlow: SingleFileFlowDefinition<
  FlowOptions,
  ChatGPTTeamTrialFlowResult
> = {
  command: 'flow:chatgpt-team-trial',
  run: runChatGPTTeamTrial,
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runSingleFileFlowFromCommandLine('chatgpt-team-trial', chatgptTeamTrialFlow)
}
