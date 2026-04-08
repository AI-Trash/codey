import type { CDPSession, Page } from 'patchright';

export interface VirtualPasskeyCredential {
  credentialId: string;
  rpId: string;
  userHandle: string;
  privateKey: string;
  signCount: number;
  isResidentCredential: boolean;
}

export interface VirtualAuthenticatorOptions {
  protocol?: 'ctap2' | 'u2f';
  transport?: 'internal' | 'usb' | 'nfc' | 'ble';
  hasResidentKey?: boolean;
  hasUserVerification?: boolean;
  isUserVerified?: boolean;
  automaticPresenceSimulation?: boolean;
}

export interface VirtualPasskeyStore {
  authenticatorId?: string;
  credentials: VirtualPasskeyCredential[];
}

const DEFAULT_AUTHENTICATOR: Required<VirtualAuthenticatorOptions> = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
};

async function createSession(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

export async function ensureVirtualAuthenticator(
  page: Page,
  options: VirtualAuthenticatorOptions = {},
): Promise<{ session: CdpSession; authenticatorId: string }> {
  const session = await createSession(page);
  await session.send('WebAuthn.enable');

  const authenticator = await session.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      ...DEFAULT_AUTHENTICATOR,
      ...options,
    },
  });

  return {
    session,
    authenticatorId: authenticator.authenticatorId as string,
  };
}

export async function getVirtualAuthenticatorCredentials(
  session: CdpSession,
  authenticatorId: string,
): Promise<VirtualPasskeyCredential[]> {
  const result = await session.send('WebAuthn.getCredentials', { authenticatorId });
  return (result.credentials || []) as VirtualPasskeyCredential[];
}

export async function addVirtualAuthenticatorCredential(
  session: CdpSession,
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
): Promise<{ session: CdpSession; authenticatorId: string }> {
  const { session, authenticatorId } = await ensureVirtualAuthenticator(page, options);

  for (const credential of store?.credentials || []) {
    await addVirtualAuthenticatorCredential(session, authenticatorId, credential);
  }

  return { session, authenticatorId };
}

export async function captureVirtualPasskeyStore(
  session: CdpSession,
  authenticatorId: string,
): Promise<VirtualPasskeyStore> {
  const credentials = await getVirtualAuthenticatorCredentials(session, authenticatorId);
  return {
    authenticatorId,
    credentials,
  };
}
