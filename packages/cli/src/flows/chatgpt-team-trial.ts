import type { Page } from 'patchright'
import path from 'path'
import { pathToFileURL } from 'url'
import {
  assignContextFromInput,
  composeStateMachineConfig,
  createStateMachine,
  defineStateMachineFragment,
  isStateMachinePatchInput,
  type StateMachineConfig,
  type StateMachineController,
  type StateMachineFragment,
  type StateMachinePatchInput,
  type StateMachineSnapshot,
  type StateMachineTransitionDefinition,
} from '../state-machine'
import { createFlowLifecycleFragment } from './machine-fragments'
import {
  CHATGPT_GOPAY_PRICING_REGION,
  CHATGPT_HOME_URL,
  DEFAULT_CHATGPT_TRIAL_PAYMENT_METHOD,
  buildChatGPTTrialPricingPromoUrl,
  clickChatGPTCheckoutSubscribeAndCapturePaymentLink,
  clickTrialPricingFreeTrial,
  continueGoPayPaymentFromRedirect,
  createChatGPTTrialCheckoutLink,
  createChatGPTBackendApiHeadersCapture,
  extractGoPayPaymentRedirectLink,
  fillChatGPTCheckoutBillingAddress,
  getChatGPTTrialPromoPlan,
  gotoTrialPricingPromo,
  normalizeChatGPTTrialPaymentMethod,
  selectChatGPTCheckoutPaymentMethodIfPresent,
  selectChatGPTTrialPricingPlanIfPresent,
  selectEligibleChatGPTTrialPromoCoupon,
  type ChatGPTBackendApiHeadersCapture,
  type ChatGPTTeamTrialBillingAddress,
  type ChatGPTTrialPromoCoupon,
  type ChatGPTTrialPaymentMethod,
  type ChatGPTTrialPromoPlan,
  type GoPayAccountLinkingOptions,
  type GoPayPaymentRedirectLink,
  type GoPayPaymentContinuationResult,
  waitForAuthenticatedSession,
  waitForChatGPTCheckoutReady,
  waitForTrialPricingFreeTrialReady,
} from '../modules/chatgpt/shared'
import { getRuntimeConfig } from '../config'
import type { FlowOptions } from '../modules/flow-cli/helpers'
import {
  attachStateMachineProgressReporter,
  parseNumberFlag,
  sanitizeErrorForOutput,
} from '../modules/flow-cli/helpers'
import { resolveAppBaseUrl } from '../modules/app-auth/http'
import {
  AppVerificationProviderClient,
  resolveVerificationAppConfig,
} from '../modules/verification'
import { saveLocalChatGPTStorageState } from '../modules/chatgpt/storage-state'
import {
  runSingleFileFlowFromCommandLine,
  type SingleFileFlowDefinition,
} from '../modules/flow-cli/single-file'
import { writeFileAtomic } from '../utils/fs'
import { loginChatGPT, type ChatGPTLoginFlowResult } from './chatgpt-login'
import { reportChatGPTAccountDeactivationToCodeyApp } from '../modules/chatgpt/account-deactivation'
import {
  unlinkGoPayLinkedApps,
  type GoPayAndroidUnlinkResult,
} from '../modules/gopay/android-unlink'
import {
  selectCodeySingBoxProxyConfig,
  type CodeySingBoxStateProxyConfig,
} from '../modules/proxy/sing-box'

export const DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME = 'Summpot'

export const DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_ADDRESS = {
  name: DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME,
  country: 'SG',
  line1: '32 Penjuru Place',
  line2: 'Jurong East',
  city: 'Singapore',
  state: undefined,
  postalCode: '608560',
} as const satisfies ChatGPTTeamTrialBillingAddress

export const CHATGPT_TEAM_TRIAL_GOPAY_CHECKOUT_PROXY_TAGS = [
  'japan',
  '日本',
  'jp',
]
export const CHATGPT_TEAM_TRIAL_GOPAY_PAYMENT_PROXY_TAGS = [
  'singapore',
  '新加坡',
  'sg',
]

export type ChatGPTTeamTrialFlowKind = 'chatgpt-team-trial'

export type ChatGPTTeamTrialFlowState =
  | 'idle'
  | 'logging-in'
  | 'home-ready'
  | 'opening-pricing'
  | 'pricing-ready'
  | 'claiming-trial'
  | 'trial-claimed'
  | 'creating-checkout'
  | 'checkout-ready'
  | 'selecting-paypal-payment-method'
  | 'paypal-payment-method-selected'
  | 'filling-billing-address'
  | 'billing-address-filled'
  | 'subscribing'
  | 'paypal-link-captured'
  | 'gopay-linking'
  | 'gopay-authorizing'
  | 'gopay-payment-ready'
  | 'gopay-payment-submitted'
  | 'retrying'
  | 'completed'
  | 'failed'

export type ChatGPTTeamTrialGoPayUnlinkStatus =
  | 'disabled'
  | 'running'
  | 'waiting'
  | 'already-unlinked'
  | 'unlinked'
  | 'failed'

export type ChatGPTTeamTrialGoPayUnlinkRegionState =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'disabled'

export type ChatGPTTeamTrialFlowEvent =
  | 'machine.started'
  | 'chatgpt.login.started'
  | 'chatgpt.login.completed'
  | 'chatgpt.home.ready'
  | 'chatgpt.pricing.opening'
  | 'chatgpt.pricing.ready'
  | 'chatgpt.trial.claiming'
  | 'chatgpt.trial.claimed'
  | 'chatgpt.checkout.creating'
  | 'chatgpt.checkout.ready'
  | 'chatgpt.paypal_payment_method.selecting'
  | 'chatgpt.paypal_payment_method.selected'
  | 'chatgpt.billing_address.filling'
  | 'chatgpt.billing_address.filled'
  | 'chatgpt.subscription.submitting'
  | 'chatgpt.paypal_link.captured'
  | 'chatgpt.gopay.linking'
  | 'chatgpt.gopay.authorizing'
  | 'chatgpt.gopay.payment_ready'
  | 'chatgpt.gopay.payment_submitted'
  | 'chatgpt.gopay_unlink.started'
  | 'chatgpt.gopay_unlink.waiting'
  | 'chatgpt.gopay_unlink.completed'
  | 'chatgpt.gopay_unlink.failed'
  | 'chatgpt.gopay_unlink.disabled'
  | 'chatgpt.proxy.selecting'
  | 'chatgpt.proxy.selected'
  | 'chatgpt.proxy.unavailable'
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
  paymentMethod?: ChatGPTTrialPaymentMethod
  pricingRegion?: string
  billingCountry?: string
  paymentMethodSelected?: boolean
  paypalPaymentMethodSelected?: boolean
  billingAddressFilled?: boolean
  subscribeClicked?: boolean
  paypalBaTokenCaptured?: boolean
  paymentRedirectUrl?: string
  paymentRedirectUrlPath?: string
  paypalApprovalUrl?: string
  paypalApprovalUrlPath?: string
  gopayActivationLinkUrl?: string
  gopayStatus?: string
  gopayAuthorizationConsentClicked?: boolean
  gopayOtpSubmitted?: boolean
  gopayPinSubmitted?: boolean
  gopayPayNowClicked?: boolean
  gopayFinalUrl?: string
  gopayUnlinkStatus?: ChatGPTTeamTrialGoPayUnlinkStatus
  gopayUnlinkStarted?: boolean
  gopayUnlinkCompleted?: boolean
  gopayUnlinkAppiumSessionId?: string
  gopayUnlinkError?: string
  proxyTag?: string
  proxySelectionStatus?: 'selected' | 'unavailable'
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
  paymentMethod: ChatGPTTrialPaymentMethod
  pricingUrl: string
  checkoutUrl: string
  trialClaimClicked: boolean
  paymentMethodSelected: boolean
  billingAddressFilled: boolean
  subscribeClicked: boolean
  paypalBaTokenCaptured: boolean
  paymentRedirectUrl: string
  paymentRedirectUrlPath: string
  paypalApprovalUrl: string
  paypalApprovalUrlPath: string
  gopayPayment?: GoPayPaymentContinuationResult
  gopayUnlink?: GoPayAndroidUnlinkResult
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
  paymentMethod: ChatGPTTrialPaymentMethod
  pricingUrl: string
  checkoutUrl: string
  trialClaimClicked: boolean
  paymentMethodSelected: true
  billingAddressFilled: true
  subscribeClicked: true
  paypalBaTokenCaptured: boolean
  paymentRedirectUrl: string
  paymentRedirectUrlPath: string
  paypalApprovalUrl: string
  paypalApprovalUrlPath: string
  gopayPayment?: GoPayPaymentContinuationResult
  gopayUnlink?: GoPayAndroidUnlinkResult
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
  backendApiHeadersCapture?: ChatGPTBackendApiHeadersCapture
  paymentMethod?: ChatGPTTrialPaymentMethod
  gopayUnlinkTask?: ChatGPTTeamTrialGoPayUnlinkTask | false
  continueGoPayPayment?: boolean
}

