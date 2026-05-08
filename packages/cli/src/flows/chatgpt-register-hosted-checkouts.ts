import type { Page } from 'patchright'
import path from 'path'
import {
  assignContextFromInput,
  composeStateMachineConfig,
  createStateMachine,
  declareStateMachineStates,
  isStateMachinePatchInput,
  type StateMachineController,
  type StateMachinePatchInput,
  type StateMachineSnapshot,
} from '../state-machine'
import { createFlowLifecycleFragment } from './machine-fragments'
import {
  registerChatGPT,
  type ChatGPTRegistrationFlowResult,
} from './chatgpt-register'
import {
  applyChatGPTTeamTrialStateProxyConfig,
  resolveChatGPTTeamTrialPromoCoupon,
} from './chatgpt-team-trial'
import {
  createChatGPTBackendApiHeadersCapture,
  createChatGPTTrialCheckoutLink,
  getChatGPTTrialPromoPlan,
  type ChatGPTBackendApiHeadersCapture,
  type ChatGPTTrialCheckoutLink,
  type ChatGPTTrialPromoCoupon,
  type ChatGPTTrialPromoPlan,
} from '../modules/chatgpt/shared'
import {
  attachStateMachineProgressReporter,
  parseBooleanFlag,
  sanitizeErrorForOutput,
  type FlowOptions,
} from '../modules/flow-cli/helpers'
import { getRuntimeConfig } from '../config'
import { writeFileAtomic } from '../utils/fs'

const HOSTED_CHECKOUT_DEFAULT_CURRENCY = 'USD'
const HOSTED_CHECKOUT_SUPPORTED_CURRENCIES = [
  'USD',
  'AUD',
  'CAD',
  'GBP',
  'EUR',
  'CLP',
  'JPY',
  'INR',
  'IDR',
  'PKR',
  'THB',
  'MYR',
  'TWD',
  'VND',
  'PHP',
  'NGN',
  'ZAR',
  'KZT',
  'TZS',
  'EGP',
  'BRL',
  'SEK',
  'CZK',
  'PLN',
  'DKK',
  'NOK',
  'KRW',
  'COP',
  'MXN',
  'PEN',
  'HUF',
  'QAR',
  'RON',
  'ILS',
  'AED',
  'SGD',
  'NZD',
  'CHF',
  'SAR',
] as const
const CHECKOUT_PAGE_SETTLE_TIMEOUT_MS = 30000

export const CHATGPT_HOSTED_CHECKOUT_COUNTRIES = [
  'NC',
  'MA',
  'XK',
  'AR',
  'SS',
  'FK',
  'YT',
  'DO',
  'NG',
  'GP',
  'IE',
  'ME',
  'BW',
  'NA',
  'NR',
  'MR',
  'ZA',
  'NU',
  'TV',
  'FR',
  'LS',
  'TC',
  'MD',
  'EE',
  'VU',
  'BT',
  'SB',
  'GY',
  'MN',
  'DE',
  'SK',
  'BS',
  'PW',
  'KR',
  'AO',
  'AT',
  'BR',
  'HU',
  'ES',
  'AE',
  'MQ',
  'GI',
  'BJ',
  'SX',
  'PN',
  'CW',
  'MT',
  'FJ',
  'MK',
  'MZ',
  'AZ',
  'TT',
  'CI',
  'HR',
  'GF',
  'GU',
  'EU',
  'SD',
  'TZ',
  'RW',
  'FM',
  'AU',
  'TR',
  'UZ',
  'AD',
  'ET',
  'PE',
  'PY',
  'HN',
  'CV',
  'VN',
  'VC',
  'WS',
  'GR',
  'GM',
  'TO',
  'LK',
  'KY',
  'LC',
  'NP',
  'BM',
  'MY',
  'PH',
  'MH',
  'RS',
  'BO',
  'EC',
  'GB',
  'KM',
  'UA',
  'SR',
  'US2',
  'CM',
  'BN',
  'GQ',
  'SH',
  'SE',
  'KW',
  'GA',
  'MF',
  'BI',
  'LB',
  'IS',
  'ID',
  'BZ',
  'IT',
  'TW',
  'GE',
  'LA',
  'PT',
  'BH',
  'CG',
  'SZ',
  'AW',
  'NZ',
  'BB',
  'UY',
  'IL',
  'GT',
  'OM',
  'FI',
  'BE',
  'LU',
  'SM',
  'SN',
  'WF',
  'DK',
  'GL',
  'MP',
  'PL',
  'PA',
  'QA',
  'NL',
  'TG',
  'MC',
  'MM',
  'CO',
  'GH',
  'CR',
  'NF',
  'AM',
  'TF',
  'HT',
  'BQ',
  'AG',
  'US',
  'SJ',
  'MS',
  'MG',
  'PS',
  'ST',
  'NI',
  'CL',
  'DZ',
  'TN',
  'SA',
  'ER',
  'KG',
  'RE',
  'VA',
  'KH',
  'ML',
  'GD',
  'EG',
  'PR',
  'MW',
  'DJ',
  'CF',
  'AQ',
  'LT',
  'PM',
  'DM',
  'SV',
  'PK',
  'AX',
  'NO',
  'CD',
  'PF',
  'PG',
  'VG',
  'JP',
  'YE',
  'TK',
  'TL',
  'TH',
  'LV',
  'BA',
  'BD',
  'VI',
  'BF',
  'AF',
  'MU',
  'BL',
  'IQ',
  'RO',
  'KZ',
  'ZW',
  'JM',
  'SG',
  'GN',
  'TD',
  'UG',
  'BG',
  'CK',
  'KI',
  'SL',
  'IN',
  'MV',
  'CY',
  'SC',
  'LY',
  'AS',
  'CH',
  'LR',
  'TJ',
  'FO',
  'MX',
  'SO',
  'KE',
  'JE',
  'IM',
  'TM',
  'GG',
  'ZM',
  'GW',
  'SI',
  'KN',
  'CA',
  'LI',
  'AL',
  'JO',
  'AI',
  'CZ',
  'NE',
] as const

