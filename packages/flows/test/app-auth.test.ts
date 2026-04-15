import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildOidcDiscoveryUrl,
  resolveOidcIssuer,
} from "../src/modules/app-auth/oidc";
import {
  clearAppSession,
  readAppSession,
} from "../src/modules/app-auth/token-store";
import { setRuntimeConfig, type CliRuntimeConfig } from "../src/config";

const tempRoot = path.join(os.tmpdir(), `codey-flows-test-${process.pid}`);

function createConfig(rootDir: string): CliRuntimeConfig {
  return {
    rootDir,
    artifactsDir: path.join(rootDir, "artifacts"),
    browser: {
      headless: true,
      slowMo: 0,
      defaultTimeoutMs: 1000,
      navigationTimeoutMs: 1000,
      recordHar: false,
    },
    openai: {
      baseUrl: "https://openai.com",
      chatgptUrl: "https://chatgpt.com",
    },
    app: {
      baseUrl: "http://localhost:3000",
      oidcBasePath: "/oidc",
      clientId: "codey_cli",
      clientSecret: "secret",
      scope: "notifications:read",
    },
  };
}

function getAppSessionStorePath(rootDir: string): string {
  return path.join(rootDir, ".codey", "credentials", "app-session.json");
}

describe("app auth OIDC helpers", () => {
  afterEach(() => {
    setRuntimeConfig(createConfig(tempRoot));
    clearAppSession();
  });

  it("resolves an issuer from baseUrl and oidcBasePath", () => {
    expect(
      resolveOidcIssuer({
        baseUrl: "http://localhost:3000",
        oidcBasePath: "/oidc",
      }),
    ).toBe("http://localhost:3000/oidc");
    expect(
      buildOidcDiscoveryUrl({
        baseUrl: "http://localhost:3000",
        oidcBasePath: "/oidc",
      }),
    ).toBe("http://localhost:3000/oidc/.well-known/openid-configuration");
  });

  it("applies oidcBasePath to a root issuer override", () => {
    expect(
      resolveOidcIssuer({
        oidcIssuer: "http://localhost:3000",
        oidcBasePath: "/oidc",
      }),
    ).toBe("http://localhost:3000/oidc");
    expect(
      resolveOidcIssuer({
        oidcIssuer: "http://localhost:3000/custom-oidc",
        oidcBasePath: "/oidc",
      }),
    ).toBe("http://localhost:3000/custom-oidc");
  });

  it("reads legacy app session files through the new tokenSet shape", () => {
    const rootDir = path.join(tempRoot, "legacy");
    setRuntimeConfig(createConfig(rootDir));
    const storePath = getAppSessionStorePath(rootDir);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          accessToken: "token-123",
          target: "octocat",
          createdAt: "2026-04-16T00:00:00.000Z",
        },
        null,
        2,
      ),
    );

    const session = readAppSession();
    expect(session.version).toBe(2);
    expect(session.tokenSet.accessToken).toBe("token-123");
    expect(session.tokenSet.tokenType).toBe("Bearer");
    expect(session.target).toBe("octocat");
  });
});
