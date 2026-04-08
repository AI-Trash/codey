import { newSession } from '../index';
import {
  buildAuthorizationUrl,
  loginChildAccount,
  loginParentAccount,
  registerChildAccount,
  registerParentAccount,
} from '../index';

async function main(): Promise<void> {
  const session = await newSession();
  try {
    const auth = buildAuthorizationUrl({
      authorizeUrl: 'https://example.com/oauth/authorize',
      clientId: 'demo-client',
      redirectUri: 'http://127.0.0.1:3000/callback',
      scope: 'openid profile',
    });

    console.log('Authorization URL:', auth.authorizationUrl);

    void registerParentAccount;
    void registerChildAccount;
    void loginParentAccount;
    void loginChildAccount;
  } finally {
    await session.close();
  }
}

void main();
