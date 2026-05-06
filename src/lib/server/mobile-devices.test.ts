import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createId: vi.fn(() => 'generated-id'),
  randomToken: vi.fn(() => 'mobile-token'),
  sha256: vi.fn((value: string) => `sha256:${value}`),
  getDb: vi.fn(),
}))

vi.mock('./db/client', () => ({
  getDb: mocks.getDb,
}))

vi.mock('./security', () => ({
  createId: mocks.createId,
  randomToken: mocks.randomToken,
  sha256: mocks.sha256,
}))

import { authenticateMobileDevice, pairMobileDevice } from './mobile-devices'

function createInsertChain(record: unknown) {
  const returning = vi.fn().mockResolvedValue([record])
  const values = vi.fn(() => ({
    returning,
  }))
  return {
    values,
    returning,
  }
}

function createDeleteChain() {
  const where = vi.fn().mockResolvedValue(undefined)
  return {
    where,
  }
}

describe('mobile devices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createId.mockImplementation(() => 'generated-id')
    mocks.randomToken.mockReturnValue('mobile-token')
    mocks.sha256.mockImplementation((value: string) => `sha256:${value}`)
  })

  it('pairs a new mobile device with a hashed device token and phone bindings', async () => {
    const device = {
      id: 'mobile-device-1',
      deviceId: 'android-abc',
      label: 'Android ABC',
      status: 'ACTIVE',
      tokenHash: 'sha256:mobile-token',
      capabilities: ['gopay:unlink', 'whatsapp:ingest'],
      pairedByUserId: 'user-1',
      deviceChallengeId: 'challenge-1',
      userAgent: 'CodeyApp',
      lastSeenAt: new Date('2026-05-06T00:00:00.000Z'),
      revokedAt: null,
      createdAt: new Date('2026-05-06T00:00:00.000Z'),
      updatedAt: new Date('2026-05-06T00:00:00.000Z'),
    }
    const deviceInsert = createInsertChain(device)
    const phoneInsert = createInsertChain({})
    const deleteChain = createDeleteChain()
    const insert = vi
      .fn()
      .mockReturnValueOnce({ values: deviceInsert.values })
      .mockReturnValueOnce({ values: phoneInsert.values })

    mocks.getDb.mockReturnValue({
      query: {
        mobileDevices: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      insert,
      delete: vi.fn(() => deleteChain),
    })

    await expect(
      pairMobileDevice({
        deviceId: ' android-abc ',
        label: ' Android ABC ',
        userId: 'user-1',
        deviceChallengeId: 'challenge-1',
        userAgent: 'CodeyApp',
        capabilities: ['whatsapp:ingest', 'gopay:unlink', 'bad space'],
        phoneBindings: [
          {
            phoneNumber: ' +1 (840) 000-0000 ',
            purpose: 'both',
            isDefault: true,
          },
        ],
      }),
    ).resolves.toMatchObject({
      token: 'mobile-token',
      device,
    })

    expect(deviceInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'android-abc',
        label: 'Android ABC',
        tokenHash: 'sha256:mobile-token',
        capabilities: ['gopay:unlink', 'whatsapp:ingest'],
        pairedByUserId: 'user-1',
      }),
    )
    expect(phoneInsert.values).toHaveBeenCalledWith([
      expect.objectContaining({
        mobileDeviceId: 'mobile-device-1',
        phoneNumber: '+18400000000',
        purpose: 'BOTH',
        isDefault: true,
      }),
    ])
  })

  it('authenticates an active device token', async () => {
    const device = {
      id: 'mobile-device-1',
      deviceId: 'android-abc',
      status: 'ACTIVE',
    }
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const set = vi.fn(() => ({ where: updateWhere }))
    mocks.getDb.mockReturnValue({
      query: {
        mobileDevices: {
          findFirst: vi.fn().mockResolvedValue(device),
        },
      },
      update: vi.fn(() => ({ set })),
    })

    await expect(
      authenticateMobileDevice(
        new Request('http://codey.test/api', {
          headers: {
            Authorization: 'Bearer mobile-token',
          },
        }),
      ),
    ).resolves.toBe(device)

    expect(mocks.sha256).toHaveBeenCalledWith('mobile-token')
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSeenAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    )
  })
})
