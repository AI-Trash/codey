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
import { loginChatGPT, type ChatGPTLoginFlowResult } from './chatgpt-login'

export type ChatGPTTeamTrialFlowKind = 'chatgpt-team-trial'

export type ChatGPTTeamTrialFlowState =
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

export type ChatGPTTeamTrialFlowEvent =
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

export interface ChatGPTTeamTrialFlowContext<Result = unknown> {
  kind: ChatGPTTeamTrialFlowKind
  url?: string
  title?: string
  email?: string
  login?: ChatGPTLoginFlowResult
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
  trialClaimClicked: boolean
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

export async function runChatGPTTeamTrial(
  page: Page,
  options: FlowOptions = {},
): Promise<ChatGPTTeamTrialFlowResult> {
  const machine = createChatGPTTeamTrialMachine()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )

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

    const title = await page.title()
    await sendTeamTrialMachine(
      machine,
      'trial-claimed',
      'chatgpt.trial.claimed',
      {
        email: login.email,
        url: page.url(),
        title,
        lastMessage: 'ChatGPT Team free trial button clicked',
      },
    )

    const result = {
      pageName: 'chatgpt-team-trial' as const,
      url: page.url(),
      title,
      email: login.email,
      authenticated: true,
      pricingUrl: CHATGPT_TEAM_PRICING_PROMO_URL,
      trialClaimClicked: true,
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