const HOSTED_CHECKOUT_COUNTRY_ALIASES = {
  US2: 'US',
  EU: 'IE',
  GF: 'FR',
  GG: 'GB',
  GP: 'FR',
  IM: 'GB',
  JE: 'GB',
  MC: 'FR',
  MF: 'FR',
  MQ: 'FR',
  PF: 'FR',
  RE: 'FR',
  VA: 'IT',
  YT: 'FR',
} as const satisfies Partial<Record<string, string>>
const HOSTED_CHECKOUT_COUNTRY_ALIAS_MAP: Partial<Record<string, string>> =
  HOSTED_CHECKOUT_COUNTRY_ALIASES

const HOSTED_CHECKOUT_COUNTRY_CURRENCIES = {
  AE: 'AED',
  AF: 'AFN',
  AL: 'ALL',
  AM: 'AMD',
  AR: 'ARS',
  AU: 'AUD',
  AZ: 'AZN',
  BA: 'BAM',
  BD: 'BDT',
  BH: 'BHD',
  BM: 'BMD',
  BN: 'BND',
  BO: 'BOB',
  BR: 'BRL',
  BS: 'BSD',
  BW: 'BWP',
  CA: 'CAD',
  CH: 'CHF',
  CL: 'CLP',
  CN: 'CNY',
  CO: 'COP',
  CR: 'CRC',
  CZ: 'CZK',
  DK: 'DKK',
  DO: 'DOP',
  DZ: 'DZD',
  AD: 'EUR',
  AT: 'EUR',
  AX: 'EUR',
  BE: 'EUR',
  BG: 'EUR',
  CY: 'EUR',
  DE: 'EUR',
  EE: 'EUR',
  EC: 'USD',
  EG: 'EGP',
  ES: 'EUR',
  ET: 'ETB',
  EU: 'EUR',
  FI: 'EUR',
  FJ: 'FJD',
  FK: 'FKP',
  FR: 'EUR',
  GB: 'GBP',
  GE: 'GEL',
  GH: 'GHS',
  GI: 'GBP',
  GM: 'GMD',
  GR: 'EUR',
  GT: 'GTQ',
  GY: 'GYD',
  HK: 'HKD',
  HN: 'HNL',
  HR: 'EUR',
  HU: 'HUF',
  ID: 'IDR',
  IE: 'EUR',
  IL: 'ILS',
  IN: 'INR',
  IS: 'EUR',
  IT: 'EUR',
  JE: 'GBP',
  JM: 'JMD',
  JO: 'JOD',
  JP: 'JPY',
  KE: 'KES',
  KG: 'KGS',
  KH: 'KHR',
  KR: 'KRW',
  KW: 'KWD',
  KZ: 'KZT',
  LA: 'LAK',
  LB: 'LBP',
  LI: 'CHF',
  LK: 'LKR',
  LT: 'EUR',
  LU: 'EUR',
  LV: 'EUR',
  MA: 'MAD',
  MC: 'EUR',
  MD: 'MDL',
  ME: 'EUR',
  MK: 'MKD',
  MT: 'EUR',
  MM: 'MMK',
  MN: 'MNT',
  MO: 'MOP',
  MU: 'MUR',
  MV: 'MVR',
  MX: 'MXN',
  MY: 'MYR',
  MZ: 'MZN',
  NA: 'NAD',
  NG: 'NGN',
  NI: 'NIO',
  NL: 'EUR',
  NO: 'NOK',
  NP: 'NPR',
  NZ: 'NZD',
  OM: 'OMR',
  PA: 'PAB',
  PE: 'PEN',
  PG: 'PGK',
  PH: 'PHP',
  PK: 'PKR',
  PL: 'PLN',
  PR: 'USD',
  PT: 'EUR',
  PY: 'PYG',
  QA: 'QAR',
  RO: 'RON',
  RS: 'EUR',
  RW: 'RWF',
  SA: 'SAR',
  SB: 'SBD',
  SC: 'SCR',
  SE: 'SEK',
  SG: 'SGD',
  SI: 'EUR',
  SK: 'EUR',
  SM: 'EUR',
  TH: 'THB',
  TJ: 'TJS',
  TN: 'TND',
  TR: 'TRY',
  TT: 'TTD',
  TW: 'TWD',
  TZ: 'TZS',
  UA: 'UAH',
  UG: 'UGX',
  US: 'USD',
  US2: 'USD',
  UY: 'UYU',
  UZ: 'UZS',
  VN: 'VND',
  WS: 'WST',
  XK: 'EUR',
  ZA: 'ZAR',
  ZM: 'ZMW',
} as const satisfies Partial<Record<string, string>>
const HOSTED_CHECKOUT_COUNTRY_CURRENCY_MAP: Partial<Record<string, string>> =
  HOSTED_CHECKOUT_COUNTRY_CURRENCIES

