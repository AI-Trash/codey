import { pathToFileURL } from 'url'
import {
  sanitizeErrorForOutput,
  type FlowOptions,
} from '../modules/flow-cli/helpers'
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
import { syncManagedWorkspaceToCodeyApp } from '../modules/app-auth/workspaces'
import { saveLocalChatGPTStorageState } from '../modules/chatgpt/storage-state'

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
  if (invites.accountId) {
    const linkedEmails = inviteInputs.emails.filter(
      (email) => !invites.erroredEmails.includes(email),
    )

    try {
      const syncedWorkspace = await syncManagedWorkspaceToCodeyApp({
        workspaceId: invites.accountId,
        ownerIdentityId: login.storedIdentity?.id,
        memberEmails: linkedEmails,
      })
      options.progressReporter?.({
        message: syncedWorkspace
          ? `Synced workspace ${syncedWorkspace.workspaceId} to Codey app`
          : `Workspace ${invites.accountId} was not synced because Codey app access was unavailable`,
      })
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Unknown workspace sync error'
      options.progressReporter?.({
        message: `Workspace sync failed for ${invites.accountId}: ${detail}`,
      })
    }
  }
  options.progressReporter?.({
    message: 'Workspace invitations completed',
  })
  try {
    await saveLocalChatGPTStorageState(page, {
      identityId: login.storedIdentity.id,
      email: login.storedIdentity.email,
      flowType: 'chatgpt-login-invite',
    })
    options.progressReporter?.({
      message: `Saved local ChatGPT storage state for ${login.storedIdentity.email}`,
    })
  } catch (error) {
    options.progressReporter?.({
      message: `Local ChatGPT storage state save failed: ${sanitizeErrorForOutput(error).message}`,
    })
  }

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
