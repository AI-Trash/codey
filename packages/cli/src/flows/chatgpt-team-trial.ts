import type { Page } from 'patchright'
import {
  Faker,
  allLocales,
  faker,
  type LocaleDefinition,
} from '@faker-js/faker'
import path from 'path'
import {
  assignContextFromInput,
  composeStateMachineConfig,
  createGuardedCaseTransitions,
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
  type ChatGPTCheckoutPaymentLink,
  createChatGPTBackendApiHeadersCapture,
  extractGoPayPaymentRedirectLink,
  fillChatGPTCheckoutBillingAddress,
  getChatGPTTrialPromoPlan,
  gotoTrialPricingPromo,
  normalizeChatGPTTrialPaymentMethod,
  readChatGPTCheckoutBillingCountry,
  selectChatGPTCheckoutPaymentMethodIfPresent,
  selectChatGPTTrialPricingPlanIfPresent,
  selectEligibleChatGPTTrialPromoCoupon,
  type ChatGPTBackendApiHeadersCapture,
  type ChatGPTSessionAccessTokenObservation,
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
  parseBooleanFlag,
  parseNumberFlag,
  sanitizeErrorForOutput,
} from '../modules/flow-cli/helpers'
import { resolveAppBaseUrl } from '../modules/app-auth/http'
import {
  AppVerificationProviderClient,
  resolveVerificationAppConfig,
} from '../modules/verification'
import { saveLocalChatGPTStorageState } from '../modules/chatgpt/storage-state'
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

const DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_COUNTRY = 'SG'
const DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_CITY = 'Singapore'
const DEFAULT_CHATGPT_TEAM_TRIAL_FAKER_LOCALE = 'en'

const CHATGPT_TEAM_TRIAL_BILLING_COUNTRY_LOCALES: Record<string, string> = {
  AR: 'es',
  AT: 'de_AT',
  AU: 'en_AU',
  BE: 'nl_BE',
  BR: 'pt_BR',
  CA: 'en_CA',
  CH: 'de_CH',
  CN: 'zh_CN',
  DE: 'de',
  ES: 'es',
  FR: 'fr',
  GB: 'en_GB',
  GH: 'en_GH',
  HK: 'en_HK',
  ID: 'id_ID',
  IE: 'en_IE',
  IN: 'en_IN',
  IT: 'it',
  JP: 'ja',
  KR: 'ko',
  LU: 'fr_LU',
  MX: 'es_MX',
  NG: 'en_NG',
  NL: 'nl',
  PT: 'pt_PT',
  SG: 'en',
  TH: 'th',
  TW: 'zh_TW',
  US: 'en_US',
  ZA: 'en_ZA',
} as const

const SINGAPORE_BILLING_ADDRESS_STREETS = [
  'Alexandra Road',
  'Beach Road',
  'Cecil Street',
  'Clementi Road',
  'Eu Tong Sen Street',
  'Geylang Road',
  'Havelock Road',
  'Holland Road',
  'Jalan Besar',
  'Joo Chiat Road',
  'Marina Boulevard',
  'New Bridge Road',
  'North Bridge Road',
  'Orchard Road',
  'Outram Road',
  'River Valley Road',
  'Serangoon Road',
  'Tanjong Pagar Road',
  'Thomson Road',
  'Upper Bukit Timah Road',
] as const

const SINGAPORE_BILLING_ADDRESS_DISTRICTS = [
  'Ang Mo Kio',
  'Bedok',
  'Bishan',
  'Bukit Batok',
  'Bukit Merah',
  'Bukit Timah',
  'Clementi',
  'Geylang',
  'Hougang',
  'Jurong East',
  'Marine Parade',
  'Orchard',
  'Pasir Ris',
  'Queenstown',
  'Sengkang',
  'Serangoon',
  'Tampines',
  'Toa Payoh',
  'Woodlands',
  'Yishun',
] as const

const CHATGPT_TEAM_TRIAL_STABLE_BILLING_ADDRESSES = {
  US: {
    name: DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME,
    country: 'US',
    line1: '1 Market Street',
    line2: undefined,
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94105',
  },
} as const satisfies Partial<Record<string, ChatGPTTeamTrialBillingAddress>>
const GOPAY_WHATSAPP_CODE_CLOCK_SKEW_TOLERANCE_MS = 15000

function createSingaporePostalCode(): string {
  const sector = faker.number.int({ min: 1, max: 82 })
  const deliveryPoint = faker.number.int({ min: 0, max: 9999 })

  return `${sector.toString().padStart(2, '0')}${deliveryPoint
    .toString()
    .padStart(4, '0')}`
}

