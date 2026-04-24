import type { Page } from 'patchright'
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
  clickTeamPricingFreeTrial,
  gotoTeamPricingPromo,
  waitForAuthenticatedSession,
  waitForTeamPricingFreeTrialReady,
} from '../modules/chatgpt/shared'
import type { FlowOptions } from '../modules/flow-cli/helpers'
import {
  attachStateMachineProgressReporter,
  sanitizeErrorForOutput,
} from '../modules/flow-cli/helpers'
import {
  runSingleFileFlowFromCommandLine,
  type SingleFileFlowDefinition,
} from '../modules/flow-cli/single-file'
import {
  loginChatGPT,
  type ChatGPTLoginFlowResult,
} from './chatgpt-login'

export type ChatGPTPurchaseFlowKind = 'chatgpt-purchase'

export type ChatGPTPurchaseFlowState =
  | 'idle'
  | 'logging-in'
  | 'home-ready'
  | 'opening-pricing'
  | 'pricing-ready'
  | 'claiming-trial'
  | 'trial-claimed'
  | 'retrying'
  | 'completed'
  | 'failed'

export type ChatGPTPurchaseFlowEvent =
  | 'machine.started'
  | 'chatgpt.login.started'
  | 'chatgpt.login.completed'
  | 'chatgpt.home.ready'
  | 'chatgpt.pricing.opening'
  | 'chatgpt.pricing.ready'
  | 'chatgpt.trial.claiming'
  | 'chatgpt.trial.claimed'
  | 'chatgpt.retry.requested'
  | 'chatgpt.completed'
  | 'chatgpt.failed'
  | 'context.updated'
  | 'action.started'
  | 'action.finished'

export interface ChatGPTPurchaseFlowContext<Result = unknown> {
  kind: ChatGPTPurchaseFlowKind
  url?: string
  title?: string
  email?: string
  login?: ChatGPTLoginFlowResult
  retryCount?: number
  retryReason?: string
  retryFromState?: ChatGPTPurchaseFlowState
  lastAttempt?: number
  lastMessage?: string
  result?: Result
}

export type ChatGPTPurchaseFlowMachine<Result = unknown> =
  StateMachineController<
    ChatGPTPurchaseFlowState,
    ChatGPTPurchaseFlowContext<Result>,
    ChatGPTPurchaseFlowEvent
  >

export type ChatGPTPurchaseFlowSnapshot<Result = unknown> =
  StateMachineSnapshot<
    ChatGPTPurchaseFlowState,
    ChatGPTPurchaseFlowContext<Result>,
    ChatGPTPurchaseFlowEvent
  >

export interface ChatGPTPurchaseFlowResult {
  pageName: 'chatgpt-purchase'
  url: string
  title: string
  email: string
  authenticated: boolean
  pricingUrl: string
  trialClaimClicked: boolean
  login: ChatGPTLoginFlowResult
  machine: ChatGPTPurchaseFlowSnapshot<ChatGPTPurchaseFlowResult>
}

const chatgptPurchaseEventTargets = {
  'machine.started': 'idle',
  'chatgpt.login.started': 'logging-in',
  'chatgpt.login.completed': 'home-ready',
  'chatgpt.home.ready': 'home-ready',
  'chatgpt.pricing.opening': 'opening-pricing',
  'chatgpt.pricing.ready': 'pricing-ready',
  'chatgpt.trial.claiming': 'claiming-trial',
  'chatgpt.trial.claimed': 'trial-claimed',
  'chatgpt.completed': 'completed',
  'chatgpt.failed': 'failed',
} as const satisfies Partial<
  Record<ChatGPTPurchaseFlowEvent, ChatGPTPurchaseFlowState>
>

const chatgptPurchaseMutableContextEvents = [
  'context.updated',
  'action.started',
  'action.finished',
] as const satisfies ChatGPTPurchaseFlowEvent[]

const chatgptPurchaseStates = [
  'idle',
  'logging-in',
  'home-ready',
  'opening-pricing',
  'pricing-ready',
  'claiming-trial',
  'trial-claimed',
  'retrying',
  'completed',
  'failed',
] as const satisfies readonly ChatGPTPurchaseFlowState[]

function createChatGPTPurchaseLifecycleFragment<Result>() {
  return defineStateMachineFragment<
    ChatGPTPurchaseFlowState,
    ChatGPTPurchaseFlowContext<Result>,
    ChatGPTPurchaseFlowEvent
  >({
    on: {
      ...createPatchTransitionMap<
        ChatGPTPurchaseFlowState,
        ChatGPTPurchaseFlowContext<Result>,
        ChatGPTPurchaseFlowEvent
      >(chatgptPurchaseEventTargets),
      'chatgpt.retry.requested': createRetryTransition<
        ChatGPTPurchaseFlowState,
        ChatGPTPurchaseFlowContext<Result>,
        ChatGPTPurchaseFlowEvent
      >({
        target: 'retrying',
        defaultMessage: 'Retrying ChatGPT purchase flow',
      }),
      ...createSelfPatchTransitionMap<
        ChatGPTPurchaseFlowState,
        ChatGPTPurchaseFlowContext<Result>,
        ChatGPTPurchaseFlowEvent
      >([...chatgptPurchaseMutableContextEvents]),
    },
  })
}

