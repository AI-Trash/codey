import type { AdminFlowTaskSummary } from '#/lib/server/flow-runs'
import { m } from '#/paraglide/messages'

export function buildAdminFlowTaskHref(taskId: string) {
  return `/admin/flows?taskId=${encodeURIComponent(taskId)}`
}

export function getFlowDisplayName(flowType: string) {
  if (flowType === 'chatgpt-register') {
    return m.admin_cli_flow_chatgpt_register_name()
  }

  if (flowType === 'chatgpt-login') {
    return m.admin_cli_flow_chatgpt_login_name()
  }

  if (flowType === 'chatgpt-team-trial' || flowType === 'chatgpt-purchase') {
    return m.admin_cli_flow_chatgpt_team_trial_name()
  }

  if (flowType === 'chatgpt-invite' || flowType === 'chatgpt-login-invite') {
    return m.admin_cli_flow_chatgpt_invite_name()
  }

  if (flowType === 'codex-oauth') {
    return m.admin_cli_flow_codex_oauth_name()
  }

  if (flowType === 'noop') {
    return m.admin_cli_flow_noop_name()
  }

  return flowType
}

export function formatFlowBatchLabel(
  task: Pick<AdminFlowTaskSummary, 'batch'>,
) {
  if (!task.batch) {
    return m.oauth_none()
  }

  const parts = []

  if (task.batch.batchId) {
    parts.push(task.batch.batchId)
  }

  if (task.batch.sequence && task.batch.total) {
    parts.push(`${task.batch.sequence}/${task.batch.total}`)
  }

  if (task.batch.parallelism) {
    parts.push(`parallelism ${task.batch.parallelism}`)
  }

  return parts.join(' · ') || m.oauth_none()
}
