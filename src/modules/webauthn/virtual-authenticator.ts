import type { CDPSession, Page } from 'patchright';

const DEFAULT_BITWARDEN_AAGUID = 'd548826e-79b4-db40-a3d8-11116f7e8349';
const AAGUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VirtualPasskeyCredential {
  credentialId: string;
  rpId: string;
  userHandle: string;
  privateKey: string;
  signCount: number;
  isResidentCredential: boolean;
  largeBlob?: string;
  backupEligibility?: boolean;
  backupState?: boolean;
  userName?: string;
  userDisplayName?: string;
}

export interface VirtualAuthenticatorOptions {
  protocol?: 'ctap2' | 'u2f';
  transport?: 'internal' | 'usb' | 'nfc' | 'ble';
  hasResidentKey?: boolean;
  hasUserVerification?: boolean;
  isUserVerified?: boolean;
  automaticPresenceSimulation?: boolean;
  aaguid?: string;
}

export interface VirtualPasskeyStore {
  authenticatorId?: string;
  credentials: VirtualPasskeyCredential[];
}

const DEFAULT_AUTHENTICATOR: Required<Omit<VirtualAuthenticatorOptions, 'aaguid'>> = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
};

function resolveDefaultAaguid(): string {
  const value = process.env.VIRTUAL_AUTHENTICATOR_AAGUID?.trim() || DEFAULT_BITWARDEN_AAGUID;
  if (!AAGUID_PATTERN.test(value)) {
    throw new Error(`Invalid virtual authenticator AAGUID: ${value}`);
  }
  return value.toLowerCase();
}

function buildVirtualAuthenticatorOptions(options: VirtualAuthenticatorOptions): Record<string, unknown> {
  const aaguid = (options.aaguid?.trim() || resolveDefaultAaguid()).toLowerCase();
  if (!AAGUID_PATTERN.test(aaguid)) {
    throw new Error(`Invalid virtual authenticator AAGUID: ${options.aaguid}`);
  }

  return {
    ...DEFAULT_AUTHENTICATOR,
    ...options,
    aaguid,
  };
}

async function createSession(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

export async function ensureVirtualAuthenticator(
  page: Page,
  options: VirtualAuthenticatorOptions = {},
): Promise<{ session: CDPSession; authenticatorId: string }> {
  const session = await createSession(page);
  await session.send('WebAuthn.enable');

  const authenticator = await session.send('WebAuthn.addVirtualAuthenticator', {
    options: buildVirtualAuthenticatorOptions(options),
  });

  return {
    session,
    authenticatorId: authenticator.authenticatorId as string,
  };
}

export async function getVirtualAuthenticatorCredentials(
  session: CDPSession,
  authenticatorId: string,
): Promise<VirtualPasskeyCredential[]> {
  const result = await session.send('WebAuthn.getCredentials', { authenticatorId });
  return (result.credentials || []) as VirtualPasskeyCredential[];
}

export async function addVirtualAuthenticatorCredential(
  session: CDPSession,
  authenticatorId: string,
  credential: VirtualPasskeyCredential,
): Promise<void> {
  await session.send('WebAuthn.addCredential', {
    authenticatorId,
    credential,
  });
}

export async function loadVirtualPasskeyStore(
  page: Page,
  store?: VirtualPasskeyStore,
  options: VirtualAuthenticatorOptions = {},
): Promise<{ session: CDPSession; authenticatorId: string }> {
  const { session, authenticatorId } = await ensureVirtualAuthenticator(page, options);

  for (const credential of store?.credentials || []) {
    await addVirtualAuthenticatorCredential(session, authenticatorId, credential);
  }

  return { session, authenticatorId };
}

export async function captureVirtualPasskeyStore(
  session: CDPSession,
  authenticatorId: string,
): Promise<VirtualPasskeyStore> {
  const credentials = await getVirtualAuthenticatorCredentials(session, authenticatorId);
  return {
    authenticatorId,
    credentials,
  };
}
