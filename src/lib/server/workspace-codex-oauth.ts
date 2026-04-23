import '@tanstack/react-start/server-only'

import { MAX_CLI_FLOW_TASK_PARALLELISM } from '../../../packages/cli/src/modules/flow-cli/flow-registry'

export function getWorkspaceCodexOAuthParallelism(memberCount: number) {
  return Math.min(
    Math.max(memberCount, 1),
    MAX_CLI_FLOW_TASK_PARALLELISM,
  )
}