export interface ChatGPTTeamTrialGoPayUnlinkTask {
  readonly status: GoPayUnlinkTaskStatus
  wait(): Promise<GoPayAndroidUnlinkResult>
}

export interface ChatGPTTeamTrialGoPayFlowResult {
  pageName: 'chatgpt-team-trial-gopay'
  url: string
  title: string
  paymentMethod: 'gopay'
  paymentRedirectUrl: string
  paypalApprovalUrl: string
  gopayPayment: GoPayPaymentContinuationResult
  gopayUnlink?: GoPayAndroidUnlinkResult
  machine: ChatGPTTeamTrialFlowSnapshot<ChatGPTTeamTrialGoPayFlowResult>
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
  'chatgpt.checkout.creating': 'creating-checkout',
  'chatgpt.checkout.ready': 'checkout-ready',
  'chatgpt.paypal_payment_method.selecting': 'selecting-paypal-payment-method',
  'chatgpt.paypal_payment_method.selected': 'paypal-payment-method-selected',
  'chatgpt.billing_address.filling': 'filling-billing-address',
  'chatgpt.billing_address.filled': 'billing-address-filled',
  'chatgpt.subscription.submitting': 'subscribing',
  'chatgpt.paypal_link.captured': 'paypal-link-captured',
  'chatgpt.gopay.linking': 'gopay-linking',
  'chatgpt.gopay.authorizing': 'gopay-authorizing',
  'chatgpt.gopay.payment_ready': 'gopay-payment-ready',
  'chatgpt.gopay.payment_submitted': 'gopay-payment-submitted',
  'chatgpt.completed': 'completed',
  'chatgpt.failed': 'failed',
} as const satisfies Partial<
  Record<ChatGPTTeamTrialFlowEvent, ChatGPTTeamTrialFlowState>
>

const chatgptTeamTrialMutableContextEvents = [
  'context.updated',
  'action.started',
  'action.finished',
  'chatgpt.proxy.selecting',
  'chatgpt.proxy.selected',
  'chatgpt.proxy.unavailable',
] as const satisfies ChatGPTTeamTrialFlowEvent[]

const chatgptTeamTrialGoPayUnlinkEventTargets = {
  'chatgpt.gopay_unlink.started': 'running',
  'chatgpt.gopay_unlink.waiting': 'waiting',
  'chatgpt.gopay_unlink.completed': 'completed',
  'chatgpt.gopay_unlink.failed': 'failed',
  'chatgpt.gopay_unlink.disabled': 'disabled',
} as const satisfies Partial<
  Record<ChatGPTTeamTrialFlowEvent, ChatGPTTeamTrialGoPayUnlinkRegionState>
>

type ChatGPTTeamTrialStateDefinition = {
  meta?: Record<string, unknown> & {
    proxy?: CodeySingBoxStateProxyConfig
  }
}

function defineChatGPTTeamTrialStates<
  const States extends {
    [State in ChatGPTTeamTrialFlowState]: ChatGPTTeamTrialStateDefinition
  },
>(states: States): States {
  return states
}

const chatgptTeamTrialPaymentProxyConfig = {
  label: 'singapore',
  tags: CHATGPT_TEAM_TRIAL_GOPAY_PAYMENT_PROXY_TAGS,
} as const satisfies CodeySingBoxStateProxyConfig

export const chatgptTeamTrialStates = defineChatGPTTeamTrialStates({
  idle: {},
  'logging-in': {},
  'home-ready': {},
  'opening-pricing': {},
  'pricing-ready': {},
  'claiming-trial': {},
  'trial-claimed': {},
  'creating-checkout': {
    meta: {
      proxy: {
        label: 'japan',
        tags: CHATGPT_TEAM_TRIAL_GOPAY_CHECKOUT_PROXY_TAGS,
      },
    },
  },
  'checkout-ready': { meta: { proxy: chatgptTeamTrialPaymentProxyConfig } },
  'selecting-paypal-payment-method': {
    meta: { proxy: chatgptTeamTrialPaymentProxyConfig },
  },
  'paypal-payment-method-selected': {
    meta: { proxy: chatgptTeamTrialPaymentProxyConfig },
  },
  'filling-billing-address': {
    meta: { proxy: chatgptTeamTrialPaymentProxyConfig },
  },
  'billing-address-filled': {
    meta: { proxy: chatgptTeamTrialPaymentProxyConfig },
  },
  subscribing: {
    meta: { proxy: chatgptTeamTrialPaymentProxyConfig },
  },
  'paypal-link-captured': {
    meta: { proxy: chatgptTeamTrialPaymentProxyConfig },
  },
  'gopay-linking': { meta: { proxy: chatgptTeamTrialPaymentProxyConfig } },
  'gopay-authorizing': { meta: { proxy: chatgptTeamTrialPaymentProxyConfig } },
  'gopay-payment-ready': {
    meta: { proxy: chatgptTeamTrialPaymentProxyConfig },
  },
  'gopay-payment-submitted': {
    meta: { proxy: chatgptTeamTrialPaymentProxyConfig },
  },
  retrying: {},
  completed: {},
  failed: {},
})

