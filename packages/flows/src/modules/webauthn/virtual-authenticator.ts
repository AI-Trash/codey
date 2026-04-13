import type { CDPSession, Page } from 'patchright'

const DEFAULT_BITWARDEN_AAGUID = 'd548826e-79b4-db40-a3d8-11116f7e8349'
const AAGUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface VirtualPasskeyCredential {
  credentialId: string
  rpId: string
  userHandle: string
  privateKey: string
  signCount: number
  isResidentCredential: boolean
  largeBlob?: string
  backupEligibility?: boolean
  backupState?: boolean
  userName?: string
  userDisplayName?: string
}

export interface VirtualAuthenticatorOptions {
  protocol?: 'ctap2' | 'u2f'
  transport?: 'internal' | 'usb' | 'nfc' | 'ble'
  hasResidentKey?: boolean
  hasUserVerification?: boolean
  isUserVerified?: boolean
  automaticPresenceSimulation?: boolean
  aaguid?: string
}

export interface VirtualPasskeyStore {
  authenticatorId?: string
  credentials: VirtualPasskeyCredential[]
}

const DEFAULT_AUTHENTICATOR: Required<
  Omit<VirtualAuthenticatorOptions, 'aaguid'>
> = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
}

function resolveDefaultAaguid(): string {
  const value =
    process.env.VIRTUAL_AUTHENTICATOR_AAGUID?.trim() || DEFAULT_BITWARDEN_AAGUID
  if (!AAGUID_PATTERN.test(value)) {
    throw new Error(`Invalid virtual authenticator AAGUID: ${value}`)
  }
  return value.toLowerCase()
}

function resolveAaguid(options: VirtualAuthenticatorOptions): string {
  const aaguid = (
    options.aaguid?.trim() || resolveDefaultAaguid()
  ).toLowerCase()
  if (!AAGUID_PATTERN.test(aaguid)) {
    throw new Error(`Invalid virtual authenticator AAGUID: ${options.aaguid}`)
  }
  return aaguid
}

async function installAttestationAaguidOverride(
  page: Page,
  aaguid: string,
): Promise<void> {
  await page.addInitScript(
    ({ aaguid: injectedAaguid }) => {
      const globalKey = '__codeyWebAuthnAaguidOverrideInstalled__'
      if ((window as typeof window & Record<string, unknown>)[globalKey]) return
      ;(window as typeof window & Record<string, unknown>)[globalKey] = true

      const uuidToBytes = (value: string): Uint8Array => {
        const hex = value.replace(/-/g, '').toLowerCase()
        const bytes = new Uint8Array(16)
        for (let i = 0; i < 16; i += 1) {
          bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
        }
        return bytes
      }

      const readLength = (
        data: Uint8Array,
        offset: number,
        additionalInfo: number,
      ): { length: number; offset: number } => {
        if (additionalInfo < 24) return { length: additionalInfo, offset }
        if (additionalInfo === 24)
          return { length: data[offset], offset: offset + 1 }
        if (additionalInfo === 25)
          return {
            length: (data[offset] << 8) | data[offset + 1],
            offset: offset + 2,
          }
        if (additionalInfo === 26) {
          return {
            length:
              ((data[offset] << 24) >>> 0) |
              (data[offset + 1] << 16) |
              (data[offset + 2] << 8) |
              data[offset + 3],
            offset: offset + 4,
          }
        }
        throw new Error(`Unsupported CBOR length encoding: ${additionalInfo}`)
      }

      const decodeItem = (
        data: Uint8Array,
        startOffset = 0,
      ): { value: unknown; offset: number } => {
        const initial = data[startOffset]
        const majorType = initial >> 5
        const additionalInfo = initial & 0x1f
        let offset = startOffset + 1

        if (majorType === 0) {
          const result = readLength(data, offset, additionalInfo)
          return { value: result.length, offset: result.offset }
        }

        if (majorType === 2 || majorType === 3) {
          const result = readLength(data, offset, additionalInfo)
          const end = result.offset + result.length
          const slice = data.slice(result.offset, end)
          return {
            value: majorType === 2 ? slice : new TextDecoder().decode(slice),
            offset: end,
          }
        }

        if (majorType === 4) {
          const result = readLength(data, offset, additionalInfo)
          offset = result.offset
          const items: unknown[] = []
          for (let i = 0; i < result.length; i += 1) {
            const decoded = decodeItem(data, offset)
            items.push(decoded.value)
            offset = decoded.offset
          }
          return { value: items, offset }
        }

        if (majorType === 5) {
          const result = readLength(data, offset, additionalInfo)
          offset = result.offset
          const map = new Map<unknown, unknown>()
          for (let i = 0; i < result.length; i += 1) {
            const keyDecoded = decodeItem(data, offset)
            const valueDecoded = decodeItem(data, keyDecoded.offset)
            map.set(keyDecoded.value, valueDecoded.value)
            offset = valueDecoded.offset
          }
          return { value: map, offset }
        }

        throw new Error(`Unsupported CBOR major type: ${majorType}`)
      }

      const encodeLength = (majorType: number, length: number): number[] => {
        if (length < 24) return [(majorType << 5) | length]
        if (length < 0x100) return [(majorType << 5) | 24, length]
        if (length < 0x10000)
          return [(majorType << 5) | 25, (length >> 8) & 0xff, length & 0xff]
        return [
          (majorType << 5) | 26,
          (length >>> 24) & 0xff,
          (length >>> 16) & 0xff,
          (length >>> 8) & 0xff,
          length & 0xff,
        ]
      }

      const concat = (chunks: Uint8Array[]): Uint8Array => {
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const out = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
          out.set(chunk, offset)
          offset += chunk.length
        }
        return out
      }

      const encodeItem = (value: unknown): Uint8Array => {
        if (
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= 0
        ) {
          return Uint8Array.from(encodeLength(0, value))
        }
        if (typeof value === 'string') {
          const bytes = new TextEncoder().encode(value)
          return concat([Uint8Array.from(encodeLength(3, bytes.length)), bytes])
        }
        if (value instanceof Uint8Array) {
          return concat([Uint8Array.from(encodeLength(2, value.length)), value])
        }
        if (Array.isArray(value)) {
          return concat([
            Uint8Array.from(encodeLength(4, value.length)),
            ...value.map((item) => encodeItem(item)),
          ])
        }
        if (value instanceof Map) {
          const entries: Uint8Array[] = [
            Uint8Array.from(encodeLength(5, value.size)),
          ]
          for (const [key, entryValue] of value.entries()) {
            entries.push(encodeItem(key))
            entries.push(encodeItem(entryValue))
          }
          return concat(entries)
        }
        throw new Error(`Unsupported CBOR value type: ${String(value)}`)
      }

      const toArrayBuffer = (
        buffer: ArrayBuffer | SharedArrayBuffer,
      ): ArrayBuffer => {
        if (buffer instanceof ArrayBuffer) return buffer
        const view = new Uint8Array(buffer)
        return view.slice().buffer
      }

      const patchAttestationObject = (
        buffer: ArrayBuffer | SharedArrayBuffer,
      ): ArrayBuffer => {
        const decoded = decodeItem(new Uint8Array(buffer))
        if (!(decoded.value instanceof Map)) return toArrayBuffer(buffer)

        const attestation = decoded.value
        const authData = attestation.get('authData')
        if (!(authData instanceof Uint8Array)) return toArrayBuffer(buffer)
        if (authData.length < 53) return toArrayBuffer(buffer)

        const flags = authData[32]
        if ((flags & 0x40) === 0) return toArrayBuffer(buffer)

        const nextAuthData = new Uint8Array(authData)
        nextAuthData.set(uuidToBytes(injectedAaguid), 37)
        attestation.set('authData', nextAuthData)

        const encoded = encodeItem(attestation)
        return encoded.slice().buffer
      }

      const originalCreate = navigator.credentials.create.bind(
        navigator.credentials,
      )
      navigator.credentials.create = async (...args) => {
        const credential = await originalCreate(...args)
        if (!(credential instanceof PublicKeyCredential)) return credential
        const response = credential.response
        if (!(response instanceof AuthenticatorAttestationResponse))
          return credential

        const readAttestationObject = () =>
          patchAttestationObject(response.attestationObject)
        Object.defineProperty(response, 'getAttestationObject', {
          configurable: true,
          value: readAttestationObject,
        })
        Object.defineProperty(response, 'attestationObject', {
          configurable: true,
          get: readAttestationObject,
        })
        return credential
      }
    },
    { aaguid },
  )
}

