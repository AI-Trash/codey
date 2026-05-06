import '@tanstack/react-start/server-only'

import { eq } from 'drizzle-orm'
import { getDb } from './db/client'
import {
  mobileDevices,
  mobilePhoneBindings,
  type MobileDeviceRow,
  type MobilePhoneBindingPurpose,
} from './db/schema'
import { createId, randomToken, sha256 } from './security'

export const MOBILE_DEVICE_AUTH_SCHEME = 'Bearer'

export interface MobileDeviceAuthResult {
  device: MobileDeviceRow
  token: string
}

export interface PairMobileDeviceInput {
  deviceId: string
  label?: string | null
  userId: string
  deviceChallengeId?: string | null
  userAgent?: string | null
  capabilities?: string[]
  phoneBindings?: Array<{
    phoneNumber: string
    countryCode?: string | null
    purpose?: MobilePhoneBindingPurpose | string | null
    label?: string | null
    isDefault?: boolean | null
  }>
}

function normalizeOptionalString(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized || undefined
}

function normalizeDeviceId(value: string) {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    throw new Error('deviceId is required')
  }
  return normalized
}

function normalizeCapabilities(values: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => value.trim())
        .filter((value) => /^[a-z][a-z0-9:_-]{1,63}$/i.test(value)),
    ),
  ).sort()
}

function normalizePhoneNumber(value: string | null | undefined) {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    return undefined
  }
  const hasLeadingPlus = normalized.startsWith('+')
  const digits = normalized.replace(/\D/g, '')
  if (!digits) {
    return undefined
  }
  return hasLeadingPlus ? `+${digits}` : digits
}

function normalizeCountryCode(value: string | null | undefined) {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    return undefined
  }
  const digits = normalized.replace(/\D/g, '')
  return digits ? `+${digits}` : undefined
}

function normalizePhoneBindingPurpose(
  value: MobilePhoneBindingPurpose | string | null | undefined,
): MobilePhoneBindingPurpose {
  const normalized = normalizeOptionalString(value)?.toUpperCase()
  return normalized === 'GOPAY' || normalized === 'BOTH'
    ? normalized
    : 'WHATSAPP'
}

function readBearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization')
  if (!header) return undefined
  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== MOBILE_DEVICE_AUTH_SCHEME.toLowerCase()) {
    return undefined
  }
  return token?.trim() || undefined
}

async function replacePhoneBindings(
  mobileDeviceId: string,
  bindings: PairMobileDeviceInput['phoneBindings'],
) {
  if (bindings === undefined) {
    return
  }

  const db = getDb()
  await db
    .delete(mobilePhoneBindings)
    .where(eq(mobilePhoneBindings.mobileDeviceId, mobileDeviceId))

  const values = (bindings || [])
    .map((binding) => {
      const phoneNumber = normalizePhoneNumber(binding.phoneNumber)
      if (!phoneNumber) {
        return null
      }
      return {
        id: createId(),
        mobileDeviceId,
        phoneNumber,
        countryCode: normalizeCountryCode(binding.countryCode),
        purpose: normalizePhoneBindingPurpose(binding.purpose),
        label: normalizeOptionalString(binding.label),
        isDefault: binding.isDefault === true,
      }
    })
    .filter((binding): binding is NonNullable<typeof binding> =>
      Boolean(binding),
    )

  if (!values.length) {
    return
  }

  await db.insert(mobilePhoneBindings).values(values)
}

export async function pairMobileDevice(
  input: PairMobileDeviceInput,
): Promise<MobileDeviceAuthResult> {
  const db = getDb()
  const deviceId = normalizeDeviceId(input.deviceId)
  const token = randomToken()
  const tokenHash = sha256(token)
  const now = new Date()
  const existing = await db.query.mobileDevices.findFirst({
    where: eq(mobileDevices.deviceId, deviceId),
  })

  const values = {
    label: normalizeOptionalString(input.label) || deviceId,
    status: 'ACTIVE' as const,
    tokenHash,
    capabilities: normalizeCapabilities(input.capabilities),
    pairedByUserId: input.userId,
    deviceChallengeId: input.deviceChallengeId || null,
    userAgent: normalizeOptionalString(input.userAgent),
    lastSeenAt: now,
    revokedAt: null,
    updatedAt: now,
  }

  const [device] = existing
    ? await db
        .update(mobileDevices)
        .set(values)
        .where(eq(mobileDevices.id, existing.id))
        .returning()
    : await db
        .insert(mobileDevices)
        .values({
          id: createId(),
          deviceId,
          ...values,
          createdAt: now,
        })
        .returning()

  if (!device) {
    throw new Error('Unable to pair mobile device')
  }

  await replacePhoneBindings(device.id, input.phoneBindings)

  return {
    device,
    token,
  }
}

export async function authenticateMobileDevice(
  request: Request,
): Promise<MobileDeviceRow | null> {
  const token = readBearerToken(request)
  if (!token) {
    return null
  }

  const db = getDb()
  const device = await db.query.mobileDevices.findFirst({
    where: eq(mobileDevices.tokenHash, sha256(token)),
  })
  if (!device || device.status !== 'ACTIVE') {
    return null
  }

  await db
    .update(mobileDevices)
    .set({
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(mobileDevices.id, device.id))

  return device
}

export async function requireMobileDevice(
  request: Request,
): Promise<MobileDeviceRow> {
  const device = await authenticateMobileDevice(request)
  if (!device) {
    throw new Error('Mobile device authentication required')
  }
  return device
}