function createChatGPTTeamTrialStateConfigs<Result>(): NonNullable<
  StateMachineConfig<
    ChatGPTTeamTrialFlowState,
    ChatGPTTeamTrialFlowContext<Result>,
    ChatGPTTeamTrialFlowEvent
  >['states']
> {
  return chatgptTeamTrialStates
}

export function getChatGPTTeamTrialStateProxyConfig(
  state: ChatGPTTeamTrialFlowState,
): CodeySingBoxStateProxyConfig | undefined {
  const stateDefinition: ChatGPTTeamTrialStateDefinition =
    chatgptTeamTrialStates[state]
  return stateDefinition.meta?.proxy
}

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

function createChatGPTTeamTrialGoPayUnlinkRegionFragment<
  Result,
>(): StateMachineFragment<
  ChatGPTTeamTrialFlowState,
  ChatGPTTeamTrialFlowContext<Result>,
  ChatGPTTeamTrialFlowEvent
> {
  return defineStateMachineFragment<
    ChatGPTTeamTrialFlowState,
    ChatGPTTeamTrialFlowContext<Result>,
    ChatGPTTeamTrialFlowEvent
  >({
    regions: {
      gopayUnlink: {
        initialState: 'idle',
        on: createGoPayUnlinkRegionTransitionMap<Result>(
          chatgptTeamTrialGoPayUnlinkEventTargets,
        ),
      },
    },
  })
}

function createGoPayUnlinkRegionTransitionMap<Result>(
  targets: Partial<
    Record<ChatGPTTeamTrialFlowEvent, ChatGPTTeamTrialGoPayUnlinkRegionState>
  >,
): Partial<
  Record<
    ChatGPTTeamTrialFlowEvent,
    StateMachineTransitionDefinition<
      string,
      ChatGPTTeamTrialFlowContext<Result>,
      ChatGPTTeamTrialFlowEvent
    >
  >
> {
  const transitions: Partial<
    Record<
      ChatGPTTeamTrialFlowEvent,
      StateMachineTransitionDefinition<
        string,
        ChatGPTTeamTrialFlowContext<Result>,
        ChatGPTTeamTrialFlowEvent
      >
    >
  > = {}

  for (const [event, target] of Object.entries(targets) as Array<
    [ChatGPTTeamTrialFlowEvent, ChatGPTTeamTrialGoPayUnlinkRegionState]
  >) {
    transitions[event] = {
      target,
      actions: assignContextFromInput<
        string,
        ChatGPTTeamTrialFlowContext<Result>,
        ChatGPTTeamTrialFlowEvent,
        StateMachinePatchInput<string, ChatGPTTeamTrialFlowContext<Result>>
      >(isStateMachinePatchInput, (_context, { input }) => input.patch ?? {}),
    }
  }

  return transitions
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
        states: createChatGPTTeamTrialStateConfigs<Result>(),
      },
      createChatGPTTeamTrialLifecycleFragment<Result>(),
      createChatGPTTeamTrialGoPayUnlinkRegionFragment<Result>(),
    ),
  )
}

async function sendTeamTrialMachine<Result>(
  machine: ChatGPTTeamTrialFlowMachine<Result>,
  event: ChatGPTTeamTrialFlowEvent,
  patch?: Partial<ChatGPTTeamTrialFlowContext<Result>>,
): Promise<void> {
  const snapshot = await machine.send(event, {
    patch,
  })
  await applyChatGPTTeamTrialStateProxyConfig(snapshot.state, {
    machine,
    paymentMethod: patch?.paymentMethod,
  })
}

async function patchTeamTrialMachine<Result>(
  machine: ChatGPTTeamTrialFlowMachine<Result>,
  event: ChatGPTTeamTrialFlowEvent,
  patch?: Partial<ChatGPTTeamTrialFlowContext<Result>>,
): Promise<void> {
  await machine.send(event, {
    patch,
  })
}

