import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createId: vi.fn(() => 'generated-id'),
  decryptSecret: vi.fn((value: string) => value.replace(/^encrypted:/, '')),
  encryptSecret: vi.fn((value: string) => `encrypted:${value}`),
  getDb: vi.fn(),
  getVerificationDomainSummaryById: vi.fn(),
  listPersonalVerificationMailboxDomains: vi.fn(),
  publishVerificationCodeEvent: vi.fn(),
}))

vi.mock('./db/client', () => ({
  getDb: mocks.getDb,
}))

vi.mock('./encrypted-secrets', () => ({
  decryptSecret: mocks.decryptSecret,
  encryptSecret: mocks.encryptSecret,
}))

vi.mock('./security', () => ({
  createId: mocks.createId,
}))

vi.mock('./verification-domains', () => ({
  getVerificationDomainSummaryById: mocks.getVerificationDomainSummaryById,
  listPersonalVerificationMailboxDomains:
    mocks.listPersonalVerificationMailboxDomains,
}))

vi.mock('./verification-events', () => ({
  publishVerificationCodeEvent: mocks.publishVerificationCodeEvent,
}))

import {
  findOutlookGraphVerificationCode,
  importPersonalMailboxesFromCsv,
} from './personal-mailboxes'

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

describe('personal mailbox Graph verification lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mocks.createId.mockReset()
    mocks.createId
      .mockReturnValueOnce('email-ingest-1')
      .mockReturnValueOnce('code-record-1')
    mocks.decryptSecret.mockImplementation((value: string) =>
      value.replace(/^encrypted:/, ''),
    )
  })

  it('syncs Graph verification emails into verification messages', async () => {
    const receivedAt = new Date('2026-05-09T00:02:00.000Z')
    const domain = {
      id: 'mailbox-graph',
      domain: 'person@example.com',
      mailboxType: 'outlook' as const,
      mailboxPrefix: null,
      description: null,
      registrationEnabled: true,
      isDefault: false,
      createdAt: new Date('2026-05-09T00:00:00.000Z'),
      updatedAt: new Date('2026-05-09T00:00:00.000Z'),
    }
    const credential = {
      id: 'credential-graph',
      verificationDomainId: domain.id,
      provider: 'outlook' as const,
      graphTenantId: 'common',
      graphClientId: 'client-id',
      graphScopes: 'https://graph.microsoft.com/Mail.Read offline_access',
      graphRefreshTokenCiphertext: 'encrypted:refresh-token',
      graphRefreshTokenPreview: '****-token',
      passwordCiphertext: null,
      passwordPreview: null,
      lastGraphReadAt: null,
      lastGraphError: null,
      createdAt: new Date('2026-05-09T00:00:00.000Z'),
      updatedAt: new Date('2026-05-09T00:00:00.000Z'),
    }
    const graphMessage = {
      id: 'graph-message-1',
      subject: 'Your ChatGPT code',
      bodyPreview: 'Use 123456 to verify your account',
      receivedDateTime: receivedAt.toISOString(),
      toRecipients: [
        {
          emailAddress: {
            address: 'person@example.com',
          },
        },
      ],
      body: {
        contentType: 'html',
        content: '<p>Use 123456 to verify your account</p>',
      },
    }
    const updateWhere = vi.fn()
    const updateSet = vi.fn(() => ({ where: updateWhere }))
    const existingEmailFindFirst = vi
      .fn()
      .mockResolvedValueOnce(domain)
      .mockResolvedValueOnce(credential)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'code-record-1',
        reservationId: 'reservation-graph',
        code: '123456',
        source: 'OUTLOOK_GRAPH',
        messageId: 'graph-message-1',
        receivedAt,
      })
    const emailReturning = vi.fn().mockResolvedValue([
      {
        id: 'email-ingest-1',
        reservationId: 'reservation-graph',
        messageId: 'graph-message-1',
        recipient: 'person@example.com',
        verificationCode: '123456',
        receivedAt,
      },
    ])
    const emailValues = vi.fn(() => ({ returning: emailReturning }))
    const codeReturning = vi.fn().mockResolvedValue([])
    const codeOnConflictDoNothing = vi.fn(() => ({ returning: codeReturning }))
    const codeValues = vi.fn(() => ({
      onConflictDoNothing: codeOnConflictDoNothing,
    }))

    mocks.getDb.mockReturnValue({
      query: {
        verificationDomains: {
          findFirst: existingEmailFindFirst,
        },
        personalMailboxCredentials: {
          findFirst: existingEmailFindFirst,
        },
        emailIngestRecords: {
          findFirst: existingEmailFindFirst,
        },
        verificationCodes: {
          findFirst: existingEmailFindFirst,
        },
      },
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi
        .fn()
        .mockReturnValueOnce({ values: emailValues })
        .mockReturnValueOnce({ values: codeValues }),
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'access-token',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [graphMessage],
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      findOutlookGraphVerificationCode({
        reservationId: 'reservation-graph',
        email: 'person@example.com',
        mailbox: 'person@example.com',
        startedAt: new Date('2026-05-09T00:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      code: '123456',
      source: 'OUTLOOK_GRAPH',
      emails: [
        {
          messageId: 'graph-message-1',
          htmlBody: '<p>Use 123456 to verify your account</p>',
        },
      ],
    })

    expect(emailValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'email-ingest-1',
        reservationId: 'reservation-graph',
        messageId: 'graph-message-1',
        recipient: 'person@example.com',
        subject: 'Your ChatGPT code',
        htmlBody: '<p>Use 123456 to verify your account</p>',
        verificationCode: '123456',
        receivedAt,
      }),
    )
    expect(codeValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'code-record-1',
        reservationId: 'reservation-graph',
        code: '123456',
        source: 'OUTLOOK_GRAPH',
        messageId: 'graph-message-1',
        receivedAt,
      }),
    )
    expect(mocks.publishVerificationCodeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: 'reservation-graph',
        email: 'person@example.com',
        code: '123456',
        source: 'OUTLOOK_GRAPH',
      }),
    )
  })
})
