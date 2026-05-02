import { pathToFileURL } from 'url'
import {
  attachStateMachineProgressReporter,
  parseBooleanFlag,
  sanitizeErrorForOutput,
  type FlowOptions,
} from '../modules/flow-cli/helpers'
import {
  composeStateMachineConfig,
  createStateMachine,
  declareStateMachineStates,
  type StateMachineController,
  type StateMachineSnapshot,
} from '../state-machine'
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
import { reportChatGPTAccountDeactivationToCodeyApp } from '../modules/chatgpt/account-deactivation'
import { createFlowLifecycleFragment } from './machine-fragments'

export type ChatGPTInviteFlowKind = 'chatgpt-invite'

export type ChatGPTInviteFlowState =
  | 'idle'
  | 'resolving-targets'
  | 'logging-in'
  | 'syncing-workspace'
  | 'inviting-members'
  | 'syncing-invites'
  | 'saving-storage-state'
  | 'retrying'
  | 'completed'
  | 'failed'

export type ChatGPTInviteFlowEvent =
  | 'machine.started'
  | 'chatgpt.invite.targets.resolving'
  | 'chatgpt.invite.targets.resolved'
  | 'chatgpt.login.started'
  | 'chatgpt.login.completed'
  | 'chatgpt.workspace.sync.started'
  | 'chatgpt.workspace.sync.completed'
  | 'chatgpt.invites.started'
  | 'chatgpt.invites.completed'
  | 'chatgpt.storage.saving'
  | 'chatgpt.storage.saved'
  | 'chatgpt.retry.requested'
  | 'chatgpt.completed'
  | 'chatgpt.failed'
  | 'context.updated'
  | 'action.started'
  | 'action.finished'

export interface ChatGPTInviteFlowContext<Result = unknown> {
  kind: ChatGPTInviteFlowKind
  url?: string
  title?: string
  email?: string
  workspaceId?: string
  inviteInputs?: ResolvedInviteEmails
  invites?: ChatGPTWorkspaceInviteResult
  login?: ChatGPTLoginFlowResult
  retryCount?: number
  retryReason?: string
  retryFromState?: ChatGPTInviteFlowState
  lastAttempt?: number
  lastMessage?: string
  result?: Result
}

export type ChatGPTInviteFlowMachine<Result = unknown> = StateMachineController<
  ChatGPTInviteFlowState,
  ChatGPTInviteFlowContext<Result>,
  ChatGPTInviteFlowEvent
>

export type ChatGPTInviteFlowSnapshot<Result = unknown> = StateMachineSnapshot<
  ChatGPTInviteFlowState,
  ChatGPTInviteFlowContext<Result>,
  ChatGPTInviteFlowEvent
>

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
  machine: ChatGPTInviteFlowSnapshot<ChatGPTInviteFlowResult>
}

const chatgptInviteEventTargets = {
  'chatgpt.invite.targets.resolving': 'resolving-targets',
  'chatgpt.invite.targets.resolved': 'resolving-targets',
  'chatgpt.login.started': 'logging-in',
  'chatgpt.login.completed': 'syncing-workspace',
  'chatgpt.workspace.sync.started': 'syncing-workspace',
  'chatgpt.workspace.sync.completed': 'syncing-workspace',
  'chatgpt.invites.started': 'inviting-members',
  'chatgpt.invites.completed': 'syncing-invites',
  'chatgpt.storage.saving': 'saving-storage-state',
  'chatgpt.storage.saved': 'saving-storage-state',
  'chatgpt.completed': 'completed',
  'chatgpt.failed': 'failed',
} as const satisfies Partial<
  Record<ChatGPTInviteFlowEvent, ChatGPTInviteFlowState>
>

const chatgptInviteMutableContextEvents = [
  'context.updated',
  'action.started',
  'action.finished',
] as const satisfies ChatGPTInviteFlowEvent[]

const chatgptInviteStates = [
  'idle',
  'resolving-targets',
  'logging-in',
  'syncing-workspace',
  'inviting-members',
  'syncing-invites',
  'saving-storage-state',
  'retrying',
  'completed',
  'failed',
] as const satisfies readonly ChatGPTInviteFlowState[]