export async function applyChatGPTTeamTrialStateProxyConfig<Result>(
  state: ChatGPTTeamTrialFlowState,
  input: {
    paymentMethod?: ChatGPTTrialPaymentMethod
    machine?: ChatGPTTeamTrialFlowMachine<Result>
    options?: FlowOptions
    patch?: Partial<ChatGPTTeamTrialFlowContext<Result>>
  } = {},
): Promise<boolean> {
  const paymentMethod =
    input.paymentMethod ||
    input.patch?.paymentMethod ||
    input.machine?.getSnapshot().context.paymentMethod
  if (paymentMethod !== 'gopay') {
    return false
  }

  const proxyConfig = getChatGPTTeamTrialStateProxyConfig(state)
  if (!proxyConfig) {
    return false
  }

  input.options?.progressReporter?.({
    message: `Selecting Codey proxy tag ${proxyConfig.label}`,
  })
  if (input.machine) {
    await patchTeamTrialMachine(input.machine, 'chatgpt.proxy.selecting', {
      ...input.patch,
      proxyTag: proxyConfig.label,
      lastMessage: `Selecting Codey proxy tag ${proxyConfig.label}`,
    })
  }

  const result = await selectCodeySingBoxProxyConfig(proxyConfig)
  const proxyTag = result.selectedTag || proxyConfig.label
  const selectedMessage = result.changed
    ? `Codey proxy tag ${proxyTag} selected`
    : `Codey proxy tag ${proxyTag} already selected`
  const unavailableMessage =
    result.unavailableMessage ||
    `Codey proxy tag ${proxyConfig.label} is not available`

  if (input.machine) {
    await patchTeamTrialMachine(
      input.machine,
      result.selected ? 'chatgpt.proxy.selected' : 'chatgpt.proxy.unavailable',
      {
        ...input.patch,
        proxyTag,
        proxySelectionStatus: result.selected ? 'selected' : 'unavailable',
        lastMessage: result.selected ? selectedMessage : unavailableMessage,
      },
    )
  }

  input.options?.progressReporter?.({
    message: result.selected ? selectedMessage : unavailableMessage,
  })

  return result.selected
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

export function resolveChatGPTTeamTrialGoPayAccount(): GoPayAccountLinkingOptions {
  const config = getRuntimeConfig().chatgptTeamTrial?.gopay

  return {
    countryCode: nonEmptyString(config?.countryCode),
    phoneNumber: nonEmptyString(config?.phoneNumber),
    pin: nonEmptyString(config?.pin),
    authorizationTimeoutMs: config?.authorizationTimeoutMs,
  }
}

function createChatGPTTeamTrialGoPayOtpCodeProvider(
  options: FlowOptions = {},
): GoPayAccountLinkingOptions['waitForOtpCode'] {
  const config = getRuntimeConfig()
  const appConfig = resolveVerificationAppConfig(config)
  const appClient = new AppVerificationProviderClient({
    ...appConfig,
    baseUrl: appConfig.baseUrl || resolveAppBaseUrl(),
  })
  const pollIntervalMs = parseNumberFlag(options.pollIntervalMs, 5000) ?? 5000

  return async ({ startedAt, timeoutMs }) =>
    appClient.waitForWhatsAppVerificationCode({
      startedAt,
      timeoutMs,
      pollIntervalMs,
      onPollAttempt(attempt) {
        options.progressReporter?.({
          message: 'Polling Codey app for GoPay WhatsApp OTP',
          attempt,
        })
      },
    })
}

export interface ChatGPTTeamTrialGoPayUnlinkOptions {
  enabled: boolean
  timeoutMs?: number
}

export function resolveChatGPTTeamTrialGoPayUnlinkOptions(): ChatGPTTeamTrialGoPayUnlinkOptions {
  const config = getRuntimeConfig().chatgptTeamTrial?.gopay

  return {
    enabled: config?.unlinkBeforeLink ?? true,
    timeoutMs: config?.unlinkTimeoutMs,
  }
}

type GoPayUnlinkTaskOutcome =
  | {
      ok: true
      result: GoPayAndroidUnlinkResult
    }
  | {
      ok: false
      error: unknown
    }

type GoPayUnlinkTaskStatus = 'pending' | 'resolved' | 'failed'

export function startChatGPTTeamTrialGoPayUnlinkTask(
  options: FlowOptions = {},
): ChatGPTTeamTrialGoPayUnlinkTask | undefined {
  const unlinkOptions = resolveChatGPTTeamTrialGoPayUnlinkOptions()
  if (!unlinkOptions.enabled) {
    options.progressReporter?.({
      message: 'GoPay unlink task is disabled',
    })
    return undefined
  }

  options.progressReporter?.({
    message: 'Starting GoPay unlink task in Appium',
  })

  let status: GoPayUnlinkTaskStatus = 'pending'
  const outcome: Promise<GoPayUnlinkTaskOutcome> = unlinkGoPayLinkedApps({
    timeoutMs: unlinkOptions.timeoutMs,
    onProgress(update) {
      options.progressReporter?.({
        message: update.message,
      })
    },
  }).then(
    (result) => {
      status = 'resolved'
      return {
        ok: true as const,
        result,
      }
    },
    (error) => {
      status = 'failed'
      return {
        ok: false as const,
        error,
      }
    },
  )

  return {
    get status() {
      return status
    },
    async wait() {
      const settled = await outcome
      if (settled.ok) {
        return settled.result
      }
      throw settled.error
    },
  }
}

function formatArtifactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

function formatTrialPaymentMethod(
  paymentMethod: ChatGPTTrialPaymentMethod,
): string {
  return paymentMethod === 'gopay' ? 'GoPay' : 'PayPal'
}

export async function selectGoPayProxyTag<Result>(
  tags: readonly string[],
  label: string,
  input: {
    options: FlowOptions
    machine?: ChatGPTTeamTrialFlowMachine<Result>
    patch?: Partial<ChatGPTTeamTrialFlowContext<Result>>
  },
): Promise<boolean> {
  const proxyConfig = {
    label,
    tags,
  } satisfies CodeySingBoxStateProxyConfig
  input.options.progressReporter?.({
    message: `Selecting Codey proxy tag ${label}`,
  })
  if (input.machine) {
    await patchTeamTrialMachine(input.machine, 'chatgpt.proxy.selecting', {
      ...input.patch,
      proxyTag: label,
      lastMessage: `Selecting Codey proxy tag ${label}`,
    })
  }

  const result = await selectCodeySingBoxProxyConfig(proxyConfig)
  const proxyTag = result.selectedTag || label
  const unavailableMessage =
    result.unavailableMessage || `Codey proxy tag ${label} is not available`
  const selectedMessage = result.changed
    ? `Codey proxy tag ${proxyTag} selected`
    : `Codey proxy tag ${proxyTag} already selected`

  if (input.machine) {
    await patchTeamTrialMachine(
      input.machine,
      result.selected ? 'chatgpt.proxy.selected' : 'chatgpt.proxy.unavailable',
      {
        ...input.patch,
        proxyTag,
        proxySelectionStatus: result.selected ? 'selected' : 'unavailable',
        lastMessage: result.selected ? selectedMessage : unavailableMessage,
      },
    )
  }

  input.options.progressReporter?.({
    message: result.selected ? selectedMessage : unavailableMessage,
  })

  return result.selected
}

export function resolveChatGPTTeamTrialPaymentMethod(
  options: FlowOptions = {},
): ChatGPTTrialPaymentMethod {
  return (
    normalizeChatGPTTrialPaymentMethod(options.claimTrial) ||
    DEFAULT_CHATGPT_TRIAL_PAYMENT_METHOD
  )
}

function resolveGoPayPaymentRedirectFromOptions(
  options: FlowOptions = {},
): GoPayPaymentRedirectLink {
  const value = options.paymentRedirectUrl?.trim()
  const redirect = value ? extractGoPayPaymentRedirectLink(value) : undefined
  if (!redirect) {
    throw new Error(
      'GoPay trial continuation requires a valid Midtrans redirect URL. Pass --paymentRedirectUrl with the captured GoPay payment link.',
    )
  }

  return redirect
}

function saveTrialPaymentRedirectUrl(
  url: string,
  paymentMethod: ChatGPTTrialPaymentMethod,
): string {
  const runtimeConfig = getRuntimeConfig()
  const filePath = path.join(
    runtimeConfig.artifactsDir,
    `${formatArtifactTimestamp()}-chatgpt-team-trial-${paymentMethod}-link.txt`,
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
  const paymentMethod =
    input.paymentMethod || resolveChatGPTTeamTrialPaymentMethod(options)
  const paymentMethodLabel = formatTrialPaymentMethod(paymentMethod)
  const shouldContinueGoPayPayment = input.continueGoPayPayment === true
  const gopayUnlinkTask =
    paymentMethod === 'gopay' && shouldContinueGoPayPayment
      ? input.gopayUnlinkTask === false
        ? undefined
        : (input.gopayUnlinkTask ?? startChatGPTTeamTrialGoPayUnlinkTask(options))
      : undefined
  let gopayUnlink: GoPayAndroidUnlinkResult | undefined

  if (paymentMethod === 'gopay' && shouldContinueGoPayPayment && machine) {
    await patchTeamTrialMachine(
      machine,
      gopayUnlinkTask
        ? 'chatgpt.gopay_unlink.started'
        : 'chatgpt.gopay_unlink.disabled',
      {
        paymentMethod,
        gopayUnlinkStarted: Boolean(gopayUnlinkTask),
        gopayUnlinkStatus: gopayUnlinkTask ? 'running' : 'disabled',
        lastMessage: gopayUnlinkTask
          ? 'GoPay unlink task is running in Appium'
          : 'GoPay unlink task is disabled',
      },
    )
  }

  const authenticated = await waitForAuthenticatedSession(page, 30000)
  if (!authenticated) {
    throw new Error(
      'ChatGPT trial flow lost the authenticated session before checkout.',
    )
  }

  if (machine) {
    await sendTeamTrialMachine(machine, 'chatgpt.home.ready', {
      email,
      paymentMethod,
      url: page.url(),
      lastMessage: 'Authenticated ChatGPT home is ready',
    })
  }

  if (machine) {
    await machine.send('context.updated', {
      patch: {
        email,
        paymentMethod,
        url: page.url(),
        lastMessage: 'Checking ChatGPT trial coupon eligibility',
      },
    })
  }
  const couponSelection = await selectEligibleChatGPTTrialPromoCoupon(page, {
    requestHeaders: input.backendApiHeadersCapture?.get()?.headers,
  })
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
        paymentMethod,
        couponState: selectedCouponState,
        url: page.url(),
        lastMessage: `Selected ChatGPT ${selectedPlan} trial coupon ${selectedCoupon}`,
      },
    })
  }

  let trialClaimClicked = true
  const useDirectCheckout = paymentMethod === 'gopay'

  if (useDirectCheckout) {
    trialClaimClicked = false
    await applyChatGPTTeamTrialStateProxyConfig('creating-checkout', {
      options,
      machine,
      paymentMethod,
      patch: {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        paymentMethod,
        couponState: selectedCouponState,
        url: page.url(),
      },
    })
    if (machine) {
      await sendTeamTrialMachine(machine, 'chatgpt.checkout.creating', {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        paymentMethod,
        couponState: selectedCouponState,
        pricingRegion: CHATGPT_GOPAY_PRICING_REGION,
        url: page.url(),
        lastMessage: `Creating ChatGPT ${selectedPlan} trial checkout link directly`,
      })
    }

    await selectGoPayProxyTag(
      CHATGPT_TEAM_TRIAL_GOPAY_PAYMENT_PROXY_TAGS,
      'singapore',
      {
        options,
        machine,
        patch: {
          email,
          coupon: selectedCoupon,
          trialPlan: selectedPlan,
          paymentMethod,
          couponState: selectedCouponState,
          url: page.url(),
        },
      },
    )

    const checkout = await createChatGPTTrialCheckoutLink(
      page,
      selectedCoupon,
      {
        paymentMethod,
      },
    )
    await applyChatGPTTeamTrialStateProxyConfig('checkout-ready', {
      options,
      machine,
      paymentMethod,
      patch: {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        paymentMethod,
        couponState: selectedCouponState,
        url: page.url(),
        checkoutUrl: checkout.url,
      },
    })
    await page.goto(checkout.url, { waitUntil: 'domcontentloaded' })
    await page.locator('body').waitFor({ state: 'visible' })
    await page.waitForLoadState('networkidle').catch(() => undefined)
    options.progressReporter?.({
      message: `Opened ChatGPT ${selectedPlan} direct checkout: ${checkout.url}`,
    })
  } else {
    if (machine) {
      await sendTeamTrialMachine(machine, 'chatgpt.pricing.opening', {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        paymentMethod,
        couponState: selectedCouponState,
        url: pricingUrl,
        lastMessage: `Opening ChatGPT ${selectedPlan} pricing promo`,
      })
    }
    await gotoTrialPricingPromo(page, selectedCoupon)
    await selectChatGPTTrialPricingPlanIfPresent(page, selectedCoupon)

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
      await sendTeamTrialMachine(machine, 'chatgpt.pricing.ready', {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        paymentMethod,
        couponState: selectedCouponState,
        url: page.url(),
        lastMessage: `ChatGPT ${selectedPlan} pricing free trial button is ready`,
      })
    }

    if (machine) {
      await sendTeamTrialMachine(machine, 'chatgpt.trial.claiming', {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        paymentMethod,
        pricingRegion: undefined,
        url: page.url(),
        lastMessage: `Clicking ChatGPT ${selectedPlan} free trial button`,
      })
    }
    await clickTrialPricingFreeTrial(page, selectedCoupon)
    const trialClaimTitle = await page.title()

    if (machine) {
      await sendTeamTrialMachine(machine, 'chatgpt.trial.claimed', {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        paymentMethod,
        url: page.url(),
        title: trialClaimTitle,
        lastMessage: `ChatGPT ${selectedPlan} free trial button clicked`,
      })
    }
  }

  const checkoutReady = await waitForChatGPTCheckoutReady(page, 60000)
  if (!checkoutReady) {
    throw new Error(
      `ChatGPT ${selectedPlan} trial checkout did not become ready.`,
    )
  }

  const checkoutUrl = page.url()
  const checkoutTitle = await page.title()

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
    await sendTeamTrialMachine(machine, 'chatgpt.checkout.ready', {
      email,
      coupon: selectedCoupon,
      trialPlan: selectedPlan,
      paymentMethod,
      url: checkoutUrl,
      checkoutUrl,
      title: checkoutTitle,
      lastMessage: `ChatGPT ${selectedPlan} checkout is ready`,
    })
  }

  const billingAddress = resolveChatGPTTeamTrialBillingAddress(options)

  if (machine) {
    await sendTeamTrialMachine(
      machine,
      'chatgpt.paypal_payment_method.selecting',
      {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        paymentMethod,
        url: checkoutUrl,
        checkoutUrl,
        lastMessage: `Selecting ${paymentMethodLabel} payment method before filling billing address`,
      },
    )
  }
  const paymentMethodSelected =
    await selectChatGPTCheckoutPaymentMethodIfPresent(page, paymentMethod, {
      timeoutMs: 30000,
    })
  if (!paymentMethodSelected) {
    throw new Error(
      `ChatGPT checkout ${paymentMethodLabel} payment method was not visible before billing address.`,
    )
  }

  if (machine) {
    await sendTeamTrialMachine(
      machine,
      'chatgpt.paypal_payment_method.selected',
      {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        paymentMethod,
        url: page.url(),
        checkoutUrl,
        paymentMethodSelected: true,
        paypalPaymentMethodSelected: paymentMethod === 'paypal',
        lastMessage: `ChatGPT checkout ${paymentMethodLabel} payment method selected`,
      },
    )
  }

  if (machine) {
    await sendTeamTrialMachine(machine, 'chatgpt.billing_address.filling', {
      email,
      coupon: selectedCoupon,
      trialPlan: selectedPlan,
      paymentMethod,
      url: checkoutUrl,
      checkoutUrl,
      billingCountry: billingAddress.country,
      paymentMethodSelected: true,
      paypalPaymentMethodSelected: paymentMethod === 'paypal',
      lastMessage: 'Filling ChatGPT checkout billing address',
    })
  }
  await fillChatGPTCheckoutBillingAddress(page, billingAddress)

  if (machine) {
    await sendTeamTrialMachine(machine, 'chatgpt.billing_address.filled', {
      email,
      coupon: selectedCoupon,
      trialPlan: selectedPlan,
      paymentMethod,
      url: page.url(),
      checkoutUrl,
      billingCountry: billingAddress.country,
      paymentMethodSelected: true,
      billingAddressFilled: true,
      lastMessage: 'ChatGPT checkout billing address filled',
    })
  }

  if (machine) {
    await sendTeamTrialMachine(machine, 'chatgpt.subscription.submitting', {
      email,
      coupon: selectedCoupon,
      trialPlan: selectedPlan,
      paymentMethod,
      url: page.url(),
      checkoutUrl,
      paymentMethodSelected: true,
      billingAddressFilled: true,
      lastMessage: `Submitting ChatGPT ${selectedPlan} trial subscription with ${paymentMethodLabel}`,
    })
  }
  const paymentRedirect =
    await clickChatGPTCheckoutSubscribeAndCapturePaymentLink(page, {
      paymentMethod,
    })
  const paymentRedirectUrlPath = saveTrialPaymentRedirectUrl(
    paymentRedirect.url,
    paymentMethod,
  )
  const paypalBaTokenCaptured = paymentRedirect.paymentMethod === 'paypal'
  let gopayPayment: GoPayPaymentContinuationResult | undefined

  if (machine) {
    await sendTeamTrialMachine(machine, 'chatgpt.paypal_link.captured', {
      email,
      coupon: selectedCoupon,
      trialPlan: selectedPlan,
      paymentMethod,
      url: page.url(),
      checkoutUrl,
      paymentMethodSelected: true,
      billingAddressFilled: true,
      subscribeClicked: true,
      paypalBaTokenCaptured,
      paymentRedirectUrl: paymentRedirect.url,
      paymentRedirectUrlPath,
      paypalApprovalUrl: paymentRedirect.url,
      paypalApprovalUrlPath: paymentRedirectUrlPath,
      lastMessage: `Captured ${paymentMethodLabel} payment redirect link: ${paymentRedirect.url}`,
    })
  }

  if (
    paymentRedirect.paymentMethod === 'gopay' &&
    !shouldContinueGoPayPayment
  ) {
    options.progressReporter?.({
      message:
        'Captured GoPay payment redirect link; Codey web will continue GoPay authorization in a follow-up task.',
    })
  } else if (paymentRedirect.paymentMethod === 'gopay') {
    const gopayAccount = resolveChatGPTTeamTrialGoPayAccount()

    if (machine) {
      await sendTeamTrialMachine(machine, 'chatgpt.gopay.linking', {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        paymentMethod,
        url: paymentRedirect.url,
        checkoutUrl,
        paymentRedirectUrl: paymentRedirect.url,
        paymentRedirectUrlPath,
        lastMessage: 'Opening GoPay tokenization link',
      })
    }

    gopayPayment = await continueGoPayPaymentFromRedirect(
      page,
      paymentRedirect,
      {
        ...gopayAccount,
        waitForOtpCode: createChatGPTTeamTrialGoPayOtpCodeProvider(options),
        async beforeAuthorizationOpen({ activationLinkUrl }) {
          if (!gopayUnlinkTask) {
            return
          }

          if (gopayUnlinkTask.status === 'failed') {
            if (machine) {
              await patchTeamTrialMachine(
                machine,
                'chatgpt.gopay_unlink.failed',
                {
                  email,
                  coupon: selectedCoupon,
                  trialPlan: selectedPlan,
                  paymentMethod,
                  url: page.url(),
                  checkoutUrl,
                  paymentRedirectUrl: paymentRedirect.url,
                  paymentRedirectUrlPath,
                  gopayActivationLinkUrl: activationLinkUrl,
                  gopayUnlinkStatus: 'failed',
                  lastMessage:
                    'GoPay unlink task failed; continuing authorization without unlink',
                },
              )
            }
            return
          }

          if (machine) {
            await patchTeamTrialMachine(
              machine,
              'chatgpt.gopay_unlink.waiting',
              {
                email,
                coupon: selectedCoupon,
                trialPlan: selectedPlan,
                paymentMethod,
                url: page.url(),
                checkoutUrl,
                paymentRedirectUrl: paymentRedirect.url,
                paymentRedirectUrlPath,
                gopayActivationLinkUrl: activationLinkUrl,
                gopayUnlinkStatus: 'waiting',
                lastMessage:
                  'Waiting for GoPay unlink task before opening GoPay authorization',
              },
            )
          }

          try {
            gopayUnlink = await gopayUnlinkTask.wait()
          } catch (error) {
            const message = sanitizeErrorForOutput(error).message
            if (machine) {
              await patchTeamTrialMachine(
                machine,
                'chatgpt.gopay_unlink.failed',
                {
                  email,
                  coupon: selectedCoupon,
                  trialPlan: selectedPlan,
                  paymentMethod,
                  url: page.url(),
                  checkoutUrl,
                  paymentRedirectUrl: paymentRedirect.url,
                  paymentRedirectUrlPath,
                  gopayActivationLinkUrl: activationLinkUrl,
                  gopayUnlinkStatus: 'failed',
                  gopayUnlinkError: message,
                  lastMessage:
                    'GoPay unlink task failed; continuing authorization without unlink',
                },
              )
            }
            return
          }

          if (machine) {
            await patchTeamTrialMachine(
              machine,
              'chatgpt.gopay_unlink.completed',
              {
                email,
                coupon: selectedCoupon,
                trialPlan: selectedPlan,
                paymentMethod,
                url: page.url(),
                checkoutUrl,
                paymentRedirectUrl: paymentRedirect.url,
                paymentRedirectUrlPath,
                gopayActivationLinkUrl: activationLinkUrl,
                gopayUnlinkStatus: gopayUnlink.status,
                gopayUnlinkCompleted: true,
                gopayUnlinkAppiumSessionId: gopayUnlink.appiumSessionId,
                lastMessage:
                  gopayUnlink.status === 'already-unlinked'
                    ? 'GoPay had no linked apps before OpenAI authorization'
                    : 'GoPay linked app was unlinked before OpenAI authorization',
              },
            )
          }
        },
        onProgress(update) {
          const messages = {
            'redirect-opened': 'Opened GoPay tokenization link',
            'phone-submitted': 'Submitted GoPay phone number',
            'authorization-opened': 'Opened GoPay authorization page',
            'authorization-consented': 'Clicked GoPay authorization consent',
            'otp-requested': 'Waiting for GoPay WhatsApp OTP from Codey app',
            'otp-submitted': 'Submitted GoPay WhatsApp OTP',
            'pin-submitted': 'Submitted GoPay PIN',
            'payment-page-ready': 'GoPay payment page is ready',
            'pay-now-clicked': 'Clicked GoPay Pay now',
          } as const
          options.progressReporter?.({
            message: messages[update.step],
          })
        },
      },
    )

    const gopayTargetEvent =
      gopayPayment.status === 'pay-now-clicked'
        ? 'chatgpt.gopay.payment_submitted'
        : 'chatgpt.gopay.payment_ready'

    if (machine) {
      await sendTeamTrialMachine(machine, gopayTargetEvent, {
        email,
        coupon: selectedCoupon,
        trialPlan: selectedPlan,
        paymentMethod,
        url: gopayPayment.finalUrl,
        title: gopayPayment.title,
        checkoutUrl,
        paymentRedirectUrl: paymentRedirect.url,
        paymentRedirectUrlPath,
        gopayActivationLinkUrl: gopayPayment.activationLinkUrl,
        gopayStatus: gopayPayment.status,
        gopayAuthorizationConsentClicked:
          gopayPayment.authorizationConsentClicked,
        gopayOtpSubmitted: gopayPayment.otpSubmitted,
        gopayPinSubmitted: gopayPayment.pinSubmitted,
        gopayPayNowClicked: gopayPayment.payNowClicked,
        gopayFinalUrl: gopayPayment.finalUrl,
        gopayUnlinkStatus: gopayUnlink?.status,
        gopayUnlinkCompleted: gopayUnlink ? true : undefined,
        gopayUnlinkAppiumSessionId: gopayUnlink?.appiumSessionId,
        lastMessage:
          gopayPayment.status === 'pay-now-clicked'
            ? 'GoPay Pay now was clicked'
            : `GoPay payment continuation stopped at ${gopayPayment.status}`,
      })
    }

    if (gopayPayment.status !== 'pay-now-clicked') {
      throw new Error(
        `GoPay payment continuation stopped at ${gopayPayment.status}.`,
      )
    }
  }

  const title = await page.title()
  return {
    url: page.url(),
    title,
    email,
    authenticated: true,
    coupon: selectedCoupon,
    plan: selectedPlan,
    paymentMethod,
    pricingUrl,
    checkoutUrl,
    trialClaimClicked,
    paymentMethodSelected: true,
    billingAddressFilled: true,
    subscribeClicked: true,
    paypalBaTokenCaptured,
    paymentRedirectUrl: paymentRedirect.url,
    paymentRedirectUrlPath,
    paypalApprovalUrl: paymentRedirect.url,
    paypalApprovalUrlPath: paymentRedirectUrlPath,
    ...(gopayPayment ? { gopayPayment } : {}),
    ...(gopayUnlink ? { gopayUnlink } : {}),
  }
}

