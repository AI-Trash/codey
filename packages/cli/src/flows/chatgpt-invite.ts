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

export interface ChatGPTInviteFlowResult {
  pageName: 'chatgpt-invite'
  url: string
  title: string
  email: string
  workspaceId?: string
  authenticated: boolean
  login: ChatGPTLoginFlowResult
  invites: ChatGPTWorkspaceInviteResult
  inviteInputs: ResolvedInviteEmails
}

async function reportWorkspaceToCodeyApp(input: {
  workspaceId?: string
  ownerIdentityId?: string
  memberEmails?: string[]
  progressReporter?: FlowOptions['progressReporter']
}): Promise<void> {
  const workspaceId = input.workspaceId?.trim()
  if (!workspaceId) {
    return
  }

  try {
    const syncedWorkspace = await syncManagedWorkspaceToCodeyApp({
      workspaceId,
      ownerIdentityId: input.ownerIdentityId,
      memberEmails: input.memberEmails || [],
    })
    input.progressReporter?.({
      message: syncedWorkspace
        ? `Synced workspace ${syncedWorkspace.workspaceId} to Codey app`
        : `Workspace ${workspaceId} was not synced because Codey app access was unavailable`,
    })
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : 'Unknown workspace sync error'
    input.progressReporter?.({
      message: `Workspace sync failed for ${workspaceId}: ${detail}`,
    })
  }
}

export async function inviteChatGPTWorkspaceMembers(
  page: Parameters<typeof loginChatGPT>[0],
  options: FlowOptions = {},
): Promise<ChatGPTInviteFlowResult> {
  options.progressReporter?.({
    message: 'Resolving invite targets',
  })
  const inviteInputs = resolveInviteEmails(options)
  if (!inviteInputs.emails.length) {
    throw new Error(
      'No invite emails were resolved. Pass --inviteEmail or --inviteFile.',
    )
  }

  const login = await loginChatGPT(page, {
    ...options,
    autoSelectFirstWorkspace: true,
  })
  await reportWorkspaceToCodeyApp({
    workspaceId: login.selectedWorkspaceId,
    ownerIdentityId: login.storedIdentity?.id,
    progressReporter: options.progressReporter,
  })
  options.progressReporter?.({
    message: 'Inviting workspace members',
  })
  const invites = await inviteWorkspaceMembers(page, inviteInputs.emails)
  const workspaceId = invites.accountId || login.selectedWorkspaceId
  const linkedEmails = inviteInputs.emails.filter(
    (email) => !invites.erroredEmails.includes(email),
  )
  await reportWorkspaceToCodeyApp({
    workspaceId,
    ownerIdentityId: login.storedIdentity?.id,
    memberEmails: linkedEmails,
    progressReporter: options.progressReporter,
  })
  options.progressReporter?.({
    message: 'Workspace invitations completed',
  })
  try {
    await saveLocalChatGPTStorageState(page, {
      identityId: login.storedIdentity.id,
      email: login.storedIdentity.email,
      flowType: 'chatgpt-invite',
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
    pageName: 'chatgpt-invite',
    url: page.url(),
    title: await page.title(),
    email: login.email,
    workspaceId,
    authenticated: login.authenticated,
    login,
    invites,
    inviteInputs,
  }
}

export const chatgptInviteFlow: SingleFileFlowDefinition<
  FlowOptions,
  ChatGPTInviteFlowResult
> = {
  command: 'flow:chatgpt-invite',
  run: inviteChatGPTWorkspaceMembers,
}

export const loginChatGPTAndInviteMembers = inviteChatGPTWorkspaceMembers

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runSingleFileFlowFromCommandLine('chatgpt-invite', chatgptInviteFlow)
}
