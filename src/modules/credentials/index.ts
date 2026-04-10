import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { getRuntimeConfig } from '../../config';
import { ensureDir, writeFileAtomic } from '../../utils/fs';
import type { VirtualPasskeyStore } from '../webauthn';

const STORE_VERSION = 1;
const STORE_DIR = '.codey/credentials';
const STORE_INDEX_FILE_NAME = 'chatgpt-identities.json';
const STORE_ACCOUNTS_DIR_NAME = 'chatgpt-identities';
const MASTER_KEY_ENV_NAME = 'CODEY_CREDENTIALS_MASTER_KEY';

export interface StoredChatGPTIdentity {
  id: string;
  provider: 'chatgpt';
  createdAt: string;
  updatedAt: string;
  email: string;
  password: string;
  passkeyStore?: VirtualPasskeyStore;
  metadata: {
    prefix?: string;
    mailbox?: string;
    source: 'chatgpt-register-exchange';
    passkeyCreated: boolean;
    chatgptUrl?: string;
  };
}

interface ChatGPTIdentityStore {
  version: number;
  identities: StoredChatGPTIdentity[];
}

interface PersistedChatGPTIdentityStore {
  version: number;
  encrypted: boolean;
  payload: string;
  updatedAt: string;
  algorithm?: 'aes-256-gcm';
  iv?: string;
  authTag?: string;
}

export interface StoredChatGPTIdentitySummary {
  id: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  hasPasskey: boolean;
  credentialCount: number;
  storePath: string;
  encrypted: boolean;
}

export interface PersistChatGPTIdentityInput {
  email: string;
  password: string;
  prefix?: string;
  mailbox?: string;
  passkeyStore?: VirtualPasskeyStore;
  passkeyCreated: boolean;
}

export interface ResolveChatGPTIdentityOptions {
  id?: string;
  email?: string;
}

export interface ResolvedChatGPTIdentity {
  identity: StoredChatGPTIdentity;
  summary: StoredChatGPTIdentitySummary;
}

function getStoreRootPath(): string {
  const config = getRuntimeConfig();
  return path.join(config.rootDir, STORE_DIR);
}

function getLegacyStorePath(): string {
  return path.join(getStoreRootPath(), STORE_INDEX_FILE_NAME);
}

function getAccountsDirectoryPath(): string {
  return path.join(getStoreRootPath(), STORE_ACCOUNTS_DIR_NAME);
}

function createIdentityFileName(identity: Pick<StoredChatGPTIdentity, 'email'>): string {
  const normalizedEmail = identity.email.trim().toLowerCase();
  const emailDigest = crypto.createHash('sha1').update(normalizedEmail).digest('hex').slice(0, 12);
  const safeEmail = normalizedEmail
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'account';
  return `${safeEmail}--${emailDigest}.json`;
}

function getIdentityStorePath(identity: Pick<StoredChatGPTIdentity, 'email'>): string {
  return path.join(getAccountsDirectoryPath(), createIdentityFileName(identity));
}

function createDefaultStore(): ChatGPTIdentityStore {
  return {
    version: STORE_VERSION,
    identities: [],
  };
}

function getMasterKey(): Buffer | undefined {
  const raw = process.env[MASTER_KEY_ENV_NAME]?.trim();
  if (!raw) return undefined;
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptStorePayload(payload: string, key: Buffer): Omit<PersistedChatGPTIdentityStore, 'version' | 'updatedAt'> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: true,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    payload: encrypted.toString('base64'),
  };
}

