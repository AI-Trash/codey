import type { Page } from 'patchright'
import path from 'path'
import { pathToFileURL } from 'url'
import {
  composeStateMachineConfig,
  createPatchTransitionMap,
  createRetryTransition,
  createSelfPatchTransitionMap,
  createStateMachine,
  declareStateMachineStates,
  defineStateMachineFragment,
  type StateMachineController,
  type StateMachineSnapshot,
} from '../state-machine'
import {
  CHATGPT_TEAM_PRICING_PROMO_URL,
  clickChatGPTCheckoutSubscribeAndCapturePaypalLink,
  clickTeamPricingFreeTrial,
  fillChatGPTCheckoutBillingAddress,
  gotoTeamPricingPromo,
  type ChatGPTTeamTrialBillingAddress,
  waitForAuthenticatedSession,
  waitForChatGPTCheckoutReady,
  waitForTeamPricingFreeTrialReady,
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
  billingCountry?: string
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
  'filling-billing-address',
  'billing-address-filled',
  'subscribing',
  'paypal-link-captured',
  'retrying',
  'completed',
  'failed',
] as const satisfies readonly ChatGPTTeamTrialFlowState[]

function createChatGPTTeamTrialLifecycleFragment<Result>() {
  return defineStateMachineFragment<
    ChatGPTTeamTrialFlowState,
    ChatGPTTeamTrialFlowContext<Result>,
    ChatGPTTeamTrialFlowEvent
  >({
    on: {
      ...createPatchTransitionMap<
        ChatGPTTeamTrialFlowState,
        ChatGPTTeamTrialFlowContext<Result>,
        ChatGPTTeamTrialFlowEvent
      >(chatgptTeamTrialEventTargets),
      'chatgpt.retry.requested': createRetryTransition<
        ChatGPTTeamTrialFlowState,
        ChatGPTTeamTrialFlowContext<Result>,
        ChatGPTTeamTrialFlowEvent
      >({
        target: 'retrying',
        defaultMessage: 'Retrying ChatGPT Team trial flow',
      }),
      ...createSelfPatchTransitionMap<
        ChatGPTTeamTrialFlowState,
        ChatGPTTeamTrialFlowContext<Result>,
        ChatGPTTeamTrialFlowEvent
      >([...chatgptTeamTrialMutableContextEvents]),
    },
  })
}

export function createChatGPTTeamTrialMachine(): ChatGPTTeamTrialFlowMachine<ChatGPTTeamTrialFlowResult> {
  return createStateMachine<
    ChatGPTTeamTrialFlowState,
    ChatGPTTeamTrialFlowContext<ChatGPTTeamTrialFlowResult>,
    ChatGPTTeamTrialFlowEvent
  >(
    composeStateMachineConfig(
      {
        id: 'flow.chatgpt.team_trial',
        initialState: 'idle',
        initialContext: {
          kind: 'chatgpt-team-trial',
          url: CHATGPT_TEAM_PRICING_PROMO_URL,
        },
        historyLimit: 200,
        states: declareStateMachineStates<
          ChatGPTTeamTrialFlowState,
          ChatGPTTeamTrialFlowContext<ChatGPTTeamTrialFlowResult>,
          ChatGPTTeamTrialFlowEvent
        >(chatgptTeamTrialStates),
      },
      createChatGPTTeamTrialLifecycleFragment<ChatGPTTeamTrialFlowResult>(),
    ),
  )
}

