import '@tanstack/react-start/server-only'

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
  workspaceInviteAuthorizeWorkflows,
  type FlowTaskRow,
  type FlowTaskStatus,
  type WorkspaceInviteAuthorizeWorkflowRow,
} from './db/schema'
import { updateManagedIdentity } from './identities'
import { createId } from './security'
import {
  ensureManagedWorkspaceMemberIdentityCount,
  findAdminManagedWorkspaceSummary,
  markManagedWorkspaceMemberInviteStatus,
  type AdminManagedWorkspaceMemberSummary,
  type AdminManagedWorkspaceSummary,
} from './workspaces'

const WORKFLOW_KIND = 'workspace-invite-and-authorize'
const MEMBER_LOGIN_PHASE = 'member-login'
const INVITE_PHASE = 'invite'
const AUTHORIZE_PHASE = 'authorize'
const WORKFLOW_MEMBER_COUNT = 9
const MAX_MEMBER_LOGIN_ATTEMPTS = 2
const MAX_AUTHORIZATION_ATTEMPTS = 2

type WorkflowTaskPhase =
  | typeof MEMBER_LOGIN_PHASE
  | typeof INVITE_PHASE
  | typeof AUTHORIZE_PHASE

type FinalFlowTaskStatus = Extract<
  FlowTaskStatus,
  'SUCCEEDED' | 'FAILED' | 'CANCELED'
>