export function createChatGPTPurchaseMachine(): ChatGPTPurchaseFlowMachine<ChatGPTPurchaseFlowResult> {
  return createStateMachine<
    ChatGPTPurchaseFlowState,
    ChatGPTPurchaseFlowContext<ChatGPTPurchaseFlowResult>,
    ChatGPTPurchaseFlowEvent
  >(
    composeStateMachineConfig(
      {
        id: 'flow.chatgpt.purchase',
        initialState: 'idle',
        initialContext: {
          kind: 'chatgpt-purchase',
          url: CHATGPT_TEAM_PRICING_PROMO_URL,
        },
        historyLimit: 200,
        states: declareStateMachineStates<
          ChatGPTPurchaseFlowState,
          ChatGPTPurchaseFlowContext<ChatGPTPurchaseFlowResult>,
          ChatGPTPurchaseFlowEvent
        >(chatgptPurchaseStates),
      },
      createChatGPTPurchaseLifecycleFragment<ChatGPTPurchaseFlowResult>(),
    ),
  )
}

async function sendPurchaseMachine(
  machine: ChatGPTPurchaseFlowMachine<ChatGPTPurchaseFlowResult>,
  state: ChatGPTPurchaseFlowState,
  event: ChatGPTPurchaseFlowEvent,
  patch?: Partial<ChatGPTPurchaseFlowContext<ChatGPTPurchaseFlowResult>>,
): Promise<void> {
  await machine.send(event, {
    target: state,
    patch,
  })
}

export async function purchaseChatGPTTeamTrial(
  page: Page,
  options: FlowOptions = {},
): Promise<ChatGPTPurchaseFlowResult> {
  const machine = createChatGPTPurchaseMachine()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )

  try {
    machine.start(
      {
        url: CHATGPT_TEAM_PRICING_PROMO_URL,
        lastMessage: 'Starting ChatGPT purchase flow',
      },
      {
        source: 'purchaseChatGPTTeamTrial',
      },
    )

    await sendPurchaseMachine(machine, 'logging-in', 'chatgpt.login.started', {
      url: page.url(),
      lastMessage: 'Logging in before opening pricing promo',
    })
    const login = await loginChatGPT(page, options)

    await sendPurchaseMachine(machine, 'home-ready', 'chatgpt.login.completed', {
      email: login.email,
      login,
      url: login.url,
      title: login.title,
      lastMessage: 'ChatGPT login completed',
    })

    const authenticated = await waitForAuthenticatedSession(page, 30000)
    if (!authenticated) {
      throw new Error('ChatGPT purchase flow lost the authenticated session after login.')
    }

    await sendPurchaseMachine(machine, 'home-ready', 'chatgpt.home.ready', {
      email: login.email,
      url: page.url(),
      lastMessage: 'Authenticated ChatGPT home is ready',
    })

    await sendPurchaseMachine(
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

    await sendPurchaseMachine(machine, 'pricing-ready', 'chatgpt.pricing.ready', {
      email: login.email,
      url: page.url(),
      lastMessage: 'ChatGPT Team pricing free trial button is ready',
    })

    await sendPurchaseMachine(
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

    const title = await page.title()
    await sendPurchaseMachine(machine, 'trial-claimed', 'chatgpt.trial.claimed', {
      email: login.email,
      url: page.url(),
      title,
      lastMessage: 'ChatGPT Team free trial button clicked',
    })

    const result = {
      pageName: 'chatgpt-purchase' as const,
      url: page.url(),
      title,
      email: login.email,
      authenticated: true,
      pricingUrl: CHATGPT_TEAM_PRICING_PROMO_URL,
      trialClaimClicked: true,
      login,
      machine:
        undefined as unknown as ChatGPTPurchaseFlowSnapshot<ChatGPTPurchaseFlowResult>,
    }

    const snapshot = machine.succeed('completed', {
      event: 'chatgpt.completed',
      patch: {
        email: login.email,
        login,
        url: result.url,
        title: result.title,
        result,
        lastMessage: 'ChatGPT Team trial claim flow completed',
      },
    })
    result.machine = snapshot
    return result
  } catch (error) {
    const message = sanitizeErrorForOutput(error).message
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

export const chatgptPurchaseFlow: SingleFileFlowDefinition<
  FlowOptions,
  ChatGPTPurchaseFlowResult
> = {
  command: 'flow:chatgpt-purchase',
  run: purchaseChatGPTTeamTrial,
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSingleFileFlowFromCommandLine('chatgpt-purchase', chatgptPurchaseFlow)
}
