import { describe, expect, it } from 'vitest'

import {
  createCliFlowTaskPayload,
  getCliFlowDefinition,
  listCliFlowCommandIds,
  normalizeCliFlowTaskPayload,
} from '../src/modules/flow-cli/flow-registry'

describe('flow registry', () => {
  it('registers the ChatGPT Team trial flow for app dispatch', () => {
    const flowIds = listCliFlowCommandIds()
    const payload = createCliFlowTaskPayload('chatgpt-team-trial', {
      email: 'person@example.com',
      recordPageContent: true,
      restoreStorageState: true,
    })

    expect(flowIds).toContain('chatgpt-team-trial')
    expect(flowIds).not.toContain('chatgpt-purchase')
    expect(getCliFlowDefinition('chatgpt-team-trial')).toMatchObject({
      id: 'chatgpt-team-trial',
      configKeys: ['identityId', 'email', 'restoreStorageState'],
    })
    expect(normalizeCliFlowTaskPayload(payload)).toEqual(payload)
  })

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
