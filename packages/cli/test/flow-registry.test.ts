import { describe, expect, it } from 'vitest'

import {
  createCliFlowTaskPayload,
  getCliFlowDefinition,
  listCliFlowCommandIds,
  normalizeCliFlowTaskPayload,
} from '../src/modules/flow-cli/flow-registry'

describe('flow registry', () => {
  it('exposes the register-to-Team-trial switch for app dispatch', () => {
    expect(getCliFlowDefinition('chatgpt-register')).toMatchObject({
      id: 'chatgpt-register',
      configKeys: [
        'password',
        'claimTeamTrial',
        'verificationTimeoutMs',
        'pollIntervalMs',
        'billingName',
        'billingCountry',
        'billingAddressLine1',
        'billingAddressLine2',
        'billingCity',
        'billingState',
        'billingPostalCode',
      ],
    })

    expect(
      normalizeCliFlowTaskPayload({
        kind: 'flow_task',
        flowId: 'chatgpt-register',
        config: {
          claimTeamTrial: 'true',
          billingCountry: ' NL ',
          billingPostalCode: ' 1187 ST ',
        },
      }),
    ).toEqual({
      kind: 'flow_task',
      flowId: 'chatgpt-register',
      config: {
        claimTeamTrial: true,
        billingCountry: 'NL',
        billingPostalCode: '1187 ST',
      },
    })
  })

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
      configKeys: [
        'identityId',
        'email',
        'restoreStorageState',
        'billingName',
        'billingCountry',
        'billingAddressLine1',
        'billingAddressLine2',
        'billingCity',
        'billingState',
        'billingPostalCode',
      ],
    })
    expect(normalizeCliFlowTaskPayload(payload)).toEqual(payload)
  })

  it('registers the renamed ChatGPT invite flow and normalizes legacy payloads', () => {
    expect(listCliFlowCommandIds()).toContain('chatgpt-invite')
    expect(getCliFlowDefinition('chatgpt-invite')).toMatchObject({
      id: 'chatgpt-invite',
      configKeys: [
        'identityId',
        'email',
        'restoreStorageState',
        'inviteEmail',
        'inviteFile',
        'pruneUnmanagedWorkspaceMembers',
      ],
    })

    expect(
      normalizeCliFlowTaskPayload({
        kind: 'flow_task',
        flowId: 'chatgpt-login-invite',
        config: {
          inviteEmail: ['member@example.com'],
          pruneUnmanagedWorkspaceMembers: 'true',
        },
      }),
    ).toEqual({
      kind: 'flow_task',
      flowId: 'chatgpt-invite',
      config: {
        inviteEmail: ['member@example.com'],
        pruneUnmanagedWorkspaceMembers: true,
      },
    })
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
      {
        workspace: {
          recordId: 'workspace-record-1',
          workspaceId: 'ws_alpha',
          label: 'Alpha',
          ownerIdentityId: 'identity-1',
        },
      },
    )

    expect(normalizeCliFlowTaskPayload(payload)).toEqual(payload)
  })

  it('normalizes workspace task metadata for app dispatch', () => {
    expect(
      normalizeCliFlowTaskPayload({
        kind: 'flow_task',
        flowId: 'chatgpt-team-trial',
        config: {
          email: 'owner@example.com',
        },
        metadata: {
          workspace: {
            recordId: ' workspace-record-1 ',
            workspaceId: ' ws_alpha ',
            label: ' Alpha ',
            ownerIdentityId: ' identity-1 ',
            ignored: 'drop me',
          },
          ignored: true,
        },
      }),
    ).toEqual({
      kind: 'flow_task',
      flowId: 'chatgpt-team-trial',
      config: {
        email: 'owner@example.com',
      },
      metadata: {
        workspace: {
          recordId: 'workspace-record-1',
          workspaceId: 'ws_alpha',
          label: 'Alpha',
          ownerIdentityId: 'identity-1',
        },
      },
    })
  })

  it('normalizes identity maintenance metadata for app dispatch', () => {
    expect(
      normalizeCliFlowTaskPayload({
        kind: 'flow_task',
        flowId: 'chatgpt-login',
        config: {
          identityId: ' identity-1 ',
          email: 'PERSON@example.com',
          restoreStorageState: 'true',
        },
        metadata: {
          identityMaintenance: {
            kind: 'identity-maintenance',
            runId: ' maintenance-run-1 ',
            identityId: ' identity-1 ',
            email: ' PERSON@example.com ',
            ignored: true,
          },
        },
      }),
    ).toEqual({
      kind: 'flow_task',
      flowId: 'chatgpt-login',
      config: {
        identityId: 'identity-1',
        email: 'PERSON@example.com',
        restoreStorageState: true,
      },
      metadata: {
        identityMaintenance: {
          kind: 'identity-maintenance',
          runId: 'maintenance-run-1',
          identityId: 'identity-1',
          email: 'PERSON@example.com',
        },
      },
    })
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
