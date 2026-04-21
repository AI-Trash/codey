import { pathToFileURL } from 'url'
import type { FlowOptions } from '../modules/flow-cli/helpers'
import {
  inviteWorkspaceMembers,
  resolveInviteEmails,
  type ChatGPTWorkspaceInviteResult,
  type ResolvedInviteEmails,
} from '../modules/chatgpt/workspace-invites'
import { loginChatGPT, type ChatGPTLoginFlowResult } from './chatgpt-login'
import {
  runSingleFileFlowFromCommandLine,
  type SingleFileFlowDefinition,
} from '../modules/flow-cli/single-file'

export interface ChatGPTLoginInviteFlowResult {
  pageName: 'chatgpt-login-invite'
  url: string
  title: string
  email: string
  authenticated: boolean
  login: ChatGPTLoginFlowResult
  invites: ChatGPTWorkspaceInviteResult
  inviteInputs: ResolvedInviteEmails
}

export async function loginChatGPTAndInviteMembers(
  page: Parameters<typeof loginChatGPT>[0],
  options: FlowOptions = {},
): Promise<ChatGPTLoginInviteFlowResult> {
  options.progressReporter?.({
    message: 'Resolving invite targets',
  })
  const inviteInputs = resolveInviteEmails(options)
  if (!inviteInputs.emails.length) {
    throw new Error(
      'No invite emails were resolved. Pass --inviteEmail or --inviteFile.',
    )
  }

  const login = await loginChatGPT(page, options)
  options.progressReporter?.({
    message: 'Inviting workspace members',
  })
  const invites = await inviteWorkspaceMembers(page, inviteInputs.emails)
  options.progressReporter?.({
    message: 'Workspace invitations completed',
  })

  return {
    pageName: 'chatgpt-login-invite',
    url: page.url(),
    title: await page.title(),
    email: login.email,
    authenticated: login.authenticated,
    login,
    invites,
    inviteInputs,
  }
}

export const chatgptLoginInviteFlow: SingleFileFlowDefinition<
  FlowOptions,
  ChatGPTLoginInviteFlowResult
> = {
  command: 'flow:chatgpt-login-invite',
  run: loginChatGPTAndInviteMembers,
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runSingleFileFlowFromCommandLine(
    'chatgpt-login-invite',
    chatgptLoginInviteFlow,
  )
}
