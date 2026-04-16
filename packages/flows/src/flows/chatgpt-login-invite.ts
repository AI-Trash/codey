import { pathToFileURL } from 'url'
import type { FlowOptions } from '../modules/flow-cli/helpers'
import {
  inviteWorkspaceMembers,
  resolveInviteEmails,
  type ChatGPTWorkspaceInviteResult,
  type ResolvedInviteEmails,
} from '../modules/chatgpt/workspace-invites'
import { parseFlowCliArgs } from '../modules/flow-cli/parse-argv'
import {
  loginChatGPTWithStoredPasskey,
  type ChatGPTLoginPasskeyFlowResult,
} from './chatgpt-login-passkey'
import {
  runSingleFileFlowFromCli,
  type SingleFileFlowDefinition,
} from '../modules/flow-cli/single-file'

export interface ChatGPTLoginInviteFlowResult {
  pageName: 'chatgpt-login-invite'
  url: string
  title: string
  email: string
  authenticated: boolean
  login: ChatGPTLoginPasskeyFlowResult
  invites: ChatGPTWorkspaceInviteResult
  inviteInputs: ResolvedInviteEmails
}

export async function loginChatGPTAndInviteMembers(
  page: Parameters<typeof loginChatGPTWithStoredPasskey>[0],
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

  const login = await loginChatGPTWithStoredPasskey(page, options)
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
  runSingleFileFlowFromCli(
    chatgptLoginInviteFlow,
    parseFlowCliArgs(process.argv.slice(2)),
  )
}
