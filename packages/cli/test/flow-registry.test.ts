import { describe, expect, it } from 'vitest'

import {
  normalizeCliFlowTaskPayload,
  normalizeCliFlowTaskParallelism,
} from '../src/modules/flow-cli/flow-registry'

describe('flow task payloads', () => {
  it('preserves normalized batch metadata on flow task payloads', () => {
    const payload = normalizeCliFlowTaskPayload({
      kind: 'flow_task',
      flowId: 'chatgpt-register',
      config: {
        verificationTimeoutMs: '180000',
      },
      batch: {
        batchId: 'batch-1',
        sequence: '2',
        total: '5',
        parallelism: '3',
      },
    })

    expect(payload).toEqual({
      kind: 'flow_task',
      flowId: 'chatgpt-register',
      config: {
        verificationTimeoutMs: 180000,
      },
      batch: {
        batchId: 'batch-1',
        sequence: 2,
        total: 5,
        parallelism: 3,
      },
    })
  })

  it('caps parallelism at the batch count', () => {
    expect(normalizeCliFlowTaskParallelism('4', { count: 2 })).toBe(2)
    expect(normalizeCliFlowTaskParallelism('', { count: 3 })).toBe(1)
  })
})