export const completeChatGPTTrialAfterAuthenticatedSession =
  completeChatGPTTeamTrialAfterAuthenticatedSession

async function continueChatGPTTeamTrialGoPayPayment<Result>(
  page: Page,
  input: {
    redirect: GoPayPaymentRedirectLink
    options?: FlowOptions
    machine: ChatGPTTeamTrialFlowMachine<Result>
  },
): Promise<{
  gopayPayment: GoPayPaymentContinuationResult
  gopayUnlink?: GoPayAndroidUnlinkResult
}> {
  const options = input.options ?? {}
  const machine = input.machine
  const redirect = input.redirect
  const paymentMethod = 'gopay' as const
  const gopayUnlinkTask = startChatGPTTeamTrialGoPayUnlinkTask(options)
  let gopayUnlink: GoPayAndroidUnlinkResult | undefined

  await patchTeamTrialMachine(
    machine,
    gopayUnlinkTask
      ? 'chatgpt.gopay_unlink.started'
      : 'chatgpt.gopay_unlink.disabled',
    {
      paymentMethod,
      paymentRedirectUrl: redirect.url,
      paypalApprovalUrl: redirect.url,
      gopayUnlinkStarted: Boolean(gopayUnlinkTask),
      gopayUnlinkStatus: gopayUnlinkTask ? 'running' : 'disabled',
      lastMessage: gopayUnlinkTask
        ? 'GoPay unlink task is running in Appium'
        : 'GoPay unlink task is disabled',
    },
  )

  await sendTeamTrialMachine(machine, 'chatgpt.gopay.linking', {
    paymentMethod,
    url: redirect.url,
    paymentRedirectUrl: redirect.url,
    paypalApprovalUrl: redirect.url,
    lastMessage: 'Opening GoPay tokenization link',
  })

  const gopayPayment = await continueGoPayPaymentFromRedirect(
    page,
    redirect,
    {
      ...resolveChatGPTTeamTrialGoPayAccount(),
      waitForOtpCode: createChatGPTTeamTrialGoPayOtpCodeProvider(options),
      async beforeAuthorizationOpen({ activationLinkUrl }) {
        if (!gopayUnlinkTask) {
          return
        }

        if (gopayUnlinkTask.status === 'failed') {
          await patchTeamTrialMachine(machine, 'chatgpt.gopay_unlink.failed', {
            paymentMethod,
            url: page.url(),
            paymentRedirectUrl: redirect.url,
            paypalApprovalUrl: redirect.url,
            gopayActivationLinkUrl: activationLinkUrl,
            gopayUnlinkStatus: 'failed',
            lastMessage:
              'GoPay unlink task failed; continuing authorization without unlink',
          })
          return
        }

        await patchTeamTrialMachine(machine, 'chatgpt.gopay_unlink.waiting', {
          paymentMethod,
          url: page.url(),
          paymentRedirectUrl: redirect.url,
          paypalApprovalUrl: redirect.url,
          gopayActivationLinkUrl: activationLinkUrl,
          gopayUnlinkStatus: 'waiting',
          lastMessage:
            'Waiting for GoPay unlink task before opening GoPay authorization',
        })

        try {
          gopayUnlink = await gopayUnlinkTask.wait()
        } catch (error) {
          await patchTeamTrialMachine(machine, 'chatgpt.gopay_unlink.failed', {
            paymentMethod,
            url: page.url(),
            paymentRedirectUrl: redirect.url,
            paypalApprovalUrl: redirect.url,
            gopayActivationLinkUrl: activationLinkUrl,
            gopayUnlinkStatus: 'failed',
            gopayUnlinkError: sanitizeErrorForOutput(error).message,
            lastMessage:
              'GoPay unlink task failed; continuing authorization without unlink',
          })
          return
        }

        await patchTeamTrialMachine(machine, 'chatgpt.gopay_unlink.completed', {
          paymentMethod,
          url: page.url(),
          paymentRedirectUrl: redirect.url,
          paypalApprovalUrl: redirect.url,
          gopayActivationLinkUrl: activationLinkUrl,
          gopayUnlinkStatus: gopayUnlink.status,
          gopayUnlinkCompleted: true,
          gopayUnlinkAppiumSessionId: gopayUnlink.appiumSessionId,
          lastMessage:
            gopayUnlink.status === 'already-unlinked'
              ? 'GoPay had no linked apps before OpenAI authorization'
              : 'GoPay linked app was unlinked before OpenAI authorization',
        })
      },
      onProgress(update) {
        const messages = {
          'redirect-opened': 'Opened GoPay tokenization link',
          'phone-submitted': 'Submitted GoPay phone number',
          'authorization-opened': 'Opened GoPay authorization page',
          'authorization-consented': 'Clicked GoPay authorization consent',
          'otp-requested': 'Waiting for GoPay WhatsApp OTP from Codey app',
          'otp-submitted': 'Submitted GoPay WhatsApp OTP',
          'pin-submitted': 'Submitted GoPay PIN',
          'payment-page-ready': 'GoPay payment page is ready',
          'pay-now-clicked': 'Clicked GoPay Pay now',
        } as const
        options.progressReporter?.({
          message: messages[update.step],
        })
      },
    },
  )

  const gopayTargetEvent =
    gopayPayment.status === 'pay-now-clicked'
      ? 'chatgpt.gopay.payment_submitted'
      : 'chatgpt.gopay.payment_ready'

  await sendTeamTrialMachine(machine, gopayTargetEvent, {
    paymentMethod,
    url: gopayPayment.finalUrl,
    title: gopayPayment.title,
    paymentRedirectUrl: redirect.url,
    paypalApprovalUrl: redirect.url,
    gopayActivationLinkUrl: gopayPayment.activationLinkUrl,
    gopayStatus: gopayPayment.status,
    gopayAuthorizationConsentClicked:
      gopayPayment.authorizationConsentClicked,
    gopayOtpSubmitted: gopayPayment.otpSubmitted,
    gopayPinSubmitted: gopayPayment.pinSubmitted,
    gopayPayNowClicked: gopayPayment.payNowClicked,
    gopayFinalUrl: gopayPayment.finalUrl,
    gopayUnlinkStatus: gopayUnlink?.status,
    gopayUnlinkCompleted: gopayUnlink ? true : undefined,
    gopayUnlinkAppiumSessionId: gopayUnlink?.appiumSessionId,
    lastMessage:
      gopayPayment.status === 'pay-now-clicked'
        ? 'GoPay Pay now was clicked'
        : `GoPay payment continuation stopped at ${gopayPayment.status}`,
  })

  if (gopayPayment.status !== 'pay-now-clicked') {
    throw new Error(
      `GoPay payment continuation stopped at ${gopayPayment.status}.`,
    )
  }

  return {
    gopayPayment,
    ...(gopayUnlink ? { gopayUnlink } : {}),
  }
}