async function sendTeamTrialMachine(
  machine: ChatGPTTeamTrialFlowMachine<ChatGPTTeamTrialFlowResult>,
  state: ChatGPTTeamTrialFlowState,
  event: ChatGPTTeamTrialFlowEvent,
  patch?: Partial<ChatGPTTeamTrialFlowContext<ChatGPTTeamTrialFlowResult>>,
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
        url: CHATGPT_TEAM_PRICING_PROMO_URL,
        lastMessage: 'Starting ChatGPT Team trial flow',
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

    const authenticated = await waitForAuthenticatedSession(page, 30000)
    if (!authenticated) {
      throw new Error(
        'ChatGPT Team trial flow lost the authenticated session after login.',
      )
    }

    await sendTeamTrialMachine(machine, 'home-ready', 'chatgpt.home.ready', {
      email: login.email,
      url: page.url(),
      lastMessage: 'Authenticated ChatGPT home is ready',
    })

    await sendTeamTrialMachine(
      machine,
      'opening-pricing',
      'chatgpt.pricing.opening',
      {
        email: login.email,
        url: CHATGPT_TEAM_PRICING_PROMO_URL,
        lastMessage: 'Opening ChatGPT Team pricing promo',
      },
    )
    await gotoTeamPricingPromo(page)

    const pricingReady = await waitForTeamPricingFreeTrialReady(page, 30000)
    if (!pricingReady) {
      throw new Error('ChatGPT Team pricing free trial button was not visible.')
    }

    await sendTeamTrialMachine(
      machine,
      'pricing-ready',
      'chatgpt.pricing.ready',
      {
        email: login.email,
        url: page.url(),
        lastMessage: 'ChatGPT Team pricing free trial button is ready',
      },
    )

    await sendTeamTrialMachine(
      machine,
      'claiming-trial',
      'chatgpt.trial.claiming',
      {
        email: login.email,
        url: page.url(),
        lastMessage: 'Clicking ChatGPT Team free trial button',
      },
    )
    await clickTeamPricingFreeTrial(page)
    const trialClaimTitle = await page.title()

    try {
      await saveLocalChatGPTStorageState(page, {
        identityId: login.storedIdentity.id,
        email: login.storedIdentity.email,
        flowType: 'chatgpt-team-trial',
      })
      options.progressReporter?.({
        message: `Saved local ChatGPT storage state for ${login.storedIdentity.email}`,
      })
    } catch (error) {
      options.progressReporter?.({
        message: `Local ChatGPT storage state save failed: ${sanitizeErrorForOutput(error).message}`,
      })
    }

    await sendTeamTrialMachine(
      machine,
      'trial-claimed',
      'chatgpt.trial.claimed',
      {
        email: login.email,
        url: page.url(),
        title: trialClaimTitle,
        lastMessage: 'ChatGPT Team free trial button clicked',
      },
    )

    const checkoutReady = await waitForChatGPTCheckoutReady(page, 60000)
    if (!checkoutReady) {
      throw new Error('ChatGPT Team trial checkout did not become ready.')
    }

    const checkoutUrl = page.url()
    const checkoutTitle = await page.title()

    await sendTeamTrialMachine(
      machine,
      'checkout-ready',
      'chatgpt.checkout.ready',
      {
        email: login.email,
        url: checkoutUrl,
        checkoutUrl,
        title: checkoutTitle,
        lastMessage: 'ChatGPT Team checkout is ready',
      },
    )

    const billingAddress = resolveChatGPTTeamTrialBillingAddress(options)

    await sendTeamTrialMachine(
      machine,
      'filling-billing-address',
      'chatgpt.billing_address.filling',
      {
        email: login.email,
        url: checkoutUrl,
        checkoutUrl,
        billingCountry: billingAddress.country,
        lastMessage: 'Filling ChatGPT checkout billing address',
      },
    )
    await fillChatGPTCheckoutBillingAddress(page, billingAddress)

    await sendTeamTrialMachine(
      machine,
      'billing-address-filled',
      'chatgpt.billing_address.filled',
      {
        email: login.email,
        url: page.url(),
        checkoutUrl,
        billingCountry: billingAddress.country,
        billingAddressFilled: true,
        lastMessage: 'ChatGPT checkout billing address filled',
      },
    )

    await sendTeamTrialMachine(
      machine,
      'subscribing',
      'chatgpt.subscription.submitting',
      {
        email: login.email,
        url: page.url(),
        checkoutUrl,
        billingAddressFilled: true,
        lastMessage: 'Submitting ChatGPT Team trial subscription',
      },
    )
    const paypalApproval =
      await clickChatGPTCheckoutSubscribeAndCapturePaypalLink(page)
    const paypalApprovalUrlPath = savePaypalApprovalUrl(paypalApproval.url)

    await sendTeamTrialMachine(
      machine,
      'paypal-link-captured',
      'chatgpt.paypal_link.captured',
      {
        email: login.email,
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

    const title = await page.title()
    const result = {
      pageName: 'chatgpt-team-trial' as const,
      url: page.url(),
      title,
      email: login.email,
      authenticated: true,
      pricingUrl: CHATGPT_TEAM_PRICING_PROMO_URL,
      checkoutUrl,
      trialClaimClicked: true,
      billingAddressFilled: true,
      subscribeClicked: true,
      paypalBaTokenCaptured: true,
      paypalApprovalUrl: paypalApproval.url,
      paypalApprovalUrlPath,
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
        checkoutUrl,
        billingAddressFilled: true,
        subscribeClicked: true,
        paypalBaTokenCaptured: true,
        paypalApprovalUrl: paypalApproval.url,
        paypalApprovalUrlPath,
        result,
        lastMessage: 'ChatGPT Team trial checkout flow completed',
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
    machine.fail('failed', error, {
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