interface WorkflowTaskMetadata {
  workflowId: string
  phase: WorkflowTaskPhase
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
  return (
    value === MEMBER_LOGIN_PHASE ||
    value === INVITE_PHASE ||
    value === AUTHORIZE_PHASE
  )
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
    workspace && isRecord(workspace.automation)
      ? workspace.automation
      : null
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

function readTaskIdentityId(task: Pick<FlowTaskRow, 'payload'>) {
  return normalizeOptionalString(readTaskConfig(task).identityId)
}

function readTaskEmail(task: Pick<FlowTaskRow, 'payload'>) {
  const email = normalizeOptionalString(readTaskConfig(task).email)
  return email ? normalizeEmail(email) : undefined
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
    connection.registeredFlows.includes('chatgpt-login') &&
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

function getWorkspaceMemberIdentityIds(
  workspace: AdminManagedWorkspaceSummary,
) {
  return workspace.members
    .map((member) => member.identityId?.trim())
    .filter((identityId): identityId is string => Boolean(identityId))
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
        'Selected CLI must be online and registered for chatgpt-login, chatgpt-invite, and codex-oauth.',
      )
    }
    return requested
  }

  const [connection] = capableConnections
  if (!connection) {
    throw new Error(
      'No online CLI is registered for chatgpt-login, chatgpt-invite, and codex-oauth.',
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

function countAttemptsByIdentity(tasks: FlowTaskRow[]) {
  const counts = new Map<string, number>()

  for (const task of tasks) {
    const identityId = readTaskIdentityId(task)
    if (!identityId || isActiveTaskStatus(task.status)) {
      continue
    }

    counts.set(identityId, (counts.get(identityId) || 0) + 1)
  }

  return counts
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

async function dispatchMemberLoginTasks(input: {
  workflow: WorkspaceInviteAuthorizeWorkflowRow
  workspace: AdminManagedWorkspaceSummary
  members: AdminManagedWorkspaceMemberSummary[]
  actor?: CliConnectionActorScope
}) {
  if (!input.workflow.connectionId) {
    throw new Error('Workflow CLI connection is missing.')
  }

  const configs = input.members.map((member) => ({
    identityId: member.identityId || '',
  }))

  return dispatchCliFlowTasks({
    connectionId: input.workflow.connectionId,
    flowId: 'chatgpt-login',
    actor: input.actor,
    configs,
    metadata: createWorkflowMetadata({
      workflow: input.workflow,
      workspace: input.workspace,
      phase: MEMBER_LOGIN_PHASE,
    }),
  })
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

async function handleMemberLoginTaskCompletion(input: {
  workflow: WorkspaceInviteAuthorizeWorkflowRow
  task: FlowTaskRow
  status: FinalFlowTaskStatus
  error?: string | null
}) {
  if (input.workflow.phase !== 'MEMBER_LOGIN') {
    return
  }

  const taskIdentityId = readTaskIdentityId(input.task)
  if (
    input.status === 'FAILED' &&
    taskIdentityId &&
    isAccountDeactivatedMessage(input.error || input.task.lastError)
  ) {
    await updateManagedIdentity({
      identityId: taskIdentityId,
      status: 'BANNED',
    })
  }

  let workspace: AdminManagedWorkspaceSummary
  try {
    workspace = await loadEnsuredWorkflowWorkspace(input.workflow)
  } catch (error) {
    await markWorkflowFailed({
      workflowId: input.workflow.id,
      message:
        error instanceof Error
          ? error.message
          : 'Unable to prepare workspace member identities.',
    })
    return
  }

  const targetMemberCount = getWorkflowTargetMemberCount(input.workflow)
  const currentIdentityIds = new Set(getWorkspaceMemberIdentityIds(workspace))
  if (currentIdentityIds.size !== targetMemberCount) {
    await markWorkflowFailed({
      workflowId: input.workflow.id,
      message: `Workspace must have ${targetMemberCount} managed member identities before inviting.`,
    })
    return
  }

  const tasks = await listWorkflowTasks({
    workflowId: input.workflow.id,
    phase: MEMBER_LOGIN_PHASE,
    flowType: 'chatgpt-login',
  })
  const succeededIdentityIds = new Set(
    tasks
      .filter((task) => task.status === 'SUCCEEDED')
      .map(readTaskIdentityId)
      .filter((identityId): identityId is string => Boolean(identityId)),
  )
  const activeIdentityIds = new Set(
    tasks
      .filter((task) => isActiveTaskStatus(task.status))
      .map(readTaskIdentityId)
      .filter((identityId): identityId is string => Boolean(identityId)),
  )
  const attemptsByIdentity = countAttemptsByIdentity(tasks)
  const pendingMembers = workspace.members.filter(
    (member) =>
      member.identityId &&
      !succeededIdentityIds.has(member.identityId) &&
      !activeIdentityIds.has(member.identityId),
  )
  const retryableMembers = pendingMembers.filter(
    (member) =>
      member.identityId &&
      (attemptsByIdentity.get(member.identityId) || 0) <
        MAX_MEMBER_LOGIN_ATTEMPTS,
  )

  if (retryableMembers.length) {
    await dispatchMemberLoginTasks({
      workflow: input.workflow,
      workspace,
      members: retryableMembers,
    })
    return
  }

  if (pendingMembers.length) {
    await markWorkflowFailed({
      workflowId: input.workflow.id,
      message:
        'Unable to confirm every workspace member through ChatGPT login.',
    })
    return
  }

  const waitingForActiveMembers = [...currentIdentityIds].some(
    (identityId) =>
      !succeededIdentityIds.has(identityId) &&
      activeIdentityIds.has(identityId),
  )
  if (waitingForActiveMembers) {
    return
  }

  const inviteWorkflow = await transitionWorkflowPhase({
    workflowId: input.workflow.id,
    from: 'MEMBER_LOGIN',
    to: 'INVITE',
    message:
      'All workspace members passed ChatGPT login; queuing member invite.',
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
    await markWorkflowFailed({
      workflowId: input.workflow.id,
      message:
        error instanceof Error
          ? error.message
          : 'Unable to queue ChatGPT invite task.',
    })
  }
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
    await markWorkflowFailed({
      workflowId: input.workflow.id,
      message: input.error || 'ChatGPT invite task did not complete.',
    })
    return
  }

  const erroredEmails = readInviteErroredEmails(input.result)
  if (erroredEmails.length) {
    await markWorkflowFailed({
      workflowId: input.workflow.id,
      message: `ChatGPT invite failed for ${erroredEmails.length} member email(s).`,
    })
    return
  }

  const workspace = await findAdminManagedWorkspaceSummary(
    input.workflow.managedWorkspaceId,
  )
  if (!workspace) {
    await markWorkflowFailed({
      workflowId: input.workflow.id,
      message: 'Workspace not found after invite completion.',
    })
    return
  }

  const authorizationWorkflow = await transitionWorkflowPhase({
    workflowId: input.workflow.id,
    from: 'INVITE',
    to: 'AUTHORIZE',
    message:
      'Workspace invite completed; queuing Codex OAuth authorization.',
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
    await markWorkflowFailed({
      workflowId: workflow.id,
      message:
        'Workspace owner and all members are required before authorization.',
    })
    return
  }

  const unauthorizedTargets = targets.filter(
    (target) => target.authorization.state !== 'authorized',
  )
  if (!unauthorizedTargets.length) {
    await markWorkflowCompleted({
      workflowId: workflow.id,
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
    await markWorkflowFailed({
      workflowId: workflow.id,
      message:
        error instanceof Error
          ? error.message
          : 'Unable to queue Codex OAuth authorization tasks.',
    })
  }
}

async function handleAuthorizationTaskCompletion(input: {
  workflow: WorkspaceInviteAuthorizeWorkflowRow
}) {
  if (input.workflow.phase !== 'AUTHORIZE') {
    return
  }

  const workspace = await findAdminManagedWorkspaceSummary(
    input.workflow.managedWorkspaceId,
  )
  if (!workspace) {
    await markWorkflowFailed({
      workflowId: input.workflow.id,
      message: 'Workspace not found during authorization.',
    })
    return
  }

  const targets = getWorkspaceAuthorizationTargets(workspace)
  const unauthorizedTargets = targets.filter(
    (target) => target.authorization.state !== 'authorized',
  )
  if (!unauthorizedTargets.length) {
    await markWorkflowCompleted({
      workflowId: input.workflow.id,
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
      await dispatchAuthorizationTasks({
        workflow: input.workflow,
        workspace,
        emails: retryableTargets.map((target) => target.email),
      })
    } catch (error) {
      await markWorkflowFailed({
        workflowId: input.workflow.id,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to queue remaining Codex OAuth authorization tasks.',
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

  await markWorkflowFailed({
    workflowId: input.workflow.id,
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
      phase: 'MEMBER_LOGIN',
      targetMemberCount: WORKFLOW_MEMBER_COUNT,
      lastMessage: `Checking ${WORKFLOW_MEMBER_COUNT} workspace members with ChatGPT login.`,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  if (!workflow) {
    throw new Error('Unable to create workspace invite and authorize workflow.')
  }

  try {
    const result = await dispatchMemberLoginTasks({
      workflow,
      workspace,
      members: workspace.members,
      actor: input.actor,
    })
    await updateWorkflowMessage({
      workflowId: workflow.id,
      message: `Queued ChatGPT login checks for ${workspace.members.length} workspace members.`,
    })

    return {
      workflowId: workflow.id,
      workspace,
      memberEmails: workspace.members.map((member) =>
        normalizeEmail(member.email),
      ),
      queuedLoginCount: result.tasks.length,
      assignedCliCount: result.assignedCliCount,
      connectionId: connection.id,
      connectionLabel: getConnectionLabel(connection),
    }
  } catch (error) {
    await markWorkflowFailed({
      workflowId: workflow.id,
      message:
        error instanceof Error
          ? error.message
          : 'Unable to queue ChatGPT login checks.',
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
    input.task.flowType === 'chatgpt-login' &&
    metadata.phase === MEMBER_LOGIN_PHASE
  ) {
    await handleMemberLoginTaskCompletion({
      workflow,
      task: input.task,
      status: input.status,
      error: input.error,
    })
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
    })
  }
}
