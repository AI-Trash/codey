import '@tanstack/react-start/server-only'

import {
  assignContextFromInput,
  composeStateMachineConfig,
  createGuardedCaseTransitions,
  createPatchTransitionMap,
  createStateMachine,
  declareStateMachineStates,
  type StateMachineController,
  type StateMachineSnapshot,
} from '@codey/state-machine'
import { and, desc, eq, sql, type SQL } from 'drizzle-orm'

import type { CliFlowTaskMetadata } from '../../../packages/cli/src/modules/flow-cli/flow-registry'
import type { CliConnectionActorScope } from './cli-connections'
import {
  isSharedCliConnection,
  listAdminCliConnectionStateForActor,
  type AdminCliConnectionSummary,
} from './cli-connections'
import { dispatchCliFlowTasks } from './cli-tasks'
import { getDb } from './db/client'
import {
  flowTasks,
  managedIdentities,
  workspaceInviteAuthorizeWorkflows,
  type FlowTaskRow,
  type FlowTaskStatus,
  type WorkspaceInviteAuthorizeWorkflowRow,
  type WorkspaceInviteAuthorizeWorkflowStatus,
} from './db/schema'
import { updateManagedIdentity } from './identities'
import { createId } from './security'
import {
  ensureManagedWorkspaceMemberIdentityCount,
  findAdminManagedWorkspaceSummary,
  markManagedWorkspaceMemberInviteStatus,
  type AdminManagedWorkspaceSummary,
} from './workspaces'

const WORKFLOW_KIND = 'workspace-invite-and-authorize'
const INVITE_PHASE = 'invite'
const AUTHORIZE_PHASE = 'authorize'
const WORKFLOW_MEMBER_COUNT = 9
const MAX_AUTHORIZATION_ATTEMPTS = 2

type WorkflowTaskPhase = typeof INVITE_PHASE | typeof AUTHORIZE_PHASE

type FinalFlowTaskStatus = Extract<
  FlowTaskStatus,
  'SUCCEEDED' | 'FAILED' | 'CANCELED'
>

export type WorkspaceInviteAuthorizeMachineState =
  | 'idle'
  | 'invite'
  | 'authorize'
  | 'completed'
  | 'failed'

export type WorkspaceInviteAuthorizeMachineEvent =
  | 'machine.started'
  | 'workflow.started'
  | 'workflow.invite.completed'
  | 'workflow.authorize.completed'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'context.updated'

export interface WorkspaceInviteAuthorizeMachineContext {
  workflowId?: string
  status?: WorkspaceInviteAuthorizeWorkflowStatus
  phase?: WorkspaceInviteAuthorizeWorkflowRow['phase']
  lastMessage?: string | null
  lastError?: string | null
}

export type WorkspaceInviteAuthorizeMachine = StateMachineController<
  WorkspaceInviteAuthorizeMachineState,
  WorkspaceInviteAuthorizeMachineContext,
  WorkspaceInviteAuthorizeMachineEvent
>

export type WorkspaceInviteAuthorizeMachineSnapshot = StateMachineSnapshot<
  WorkspaceInviteAuthorizeMachineState,
  WorkspaceInviteAuthorizeMachineContext,
  WorkspaceInviteAuthorizeMachineEvent
>

type WorkflowMachineOutcome = 'invite' | 'authorize' | 'completed' | 'failed'

interface WorkflowMachineOutcomeInput {
  outcome: WorkflowMachineOutcome
  message?: string | null
  error?: string | null
}

interface WorkflowTaskMetadata {
  workflowId: string
  phase: WorkflowTaskPhase
}

function isWorkflowMachineOutcomeInput(
  value: unknown,
): value is WorkflowMachineOutcomeInput {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as Partial<WorkflowMachineOutcomeInput>).outcome === 'string',
  )
}

const workspaceWorkflowStates = [
  'idle',
  'invite',
  'authorize',
  'completed',
  'failed',
] as const satisfies readonly WorkspaceInviteAuthorizeMachineState[]