async function createSession(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page)
}

export async function ensureVirtualAuthenticator(
  page: Page,
  options: VirtualAuthenticatorOptions = {},
): Promise<{ session: CDPSession; authenticatorId: string }> {
  const session = await createSession(page)
  const aaguid = resolveAaguid(options)
  await installAttestationAaguidOverride(page, aaguid)
  await session.send('WebAuthn.enable')

  const { aaguid: _aaguid, ...authenticatorOptions } = options
  const authenticator = await session.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      ...DEFAULT_AUTHENTICATOR,
      ...authenticatorOptions,
    },
  })

  return {
    session,
    authenticatorId: authenticator.authenticatorId as string,
  }
}

export async function getVirtualAuthenticatorCredentials(
  session: CDPSession,
  authenticatorId: string,
): Promise<VirtualPasskeyCredential[]> {
  const result = await session.send('WebAuthn.getCredentials', {
    authenticatorId,
  })
  return (result.credentials || []) as VirtualPasskeyCredential[]
}

export async function addVirtualAuthenticatorCredential(
  session: CDPSession,
  authenticatorId: string,
  credential: VirtualPasskeyCredential,
): Promise<void> {
  await session.send('WebAuthn.addCredential', {
    authenticatorId,
    credential,
  })
}

export async function loadVirtualPasskeyStore(
  page: Page,
  store?: VirtualPasskeyStore,
  options: VirtualAuthenticatorOptions = {},
): Promise<{ session: CDPSession; authenticatorId: string }> {
  const { session, authenticatorId } = await ensureVirtualAuthenticator(
    page,
    options,
  )

  for (const credential of store?.credentials || []) {
    await addVirtualAuthenticatorCredential(
      session,
      authenticatorId,
      credential,
    )
  }

  return { session, authenticatorId }
}

export async function captureVirtualPasskeyStore(
  session: CDPSession,
  authenticatorId: string,
): Promise<VirtualPasskeyStore> {
  const credentials = await getVirtualAuthenticatorCredentials(
    session,
    authenticatorId,
  )
  return {
    authenticatorId,
    credentials,
  }
}
