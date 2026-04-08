import crypto from 'crypto';
import type { Page } from 'playwright';
import {
  waitForAuthorizationCode,
  type AuthorizationCallbackPayload,
  type CallbackServerOptions,
} from './callback-server';

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

export interface BuildAuthorizationUrlOptions {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  extraParams?: Record<string, string | number | boolean | null | undefined>;
  pkce?: boolean;
}

export interface BuildAuthorizationUrlResult {
  authorizationUrl: string;
  state: string;
  codeVerifier: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: 'S256' | null;
}

export interface RunAuthorizationCodeFlowOptions {
  startUrl: string;
  callback?: CallbackServerOptions;
  expectedState?: string;
  afterNavigation?: (page: Page) => Promise<void>;
}

export function createPkcePair(): PkcePair {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}

export function buildAuthorizationUrl(
  options: BuildAuthorizationUrlOptions,
): BuildAuthorizationUrlResult {
  const {
    authorizeUrl,
    clientId,
    redirectUri,
    scope,
    state = crypto.randomUUID(),
    extraParams = {},
    pkce = true,
  } = options;

  if (!authorizeUrl || !clientId || !redirectUri) {
    throw new Error('authorizeUrl, clientId and redirectUri are required');
  }

  const url = new URL(authorizeUrl);
  const pkcePair = pkce ? createPkcePair() : null;

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  if (scope) url.searchParams.set('scope', scope);
  if (pkcePair) {
    url.searchParams.set('code_challenge', pkcePair.challenge);
    url.searchParams.set('code_challenge_method', pkcePair.method);
  }

  for (const [key, value] of Object.entries(extraParams)) {
    if (value != null) url.searchParams.set(key, String(value));
  }

  return {
    authorizationUrl: url.toString(),
    state,
    codeVerifier: pkcePair?.verifier || null,
    codeChallenge: pkcePair?.challenge || null,
    codeChallengeMethod: pkcePair?.method || null,
  };
}

export async function runAuthorizationCodeFlow(
  page: Page,
  options: RunAuthorizationCodeFlowOptions,
): Promise<AuthorizationCallbackPayload> {
  const { startUrl, callback = {}, expectedState, afterNavigation } = options;
  if (!startUrl) {
    throw new Error('startUrl is required');
  }

  const callbackPromise = waitForAuthorizationCode(callback);
  await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

  if (afterNavigation) {
    await afterNavigation(page);
  }

  const result = await callbackPromise;
  if (!result.code) {
    throw new Error(`Authorization callback did not contain code: ${result.callbackUrl}`);
  }
  if (expectedState && result.state !== expectedState) {
    throw new Error(`Authorization state mismatch, expected "${expectedState}" got "${result.state}"`);
  }

  return result;
}

export { waitForAuthorizationCode };