function createWorkspaceWorkflowOutcomeTransitions() {
  return createGuardedCaseTransitions<
    WorkspaceInviteAuthorizeMachineState,
    WorkspaceInviteAuthorizeMachineContext,
    WorkspaceInviteAuthorizeMachineEvent,
    WorkflowMachineOutcomeInput
  >({
    isInput: isWorkflowMachineOutcomeInput,
    cases: [
      {
        priority: 40,
        when: ({ input }) => input.outcome === 'completed',
        target: 'completed',
        actions: assignContextFromInput(
          isWorkflowMachineOutcomeInput,
          (_context, { input }) => ({
            status: 'COMPLETED',
            phase: 'COMPLETED',
            lastMessage: input.message,
            lastError: null,
          }),
        ),
      },
      {
        priority: 30,
        when: ({ input }) => input.outcome === 'failed',
        target: 'failed',
        actions: assignContextFromInput(
          isWorkflowMachineOutcomeInput,
          (_context, { input }) => ({
            status: 'FAILED',
            phase: 'FAILED',
            lastMessage: input.message,
            lastError: input.error ?? input.message,
          }),
        ),
      },
      {
        priority: 20,
        when: ({ input }) => input.outcome === 'authorize',
        target: 'authorize',
        actions: assignContextFromInput(
          isWorkflowMachineOutcomeInput,
          (_context, { input }) => ({
            status: 'RUNNING',
            phase: 'AUTHORIZE',
            lastMessage: input.message,
            lastError: null,
          }),
        ),
      },
      {
        priority: 10,
        when: ({ input }) => input.outcome === 'invite',
        target: 'invite',
        actions: assignContextFromInput(
          isWorkflowMachineOutcomeInput,
          (_context, { input }) => ({
            status: 'RUNNING',
            phase: 'INVITE',
            lastMessage: input.message,
            lastError: null,
          }),
        ),
      },
    ],
  })
}

function getWorkflowMachineState(
  workflow: WorkspaceInviteAuthorizeWorkflowRow,
): WorkspaceInviteAuthorizeMachineState {
  if (workflow.status === 'COMPLETED' || workflow.phase === 'COMPLETED') {
    return 'completed'
  }
  if (workflow.status === 'FAILED' || workflow.phase === 'FAILED') {
    return 'failed'
  }
  if (workflow.phase === 'AUTHORIZE') {
    return 'authorize'
  }
  if (workflow.phase === 'INVITE') {
    return 'invite'
  }
  return 'idle'
}