export type ChatGPTRegisterHostedCheckoutsFlowKind =
  'chatgpt-register-hosted-checkouts'

export type ChatGPTRegisterHostedCheckoutsFlowState =
  | 'idle'
  | 'registering'
  | 'coupon-checking'
  | 'checkout-link-creating'
  | 'checkout-page-open'
  | 'waiting-page-close'
  | 'retrying'
  | 'completed'
  | 'failed'

export type ChatGPTRegisterHostedCheckoutsFlowEvent =
  | 'machine.started'
  | 'chatgpt.registration.started'
  | 'chatgpt.registration.completed'
  | 'chatgpt.coupon.checking'
  | 'chatgpt.coupon.selected'
  | 'chatgpt.checkout_link.creating'
  | 'chatgpt.checkout_link.created'
  | 'chatgpt.checkout_link.skipped'
  | 'chatgpt.checkout_page.opened'
  | 'chatgpt.checkout_page.closed'
  | 'chatgpt.retry.requested'
  | 'chatgpt.completed'
  | 'chatgpt.failed'
  | 'context.updated'
  | 'action.started'
  | 'action.finished'

export interface ChatGPTHostedCheckoutCountryLink {
  requestedCountry: string
  billingCountry: string
  billingCurrency: string
  url: string
  checkoutSessionId?: string
  processorEntity?: string
  createdAt: string
}

export interface ChatGPTHostedCheckoutCountrySkip {
  requestedCountry: string
  billingCountry: string
  billingCurrency: string
  reason: string
  skippedAt: string
}

export interface ChatGPTRegisterHostedCheckoutsContext<Result = unknown> {
  kind: ChatGPTRegisterHostedCheckoutsFlowKind
  url?: string
  title?: string
  email?: string
  registration?: ChatGPTRegistrationFlowResult
  coupon?: ChatGPTTrialPromoCoupon
  plan?: ChatGPTTrialPromoPlan
  currentCountry?: string
  currentIndex?: number
  totalCountries?: number
  checkoutLinks?: ChatGPTHostedCheckoutCountryLink[]
  skippedCheckouts?: ChatGPTHostedCheckoutCountrySkip[]
  checkoutLinksPath?: string
  retryCount?: number
  retryReason?: string
  retryFromState?: ChatGPTRegisterHostedCheckoutsFlowState
  lastAttempt?: number
  lastMessage?: string
  result?: Result
}