function decryptStorePayload(payload: PersistedChatGPTIdentityStore, key: Buffer): string {
  if (!payload.iv || !payload.authTag) {
    throw new Error('Credential store is missing IV or auth tag.');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.payload, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function readStoreEnvelope(storePath: string): { store: ChatGPTIdentityStore; encrypted: boolean } {
  if (!fs.existsSync(storePath)) {
    return {
      store: createDefaultStore(),
      encrypted: false,
    };
  }

  const raw = JSON.parse(fs.readFileSync(storePath, 'utf8')) as PersistedChatGPTIdentityStore | ChatGPTIdentityStore;
  if ('identities' in raw) {
    return {
      store: raw,
      encrypted: false,
    };
  }

  if (!raw.encrypted) {
    return {
      store: JSON.parse(raw.payload) as ChatGPTIdentityStore,
      encrypted: false,
    };
  }

  const key = getMasterKey();
  if (!key) {
    throw new Error(
      `Credential store is encrypted. Set ${MASTER_KEY_ENV_NAME} before reading ${storePath}.`,
    );
  }

  return {
    store: JSON.parse(decryptStorePayload(raw, key)) as ChatGPTIdentityStore,
    encrypted: true,
  };
}

function writeStoreEnvelope(storePath: string, store: ChatGPTIdentityStore): { encrypted: boolean } {
  ensureDir(path.dirname(storePath));
  const payload = JSON.stringify(store, null, 2);
  const key = getMasterKey();
  const envelope: PersistedChatGPTIdentityStore = key
    ? {
        version: STORE_VERSION,
        updatedAt: new Date().toISOString(),
        ...encryptStorePayload(payload, key),
      }
    : {
        version: STORE_VERSION,
        updatedAt: new Date().toISOString(),
        encrypted: false,
        payload,
      };
  writeFileAtomic(storePath, `${JSON.stringify(envelope, null, 2)}\n`);
  return { encrypted: envelope.encrypted };
}

function summarize(identity: StoredChatGPTIdentity, storePath: string, encrypted: boolean): StoredChatGPTIdentitySummary {
  return {
    id: identity.id,
    email: identity.email,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
    hasPasskey: Boolean(identity.passkeyStore?.credentials.length),
    credentialCount: identity.passkeyStore?.credentials.length || 0,
    storePath,
    encrypted,
  };
}

function readIdentityStoreFile(storePath: string): ResolvedChatGPTIdentity | undefined {
  const loaded = readStoreEnvelope(storePath);
  const [identity] = loaded.store.identities;
  if (!identity) return undefined;
  return {
    identity,
    summary: summarize(identity, storePath, loaded.encrypted),
  };
}

function readAllStoredChatGPTIdentities(): ResolvedChatGPTIdentity[] {
  const results = new Map<string, ResolvedChatGPTIdentity>();
  const accountDir = getAccountsDirectoryPath();

  if (fs.existsSync(accountDir)) {
    for (const entry of fs.readdirSync(accountDir, { withFileTypes: true })) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') continue;
      const resolved = readIdentityStoreFile(path.join(accountDir, entry.name));
      if (resolved) results.set(resolved.identity.id, resolved);
    }
  }

  const legacyStorePath = getLegacyStorePath();
  const legacy = readStoreEnvelope(legacyStorePath);
  for (const identity of legacy.store.identities) {
    if (results.has(identity.id)) continue;
    results.set(identity.id, {
      identity,
      summary: summarize(identity, legacyStorePath, legacy.encrypted),
    });
  }

  return [...results.values()];
}

export function persistChatGPTIdentity(input: PersistChatGPTIdentityInput): ResolvedChatGPTIdentity {
  const now = new Date().toISOString();
  const identity: StoredChatGPTIdentity = {
    id: crypto.randomUUID(),
    provider: 'chatgpt',
    createdAt: now,
    updatedAt: now,
    email: input.email,
    password: input.password,
    passkeyStore: input.passkeyStore,
    metadata: {
      prefix: input.prefix,
      mailbox: input.mailbox,
      source: 'chatgpt-register-exchange',
      passkeyCreated: input.passkeyCreated,
      chatgptUrl: getRuntimeConfig().openai.chatgptUrl,
    },
  };
  const storePath = getIdentityStorePath(identity);
  const persisted = writeStoreEnvelope(storePath, {
    version: STORE_VERSION,
    identities: [identity],
  });

  return {
    identity,
    summary: summarize(identity, storePath, persisted.encrypted),
  };
}

export function resolveStoredChatGPTIdentity(
  options: ResolveChatGPTIdentityOptions = {},
): ResolvedChatGPTIdentity {
  const candidates = readAllStoredChatGPTIdentities().sort((left, right) =>
    right.identity.updatedAt.localeCompare(left.identity.updatedAt),
  );

  const match = candidates.find((entry) => {
    if (options.id && entry.identity.id !== options.id) return false;
    if (options.email && entry.identity.email.toLowerCase() !== options.email.toLowerCase()) return false;
    return true;
  });

  if (!match) {
    const requested = options.id ? `id=${options.id}` : options.email ? `email=${options.email}` : 'latest record';
    throw new Error(`No persisted ChatGPT identity found for ${requested}.`);
  }

  return match;
}
