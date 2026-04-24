import { describe, expect, it } from 'vitest'

import {
  createCliFlowTaskPayload,
  normalizeCliFlowTaskPayload,
} from '../src/modules/flow-cli/flow-registry'

describe('flow task payload external services', () => {
  it('preserves app-managed Sub2API task metadata', () => {
    const payload = createCliFlowTaskPayload(
      'codex-oauth',
      {
        workspaceId: 'ws-explicit',
        workspaceIndex: 2,
      },
      {
        batchId: 'batch-1',
        sequence: 1,
        total: 2,
        parallelism: 2,
      },
      {
        sub2api: {
          source: 'app',
        },
      },
    )

    expect(normalizeCliFlowTaskPayload(payload)).toEqual(payload)
  })

  it('drops unsupported external service metadata', () => {
    expect(
      normalizeCliFlowTaskPayload({
        kind: 'flow_task',
        flowId: 'codex-oauth',
        config: {},
        externalServices: {
          sub2api: {
            source: 'env',
          },
        },
      }),
    ).toEqual({
      kind: 'flow_task',
      flowId: 'codex-oauth',
      config: {},
    })
  })
})