export type ChatGPTRegisterHostedCheckoutsMachine<Result = unknown> =
  StateMachineController<
    ChatGPTRegisterHostedCheckoutsFlowState,
    ChatGPTRegisterHostedCheckoutsContext<Result>,
    ChatGPTRegisterHostedCheckoutsFlowEvent
  >

export type ChatGPTRegisterHostedCheckoutsSnapshot<Result = unknown> =
  StateMachineSnapshot<
    ChatGPTRegisterHostedCheckoutsFlowState,
    ChatGPTRegisterHostedCheckoutsContext<Result>,
    ChatGPTRegisterHostedCheckoutsFlowEvent
  >

export interface ChatGPTRegisterHostedCheckoutsResult {
  pageName: 'chatgpt-register-hosted-checkouts'
  url: string
  title: string
  email: string
  verified: boolean
  registration: ChatGPTRegistrationFlowResult
  coupon: ChatGPTTrialPromoCoupon
  plan: ChatGPTTrialPromoPlan
  checkoutLinks: ChatGPTHostedCheckoutCountryLink[]
  skippedCheckouts: ChatGPTHostedCheckoutCountrySkip[]
  checkoutLinksPath: string
  machine: ChatGPTRegisterHostedCheckoutsSnapshot<ChatGPTRegisterHostedCheckoutsResult>
}

export interface ChatGPTHostedCheckoutCountrySpec {
  requestedCountry: string
  billingCountry: string
  billingCurrency: string
}

const chatgptRegisterHostedCheckoutsStates = [
  'idle',
  'registering',
  'coupon-checking',
  'checkout-link-creating',
  'checkout-page-open',
  'waiting-page-close',
  'retrying',
  'completed',
  'failed',
] as const satisfies readonly ChatGPTRegisterHostedCheckoutsFlowState[]

const chatgptRegisterHostedCheckoutsEventTargets = {
  'chatgpt.registration.started': 'registering',
  'chatgpt.registration.completed': 'coupon-checking',
  'chatgpt.coupon.checking': 'coupon-checking',
  'chatgpt.coupon.selected': 'checkout-link-creating',
  'chatgpt.checkout_link.creating': 'checkout-link-creating',
  'chatgpt.checkout_link.created': 'checkout-page-open',
  'chatgpt.checkout_link.skipped': 'checkout-link-creating',
  'chatgpt.checkout_page.opened': 'waiting-page-close',
  'chatgpt.checkout_page.closed': 'checkout-link-creating',
  'chatgpt.completed': 'completed',
  'chatgpt.failed': 'failed',
} as const satisfies Partial<
  Record<
    ChatGPTRegisterHostedCheckoutsFlowEvent,
    ChatGPTRegisterHostedCheckoutsFlowState
  >
>

const chatgptRegisterHostedCheckoutsMutableContextEvents = [
  'context.updated',
  'action.started',
  'action.finished',
] as const satisfies ChatGPTRegisterHostedCheckoutsFlowEvent[]

function assignHostedCheckoutPatch() {
  return assignContextFromInput<
    ChatGPTRegisterHostedCheckoutsFlowState,
    ChatGPTRegisterHostedCheckoutsContext<ChatGPTRegisterHostedCheckoutsResult>,
    ChatGPTRegisterHostedCheckoutsFlowEvent,
    StateMachinePatchInput<
      ChatGPTRegisterHostedCheckoutsFlowState,
      ChatGPTRegisterHostedCheckoutsContext<ChatGPTRegisterHostedCheckoutsResult>
    >
  >(isStateMachinePatchInput, (_context, { input }) => input.patch ?? {})
}

export function normalizeHostedCheckoutCountryCode(value: string): string {
  const normalized = value.trim().toUpperCase()
  return HOSTED_CHECKOUT_COUNTRY_ALIAS_MAP[normalized] || normalized
}

