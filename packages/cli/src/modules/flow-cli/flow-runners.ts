import type { AndroidSession } from '../../core/android'
import type { Session } from '../../types'
import { runAndroidHealthcheck } from '../../flows/android-healthcheck'
import { inviteChatGPTWorkspaceMembers } from '../../flows/chatgpt-invite'
import { loginChatGPT } from '../../flows/chatgpt-login'
import { registerChatGPT } from '../../flows/chatgpt-register'
import { runChatGPTTeamTrial } from '../../flows/chatgpt-team-trial'
import { runCodexOAuthFlow } from '../../flows/codex-oauth'
import { openNoopFlow } from '../../flows/noop'
import type { CliFlowCommandId, CliFlowRuntimeKind } from './flow-registry'
import type { FlowOptions } from './helpers'

export interface BrowserCliFlowRunner {
  runtime: 'browser'
  run(session: Session, options: FlowOptions): Promise<unknown>
}

export interface AndroidCliFlowRunner {
  runtime: 'android'
  run(session: AndroidSession, options: FlowOptions): Promise<unknown>
}

export type CliFlowRunner = BrowserCliFlowRunner | AndroidCliFlowRunner

function browserFlow(run: BrowserCliFlowRunner['run']): BrowserCliFlowRunner {
  return {
    runtime: 'browser',
    run,
  }
}

function androidFlow(run: AndroidCliFlowRunner['run']): AndroidCliFlowRunner {
  return {
    runtime: 'android',
    run,
  }
}

export const cliFlowRunners = {
  'chatgpt-register': browserFlow((session, options) =>
    registerChatGPT(session.page, options),
  ),
  'chatgpt-login': browserFlow((session, options) =>
    loginChatGPT(session.page, options),
  ),
  'chatgpt-team-trial': browserFlow((session, options) =>
    runChatGPTTeamTrial(session.page, options),
  ),
  'chatgpt-invite': browserFlow((session, options) =>
    inviteChatGPTWorkspaceMembers(session.page, options),
  ),
  'codex-oauth': browserFlow((session, options) =>
    runCodexOAuthFlow(session.page, options),
  ),
  'android-healthcheck': androidFlow((session, options) =>
    runAndroidHealthcheck(session, options),
  ),
  noop: browserFlow((session) => openNoopFlow(session.page)),
} as const satisfies Record<CliFlowCommandId, CliFlowRunner>

export function getCliFlowRunner(flowId: CliFlowCommandId): CliFlowRunner {
  return cliFlowRunners[flowId]
}

export function getCliFlowRuntime(
  flowId: CliFlowCommandId,
): CliFlowRuntimeKind {
  return cliFlowRunners[flowId].runtime
}