export function createWorkspaceInviteAuthorizeMachine(
  workflow?: WorkspaceInviteAuthorizeWorkflowRow,
): WorkspaceInviteAuthorizeMachine {
  const initialState = workflow ? getWorkflowMachineState(workflow) : 'idle'

  return createStateMachine<
    WorkspaceInviteAuthorizeMachineState,
    WorkspaceInviteAuthorizeMachineContext,
    WorkspaceInviteAuthorizeMachineEvent
  >(
    composeStateMachineConfig({
      id: 'workflow.workspace_invite_authorize',
      initialState,
      initialContext: {
        workflowId: workflow?.id,
        status: workflow?.status,
        phase: workflow?.phase,
        lastMessage: workflow?.lastMessage,
        lastError: workflow?.lastError,
      },
      historyLimit: 80,
      states: declareStateMachineStates<
        WorkspaceInviteAuthorizeMachineState,
        WorkspaceInviteAuthorizeMachineContext,
        WorkspaceInviteAuthorizeMachineEvent
      >(workspaceWorkflowStates),
      on: {
        ...createPatchTransitionMap<
          WorkspaceInviteAuthorizeMachineState,
          WorkspaceInviteAuthorizeMachineContext,
          WorkspaceInviteAuthorizeMachineEvent
        >({
          'workflow.started': 'invite',
          'workflow.completed': 'completed',
          'workflow.failed': 'failed',
        }),
        'workflow.invite.completed':
          createWorkspaceWorkflowOutcomeTransitions(),
        'workflow.authorize.completed':
          createWorkspaceWorkflowOutcomeTransitions(),
      },
    }),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function isWorkflowTaskPhase(value: string): value is WorkflowTaskPhase {
  return value === INVITE_PHASE || value === AUTHORIZE_PHASE
}

function readWorkflowTaskMetadata(
  payload?: Record<string, unknown> | null,
): WorkflowTaskMetadata | null {
  if (!isRecord(payload)) {
    return null
  }

  const metadata = isRecord(payload.metadata) ? payload.metadata : null
  const workspace =
    metadata && isRecord(metadata.workspace) ? metadata.workspace : null
  const automation =
    workspace && isRecord(workspace.automation) ? workspace.automation : null
  if (!automation || automation.kind !== WORKFLOW_KIND) {
    return null
  }

  const workflowId = normalizeOptionalString(automation.id)
  const phase = normalizeOptionalString(automation.phase)
  if (!workflowId || !phase || !isWorkflowTaskPhase(phase)) {
    return null
  }

  return {
    workflowId,
    phase,
  }
}

function readTaskConfig(task: Pick<FlowTaskRow, 'payload'>) {
  const payload = isRecord(task.payload) ? task.payload : null
  return payload && isRecord(payload.config) ? payload.config : {}
}

function readTaskEmail(task: Pick<FlowTaskRow, 'payload'>) {
  const email = normalizeOptionalString(readTaskConfig(task).email)
  return email ? normalizeEmail(email) : undefined
}

function readTaskInviteEmails(task: Pick<FlowTaskRow, 'payload'>) {
  const value = readTaskConfig(task).inviteEmail
  const inputs = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : typeof value === 'string'
      ? [value]
      : []

  return Array.from(
    new Set(
      inputs
        .flatMap((entry) => entry.split(/[\r\n,;]+/))
        .map(normalizeEmail)
        .filter(Boolean),
    ),
  )
}

function sameEmailSet(left: string[], right: string[]) {
  const leftSet = new Set(left.map(normalizeEmail).filter(Boolean))
  const rightSet = new Set(right.map(normalizeEmail).filter(Boolean))
  if (leftSet.size !== rightSet.size) {
    return false
  }

  for (const email of leftSet) {
    if (!rightSet.has(email)) {
      return false
    }
  }

  return true
}

function isActiveTaskStatus(status: FlowTaskStatus) {
  return status === 'QUEUED' || status === 'LEASED' || status === 'RUNNING'
}

function isConnectionBusy(connection: AdminCliConnectionSummary) {
  return Boolean(
    connection.runtimeFlowId &&
    !connection.runtimeFlowCompletedAt &&
    connection.runtimeFlowStatus !== 'completed',
  )
}

function getConnectionLabel(connection: AdminCliConnectionSummary) {
  return (
    connection.cliName || connection.target || connection.authClientId || 'CLI'
  )
}

function hasRequiredWorkflowFlows(connection: AdminCliConnectionSummary) {
  return (
    connection.registeredFlows.includes('chatgpt-invite') &&
    connection.registeredFlows.includes('codex-oauth')
  )
}

function sortWorkflowCapableConnections(
  connections: AdminCliConnectionSummary[],
) {
  return [...connections].sort((left, right) => {
    const sharedDelta =
      Number(isSharedCliConnection(right)) - Number(isSharedCliConnection(left))
    if (sharedDelta) {
      return sharedDelta
    }

    const busyDelta =
      Number(isConnectionBusy(left)) - Number(isConnectionBusy(right))
    if (busyDelta) {
      return busyDelta
    }

    return (
      new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime()
    )
  })
}

function getWorkflowTargetMemberCount(
  workflow: Pick<WorkspaceInviteAuthorizeWorkflowRow, 'targetMemberCount'>,
) {
  return Math.max(
    1,
    Math.min(WORKFLOW_MEMBER_COUNT, workflow.targetMemberCount || 0),
  )
}

function getWorkspaceAuthorizationTargets(
  workspace: AdminManagedWorkspaceSummary,
) {
  return [
    ...(workspace.owner
      ? [
          {
            email: normalizeEmail(workspace.owner.email),
            authorization: workspace.owner.authorization,
          },
        ]
      : []),
    ...workspace.members.map((member) => ({
      email: normalizeEmail(member.email),
      authorization: member.authorization,
    })),
  ]
}

function createWorkflowMetadata(input: {
  workflow: WorkspaceInviteAuthorizeWorkflowRow
  workspace: AdminManagedWorkspaceSummary
  phase: WorkflowTaskPhase
}): CliFlowTaskMetadata {
  return {
    workspace: {
      recordId: input.workspace.id,
      ...(input.workspace.workspaceId
        ? { workspaceId: input.workspace.workspaceId }
        : {}),
      ...(input.workspace.label ? { label: input.workspace.label } : {}),
      ...(input.workspace.owner?.identityId
        ? { ownerIdentityId: input.workspace.owner.identityId }
        : {}),
      automation: {
        id: input.workflow.id,
        kind: WORKFLOW_KIND,
        phase: input.phase,
        ...(input.workflow.connectionId
          ? { connectionId: input.workflow.connectionId }
          : {}),
        targetMemberCount: getWorkflowTargetMemberCount(input.workflow),
      },
    },
  }
}

async function selectWorkflowConnection(input: {
  actor: CliConnectionActorScope
  connectionId?: string
}) {
  const state = await listAdminCliConnectionStateForActor(input.actor)
  const capableConnections = sortWorkflowCapableConnections(
    state.activeConnections.filter(hasRequiredWorkflowFlows),
  )

  if (input.connectionId) {
    const requested = capableConnections.find(
      (connection) => connection.id === input.connectionId,
    )
    if (!requested) {
      throw new Error(
        'Selected CLI must be online and registered for chatgpt-invite and codex-oauth.',
      )
    }
    return requested
  }

  const [connection] = capableConnections
  if (!connection) {
    throw new Error(
      'No online CLI is registered for chatgpt-invite and codex-oauth.',
    )
  }

  return connection
}

async function findWorkflow(workflowId: string) {
  return (
    (await getDb().query.workspaceInviteAuthorizeWorkflows.findFirst({
      where: eq(workspaceInviteAuthorizeWorkflows.id, workflowId),
    })) || null
  )
}

async function updateWorkflowMessage(input: {
  workflowId: string
  phase?: WorkspaceInviteAuthorizeWorkflowRow['phase']
  message: string
}) {
  await getDb()
    .update(workspaceInviteAuthorizeWorkflows)
    .set({
      ...(input.phase ? { phase: input.phase } : {}),
      lastMessage: input.message,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(workspaceInviteAuthorizeWorkflows.id, input.workflowId))
}

async function markWorkflowFailed(input: {
  workflowId: string
  message: string
}) {
  const now = new Date()
  await getDb()
    .update(workspaceInviteAuthorizeWorkflows)
    .set({
      status: 'FAILED',
      phase: 'FAILED',
      lastMessage: input.message,
      lastError: input.message,
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(workspaceInviteAuthorizeWorkflows.id, input.workflowId),
        eq(workspaceInviteAuthorizeWorkflows.status, 'RUNNING'),
      ),
    )
}

async function markWorkflowCompleted(input: {
  workflowId: string
  message: string
}) {
  const now = new Date()
  await getDb()
    .update(workspaceInviteAuthorizeWorkflows)
    .set({
      status: 'COMPLETED',
      phase: 'COMPLETED',
      lastMessage: input.message,
      lastError: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(workspaceInviteAuthorizeWorkflows.id, input.workflowId),
        eq(workspaceInviteAuthorizeWorkflows.status, 'RUNNING'),
      ),
    )
}

async function transitionWorkflowPhase(input: {
  workflowId: string
  from: WorkspaceInviteAuthorizeWorkflowRow['phase']
  to: WorkspaceInviteAuthorizeWorkflowRow['phase']
  message: string
}) {
  const [workflow] = await getDb()
    .update(workspaceInviteAuthorizeWorkflows)
    .set({
      phase: input.to,
      lastMessage: input.message,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workspaceInviteAuthorizeWorkflows.id, input.workflowId),
        eq(workspaceInviteAuthorizeWorkflows.status, 'RUNNING'),
        eq(workspaceInviteAuthorizeWorkflows.phase, input.from),
      ),
    )
    .returning()

  return workflow || null
}

async function applyWorkflowMachineOutcome(input: {
  workflow: WorkspaceInviteAuthorizeWorkflowRow
  event: Extract<
    WorkspaceInviteAuthorizeMachineEvent,
    'workflow.invite.completed' | 'workflow.authorize.completed'
  >
  outcome: WorkflowMachineOutcome
  message: string
  error?: string | null
}): Promise<WorkspaceInviteAuthorizeWorkflowRow | null> {
  const machine = createWorkspaceInviteAuthorizeMachine(input.workflow)
  machine.start(machine.getSnapshot().context, {
    source: 'workspace-invite-authorize',
  })
  const snapshot = await machine.send(input.event, {
    outcome: input.outcome,
    message: input.message,
    error: input.error,
  } satisfies WorkflowMachineOutcomeInput)

  if (snapshot.state === 'failed') {
    await markWorkflowFailed({
      workflowId: input.workflow.id,
      message: snapshot.context.lastError || input.message,
    })
    return null
  }

  if (snapshot.state === 'completed') {
    await markWorkflowCompleted({
      workflowId: input.workflow.id,
      message: snapshot.context.lastMessage || input.message,
    })
    return null
  }

  if (snapshot.state === 'authorize') {
    if (input.workflow.phase === 'AUTHORIZE') {
      await updateWorkflowMessage({
        workflowId: input.workflow.id,
        phase: 'AUTHORIZE',
        message: snapshot.context.lastMessage || input.message,
      })
      return input.workflow
    }

    return transitionWorkflowPhase({
      workflowId: input.workflow.id,
      from: input.workflow.phase,
      to: 'AUTHORIZE',
      message: snapshot.context.lastMessage || input.message,
    })
  }

  if (snapshot.state === 'invite') {
    if (input.workflow.phase === 'INVITE') {
      await updateWorkflowMessage({
        workflowId: input.workflow.id,
        phase: 'INVITE',
        message: snapshot.context.lastMessage || input.message,
      })
      return input.workflow
    }

    return transitionWorkflowPhase({
      workflowId: input.workflow.id,
      from: input.workflow.phase,
      to: 'INVITE',
      message: snapshot.context.lastMessage || input.message,
    })
  }

  return input.workflow
}

function workflowTaskFilter(input: {
  workflowId: string
  phase: WorkflowTaskPhase
  flowType?: string
}): SQL {
  const base = and(
    sql`${flowTasks.payload} #>> '{metadata,workspace,automation,id}' = ${input.workflowId}`,
    sql`${flowTasks.payload} #>> '{metadata,workspace,automation,phase}' = ${input.phase}`,
  ) as SQL

  return input.flowType
    ? (and(base, eq(flowTasks.flowType, input.flowType)) as SQL)
    : base
}

async function listWorkflowTasks(input: {
  workflowId: string
  phase: WorkflowTaskPhase
  flowType?: string
}) {
  return getDb().query.flowTasks.findMany({
    where: workflowTaskFilter(input),
    orderBy: [desc(flowTasks.createdAt)],
  })
}

function countAttemptsByEmail(tasks: FlowTaskRow[]) {
  const counts = new Map<string, number>()

  for (const task of tasks) {
    const email = readTaskEmail(task)
    if (!email || isActiveTaskStatus(task.status)) {
      continue
    }

    counts.set(email, (counts.get(email) || 0) + 1)
  }

  return counts
}

function isAccountDeactivatedMessage(value?: string | null) {
  return Boolean(value && /account_deactivated/i.test(value))
}

function readInviteErroredEmails(result?: Record<string, unknown> | null) {
  const invites = result && isRecord(result.invites) ? result.invites : result
  const value = invites && isRecord(invites) ? invites.erroredEmails : null
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(normalizeEmail)
    .filter(Boolean)
}

async function dispatchInviteTask(input: {
  workflow: WorkspaceInviteAuthorizeWorkflowRow
  workspace: AdminManagedWorkspaceSummary
}) {
  if (!input.workflow.connectionId) {
    throw new Error('Workflow CLI connection is missing.')
  }
  if (!input.workspace.owner?.identityId) {
    throw new Error('Workspace owner identity is required before inviting.')
  }

  const memberEmails = input.workspace.members.map((member) =>
    normalizeEmail(member.email),
  )
  const result = await dispatchCliFlowTasks({
    connectionId: input.workflow.connectionId,
    flowId: 'chatgpt-invite',
    config: {
      identityId: input.workspace.owner.identityId,
      inviteEmail: memberEmails,
      pruneUnmanagedWorkspaceMembers: true,
    },
    metadata: createWorkflowMetadata({
      workflow: input.workflow,
      workspace: input.workspace,
      phase: INVITE_PHASE,
    }),
  })

  await markManagedWorkspaceMemberInviteStatus({
    workspaceRecordId: input.workspace.id,
    emails: memberEmails,
    status: 'PENDING',
  })
  await updateWorkflowMessage({
    workflowId: input.workflow.id,
    message: `Queued ChatGPT invite for ${memberEmails.length} workspace members.`,
  })

  return result
}

async function dispatchAuthorizationTasks(input: {
  workflow: WorkspaceInviteAuthorizeWorkflowRow
  workspace: AdminManagedWorkspaceSummary
  emails: string[]
}) {
  if (!input.workflow.connectionId) {
    throw new Error('Workflow CLI connection is missing.')
  }

  const emails = Array.from(new Set(input.emails.map(normalizeEmail))).filter(
    Boolean,
  )
  if (!emails.length) {
    return null
  }

  const result = await dispatchCliFlowTasks({
    connectionId: input.workflow.connectionId,
    flowId: 'codex-oauth',
    configs: emails.map((email) => ({
      email,
      ...(input.workspace.workspaceId
        ? { workspaceId: input.workspace.workspaceId }
        : {}),
    })),
    metadata: createWorkflowMetadata({
      workflow: input.workflow,
      workspace: input.workspace,
      phase: AUTHORIZE_PHASE,
    }),
  })

  await updateWorkflowMessage({
    workflowId: input.workflow.id,
    message: `Queued Codex OAuth authorization for ${emails.length} workspace identities.`,
  })

  return result
}

async function loadEnsuredWorkflowWorkspace(
  workflow: WorkspaceInviteAuthorizeWorkflowRow,
) {
  return ensureManagedWorkspaceMemberIdentityCount({
    id: workflow.managedWorkspaceId,
    count: getWorkflowTargetMemberCount(workflow),
  })
}

async function hasLatestSuccessfulInviteForWorkspaceMembers(input: {
  workflowId: string
  workspace: AdminManagedWorkspaceSummary
}) {
  const memberEmails = input.workspace.members.map((member) =>
    normalizeEmail(member.email),
  )
  const tasks = await listWorkflowTasks({
    workflowId: input.workflowId,
    phase: INVITE_PHASE,
    flowType: 'chatgpt-invite',
  })
  const latestSuccessfulInvite = tasks.find(
    (task) => task.status === 'SUCCEEDED',
  )

  return Boolean(
    latestSuccessfulInvite &&
    sameEmailSet(readTaskInviteEmails(latestSuccessfulInvite), memberEmails),
  )
}

async function markTaskEmailAsBanned(task: FlowTaskRow) {
  const email = readTaskEmail(task)
  if (!email) {
    return
  }

  const identity = await getDb().query.managedIdentities.findFirst({
    where: eq(managedIdentities.email, email),
    columns: {
      identityId: true,
    },
  })
  if (!identity) {
    return
  }

  await updateManagedIdentity({
    identityId: identity.identityId,
    status: 'BANNED',
  })
}

async function markWorkspaceMembersForReview(input: {
  workspace: AdminManagedWorkspaceSummary
  emails: string[]
}) {
  const emailSet = new Set(input.emails.map(normalizeEmail).filter(Boolean))
  const members = input.workspace.members.filter(
    (member) => member.identityId && emailSet.has(normalizeEmail(member.email)),
  )

  for (const member of members) {
    const identityId = member.identityId
    if (!identityId) {
      continue
    }

    await updateManagedIdentity({
      identityId,
      status: 'REVIEW',
    })
  }

  return members.length
}

async function handleInviteTaskCompletion(input: {
  workflow: WorkspaceInviteAuthorizeWorkflowRow
  status: FinalFlowTaskStatus
  error?: string | null
  result?: Record<string, unknown> | null
}) {
  if (input.workflow.phase !== 'INVITE') {
    return
  }

  if (input.status !== 'SUCCEEDED') {
    await applyWorkflowMachineOutcome({
      workflow: input.workflow,
      event: 'workflow.invite.completed',
      outcome: 'failed',
      message: input.error || 'ChatGPT invite task did not complete.',
      error: input.error,
    })
    return
  }

  const erroredEmails = readInviteErroredEmails(input.result)
  if (erroredEmails.length) {
    const workspace = await findAdminManagedWorkspaceSummary(
      input.workflow.managedWorkspaceId,
    )
    if (!workspace) {
      await applyWorkflowMachineOutcome({
        workflow: input.workflow,
        event: 'workflow.invite.completed',
        outcome: 'failed',
        message: 'Workspace not found after invite errors.',
      })
      return
    }

    const reviewCount = await markWorkspaceMembersForReview({
      workspace,
      emails: erroredEmails,
    })
    if (!reviewCount) {
      await applyWorkflowMachineOutcome({
        workflow: input.workflow,
        event: 'workflow.invite.completed',
        outcome: 'failed',
        message: `ChatGPT invite failed for ${erroredEmails.length} member email(s), but no matching managed member identity could be replaced.`,
      })
      return
    }

    try {
      const refreshedWorkspace = await loadEnsuredWorkflowWorkspace(
        input.workflow,
      )
      await applyWorkflowMachineOutcome({
        workflow: input.workflow,
        event: 'workflow.invite.completed',
        outcome: 'invite',
        message:
          'Replacing failed invite members; queuing refreshed ChatGPT invite.',
      })
      await dispatchInviteTask({
        workflow: input.workflow,
        workspace: refreshedWorkspace,
      })
    } catch (error) {
      await applyWorkflowMachineOutcome({
        workflow: input.workflow,
        event: 'workflow.invite.completed',
        outcome: 'failed',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to replace failed invite members.',
        error: error instanceof Error ? error.message : undefined,
      })
    }
    return
  }

  let workspace: AdminManagedWorkspaceSummary
  try {
    workspace = await loadEnsuredWorkflowWorkspace(input.workflow)
  } catch (error) {
    await applyWorkflowMachineOutcome({
      workflow: input.workflow,
      event: 'workflow.invite.completed',
      outcome: 'failed',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to prepare workspace member identities after invite.',
      error: error instanceof Error ? error.message : undefined,
    })
    return
  }

  if (
    !(await hasLatestSuccessfulInviteForWorkspaceMembers({
      workflowId: input.workflow.id,
      workspace,
    }))
  ) {
    try {
      await applyWorkflowMachineOutcome({
        workflow: input.workflow,
        event: 'workflow.invite.completed',
        outcome: 'invite',
        message:
          'Workspace members changed after invite; queuing refreshed ChatGPT invite.',
      })
      await dispatchInviteTask({
        workflow: input.workflow,
        workspace,
      })
    } catch (error) {
      await applyWorkflowMachineOutcome({
        workflow: input.workflow,
        event: 'workflow.invite.completed',
        outcome: 'failed',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to queue refreshed ChatGPT invite task.',
        error: error instanceof Error ? error.message : undefined,
      })
    }
    return
  }

  const authorizationWorkflow = await applyWorkflowMachineOutcome({
    workflow: input.workflow,
    event: 'workflow.invite.completed',
    outcome: 'authorize',
    message: 'Workspace invite completed; queuing Codex OAuth authorization.',
  })
  if (!authorizationWorkflow) {
    return
  }

  await queuePendingAuthorizationTasks(authorizationWorkflow, workspace)
}

async function queuePendingAuthorizationTasks(
  workflow: WorkspaceInviteAuthorizeWorkflowRow,
  workspace: AdminManagedWorkspaceSummary,
) {
  const targetMemberCount = getWorkflowTargetMemberCount(workflow)
  const targets = getWorkspaceAuthorizationTargets(workspace)
  if (!workspace.owner || workspace.members.length !== targetMemberCount) {
    await applyWorkflowMachineOutcome({
      workflow,
      event: 'workflow.authorize.completed',
      outcome: 'failed',
      message:
        'Workspace owner and all members are required before authorization.',
    })
    return
  }

  const unauthorizedTargets = targets.filter(
    (target) => target.authorization.state !== 'authorized',
  )
  if (!unauthorizedTargets.length) {
    await applyWorkflowMachineOutcome({
      workflow,
      event: 'workflow.authorize.completed',
      outcome: 'completed',
      message: 'Workspace owner and all members are authorized.',
    })
    return
  }

  try {
    await dispatchAuthorizationTasks({
      workflow,
      workspace,
      emails: unauthorizedTargets.map((target) => target.email),
    })
  } catch (error) {
    await applyWorkflowMachineOutcome({
      workflow,
      event: 'workflow.authorize.completed',
      outcome: 'failed',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to queue Codex OAuth authorization tasks.',
      error: error instanceof Error ? error.message : undefined,
    })
  }
}

async function handleAuthorizationTaskCompletion(input: {
  workflow: WorkspaceInviteAuthorizeWorkflowRow
  task: FlowTaskRow
  status: FinalFlowTaskStatus
  error?: string | null
}) {
  if (input.workflow.phase !== 'AUTHORIZE') {
    return
  }

  if (
    input.status === 'FAILED' &&
    isAccountDeactivatedMessage(input.error || input.task.lastError)
  ) {
    await markTaskEmailAsBanned(input.task)
  }

  let workspace: AdminManagedWorkspaceSummary
  try {
    workspace = await loadEnsuredWorkflowWorkspace(input.workflow)
  } catch (error) {
    await applyWorkflowMachineOutcome({
      workflow: input.workflow,
      event: 'workflow.authorize.completed',
      outcome: 'failed',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to prepare workspace member identities during authorization.',
      error: error instanceof Error ? error.message : undefined,
    })
    return
  }

  if (
    !(await hasLatestSuccessfulInviteForWorkspaceMembers({
      workflowId: input.workflow.id,
      workspace,
    }))
  ) {
    const inviteWorkflow = await applyWorkflowMachineOutcome({
      workflow: input.workflow,
      event: 'workflow.authorize.completed',
      outcome: 'invite',
      message:
        'Workspace members changed during authorization; queuing refreshed ChatGPT invite.',
    })
    if (!inviteWorkflow) {
      return
    }

    try {
      await dispatchInviteTask({
        workflow: inviteWorkflow,
        workspace,
      })
    } catch (error) {
      await applyWorkflowMachineOutcome({
        workflow: input.workflow,
        event: 'workflow.authorize.completed',
        outcome: 'failed',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to queue refreshed ChatGPT invite task.',
        error: error instanceof Error ? error.message : undefined,
      })
    }
    return
  }

  const targets = getWorkspaceAuthorizationTargets(workspace)
  const targetMemberCount = getWorkflowTargetMemberCount(input.workflow)
  if (!workspace.owner || workspace.members.length !== targetMemberCount) {
    await applyWorkflowMachineOutcome({
      workflow: input.workflow,
      event: 'workflow.authorize.completed',
      outcome: 'failed',
      message:
        'Workspace owner and all members are required before authorization can complete.',
    })
    return
  }

  const unauthorizedTargets = targets.filter(
    (target) => target.authorization.state !== 'authorized',
  )
  if (!unauthorizedTargets.length) {
    await applyWorkflowMachineOutcome({
      workflow: input.workflow,
      event: 'workflow.authorize.completed',
      outcome: 'completed',
      message: 'Workspace owner and all members are authorized.',
    })
    return
  }

  const tasks = await listWorkflowTasks({
    workflowId: input.workflow.id,
    phase: AUTHORIZE_PHASE,
    flowType: 'codex-oauth',
  })
  const activeEmails = new Set(
    tasks
      .filter((task) => isActiveTaskStatus(task.status))
      .map(readTaskEmail)
      .filter((email): email is string => Boolean(email)),
  )
  const attemptsByEmail = countAttemptsByEmail(tasks)
  const pendingTargets = unauthorizedTargets.filter(
    (target) => !activeEmails.has(target.email),
  )
  const retryableTargets = pendingTargets.filter(
    (target) =>
      (attemptsByEmail.get(target.email) || 0) < MAX_AUTHORIZATION_ATTEMPTS,
  )

  if (retryableTargets.length) {
    try {
      await applyWorkflowMachineOutcome({
        workflow: input.workflow,
        event: 'workflow.authorize.completed',
        outcome: 'authorize',
        message: `Queuing ${retryableTargets.length} remaining Codex OAuth authorization task(s).`,
      })
      await dispatchAuthorizationTasks({
        workflow: input.workflow,
        workspace,
        emails: retryableTargets.map((target) => target.email),
      })
    } catch (error) {
      await applyWorkflowMachineOutcome({
        workflow: input.workflow,
        event: 'workflow.authorize.completed',
        outcome: 'failed',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to queue remaining Codex OAuth authorization tasks.',
        error: error instanceof Error ? error.message : undefined,
      })
    }
    return
  }

  const waitingForActiveTargets = unauthorizedTargets.some((target) =>
    activeEmails.has(target.email),
  )
  if (waitingForActiveTargets) {
    return
  }

  await applyWorkflowMachineOutcome({
    workflow: input.workflow,
    event: 'workflow.authorize.completed',
    outcome: 'failed',
    message:
      'Workspace authorization is incomplete after the allowed Codex OAuth attempts.',
  })
}

export async function startWorkspaceInviteAuthorizeWorkflow(input: {
  workspaceRecordId: string
  actor: CliConnectionActorScope
  connectionId?: string
}) {
  const existingWorkspace = await findAdminManagedWorkspaceSummary(
    input.workspaceRecordId,
  )
  if (!existingWorkspace) {
    throw new Error('Workspace not found')
  }
  const connection = await selectWorkflowConnection({
    actor: input.actor,
    connectionId: input.connectionId,
  })
  const workspace = await ensureManagedWorkspaceMemberIdentityCount({
    id: input.workspaceRecordId,
    count: WORKFLOW_MEMBER_COUNT,
  })
  if (!workspace.owner?.identityId) {
    throw new Error('Workspace owner identity is required.')
  }
  if (workspace.members.length !== WORKFLOW_MEMBER_COUNT) {
    throw new Error(
      `Workspace must have ${WORKFLOW_MEMBER_COUNT} managed members before starting.`,
    )
  }

  const now = new Date()
  const [workflow] = await getDb()
    .insert(workspaceInviteAuthorizeWorkflows)
    .values({
      id: createId(),
      managedWorkspaceId: workspace.id,
      connectionId: connection.id,
      status: 'RUNNING',
      phase: 'INVITE',
      targetMemberCount: WORKFLOW_MEMBER_COUNT,
      lastMessage: `Inviting ${WORKFLOW_MEMBER_COUNT} workspace members from the owner account.`,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  if (!workflow) {
    throw new Error('Unable to create workspace invite and authorize workflow.')
  }

  const machine = createWorkspaceInviteAuthorizeMachine(workflow)
  machine.start(
    {
      workflowId: workflow.id,
      status: 'RUNNING',
      phase: 'INVITE',
      lastMessage: workflow.lastMessage,
    },
    {
      source: 'startWorkspaceInviteAuthorizeWorkflow',
    },
  )
  await machine.send('workflow.started', {
    patch: {
      workflowId: workflow.id,
      status: 'RUNNING',
      phase: 'INVITE',
      lastMessage: workflow.lastMessage,
    },
  })

  try {
    const result = await dispatchInviteTask({
      workflow,
      workspace,
    })
    await updateWorkflowMessage({
      workflowId: workflow.id,
      message: `Queued ChatGPT invite for ${workspace.members.length} workspace members.`,
    })

    return {
      workflowId: workflow.id,
      workspace,
      memberEmails: workspace.members.map((member) =>
        normalizeEmail(member.email),
      ),
      queuedInviteCount: result.tasks.length,
      assignedCliCount: result.assignedCliCount,
      connectionId: connection.id,
      connectionLabel: getConnectionLabel(connection),
    }
  } catch (error) {
    await applyWorkflowMachineOutcome({
      workflow,
      event: 'workflow.invite.completed',
      outcome: 'failed',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to queue ChatGPT invite.',
      error: error instanceof Error ? error.message : undefined,
    })
    throw error
  }
}

export async function advanceWorkspaceInviteAuthorizeWorkflowFromFlowTask(input: {
  task: FlowTaskRow
  status: FinalFlowTaskStatus
  error?: string | null
  result?: Record<string, unknown> | null
}) {
  const metadata = readWorkflowTaskMetadata(input.task.payload)
  if (!metadata) {
    return
  }

  const workflow = await findWorkflow(metadata.workflowId)
  if (!workflow || workflow.status !== 'RUNNING') {
    return
  }

  if (
    input.task.flowType === 'chatgpt-invite' &&
    metadata.phase === INVITE_PHASE
  ) {
    await handleInviteTaskCompletion({
      workflow,
      status: input.status,
      error: input.error,
      result: input.result,
    })
    return
  }

  if (
    input.task.flowType === 'codex-oauth' &&
    metadata.phase === AUTHORIZE_PHASE
  ) {
    await handleAuthorizationTaskCompletion({
      workflow,
      task: input.task,
      status: input.status,
      error: input.error,
    })
  }
}
