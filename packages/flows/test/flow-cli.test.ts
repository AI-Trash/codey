import { describe, expect, it } from 'vitest'
import { noopFlow } from '../src/flows/noop'
import {
  applyFlowOptionDefaults,
  shouldKeepFlowOpen,
  type FlowOptions,
} from '../src/modules/flow-cli/helpers'

describe('flow cli helpers', () => {
  it('applies flow defaults without overriding explicit values', () => {
    const defaults = applyFlowOptionDefaults<FlowOptions>(
      {},
      {
        har: true,
        record: true,
      },
    )
    expect(defaults.har).toBe(true)
    expect(defaults.record).toBe(true)

    const explicit = applyFlowOptionDefaults<FlowOptions>(
      { har: false, record: false },
      { har: true, record: true },
    )
    expect(explicit.har).toBe(false)
    expect(explicit.record).toBe(false)
  })

  it('treats record as the keep-open switch', () => {
    expect(shouldKeepFlowOpen({})).toBe(false)
    expect(shouldKeepFlowOpen({ record: true })).toBe(true)
    expect(shouldKeepFlowOpen({ record: 'true' })).toBe(true)
    expect(shouldKeepFlowOpen({ record: 'false' })).toBe(false)
  })

  it('defaults noop flow to har and record enabled', () => {
    expect(noopFlow.defaultOptions).toMatchObject({
      har: true,
      record: true,
    })
  })
})
