import { describe, expect, it } from 'vitest'

import { getWorkspaceCodexOAuthParallelism } from './workspace-codex-oauth'

describe('getWorkspaceCodexOAuthParallelism', () => {
  it('uses the pending member count when it is below the global cap', () => {
    expect(getWorkspaceCodexOAuthParallelism(2)).toBe(2)
  })

  it('caps workspace authorization parallelism at the global parallelism limit', () => {
    expect(getWorkspaceCodexOAuthParallelism(20)).toBe(10)
  })

  it('never returns less than one', () => {
    expect(getWorkspaceCodexOAuthParallelism(0)).toBe(1)
  })
})
