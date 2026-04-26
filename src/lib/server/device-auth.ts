import '@tanstack/react-start/server-only'
import { desc, eq } from 'drizzle-orm'
import { getAppEnv } from './env'
import { getDb } from './db/client'
import { deviceChallenges, sessions } from './db/schema'
import { createId, randomToken, randomUserCode, sha256 } from './security'

export async function createDeviceChallenge(input: {
  scope?: string
  flowType?: string
  cliName?: string
  requestedBy?: string
}) {
  const env = getAppEnv()
  const expiresAt = new Date(
    Date.now() + env.deviceChallengeTtlMinutes * 60 * 1000,
  )
  const deviceCode = randomToken(24)
  const userCode = randomUserCode()

  const [challenge] = await getDb()
    .insert(deviceChallenges)
    .values({
      id: createId(),
      deviceCode,
      userCode,
      scope: input.scope,
      flowType: input.flowType,
      cliName: input.cliName,
      requestedBy: input.requestedBy,
      expiresAt,
    })
    .returning()

  return challenge
}

export async function getDeviceChallengeByCode(deviceCode: string) {
  return getDb().query.deviceChallenges.findFirst({
    where: eq(deviceChallenges.deviceCode, deviceCode),
    with: { user: true },
  })
}

export async function getDeviceChallengeByUserCode(userCode: string) {
  return getDb().query.deviceChallenges.findFirst({
    where: eq(deviceChallenges.userCode, userCode),
    with: { user: true },
  })
}

export async function approveDeviceChallenge(params: {
  deviceCode: string
  userId: string
  approvalMessage?: string
}) {
  const token = randomToken()
  const db = getDb()
  await db
    .update(deviceChallenges)
    .set({
      status: 'APPROVED',
      userId: params.userId,
      approvalMessage: params.approvalMessage ?? null,
      accessTokenHash: sha256(token),
      approvedAt: new Date(),
    })
    .where(eq(deviceChallenges.deviceCode, params.deviceCode))

  const challenge = await db.query.deviceChallenges.findFirst({
    where: eq(deviceChallenges.deviceCode, params.deviceCode),
    with: { user: true },
  })

  if (!challenge) {
    throw new Error('Device challenge not found')
  }

  return {
    challenge,
    accessToken: token,
  }
}

export async function denyDeviceChallenge(
  deviceCode: string,
  approvalMessage?: string,
) {
  const [challenge] = await getDb()
    .update(deviceChallenges)
    .set({
      status: 'DENIED',
      approvalMessage: approvalMessage ?? null,
      deniedAt: new Date(),
    })
    .where(eq(deviceChallenges.deviceCode, deviceCode))
    .returning()

  return challenge
}

export async function consumeApprovedDeviceChallenge(deviceCode: string) {
  const token = randomToken()
  return getDb().transaction(async (tx) => {
    const challenge = await tx.query.deviceChallenges.findFirst({
      where: eq(deviceChallenges.deviceCode, deviceCode),
      with: { user: true },
    })

    if (!challenge) {
      throw new Error('Device challenge not found')
    }

    if (challenge.expiresAt.getTime() <= Date.now()) {
      await tx
        .update(deviceChallenges)
        .set({ status: 'EXPIRED' })
        .where(eq(deviceChallenges.id, challenge.id))
      throw new Error('Device challenge expired')
    }

    if (
      challenge.status !== 'APPROVED' ||
      !challenge.userId ||
      !challenge.user
    ) {
      throw new Error('Device challenge is not approved yet')
    }

    await tx.insert(sessions).values({
      id: createId(),
      userId: challenge.userId,
      kind: 'CLI',
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })

    await tx
      .update(deviceChallenges)
      .set({
        status: 'CONSUMED',
        consumedAt: new Date(),
        lastPolledAt: new Date(),
      })
      .where(eq(deviceChallenges.id, challenge.id))

    return {
      accessToken: token,
      user: challenge.user,
    }
  })
}

export async function pollDeviceChallenge(deviceCode: string) {
  const db = getDb()
  const challenge = await db.query.deviceChallenges.findFirst({
    where: eq(deviceChallenges.deviceCode, deviceCode),
    with: { user: true },
  })

  if (!challenge) {
    return null
  }

  const status =
    challenge.expiresAt.getTime() <= Date.now() &&
    challenge.status === 'PENDING'
      ? 'EXPIRED'
      : challenge.status

  const lastPolledAt = new Date()

  if (status !== challenge.status) {
    await db
      .update(deviceChallenges)
      .set({ status })
      .where(eq(deviceChallenges.id, challenge.id))
  }

  await db
    .update(deviceChallenges)
    .set({ lastPolledAt })
    .where(eq(deviceChallenges.id, challenge.id))

  return {
    ...challenge,
    status,
    lastPolledAt,
  }
}

export async function listRecentDeviceChallenges() {
  return getDb().query.deviceChallenges.findMany({
    with: { user: true },
    orderBy: [desc(deviceChallenges.createdAt)],
    limit: 20,
  })
}
