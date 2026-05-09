import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createId: vi.fn(() => 'generated-id'),
  encryptSecret: vi.fn((value: string) => `encrypted:${value}`),
  getDb: vi.fn(),
  getVerificationDomainSummaryById: vi.fn(),
}))

vi.mock('./db/client', () => ({
  getDb: mocks.getDb,
}))

vi.mock('./encrypted-secrets', () => ({
  decryptSecret: vi.fn(),
  encryptSecret: mocks.encryptSecret,
}))

vi.mock('./security', () => ({
  createId: mocks.createId,
}))

vi.mock('./verification-domains', () => ({
  getVerificationDomainSummaryById: mocks.getVerificationDomainSummaryById,
  listPersonalVerificationMailboxDomains: vi.fn(),
}))

import { importPersonalMailboxesFromCsv } from './personal-mailboxes'

function createInsertChain(returnedRows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnedRows)
  const onConflictDoNothing = vi.fn(() => ({
    returning,
  }))
  const onConflictDoUpdate = vi.fn(() => undefined)
  const values = vi.fn(() => ({
    onConflictDoNothing,
    onConflictDoUpdate,
    returning,
  }))

  return {
    onConflictDoNothing,
    onConflictDoUpdate,
    returning,
    values,
  }
}

function createUpdateChain() {
  const where = vi.fn(() => undefined)
  const set = vi.fn(() => ({
    where,
  }))

  return {
    set,
    where,
  }
}

describe('personal mailbox CSV import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('imports single-column outlook rows split by ----', async () => {
    const now = new Date('2026-05-09T00:00:00.000Z')
    const domain = {
      id: 'mailbox-1',
      domain: 'person@example.com',
      mailboxType: 'outlook' as const,
      mailboxPrefix: null,
      description: null,
      registrationEnabled: true,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    }
    const credential = {
      id: 'credential-1',
      verificationDomainId: domain.id,
      provider: 'outlook' as const,
      graphTenantId: 'common',
      graphClientId: '11111111-1111-4111-8111-111111111111',
      graphScopes: 'https://graph.microsoft.com/Mail.Read offline_access',
      graphRefreshTokenCiphertext: 'encrypted:refresh-token',
      graphRefreshTokenPreview: '****-token',
      passwordCiphertext: 'encrypted:mail-password',
      passwordPreview: '****ssword',
      lastGraphReadAt: null,
      lastGraphError: null,
      createdAt: now,
      updatedAt: now,
    }
    const domainInsert = createInsertChain([domain])
    const credentialInsert = createInsertChain([credential])
    const updateChain = createUpdateChain()
    const db = {
      query: {
        verificationDomains: {
          findFirst: vi.fn().mockResolvedValue(domain),
        },
        personalMailboxCredentials: {
          findFirst: vi.fn().mockResolvedValue(credential),
        },
      },
      insert: vi
        .fn()
        .mockReturnValueOnce({ values: domainInsert.values })
        .mockReturnValueOnce({ values: credentialInsert.values }),
      update: vi.fn(() => ({ set: updateChain.set })),
    }
    mocks.getDb.mockReturnValue(db)
    mocks.getVerificationDomainSummaryById.mockResolvedValue(domain)

    const result = await importPersonalMailboxesFromCsv(
      [
        '卡号',
        'person@example.com----mail-password----11111111-1111-4111-8111-111111111111----refresh-token',
      ].join('\n'),
    )

    expect(result.failed).toEqual([])
    expect(result.imported).toHaveLength(1)
    expect(domainInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'person@example.com',
        mailboxType: 'outlook',
      }),
    )
    expect(credentialInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        graphClientId: '11111111-1111-4111-8111-111111111111',
        graphRefreshTokenCiphertext: 'encrypted:refresh-token',
        passwordCiphertext: 'encrypted:mail-password',
      }),
    )
    expect(mocks.encryptSecret).toHaveBeenCalledWith(
      'refresh-token',
      'encrypt Outlook Graph refresh tokens',
    )
  })

  it('keeps empty password fields in single-column outlook rows', async () => {
    const now = new Date('2026-05-09T00:00:00.000Z')
    const domain = {
      id: 'mailbox-2',
      domain: 'empty-password@example.com',
      mailboxType: 'outlook' as const,
      mailboxPrefix: null,
      description: null,
      registrationEnabled: true,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    }
    const credential = {
      id: 'credential-2',
      verificationDomainId: domain.id,
      provider: 'outlook' as const,
      graphTenantId: 'common',
      graphClientId: '22222222-2222-4222-8222-222222222222',
      graphScopes: 'https://graph.microsoft.com/Mail.Read offline_access',
      graphRefreshTokenCiphertext: 'encrypted:refresh-token',
      graphRefreshTokenPreview: '****-token',
      passwordCiphertext: null,
      passwordPreview: null,
      lastGraphReadAt: null,
      lastGraphError: null,
      createdAt: now,
      updatedAt: now,
    }
    const domainInsert = createInsertChain([domain])
    const credentialInsert = createInsertChain([credential])
    const updateChain = createUpdateChain()
    const db = {
      query: {
        verificationDomains: {
          findFirst: vi.fn().mockResolvedValue(domain),
        },
        personalMailboxCredentials: {
          findFirst: vi.fn().mockResolvedValue(credential),
        },
      },
      insert: vi
        .fn()
        .mockReturnValueOnce({ values: domainInsert.values })
        .mockReturnValueOnce({ values: credentialInsert.values }),
      update: vi.fn(() => ({ set: updateChain.set })),
    }
    mocks.getDb.mockReturnValue(db)
    mocks.getVerificationDomainSummaryById.mockResolvedValue(domain)

    const result = await importPersonalMailboxesFromCsv(
      [
        '卡号',
        'empty-password@example.com---- ----22222222-2222-4222-8222-222222222222----refresh-token',
      ].join('\n'),
    )

    expect(result.failed).toEqual([])
    expect(result.imported).toHaveLength(1)
    expect(credentialInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        graphClientId: '22222222-2222-4222-8222-222222222222',
        graphRefreshTokenCiphertext: 'encrypted:refresh-token',
      }),
    )
    expect(credentialInsert.values).toHaveBeenCalledWith(
      expect.not.objectContaining({
        passwordCiphertext: expect.any(String),
      }),
    )
  })
})
