import type { AndroidSession } from '../../cli/src/core/android'
import type { Session } from '../../cli/src/types'
import type {
  DesktopFlowCommandId,
  DesktopFlowOptions,
  DesktopFlowRuntimeKind,
} from './types'

export interface BrowserDesktopFlowRunner {
  runtime: 'browser'
  run(session: Session, options: DesktopFlowOptions): Promise<unknown>
}

export interface AndroidDesktopFlowRunner {
  runtime: 'android'
  run(session: AndroidSession, options: DesktopFlowOptions): Promise<unknown>
}

export type DesktopFlowRunner =
  | BrowserDesktopFlowRunner
  | AndroidDesktopFlowRunner

function browserFlow(
  run: BrowserDesktopFlowRunner['run'],
): BrowserDesktopFlowRunner {
  return {
    runtime: 'browser',
    run,
  }
}

function androidFlow(
  run: AndroidDesktopFlowRunner['run'],
): AndroidDesktopFlowRunner {
  return {
    runtime: 'android',
    run,
  }
}

function assertUnsupportedFlow(flowId: never): never {
  throw new Error(`Unsupported Codey flow: ${flowId}`)
}

export function getDesktopFlowRuntime(
  flowId: DesktopFlowCommandId,
): DesktopFlowRuntimeKind {
  return flowId === 'android-healthcheck' ? 'android' : 'browser'
}

export async function loadDesktopFlowRunner(
  flowId: DesktopFlowCommandId,
): Promise<DesktopFlowRunner> {
  switch (flowId) {
    case 'chatgpt-register': {
      const { registerChatGPT } = await import(
        '../../cli/src/flows/chatgpt-register'
      )
      return browserFlow((session, options) =>
        registerChatGPT(session.page, options),
      )
    }

    case 'chatgpt-register-hosted-checkouts': {
      const { registerChatGPTAndReviewHostedCheckouts } = await import(
        '../../cli/src/flows/chatgpt-register-hosted-checkouts'
      )
      return browserFlow((session, options) =>
        registerChatGPTAndReviewHostedCheckouts(session.page, options),
      )
    }

    case 'chatgpt-login': {
      const { loginChatGPT } = await import(
        '../../cli/src/flows/chatgpt-login'
      )
      return browserFlow((session, options) =>
        loginChatGPT(session.page, options),
      )
    }

    case 'chatgpt-team-trial': {
      const { runChatGPTTeamTrial } = await import(
        '../../cli/src/flows/chatgpt-team-trial'
      )
      return browserFlow((session, options) =>
        runChatGPTTeamTrial(session.page, options),
      )
    }

    case 'chatgpt-team-trial-gopay': {
      const { runChatGPTTeamTrialGoPay } = await import(
        '../../cli/src/flows/chatgpt-team-trial'
      )
      return browserFlow((session, options) =>
        runChatGPTTeamTrialGoPay(session.page, options),
      )
    }

    case 'chatgpt-invite': {
      const { inviteChatGPTWorkspaceMembers } = await import(
        '../../cli/src/flows/chatgpt-invite'
      )
      return browserFlow((session, options) =>
        inviteChatGPTWorkspaceMembers(session.page, options),
      )
    }

    case 'codex-oauth': {
      const { runCodexOAuthFlow } = await import(
        '../../cli/src/flows/codex-oauth'
      )
      return browserFlow((session, options) =>
        runCodexOAuthFlow(session.page, options),
      )
    }

    case 'android-healthcheck': {
      const { runAndroidHealthcheck } = await import(
        '../../cli/src/flows/android-healthcheck'
      )
      return androidFlow((session, options) =>
        runAndroidHealthcheck(session, options),
      )
    }

    case 'noop': {
      const { openNoopFlow } = await import('../../cli/src/flows/noop')
      return browserFlow((session) => openNoopFlow(session.page))
    }

    default:
      return assertUnsupportedFlow(flowId)
  }
}