export function getHostedCheckoutCurrencyForCountry(value: string): string {
  const normalized = value.trim().toUpperCase()
  const country = normalizeHostedCheckoutCountryCode(normalized)
  const currency =
    HOSTED_CHECKOUT_COUNTRY_CURRENCY_MAP[normalized] ||
    HOSTED_CHECKOUT_COUNTRY_CURRENCY_MAP[country] ||
    HOSTED_CHECKOUT_DEFAULT_CURRENCY
  return HOSTED_CHECKOUT_SUPPORTED_CURRENCIES.includes(
    currency as (typeof HOSTED_CHECKOUT_SUPPORTED_CURRENCIES)[number],
  )
    ? currency
    : HOSTED_CHECKOUT_DEFAULT_CURRENCY
}

export function resolveHostedCheckoutCountrySpecs(
  countries: readonly string[] = CHATGPT_HOSTED_CHECKOUT_COUNTRIES,
): ChatGPTHostedCheckoutCountrySpec[] {
  return countries
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean)
    .map((requestedCountry) => ({
      requestedCountry,
      billingCountry: normalizeHostedCheckoutCountryCode(requestedCountry),
      billingCurrency: getHostedCheckoutCurrencyForCountry(requestedCountry),
    }))
}

function getHostedCheckoutCountriesFromOptions(
  options: FlowOptions,
): readonly string[] {
  return options.hostedCheckoutCountry?.length
    ? options.hostedCheckoutCountry
    : CHATGPT_HOSTED_CHECKOUT_COUNTRIES
}

function shouldReviewHostedCheckoutPages(options: FlowOptions): boolean {
  return parseBooleanFlag(options.hostedCheckoutReview, true) ?? true
}

export function createChatGPTRegisterHostedCheckoutsMachine(): ChatGPTRegisterHostedCheckoutsMachine<ChatGPTRegisterHostedCheckoutsResult> {
  const states = declareStateMachineStates<
    ChatGPTRegisterHostedCheckoutsFlowState,
    ChatGPTRegisterHostedCheckoutsContext<ChatGPTRegisterHostedCheckoutsResult>,
    ChatGPTRegisterHostedCheckoutsFlowEvent
  >(chatgptRegisterHostedCheckoutsStates)
  states['checkout-link-creating'] = {
    ...states['checkout-link-creating'],
    on: {
      'chatgpt.checkout_link.creating': {
        target: 'checkout-link-creating',
        reenter: true,
        actions: assignHostedCheckoutPatch(),
      },
    },
  }

  return createStateMachine<
    ChatGPTRegisterHostedCheckoutsFlowState,
    ChatGPTRegisterHostedCheckoutsContext<ChatGPTRegisterHostedCheckoutsResult>,
    ChatGPTRegisterHostedCheckoutsFlowEvent
  >(
    composeStateMachineConfig(
      {
        id: 'flow.chatgpt.register_hosted_checkouts',
        initialState: 'idle',
        initialContext: {
          kind: 'chatgpt-register-hosted-checkouts',
          checkoutLinks: [],
          skippedCheckouts: [],
        },
        historyLimit: 300,
        states,
      },
      createFlowLifecycleFragment<
        ChatGPTRegisterHostedCheckoutsFlowState,
        ChatGPTRegisterHostedCheckoutsContext<ChatGPTRegisterHostedCheckoutsResult>,
        ChatGPTRegisterHostedCheckoutsFlowEvent
      >({
        eventTargets: chatgptRegisterHostedCheckoutsEventTargets,
        mutableContextEvents:
          chatgptRegisterHostedCheckoutsMutableContextEvents,
        retryEvent: 'chatgpt.retry.requested',
        retryTarget: 'retrying',
        defaultRetryMessage: 'Creating hosted checkout link',
      }),
    ),
  )
}

async function sendHostedCheckoutsMachine(
  machine: ChatGPTRegisterHostedCheckoutsMachine<ChatGPTRegisterHostedCheckoutsResult>,
  event: ChatGPTRegisterHostedCheckoutsFlowEvent,
  patch?: Partial<
    ChatGPTRegisterHostedCheckoutsContext<ChatGPTRegisterHostedCheckoutsResult>
  >,
): Promise<void> {
  await machine.send(event, {
    patch,
  })
}

function formatArtifactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

function saveHostedCheckoutLinks(
  links: ChatGPTHostedCheckoutCountryLink[],
): string {
  const runtimeConfig = getRuntimeConfig()
  const filePath = path.join(
    runtimeConfig.artifactsDir,
    `${formatArtifactTimestamp()}-chatgpt-hosted-checkouts.json`,
  )
  writeFileAtomic(filePath, `${JSON.stringify(links, null, 2)}\n`)
  return filePath
}