export function createChatGPTTeamTrialSingaporeBillingAddress(): ChatGPTTeamTrialBillingAddress {
  return {
    name: DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME,
    country: DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_COUNTRY,
    line1: `${faker.number.int({ min: 1, max: 999 })} ${faker.helpers.arrayElement(
      SINGAPORE_BILLING_ADDRESS_STREETS,
    )}`,
    line2: faker.helpers.arrayElement(SINGAPORE_BILLING_ADDRESS_DISTRICTS),
    city: DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_CITY,
    state: undefined,
    postalCode: createSingaporePostalCode(),
  }
}

function normalizeBillingCountry(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim().toUpperCase()
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : undefined
}

function getFakerLocale(localeCode: string): LocaleDefinition | undefined {
  return (allLocales as Record<string, LocaleDefinition | undefined>)[
    localeCode
  ]
}

function getFakerLocaleCodesForCountry(country: string): string[] {
  const normalized = normalizeBillingCountry(country)
  if (!normalized) {
    return [DEFAULT_CHATGPT_TEAM_TRIAL_FAKER_LOCALE]
  }

  const mappedLocale = CHATGPT_TEAM_TRIAL_BILLING_COUNTRY_LOCALES[normalized]
  const languageCode = normalized.toLowerCase()
  return [
    mappedLocale,
    `${languageCode}_${normalized}`,
    languageCode,
    DEFAULT_CHATGPT_TEAM_TRIAL_FAKER_LOCALE,
    'base',
  ].filter((entry): entry is string => Boolean(entry))
}

function createFakerForBillingCountry(country: string): Faker {
  const locales = getFakerLocaleCodesForCountry(country)
    .map((localeCode) => getFakerLocale(localeCode))
    .filter((locale): locale is LocaleDefinition => Boolean(locale))

  return new Faker({
    locale: locales.length > 0 ? locales : [allLocales.en, allLocales.base],
  })
}

function createChatGPTTeamTrialFakerBillingAddressLine2(
  countryFaker: Faker,
): string | undefined {
  const line2 = countryFaker.location.secondaryAddress().trim()
  return line2 || undefined
}

function createChatGPTTeamTrialFakerBillingAddress(
  country: string,
): ChatGPTTeamTrialBillingAddress {
  const normalizedCountry =
    normalizeBillingCountry(country) ||
    DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_COUNTRY

  if (normalizedCountry === DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_COUNTRY) {
    return createChatGPTTeamTrialSingaporeBillingAddress()
  }

  const stableAddress =
    CHATGPT_TEAM_TRIAL_STABLE_BILLING_ADDRESSES[normalizedCountry]
  if (stableAddress) {
    return { ...stableAddress }
  }

  const countryFaker = createFakerForBillingCountry(normalizedCountry)

  return {
    name: DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME,
    country: normalizedCountry,
    line1: countryFaker.location.streetAddress(),
    line2: createChatGPTTeamTrialFakerBillingAddressLine2(countryFaker),
    city: countryFaker.location.city(),
    state: countryFaker.location.state(),
    postalCode: countryFaker.location.zipCode(),
  }
}

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
  | 'chatgpt.checkout.entry.observed'
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
  sessionAccessTokenAvailable?: boolean
  sessionAccessTokenStatus?: number
  sessionAccessTokenError?: string
  checkoutEntryMode?: 'direct' | 'pricing'
  checkoutEntryFallbackReason?: string
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

export const chatgptTeamTrialStates = defineChatGPTTeamTrialStates({
  idle: {},
  'logging-in': {},
  'home-ready': {},
  'opening-pricing': {},
  'pricing-ready': {},
  'claiming-trial': {},
  'trial-claimed': {},
  'creating-checkout': {},
  'checkout-ready': {},
  'selecting-paypal-payment-method': {},
  'paypal-payment-method-selected': {},
  'filling-billing-address': {},
  'billing-address-filled': {},
  subscribing: {},
  'paypal-link-captured': {},
  'gopay-linking': {},
  'gopay-authorizing': {},
  'gopay-payment-ready': {},
  'gopay-payment-submitted': {},
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
      createChatGPTTeamTrialCheckoutEntryFragment<Result>(),
      createChatGPTTeamTrialGoPayUnlinkRegionFragment<Result>(),
    ),
  )
}

function createChatGPTTeamTrialCheckoutEntryFragment<
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
    on: {
      'chatgpt.checkout.entry.observed':
        createChatGPTTeamTrialCheckoutEntryObservedTransitions<Result>(),
    },
  })
}