function createChatGPTInviteLifecycleFragment<Result>() {
  return createFlowLifecycleFragment<
    ChatGPTInviteFlowState,
    ChatGPTInviteFlowContext<Result>,
    ChatGPTInviteFlowEvent
  >({
    eventTargets: chatgptInviteEventTargets,
    mutableContextEvents: chatgptInviteMutableContextEvents,
    retryEvent: 'chatgpt.retry.requested',
    retryTarget: 'retrying',
    defaultRetryMessage: 'Retrying ChatGPT workspace invite flow',
  })
}

export function createChatGPTInviteMachine(): ChatGPTInviteFlowMachine<ChatGPTInviteFlowResult> {
  return createStateMachine<
    ChatGPTInviteFlowState,
    ChatGPTInviteFlowContext<ChatGPTInviteFlowResult>,
    ChatGPTInviteFlowEvent
  >(
    composeStateMachineConfig(
      {
        id: 'flow.chatgpt.invite',
        initialState: 'idle',
        initialContext: {
          kind: 'chatgpt-invite',
        },
        historyLimit: 120,
        states: declareStateMachineStates<
          ChatGPTInviteFlowState,
          ChatGPTInviteFlowContext<ChatGPTInviteFlowResult>,
          ChatGPTInviteFlowEvent
        >(chatgptInviteStates),
      },
      createChatGPTInviteLifecycleFragment<ChatGPTInviteFlowResult>(),
    ),
  )
}

async function sendInviteMachine(
  machine: ChatGPTInviteFlowMachine<ChatGPTInviteFlowResult>,
  event: ChatGPTInviteFlowEvent,
  patch?: Partial<ChatGPTInviteFlowContext<ChatGPTInviteFlowResult>>,
): Promise<void> {
  await machine.send(event, {
    patch,
  })
}