function toHostedCheckoutLink(
  spec: ChatGPTHostedCheckoutCountrySpec,
  checkout: ChatGPTTrialCheckoutLink,
): ChatGPTHostedCheckoutCountryLink {
  return {
    requestedCountry: spec.requestedCountry,
    billingCountry: spec.billingCountry,
    billingCurrency: spec.billingCurrency,
    url: checkout.url,
    ...(checkout.checkoutSessionId
      ? { checkoutSessionId: checkout.checkoutSessionId }
      : {}),
    ...(checkout.processorEntity
      ? { processorEntity: checkout.processorEntity }
      : {}),
    createdAt: new Date().toISOString(),
  }
}

function toSkippedHostedCheckout(
  spec: ChatGPTHostedCheckoutCountrySpec,
  error: unknown,
): ChatGPTHostedCheckoutCountrySkip {
  return {
    requestedCountry: spec.requestedCountry,
    billingCountry: spec.billingCountry,
    billingCurrency: spec.billingCurrency,
    reason: sanitizeErrorForOutput(error).message,
    skippedAt: new Date().toISOString(),
  }
}

export function isRecoverableHostedCheckoutCountryError(
  error: unknown,
): boolean {
  const message = sanitizeErrorForOutput(error).message
  return /HTTP 400/i.test(message) && /invalid billing details/i.test(message)
}

function chooseHostedCheckoutCoupon(
  options: FlowOptions,
): {
  coupon: ChatGPTTrialPromoCoupon
  plan: ChatGPTTrialPromoPlan
} {
  const coupon = resolveChatGPTTeamTrialPromoCoupon(options)

  return {
    coupon,
    plan: getChatGPTTrialPromoPlan(coupon),
  }
}

async function waitForOperatorToClosePage(page: Page): Promise<void> {
  if (page.isClosed()) {
    return
  }

  await new Promise<void>((resolve) => {
    page.once('close', () => resolve())
  })
}

function isCheckoutReviewPageClosedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /page.*closed|target.*closed|context.*closed|browser.*closed/i.test(
      error.message,
    )
  )
}

async function openHostedCheckoutForReview(input: {
  sourcePage: Page
  link: ChatGPTHostedCheckoutCountryLink
  index: number
  total: number
  options: FlowOptions
}): Promise<void> {
  const checkoutPage = await input.sourcePage.context().newPage()
  input.options.progressReporter?.({
    message: `Opening hosted checkout ${input.index + 1}/${input.total} for ${input.link.requestedCountry}`,
  })

  const closePromise = waitForOperatorToClosePage(checkoutPage)
  const loadPromise = (async () => {
    await checkoutPage.goto(input.link.url, { waitUntil: 'domcontentloaded' })
    await checkoutPage.locator('body').waitFor({
      state: 'visible',
      timeout: CHECKOUT_PAGE_SETTLE_TIMEOUT_MS,
    })
    await checkoutPage.waitForLoadState('networkidle').catch(() => undefined)
  })()

  const firstOutcome = await Promise.race([
    closePromise.then(() => 'closed' as const),
    loadPromise
      .then(() => 'loaded' as const)
      .catch((error: unknown) => ({ error })),
  ])

  if (firstOutcome === 'closed') {
    loadPromise.catch(() => undefined)
    return
  }

  if (typeof firstOutcome === 'object') {
    if (
      checkoutPage.isClosed() ||
      isCheckoutReviewPageClosedError(firstOutcome.error)
    ) {
      return
    }
    throw firstOutcome.error
  }

  await waitForOperatorToClosePage(checkoutPage)
}