function createChatGPTTeamTrialCheckoutEntryObservedTransitions<Result>() {
  return createGuardedCaseTransitions<
    ChatGPTTeamTrialFlowState,
    ChatGPTTeamTrialFlowContext<Result>,
    ChatGPTTeamTrialFlowEvent,
    StateMachinePatchInput<
      ChatGPTTeamTrialFlowState,
      ChatGPTTeamTrialFlowContext<Result>
    >
  >({
    isInput: isStateMachinePatchInput,
    cases: [
      {
        priority: 20,
        when: ({ input }) =>
          input.patch?.paymentMethod === 'gopay' &&
          input.patch.sessionAccessTokenAvailable === true,
        target: 'creating-checkout',
        actions: assignContextFromInput<
          ChatGPTTeamTrialFlowState,
          ChatGPTTeamTrialFlowContext<Result>,
          ChatGPTTeamTrialFlowEvent,
          StateMachinePatchInput<
            ChatGPTTeamTrialFlowState,
            ChatGPTTeamTrialFlowContext<Result>
          >
        >(isStateMachinePatchInput, (_context, { input }) => ({
          ...input.patch,
          checkoutEntryMode: 'direct',
          checkoutEntryFallbackReason: undefined,
          lastMessage:
            input.patch?.lastMessage ||
            'ChatGPT session access token is available for direct trial checkout',
        })),
      },
      {
        priority: 10,
        target: 'opening-pricing',
        actions: assignContextFromInput<
          ChatGPTTeamTrialFlowState,
          ChatGPTTeamTrialFlowContext<Result>,
          ChatGPTTeamTrialFlowEvent,
          StateMachinePatchInput<
            ChatGPTTeamTrialFlowState,
            ChatGPTTeamTrialFlowContext<Result>
          >
        >(isStateMachinePatchInput, (_context, { input }) => {
          const directCheckoutRequested = input.patch?.paymentMethod === 'gopay'
          return {
            ...input.patch,
            checkoutEntryMode: 'pricing',
            checkoutEntryFallbackReason:
              directCheckoutRequested &&
              input.patch?.sessionAccessTokenAvailable !== true
                ? 'session-access-token-unavailable'
                : undefined,
            lastMessage:
              input.patch?.lastMessage ||
              (directCheckoutRequested
                ? 'ChatGPT session access token was not observed; opening pricing promo checkout'
                : 'Opening ChatGPT pricing promo checkout'),
          }
        }),
      },
    ],
  })
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
  runtimeCountry?: string,
): ChatGPTTeamTrialBillingAddress {
  const config = getRuntimeConfig().chatgptTeamTrial?.billingAddress
  const fallbackCountry =
    nonEmptyString(options.billingCountry) ||
    nonEmptyString(config?.country) ||
    normalizeBillingCountry(runtimeCountry) ||
    DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_COUNTRY
  const fallbackAddress =
    createChatGPTTeamTrialFakerBillingAddress(fallbackCountry)

  return {
    name:
      nonEmptyString(options.billingName) ||
      nonEmptyString(config?.name) ||
      fallbackAddress.name,
    country:
      nonEmptyString(options.billingCountry) ||
      nonEmptyString(config?.country) ||
      fallbackAddress.country,
    line1:
      nonEmptyString(options.billingAddressLine1) ||
      nonEmptyString(config?.line1) ||
      fallbackAddress.line1,
    line2:
      nonEmptyString(options.billingAddressLine2) ||
      nonEmptyString(config?.line2) ||
      fallbackAddress.line2,
    city:
      nonEmptyString(options.billingCity) ||
      nonEmptyString(config?.city) ||
      fallbackAddress.city,
    state:
      nonEmptyString(options.billingState) ||
      nonEmptyString(config?.state) ||
      fallbackAddress.state,
    postalCode:
      nonEmptyString(options.billingPostalCode) ||
      nonEmptyString(config?.postalCode) ||
      fallbackAddress.postalCode,
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
      clockSkewToleranceMs: GOPAY_WHATSAPP_CODE_CLOCK_SKEW_TOLERANCE_MS,
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
  appiumFallback?: boolean
}

export function resolveChatGPTTeamTrialGoPayUnlinkOptions(): ChatGPTTeamTrialGoPayUnlinkOptions {
  const config = getRuntimeConfig().chatgptTeamTrial?.gopay

  return {
    enabled: config?.unlinkBeforeLink ?? true,
    timeoutMs: config?.unlinkTimeoutMs,
    appiumFallback: config?.unlinkAppiumFallback ?? false,
  }
}

function resolveChatGPTTeamTrialGoPayUnlinkOptionsForFlow(
  options: FlowOptions = {},
): ChatGPTTeamTrialGoPayUnlinkOptions {
  const resolved = resolveChatGPTTeamTrialGoPayUnlinkOptions()
  if (options.unlinkBeforeLink === undefined) {
    return resolved
  }

  return {
    ...resolved,
    enabled:
      parseBooleanFlag(options.unlinkBeforeLink, resolved.enabled) ?? true,
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
  const unlinkOptions =
    resolveChatGPTTeamTrialGoPayUnlinkOptionsForFlow(options)
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

interface ChatGPTTeamTrialCheckoutContext<Result = unknown> {
  options: FlowOptions
  email: string
  machine?: ChatGPTTeamTrialFlowMachine<Result>
  paymentMethod: ChatGPTTrialPaymentMethod
  paymentMethodLabel: string
  coupon: ChatGPTTrialPromoCoupon
  plan: ChatGPTTrialPromoPlan
  couponState?: string
  sessionAccessToken?: ChatGPTSessionAccessTokenObservation
  pricingUrl: string
}

interface ChatGPTTeamTrialCheckoutEntry {
  checkoutUrl: string
  checkoutTitle: string
  trialClaimClicked: boolean
}

interface ChatGPTTeamTrialSubmittedPayment {
  redirect: ChatGPTCheckoutPaymentLink
  redirectUrlPath: string
  paypalBaTokenCaptured: boolean
}

async function startChatGPTTeamTrialGoPayUnlinkRegion<Result>(
  machine: ChatGPTTeamTrialFlowMachine<Result> | undefined,
  paymentMethod: ChatGPTTrialPaymentMethod,
  shouldContinueGoPayPayment: boolean,
  gopayUnlinkTask: ChatGPTTeamTrialGoPayUnlinkTask | undefined,
): Promise<void> {
  if (paymentMethod !== 'gopay' || !shouldContinueGoPayPayment || !machine) {
    return
  }

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

async function requireChatGPTTeamTrialAuthenticatedHome<Result>(
  page: Page,
  context: Pick<
    ChatGPTTeamTrialCheckoutContext<Result>,
    'email' | 'machine' | 'paymentMethod'
  >,
): Promise<void> {
  const authenticated = await waitForAuthenticatedSession(page, 30000)
  if (!authenticated) {
    throw new Error(
      'ChatGPT trial flow lost the authenticated session before checkout.',
    )
  }

  if (context.machine) {
    await sendTeamTrialMachine(context.machine, 'chatgpt.home.ready', {
      email: context.email,
      paymentMethod: context.paymentMethod,
      url: page.url(),
      lastMessage: 'Authenticated ChatGPT home is ready',
    })
  }
}

async function selectChatGPTTeamTrialCoupon<Result>(
  page: Page,
  input: ChatGPTTeamTrialPostLoginOptions<Result>,
  context: Pick<
    ChatGPTTeamTrialCheckoutContext<Result>,
    'email' | 'machine' | 'options' | 'paymentMethod'
  >,
): Promise<{
  coupon: ChatGPTTrialPromoCoupon
  plan: ChatGPTTrialPromoPlan
  couponState?: string
  sessionAccessToken?: ChatGPTSessionAccessTokenObservation
  pricingUrl: string
}> {
  if (context.machine) {
    await context.machine.send('context.updated', {
      patch: {
        email: context.email,
        paymentMethod: context.paymentMethod,
        url: page.url(),
        lastMessage: 'Checking ChatGPT trial coupon eligibility',
      },
    })
  }

  const couponSelection = await selectEligibleChatGPTTrialPromoCoupon(page, {
    requestHeaders: input.backendApiHeadersCapture?.get()?.headers,
    observeSessionAccessToken: context.paymentMethod === 'gopay',
    sessionAccessTokenTimeoutMs: 10000,
  })
  const coupon = couponSelection.selected?.coupon
  if (!coupon) {
    throw new Error(
      `No eligible ChatGPT trial coupon was found (${formatTrialCouponChecks(couponSelection.checked)}).`,
    )
  }

  const plan = getChatGPTTrialPromoPlan(coupon)
  const couponState = couponSelection.selected?.state
  const sessionAccessToken = couponSelection.sessionAccessToken
  const pricingUrl = buildChatGPTTrialPricingPromoUrl(coupon)
  context.options.progressReporter?.({
    message: `Selected ChatGPT ${plan} trial coupon ${coupon}`,
  })
  if (context.paymentMethod === 'gopay' && sessionAccessToken) {
    context.options.progressReporter?.({
      message: sessionAccessToken.available
        ? 'ChatGPT session access token is available for direct trial checkout'
        : 'ChatGPT session access token was not observed during coupon eligibility check',
    })
  }

  if (context.machine) {
    await context.machine.send('context.updated', {
      patch: {
        email: context.email,
        coupon,
        trialPlan: plan,
        paymentMethod: context.paymentMethod,
        couponState,
        ...getSessionAccessTokenContextPatch(sessionAccessToken),
        url: page.url(),
        lastMessage: `Selected ChatGPT ${plan} trial coupon ${coupon}`,
      },
    })
  }

  return {
    coupon,
    plan,
    couponState,
    ...(sessionAccessToken ? { sessionAccessToken } : {}),
    pricingUrl,
  }
}

async function openChatGPTTeamTrialCheckout<Result>(
  page: Page,
  context: ChatGPTTeamTrialCheckoutContext<Result>,
): Promise<ChatGPTTeamTrialCheckoutEntry> {
  const checkoutEntryMode = await observeChatGPTTeamTrialCheckoutEntry(
    page,
    context,
  )
  if (checkoutEntryMode === 'direct') {
    try {
      await openDirectGoPayTrialCheckout(page, context)
      const checkoutReady = await waitForChatGPTCheckoutReady(page, 60000)
      if (!checkoutReady) {
        throw new Error(
          `ChatGPT ${context.plan} trial checkout did not become ready.`,
        )
      }
      return {
        checkoutUrl: page.url(),
        checkoutTitle: await page.title(),
        trialClaimClicked: false,
      }
    } catch (error) {
      if (!isSessionAccessTokenUnavailableCheckoutError(error)) {
        throw error
      }

      const message = sanitizeErrorForOutput(error).message
      context.options.progressReporter?.({
        message:
          'ChatGPT session access token disappeared during direct checkout; opening pricing promo checkout',
      })
      if (context.machine) {
        await sendTeamTrialMachine(
          context.machine,
          'chatgpt.checkout.entry.observed',
          {
            email: context.email,
            coupon: context.coupon,
            trialPlan: context.plan,
            paymentMethod: context.paymentMethod,
            couponState: context.couponState,
            sessionAccessTokenAvailable: false,
            sessionAccessTokenError: message,
            url: page.url(),
            lastMessage:
              'ChatGPT session access token disappeared during direct checkout; opening pricing promo checkout',
          },
        )
      }
    }
  }

  if (context.paymentMethod === 'gopay') {
    context.options.progressReporter?.({
      message:
        'Opening ChatGPT pricing promo checkout because direct checkout access token was not observed',
    })
  }
  await openPricingTrialCheckout(page, context)
  const checkoutReady = await waitForChatGPTCheckoutReady(page, 60000)
  if (!checkoutReady) {
    throw new Error(
      `ChatGPT ${context.plan} trial checkout did not become ready.`,
    )
  }

  return {
    checkoutUrl: page.url(),
    checkoutTitle: await page.title(),
    trialClaimClicked: true,
  }
}

function isSessionAccessTokenUnavailableCheckoutError(error: unknown): boolean {
  return sanitizeErrorForOutput(error).message.includes(
    'ChatGPT session access token was not available',
  )
}

async function observeChatGPTTeamTrialCheckoutEntry<Result>(
  page: Page,
  context: ChatGPTTeamTrialCheckoutContext<Result>,
): Promise<'direct' | 'pricing'> {
  const directCheckoutRequested = context.paymentMethod === 'gopay'
  const directCheckoutAvailable =
    directCheckoutRequested && context.sessionAccessToken?.available === true
  const message = directCheckoutAvailable
    ? `Creating ChatGPT ${context.plan} trial checkout link directly`
    : directCheckoutRequested
      ? 'ChatGPT session access token was not observed; opening pricing promo checkout'
      : `Opening ChatGPT ${context.plan} pricing promo checkout`

  if (context.machine) {
    await sendTeamTrialMachine(
      context.machine,
      'chatgpt.checkout.entry.observed',
      {
        email: context.email,
        coupon: context.coupon,
        trialPlan: context.plan,
        paymentMethod: context.paymentMethod,
        couponState: context.couponState,
        pricingRegion: directCheckoutAvailable
          ? CHATGPT_GOPAY_PRICING_REGION
          : undefined,
        url: page.url(),
        ...getSessionAccessTokenContextPatch(context.sessionAccessToken),
        lastMessage: message,
      },
    )
    return context.machine.getSnapshot().context.checkoutEntryMode === 'direct'
      ? 'direct'
      : 'pricing'
  }

  return directCheckoutAvailable ? 'direct' : 'pricing'
}

function getSessionAccessTokenContextPatch<Result>(
  observation: ChatGPTSessionAccessTokenObservation | undefined,
): Partial<ChatGPTTeamTrialFlowContext<Result>> {
  if (!observation) {
    return {}
  }

  return {
    sessionAccessTokenAvailable: observation.available,
    sessionAccessTokenStatus: observation.status,
    sessionAccessTokenError: observation.error,
  }
}

async function openDirectGoPayTrialCheckout<Result>(
  page: Page,
  context: ChatGPTTeamTrialCheckoutContext<Result>,
): Promise<void> {
  await applyChatGPTTeamTrialStateProxyConfig('creating-checkout', {
    options: context.options,
    machine: context.machine,
    paymentMethod: context.paymentMethod,
    patch: {
      email: context.email,
      coupon: context.coupon,
      trialPlan: context.plan,
      paymentMethod: context.paymentMethod,
      couponState: context.couponState,
      url: page.url(),
    },
  })
  if (context.machine) {
    await sendTeamTrialMachine(context.machine, 'chatgpt.checkout.creating', {
      email: context.email,
      coupon: context.coupon,
      trialPlan: context.plan,
      paymentMethod: context.paymentMethod,
      couponState: context.couponState,
      pricingRegion: CHATGPT_GOPAY_PRICING_REGION,
      url: page.url(),
      lastMessage: `Creating ChatGPT ${context.plan} trial checkout link directly`,
    })
  }

  const checkout = await createChatGPTTrialCheckoutLink(page, context.coupon, {
    paymentMethod: context.paymentMethod,
  })
  await applyChatGPTTeamTrialStateProxyConfig('checkout-ready', {
    options: context.options,
    machine: context.machine,
    paymentMethod: context.paymentMethod,
    patch: {
      email: context.email,
      coupon: context.coupon,
      trialPlan: context.plan,
      paymentMethod: context.paymentMethod,
      couponState: context.couponState,
      url: page.url(),
      checkoutUrl: checkout.url,
    },
  })
  await page.goto(checkout.url, { waitUntil: 'domcontentloaded' })
  await page.locator('body').waitFor({ state: 'visible' })
  await page.waitForLoadState('networkidle').catch(() => undefined)
  context.options.progressReporter?.({
    message: `Opened ChatGPT ${context.plan} direct checkout: ${checkout.url}`,
  })
}

async function openPricingTrialCheckout<Result>(
  page: Page,
  context: ChatGPTTeamTrialCheckoutContext<Result>,
): Promise<void> {
  if (context.machine) {
    await sendTeamTrialMachine(context.machine, 'chatgpt.pricing.opening', {
      email: context.email,
      coupon: context.coupon,
      trialPlan: context.plan,
      paymentMethod: context.paymentMethod,
      couponState: context.couponState,
      url: context.pricingUrl,
      lastMessage: `Opening ChatGPT ${context.plan} pricing promo`,
    })
  }
  await gotoTrialPricingPromo(page, context.coupon)
  await selectChatGPTTrialPricingPlanIfPresent(page, context.coupon)

  const pricingReady = await waitForTrialPricingFreeTrialReady(
    page,
    context.coupon,
    30000,
  )
  if (!pricingReady) {
    throw new Error(
      `ChatGPT ${context.plan} pricing free trial button was not visible.`,
    )
  }

  if (context.machine) {
    await sendTeamTrialMachine(context.machine, 'chatgpt.pricing.ready', {
      email: context.email,
      coupon: context.coupon,
      trialPlan: context.plan,
      paymentMethod: context.paymentMethod,
      couponState: context.couponState,
      url: page.url(),
      lastMessage: `ChatGPT ${context.plan} pricing free trial button is ready`,
    })
    await sendTeamTrialMachine(context.machine, 'chatgpt.trial.claiming', {
      email: context.email,
      coupon: context.coupon,
      trialPlan: context.plan,
      paymentMethod: context.paymentMethod,
      pricingRegion: undefined,
      url: page.url(),
      lastMessage: `Clicking ChatGPT ${context.plan} free trial button`,
    })
  }

  await clickTrialPricingFreeTrial(page, context.coupon)
  const trialClaimTitle = await page.title()

  if (context.machine) {
    await sendTeamTrialMachine(context.machine, 'chatgpt.trial.claimed', {
      email: context.email,
      coupon: context.coupon,
      trialPlan: context.plan,
      paymentMethod: context.paymentMethod,
      url: page.url(),
      title: trialClaimTitle,
      lastMessage: `ChatGPT ${context.plan} free trial button clicked`,
    })
  }
}

async function saveTeamTrialStorageStateIfRequested<Result>(
  page: Page,
  input: ChatGPTTeamTrialPostLoginOptions<Result>,
  options: FlowOptions,
): Promise<void> {
  if (!input.storageStateIdentity) {
    return
  }

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

async function prepareChatGPTTeamTrialCheckout<Result>(
  page: Page,
  context: ChatGPTTeamTrialCheckoutContext<Result>,
  checkout: ChatGPTTeamTrialCheckoutEntry,
): Promise<void> {
  if (context.machine) {
    await sendTeamTrialMachine(context.machine, 'chatgpt.checkout.ready', {
      email: context.email,
      coupon: context.coupon,
      trialPlan: context.plan,
      paymentMethod: context.paymentMethod,
      url: checkout.checkoutUrl,
      checkoutUrl: checkout.checkoutUrl,
      title: checkout.checkoutTitle,
      lastMessage: `ChatGPT ${context.plan} checkout is ready`,
    })
  }
}

async function submitChatGPTTeamTrialCheckout<Result>(
  page: Page,
  context: ChatGPTTeamTrialCheckoutContext<Result>,
  checkoutUrl: string,
): Promise<ChatGPTTeamTrialSubmittedPayment> {
  const preserveBillingCountry =
    context.paymentMethod === 'gopay' ||
    context.options.preserveCheckoutBillingCountry === true

  if (context.machine) {
    await sendTeamTrialMachine(
      context.machine,
      'chatgpt.paypal_payment_method.selecting',
      {
        email: context.email,
        coupon: context.coupon,
        trialPlan: context.plan,
        paymentMethod: context.paymentMethod,
        url: checkoutUrl,
        checkoutUrl,
        lastMessage: `Selecting ${context.paymentMethodLabel} payment method before filling billing address`,
      },
    )
  }
  const paymentMethodSelected =
    await selectChatGPTCheckoutPaymentMethodIfPresent(
      page,
      context.paymentMethod,
      {
        timeoutMs: 30000,
      },
    )
  if (!paymentMethodSelected) {
    throw new Error(
      `ChatGPT checkout ${context.paymentMethodLabel} payment method was not visible before billing address.`,
    )
  }

  const runtimeBillingCountry = preserveBillingCountry
    ? await readChatGPTCheckoutBillingCountry(page)
    : undefined
  const billingAddress = resolveChatGPTTeamTrialBillingAddress(
    context.options,
    runtimeBillingCountry,
  )

  if (context.machine) {
    await sendTeamTrialMachine(
      context.machine,
      'chatgpt.paypal_payment_method.selected',
      {
        email: context.email,
        coupon: context.coupon,
        trialPlan: context.plan,
        paymentMethod: context.paymentMethod,
        url: page.url(),
        checkoutUrl,
        paymentMethodSelected: true,
        paypalPaymentMethodSelected: context.paymentMethod === 'paypal',
        lastMessage: `ChatGPT checkout ${context.paymentMethodLabel} payment method selected`,
      },
    )
    await sendTeamTrialMachine(
      context.machine,
      'chatgpt.billing_address.filling',
      {
        email: context.email,
        coupon: context.coupon,
        trialPlan: context.plan,
        paymentMethod: context.paymentMethod,
        url: checkoutUrl,
        checkoutUrl,
        billingCountry: billingAddress.country,
        paymentMethodSelected: true,
        paypalPaymentMethodSelected: context.paymentMethod === 'paypal',
        lastMessage: 'Filling ChatGPT checkout billing address',
      },
    )
  }
  await fillChatGPTCheckoutBillingAddress(page, billingAddress, {
    fillCountry: !preserveBillingCountry,
  })
  if (context.paymentMethod === 'gopay') {
    await selectChatGPTCheckoutPaymentMethodIfPresent(
      page,
      context.paymentMethod,
      {
        timeoutMs: 10000,
      },
    )
  }

  if (context.machine) {
    await sendTeamTrialMachine(
      context.machine,
      'chatgpt.billing_address.filled',
      {
        email: context.email,
        coupon: context.coupon,
        trialPlan: context.plan,
        paymentMethod: context.paymentMethod,
        url: page.url(),
        checkoutUrl,
        billingCountry: billingAddress.country,
        paymentMethodSelected: true,
        billingAddressFilled: true,
        lastMessage: 'ChatGPT checkout billing address filled',
      },
    )
    await sendTeamTrialMachine(
      context.machine,
      'chatgpt.subscription.submitting',
      {
        email: context.email,
        coupon: context.coupon,
        trialPlan: context.plan,
        paymentMethod: context.paymentMethod,
        url: page.url(),
        checkoutUrl,
        paymentMethodSelected: true,
        billingAddressFilled: true,
        lastMessage: `Submitting ChatGPT ${context.plan} trial subscription with ${context.paymentMethodLabel}`,
      },
    )
  }

  const redirect = await clickChatGPTCheckoutSubscribeAndCapturePaymentLink(
    page,
    {
      paymentMethod: context.paymentMethod,
    },
  )
  const redirectUrlPath = saveTrialPaymentRedirectUrl(
    redirect.url,
    context.paymentMethod,
  )
  const paypalBaTokenCaptured = redirect.paymentMethod === 'paypal'

  if (context.machine) {
    await sendTeamTrialMachine(
      context.machine,
      'chatgpt.paypal_link.captured',
      {
        email: context.email,
        coupon: context.coupon,
        trialPlan: context.plan,
        paymentMethod: context.paymentMethod,
        url: page.url(),
        checkoutUrl,
        paymentMethodSelected: true,
        billingAddressFilled: true,
        subscribeClicked: true,
        paypalBaTokenCaptured,
        paymentRedirectUrl: redirect.url,
        paymentRedirectUrlPath: redirectUrlPath,
        paypalApprovalUrl: redirect.url,
        paypalApprovalUrlPath: redirectUrlPath,
        lastMessage: `Captured ${context.paymentMethodLabel} payment redirect link: ${redirect.url}`,
      },
    )
  }

  return {
    redirect,
    redirectUrlPath,
    paypalBaTokenCaptured,
  }
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
        : (input.gopayUnlinkTask ??
          startChatGPTTeamTrialGoPayUnlinkTask(options))
      : undefined
  let gopayUnlink: GoPayAndroidUnlinkResult | undefined

  await startChatGPTTeamTrialGoPayUnlinkRegion(
    machine,
    paymentMethod,
    shouldContinueGoPayPayment,
    gopayUnlinkTask,
  )
  await requireChatGPTTeamTrialAuthenticatedHome(page, {
    email,
    machine,
    paymentMethod,
  })

  const selected = await selectChatGPTTeamTrialCoupon(page, input, {
    email,
    machine,
    options,
    paymentMethod,
  })
  const selectedCoupon = selected.coupon
  const selectedPlan = selected.plan
  const selectedCouponState = selected.couponState
  const pricingUrl = selected.pricingUrl
  const checkoutContext: ChatGPTTeamTrialCheckoutContext<Result> = {
    email,
    machine,
    options,
    paymentMethod,
    paymentMethodLabel,
    coupon: selectedCoupon,
    plan: selectedPlan,
    couponState: selectedCouponState,
    sessionAccessToken: selected.sessionAccessToken,
    pricingUrl,
  }

  const checkout = await openChatGPTTeamTrialCheckout(page, checkoutContext)
  const checkoutUrl = checkout.checkoutUrl
  const trialClaimClicked = checkout.trialClaimClicked
  await saveTeamTrialStorageStateIfRequested(page, input, options)
  await prepareChatGPTTeamTrialCheckout(page, checkoutContext, checkout)

  const submittedPayment = await submitChatGPTTeamTrialCheckout(
    page,
    checkoutContext,
    checkoutUrl,
  )
  const paymentRedirect = submittedPayment.redirect
  const paymentRedirectUrlPath = submittedPayment.redirectUrlPath
  const paypalBaTokenCaptured = submittedPayment.paypalBaTokenCaptured
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
        async beforeLinkButtonClick() {
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
                gopayUnlinkStatus: 'waiting',
                lastMessage:
                  'Waiting for GoPay unlink task before clicking GoPay Link and pay',
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

  const gopayPayment = await continueGoPayPaymentFromRedirect(page, redirect, {
    ...resolveChatGPTTeamTrialGoPayAccount(),
    waitForOtpCode: createChatGPTTeamTrialGoPayOtpCodeProvider(options),
    async beforeLinkButtonClick() {
      if (!gopayUnlinkTask) {
        return
      }

      if (gopayUnlinkTask.status === 'failed') {
        await patchTeamTrialMachine(machine, 'chatgpt.gopay_unlink.failed', {
          paymentMethod,
          url: page.url(),
          paymentRedirectUrl: redirect.url,
          paypalApprovalUrl: redirect.url,
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
        gopayUnlinkStatus: 'waiting',
        lastMessage:
          'Waiting for GoPay unlink task before clicking GoPay Link and pay',
      })

      try {
        gopayUnlink = await gopayUnlinkTask.wait()
      } catch (error) {
        await patchTeamTrialMachine(machine, 'chatgpt.gopay_unlink.failed', {
          paymentMethod,
          url: page.url(),
          paymentRedirectUrl: redirect.url,
          paypalApprovalUrl: redirect.url,
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
  })

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
    gopayAuthorizationConsentClicked: gopayPayment.authorizationConsentClicked,
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
  const machine =
    createChatGPTTeamTrialMachine<ChatGPTTeamTrialGoPayFlowResult>()
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