export async function runChatGPTTeamTrialGoPay(
  page: Page,
  options: FlowOptions = {},
): Promise<ChatGPTTeamTrialGoPayFlowResult> {
  const machine = createChatGPTTeamTrialMachine<ChatGPTTeamTrialGoPayFlowResult>()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )
  const redirect = resolveGoPayPaymentRedirectFromOptions(options)

  try {
    machine.start(
      {
        paymentMethod: 'gopay',
        paymentRedirectUrl: redirect.url,
        paypalApprovalUrl: redirect.url,
        url: redirect.url,
        lastMessage: 'Starting GoPay trial payment continuation',
      },
      {
        source: 'runChatGPTTeamTrialGoPay',
      },
    )

    const { gopayPayment, gopayUnlink } =
      await continueChatGPTTeamTrialGoPayPayment(page, {
        redirect,
        options,
        machine,
      })

    const result = {
      pageName: 'chatgpt-team-trial-gopay' as const,
      url: gopayPayment.finalUrl,
      title: gopayPayment.title,
      paymentMethod: 'gopay' as const,
      paymentRedirectUrl: redirect.url,
      paypalApprovalUrl: redirect.url,
      gopayPayment,
      ...(gopayUnlink ? { gopayUnlink } : {}),
      machine:
        undefined as unknown as ChatGPTTeamTrialFlowSnapshot<ChatGPTTeamTrialGoPayFlowResult>,
    }

    const snapshot = machine.succeed('completed', {
      event: 'chatgpt.completed',
      patch: {
        url: result.url,
        title: result.title,
        paymentMethod: result.paymentMethod,
        paymentRedirectUrl: result.paymentRedirectUrl,
        paypalApprovalUrl: result.paypalApprovalUrl,
        gopayActivationLinkUrl: result.gopayPayment.activationLinkUrl,
        gopayStatus: result.gopayPayment.status,
        gopayAuthorizationConsentClicked:
          result.gopayPayment.authorizationConsentClicked,
        gopayOtpSubmitted: result.gopayPayment.otpSubmitted,
        gopayPinSubmitted: result.gopayPayment.pinSubmitted,
        gopayPayNowClicked: result.gopayPayment.payNowClicked,
        gopayFinalUrl: result.gopayPayment.finalUrl,
        gopayUnlinkStatus: result.gopayUnlink?.status,
        gopayUnlinkCompleted: result.gopayUnlink ? true : undefined,
        gopayUnlinkAppiumSessionId: result.gopayUnlink?.appiumSessionId,
        result,
        lastMessage: 'GoPay trial payment continuation completed',
      },
    })
    result.machine = snapshot
    return result
  } catch (error) {
    machine.fail(error, 'failed', {
      event: 'chatgpt.failed',
      patch: {
        url: page.url(),
        paymentMethod: 'gopay',
        paymentRedirectUrl: redirect.url,
        paypalApprovalUrl: redirect.url,
        lastMessage: sanitizeErrorForOutput(error).message,
      },
    })
    throw error
  } finally {
    detachProgress()
  }
}