async function generateAndReviewHostedCheckoutLinks(input: {
  page: Page
  options: FlowOptions
  machine: ChatGPTRegisterHostedCheckoutsMachine<ChatGPTRegisterHostedCheckoutsResult>
  backendApiHeadersCapture: ChatGPTBackendApiHeadersCapture
  email: string
  coupon: ChatGPTTrialPromoCoupon
  plan: ChatGPTTrialPromoPlan
}): Promise<ChatGPTHostedCheckoutCountryLink[]> {
  const countrySpecs = resolveHostedCheckoutCountrySpecs(
    getHostedCheckoutCountriesFromOptions(input.options),
  )
  const links: ChatGPTHostedCheckoutCountryLink[] = []
  const skippedCheckouts: ChatGPTHostedCheckoutCountrySkip[] = []

  for (let index = 0; index < countrySpecs.length; index += 1) {
    const spec = countrySpecs[index]
    await applyChatGPTTeamTrialStateProxyConfig('creating-checkout', {
      options: input.options,
      paymentMethod: 'gopay',
      patch: {
        email: input.email,
        coupon: input.coupon,
        trialPlan: input.plan,
        paymentMethod: 'gopay',
        pricingRegion: spec.billingCountry,
        url: input.page.url(),
      },
    })
    await sendHostedCheckoutsMachine(
      input.machine,
      'chatgpt.checkout_link.creating',
      {
        email: input.email,
        coupon: input.coupon,
        plan: input.plan,
        currentCountry: spec.requestedCountry,
        currentIndex: index + 1,
        totalCountries: countrySpecs.length,
        checkoutLinks: links,
        url: input.page.url(),
        lastMessage: `Creating hosted checkout link ${index + 1}/${countrySpecs.length} for ${spec.requestedCountry}`,
      },
    )

    let checkout: ChatGPTTrialCheckoutLink
    try {
      checkout = await createChatGPTTrialCheckoutLink(
        input.page,
        input.coupon,
        {
          paymentMethod: 'gopay',
          checkoutUiMode: 'hosted',
          billingCountry: spec.billingCountry,
          billingCurrency: spec.billingCurrency,
          requestHeaders: input.backendApiHeadersCapture.get()?.headers,
        },
      )
    } catch (error) {
      if (!isRecoverableHostedCheckoutCountryError(error)) {
        throw error
      }

      const skipped = toSkippedHostedCheckout(spec, error)
      skippedCheckouts.push(skipped)
      input.options.progressReporter?.({
        message: `Skipping hosted checkout ${index + 1}/${countrySpecs.length} for ${spec.requestedCountry}: ${skipped.reason}`,
      })
      await sendHostedCheckoutsMachine(
        input.machine,
        'chatgpt.checkout_link.skipped',
        {
          email: input.email,
          currentCountry: spec.requestedCountry,
          currentIndex: index + 1,
          totalCountries: countrySpecs.length,
          checkoutLinks: links,
          skippedCheckouts,
          url: input.page.url(),
          lastMessage: `Skipped hosted checkout ${index + 1}/${countrySpecs.length} for ${spec.requestedCountry}: ${skipped.reason}`,
        },
      )
      continue
    }
    await applyChatGPTTeamTrialStateProxyConfig('checkout-ready', {
      options: input.options,
      paymentMethod: 'gopay',
      patch: {
        email: input.email,
        coupon: input.coupon,
        trialPlan: input.plan,
        paymentMethod: 'gopay',
        pricingRegion: spec.billingCountry,
        checkoutUrl: checkout.url,
        url: input.page.url(),
      },
    })

    const link = toHostedCheckoutLink(spec, checkout)
    links.push(link)
    await sendHostedCheckoutsMachine(
      input.machine,
      'chatgpt.checkout_link.created',
      {
        email: input.email,
        currentCountry: spec.requestedCountry,
        currentIndex: index + 1,
        totalCountries: countrySpecs.length,
        checkoutLinks: links,
        skippedCheckouts,
        url: checkout.url,
        lastMessage: `Hosted checkout link ${index + 1}/${countrySpecs.length} created for ${spec.requestedCountry}`,
      },
    )

    await sendHostedCheckoutsMachine(
      input.machine,
      'chatgpt.checkout_page.opened',
      {
        email: input.email,
        currentCountry: spec.requestedCountry,
        currentIndex: index + 1,
        totalCountries: countrySpecs.length,
        checkoutLinks: links,
        skippedCheckouts,
        url: checkout.url,
        lastMessage: `Waiting for operator to close hosted checkout ${index + 1}/${countrySpecs.length} (${spec.requestedCountry})`,
      },
    )
    if (shouldReviewHostedCheckoutPages(input.options)) {
      await openHostedCheckoutForReview({
        sourcePage: input.page,
        link,
        index,
        total: countrySpecs.length,
        options: input.options,
      })
    } else {
      input.options.progressReporter?.({
        message: `Review disabled for hosted checkout ${index + 1}/${countrySpecs.length} (${spec.requestedCountry})`,
      })
    }
    if (index < countrySpecs.length - 1) {
      await sendHostedCheckoutsMachine(
        input.machine,
        'chatgpt.checkout_page.closed',
        {
          email: input.email,
          currentCountry: spec.requestedCountry,
          currentIndex: index + 1,
          totalCountries: countrySpecs.length,
          checkoutLinks: links,
          skippedCheckouts,
          url: input.page.url(),
          lastMessage: `Hosted checkout ${index + 1}/${countrySpecs.length} closed`,
        },
      )
    } else {
      await sendHostedCheckoutsMachine(input.machine, 'context.updated', {
        email: input.email,
        currentCountry: spec.requestedCountry,
        currentIndex: index + 1,
        totalCountries: countrySpecs.length,
        checkoutLinks: links,
        skippedCheckouts,
        url: input.page.url(),
        lastMessage: `Hosted checkout ${index + 1}/${countrySpecs.length} closed`,
      })
    }
  }

  return links
}