async function reportWorkspaceToCodeyApp(input: {
  workspaceId?: string
  ownerIdentityId?: string
  memberEmails?: string[]
  confirmedInviteEmails?: string[]
  failedInviteEmails?: string[]
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
      confirmedInviteEmails: input.confirmedInviteEmails || [],
      failedInviteEmails: input.failedInviteEmails || [],
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
  const machine = createChatGPTInviteMachine()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )
  let completedLogin: ChatGPTLoginFlowResult | undefined

  try {
    machine.start(
      {
        url: page.url(),
        lastMessage: 'Starting ChatGPT workspace invite flow',
      },
      {
        source: 'inviteChatGPTWorkspaceMembers',
      },
    )
    await sendInviteMachine(machine, 'chatgpt.invite.targets.resolving', {
      url: page.url(),
      lastMessage: 'Resolving invite targets',
    })
    options.progressReporter?.({
      message: 'Resolving invite targets',
    })
    const inviteInputs = resolveInviteEmails(options)
    await sendInviteMachine(machine, 'chatgpt.invite.targets.resolved', {
      inviteInputs,
      lastMessage: `Resolved ${inviteInputs.emails.length} invite target(s)`,
    })
    if (!inviteInputs.emails.length) {
      throw new Error(
        'No invite emails were resolved. Pass --inviteEmail or --inviteFile.',
      )
    }

    await sendInviteMachine(machine, 'chatgpt.login.started', {
      url: page.url(),
      inviteInputs,
      lastMessage: 'Logging in before inviting workspace members',
    })
    const login = await loginChatGPT(page, {
      ...options,
      autoSelectFirstWorkspace: true,
    })
    completedLogin = login
    await sendInviteMachine(machine, 'chatgpt.login.completed', {
      email: login.email,
      login,
      workspaceId: login.selectedWorkspaceId,
      url: login.url,
      title: login.title,
      lastMessage: 'ChatGPT login completed for workspace invite flow',
    })
    await sendInviteMachine(machine, 'chatgpt.workspace.sync.started', {
      email: login.email,
      workspaceId: login.selectedWorkspaceId,
      lastMessage: 'Syncing selected workspace before inviting members',
    })
    await reportWorkspaceToCodeyApp({
      workspaceId: login.selectedWorkspaceId,
      ownerIdentityId: login.storedIdentity?.id,
      progressReporter: options.progressReporter,
    })
    await sendInviteMachine(machine, 'chatgpt.workspace.sync.completed', {
      email: login.email,
      workspaceId: login.selectedWorkspaceId,
      lastMessage: login.selectedWorkspaceId
        ? `Synced selected workspace ${login.selectedWorkspaceId}`
        : 'No selected workspace id was available before inviting members',
    })
    options.progressReporter?.({
      message: 'Inviting workspace members',
    })
    await sendInviteMachine(machine, 'chatgpt.invites.started', {
      email: login.email,
      workspaceId: login.selectedWorkspaceId,
      inviteInputs,
      lastMessage: 'Inviting workspace members',
    })
    const invites = await inviteWorkspaceMembers(page, inviteInputs.emails, {
      pruneUnmanagedWorkspaceMembers:
        parseBooleanFlag(options.pruneUnmanagedWorkspaceMembers, false) ??
        false,
      protectedEmails: [login.email, login.storedIdentity.email],
      progressReporter: options.progressReporter,
    })
    const workspaceId = invites.accountId || login.selectedWorkspaceId
    const linkedEmails = inviteInputs.emails.filter(
      (email) => !invites.erroredEmails.includes(email),
    )
    await sendInviteMachine(machine, 'chatgpt.invites.completed', {
      email: login.email,
      workspaceId,
      invites,
      lastMessage: `Workspace invites completed for ${linkedEmails.length} member(s)`,
    })
    await sendInviteMachine(machine, 'chatgpt.workspace.sync.started', {
      email: login.email,
      workspaceId,
      invites,
      lastMessage: 'Syncing workspace invite results to Codey app',
    })
    await reportWorkspaceToCodeyApp({
      workspaceId,
      ownerIdentityId: login.storedIdentity?.id,
      memberEmails: linkedEmails,
      confirmedInviteEmails: invites.invitedEmails,
      failedInviteEmails: invites.erroredEmails,
      progressReporter: options.progressReporter,
    })
    await sendInviteMachine(machine, 'chatgpt.workspace.sync.completed', {
      email: login.email,
      workspaceId,
      invites,
      lastMessage: 'Synced workspace invite results to Codey app',
    })
    options.progressReporter?.({
      message: 'Workspace invitations completed',
    })
    try {
      await sendInviteMachine(machine, 'chatgpt.storage.saving', {
        email: login.email,
        workspaceId,
        lastMessage: 'Saving local ChatGPT storage state after invites',
      })
      await saveLocalChatGPTStorageState(page, {
        identityId: login.storedIdentity.id,
        email: login.storedIdentity.email,
        flowType: 'chatgpt-invite',
      })
      await sendInviteMachine(machine, 'chatgpt.storage.saved', {
        email: login.email,
        workspaceId,
        lastMessage: `Saved local ChatGPT storage state for ${login.storedIdentity.email}`,
      })
      options.progressReporter?.({
        message: `Saved local ChatGPT storage state for ${login.storedIdentity.email}`,
      })
    } catch (error) {
      await machine.send('chatgpt.retry.requested', {
        reason: 'storage-state-save',
        message: 'Continuing after local ChatGPT storage state save failed',
        patch: {
          email: login.email,
          workspaceId,
          lastMessage: sanitizeErrorForOutput(error).message,
        },
      })
      options.progressReporter?.({
        message: `Local ChatGPT storage state save failed: ${sanitizeErrorForOutput(error).message}`,
      })
    }

    const result = {
      pageName: 'chatgpt-invite' as const,
      url: page.url(),
      title: await page.title(),
      email: login.email,
      workspaceId,
      authenticated: login.authenticated,
      login,
      invites,
      inviteInputs,
      machine:
        undefined as unknown as ChatGPTInviteFlowSnapshot<ChatGPTInviteFlowResult>,
    }
    const snapshot = machine.succeed('completed', {
      event: 'chatgpt.completed',
      patch: {
        email: login.email,
        workspaceId,
        login,
        invites,
        inviteInputs,
        url: result.url,
        title: result.title,
        result,
        lastMessage: 'ChatGPT workspace invite flow completed',
      },
    })
    result.machine = snapshot
    return result
  } catch (error) {
    await reportChatGPTAccountDeactivationToCodeyApp({
      error,
      identity: completedLogin?.storedIdentity,
      progressReporter: options.progressReporter,
    })
    machine.fail(error, 'failed', {
      event: 'chatgpt.failed',
      patch: {
        url: page.url(),
        lastMessage: sanitizeErrorForOutput(error).message,
      },
    })
    throw error
  } finally {
    detachProgress()
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