export async function runChatGPTTeamTrial(
  page: Page,
  options: FlowOptions = {},
): Promise<ChatGPTTeamTrialFlowResult> {
  const machine = createChatGPTTeamTrialMachine()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )
  const backendApiHeadersCapture = createChatGPTBackendApiHeadersCapture(page)
  const paymentMethod = resolveChatGPTTeamTrialPaymentMethod(options)
  let completedLogin: ChatGPTLoginFlowResult | undefined

  try {
    machine.start(
      {
        url: CHATGPT_HOME_URL,
        paymentMethod,
        lastMessage: 'Starting ChatGPT trial flow',
      },
      {
        source: 'runChatGPTTeamTrial',
      },
    )
    await sendTeamTrialMachine(machine, 'chatgpt.login.started', {
      url: page.url(),
      paymentMethod,
      lastMessage: 'Logging in before opening pricing promo',
    })
    const login = await loginChatGPT(page, options)
    completedLogin = login

    await sendTeamTrialMachine(machine, 'chatgpt.login.completed', {
      email: login.email,
      login,
      paymentMethod,
      url: login.url,
      title: login.title,
      lastMessage: 'ChatGPT login completed',
    })

    const postLoginResult =
      await completeChatGPTTeamTrialAfterAuthenticatedSession(page, {
        email: login.email,
        options,
        machine,
        storageStateIdentity: login.storedIdentity,
        storageStateFlowType: 'chatgpt-team-trial',
        backendApiHeadersCapture,
        paymentMethod,
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
        paymentMethod: result.paymentMethod,
        paymentMethodSelected: result.paymentMethodSelected,
        billingAddressFilled: true,
        subscribeClicked: true,
        paypalBaTokenCaptured: result.paypalBaTokenCaptured,
        paymentRedirectUrl: result.paymentRedirectUrl,
        paymentRedirectUrlPath: result.paymentRedirectUrlPath,
        paypalApprovalUrl: result.paypalApprovalUrl,
        paypalApprovalUrlPath: result.paypalApprovalUrlPath,
        gopayActivationLinkUrl: result.gopayPayment?.activationLinkUrl,
        gopayStatus: result.gopayPayment?.status,
        gopayAuthorizationConsentClicked:
          result.gopayPayment?.authorizationConsentClicked,
        gopayOtpSubmitted: result.gopayPayment?.otpSubmitted,
        gopayPinSubmitted: result.gopayPayment?.pinSubmitted,
        gopayPayNowClicked: result.gopayPayment?.payNowClicked,
        gopayFinalUrl: result.gopayPayment?.finalUrl,
        gopayUnlinkStatus: result.gopayUnlink?.status,
        gopayUnlinkCompleted: result.gopayUnlink ? true : undefined,
        gopayUnlinkAppiumSessionId: result.gopayUnlink?.appiumSessionId,
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
    backendApiHeadersCapture.dispose()
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

export const chatgptTeamTrialGoPayFlow: SingleFileFlowDefinition<
  FlowOptions,
  ChatGPTTeamTrialGoPayFlowResult
> = {
  command: 'flow:chatgpt-team-trial-gopay',
  run: runChatGPTTeamTrialGoPay,
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runSingleFileFlowFromCommandLine('chatgpt-team-trial', chatgptTeamTrialFlow)
}