export async function registerChatGPTAndReviewHostedCheckouts(
  page: Page,
  options: FlowOptions = {},
): Promise<ChatGPTRegisterHostedCheckoutsResult> {
  const machine = createChatGPTRegisterHostedCheckoutsMachine()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )
  const backendApiHeadersCapture = createChatGPTBackendApiHeadersCapture(page)

  try {
    machine.start(
      {
        checkoutLinks: [],
        skippedCheckouts: [],
        totalCountries: getHostedCheckoutCountriesFromOptions(options).length,
      },
      {
        source: 'registerChatGPTAndReviewHostedCheckouts',
      },
    )
    await sendHostedCheckoutsMachine(machine, 'chatgpt.registration.started', {
      lastMessage:
        'Starting ChatGPT registration before hosted checkout review',
    })

    const registration = await registerChatGPT(page, {
      ...options,
      claimTrial: false,
      claimTeamTrial: false,
    })
    await sendHostedCheckoutsMachine(
      machine,
      'chatgpt.registration.completed',
      {
        email: registration.email,
        registration,
        url: registration.url,
        title: registration.title,
        lastMessage:
          'ChatGPT registration completed; preparing hosted checkout links',
      },
    )

    await sendHostedCheckoutsMachine(machine, 'chatgpt.coupon.checking', {
      email: registration.email,
      url: page.url(),
      lastMessage: 'Selecting configured ChatGPT trial coupon',
    })
    const { coupon, plan } = chooseHostedCheckoutCoupon(options)
    await sendHostedCheckoutsMachine(machine, 'chatgpt.coupon.selected', {
      email: registration.email,
      coupon,
      plan,
      url: page.url(),
      lastMessage: `Selected ChatGPT ${plan} trial coupon ${coupon}`,
    })

    const checkoutLinks = await generateAndReviewHostedCheckoutLinks({
      page,
      options,
      machine,
      backendApiHeadersCapture,
      email: registration.email,
      coupon,
      plan,
    })
    const checkoutLinksPath = saveHostedCheckoutLinks(checkoutLinks)
    const skippedCheckouts =
      machine.getSnapshot().context.skippedCheckouts ?? []
    const result = {
      pageName: 'chatgpt-register-hosted-checkouts' as const,
      url: page.url(),
      title: await page.title(),
      email: registration.email,
      verified: registration.verified,
      registration,
      coupon,
      plan,
      checkoutLinks,
      skippedCheckouts,
      checkoutLinksPath,
      machine:
        undefined as unknown as ChatGPTRegisterHostedCheckoutsSnapshot<ChatGPTRegisterHostedCheckoutsResult>,
    }
    const snapshot = machine.succeed('completed', {
      event: 'chatgpt.completed',
      patch: {
        email: registration.email,
        coupon,
        plan,
        registration,
        checkoutLinks,
        skippedCheckouts,
        checkoutLinksPath,
        result,
        url: result.url,
        title: result.title,
        lastMessage: 'All hosted checkout pages were reviewed',
      },
    })
    result.machine = snapshot
    return result
  } catch (error) {
    machine.fail(error, 'failed', {
      event: 'chatgpt.failed',
      patch: {
        url: page.url(),
        lastMessage: sanitizeErrorForOutput(error).message,
      },
    })
    throw error
  } finally {
    backendApiHeadersCapture.dispose()
    detachProgress()
  }
}
