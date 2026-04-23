import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildSub2ApiOpenAiRelatedModelMapping } from "../../../packages/cli/src/modules/app-auth/sub2api-related-models";

const mocks = vi.hoisted(() => ({
  hasEnabledSub2ApiServiceConfig: vi.fn(),
  getCliSub2ApiConfig: vi.fn(),
}));

vi.mock("./external-service-configs", () => ({
  hasEnabledSub2ApiServiceConfig: mocks.hasEnabledSub2ApiServiceConfig,
  getCliSub2ApiConfig: mocks.getCliSub2ApiConfig,
}));

describe("syncManagedCodexOAuthSessionToSub2Api", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null when the managed Sub2API config is disabled", async () => {
    mocks.hasEnabledSub2ApiServiceConfig.mockResolvedValue(false);

    const { syncManagedCodexOAuthSessionToSub2Api } = await import(
      "./sub2api-codex-oauth"
    );

    await expect(
      syncManagedCodexOAuthSessionToSub2Api({
        email: "person@example.com",
        clientId: "codex-client-id",
        sessionData: {
          tokens: {
            refresh_token: "codex-refresh-token",
          },
        },
      }),
    ).resolves.toBeNull();
  });

  it("creates a Sub2API account with notes metadata on the server", async () => {
    mocks.hasEnabledSub2ApiServiceConfig.mockResolvedValue(true);
    mocks.getCliSub2ApiConfig.mockResolvedValue({
      baseUrl: "https://sub2api.example.com",
      bearerToken: "sub2api-bearer",
    });

    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "success",
            data: {
              access_token: "fresh-access-token",
              refresh_token: "fresh-refresh-token",
              expires_at: 1770000000,
              client_id: "codex-client-id",
              email: "person@example.com",
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "success",
            data: {
              items: [],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "success",
            data: {
              id: 42,
              name: "person@example.com + ws-primary",
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { syncManagedCodexOAuthSessionToSub2Api } = await import(
      "./sub2api-codex-oauth"
    );

    await expect(
      syncManagedCodexOAuthSessionToSub2Api({
        email: "person@example.com",
        clientId: "codex-client-id",
        workspaceId: "ws-primary",
        sessionData: {
          client_id: "codex-client-id",
          tokens: {
            refresh_token: "codex-refresh-token",
            expires_at: "2026-04-21T01:00:00.000Z",
          },
        },
      }),
    ).resolves.toEqual({
      accountId: 42,
      action: "created",
      email: "person@example.com",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://sub2api.example.com/api/v1/admin/accounts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "person@example.com + ws-primary",
          notes: JSON.stringify({
            workspaceId: "ws-primary",
            email: "person@example.com",
          }),
          platform: "openai",
          type: "oauth",
          credentials: {
            access_token: "fresh-access-token",
            refresh_token: "fresh-refresh-token",
            expires_at: 1770000000,
            email: "person@example.com",
            client_id: "codex-client-id",
          },
          extra: {
            email: "person@example.com",
          },
          concurrency: 0,
          priority: 0,
        }),
      }),
    );
  });

  it("updates an existing Sub2API account matched by notes metadata", async () => {
    mocks.hasEnabledSub2ApiServiceConfig.mockResolvedValue(true);
    mocks.getCliSub2ApiConfig.mockResolvedValue({
      baseUrl: "https://sub2api.example.com",
      bearerToken: "sub2api-bearer",
      autoFillRelatedModels: true,
    });

    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "success",
            data: {
              access_token: "fresh-access-token",
              email: "person@example.com",
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "success",
            data: {
              items: [
                {
                  id: 101,
                  name: "Custom Name",
                  notes: JSON.stringify({
                    workspaceId: "ws-primary",
                    email: "person@example.com",
                  }),
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "success",
            data: {
              id: 101,
              name: "person@example.com + ws-primary",
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { syncManagedCodexOAuthSessionToSub2Api } = await import(
      "./sub2api-codex-oauth"
    );

    await expect(
      syncManagedCodexOAuthSessionToSub2Api({
        email: "person@example.com",
        clientId: "codex-client-id",
        workspaceId: "ws-primary",
        sessionData: {
          tokens: {
            refresh_token: "codex-refresh-token",
          },
        },
      }),
    ).resolves.toEqual({
      accountId: 101,
      action: "updated",
      email: "person@example.com",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://sub2api.example.com/api/v1/admin/accounts/101",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          name: "person@example.com + ws-primary",
          notes: JSON.stringify({
            workspaceId: "ws-primary",
            email: "person@example.com",
          }),
          credentials: {
            access_token: "fresh-access-token",
            refresh_token: "codex-refresh-token",
            email: "person@example.com",
            client_id: "codex-client-id",
          },
        }),
      }),
    );
  });

  it("does not use the account name alone to decide uniqueness", async () => {
    mocks.hasEnabledSub2ApiServiceConfig.mockResolvedValue(true);
    mocks.getCliSub2ApiConfig.mockResolvedValue({
      baseUrl: "https://sub2api.example.com",
      bearerToken: "sub2api-bearer",
      autoFillRelatedModels: true,
    });

    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "success",
            data: {
              access_token: "fresh-access-token",
              refresh_token: "fresh-refresh-token",
              email: "person@example.com",
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "success",
            data: {
              items: [
                {
                  id: 88,
                  name: "person@example.com",
                  notes: JSON.stringify({
                    workspaceId: "ws-other",
                    email: "person@example.com",
                  }),
                  credentials: {
                    email: "person@example.com",
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "success",
            data: {
              id: 144,
              name: "person@example.com + ws-primary",
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { syncManagedCodexOAuthSessionToSub2Api } = await import(
      "./sub2api-codex-oauth"
    );

    await expect(
      syncManagedCodexOAuthSessionToSub2Api({
        email: "person@example.com",
        clientId: "codex-client-id",
        workspaceId: "ws-primary",
        sessionData: {
          tokens: {
            refresh_token: "codex-refresh-token",
          },
        },
      }),
    ).resolves.toEqual({
      accountId: 144,
      action: "created",
      email: "person@example.com",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://sub2api.example.com/api/v1/admin/accounts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "person@example.com + ws-primary",
          notes: JSON.stringify({
            workspaceId: "ws-primary",
            email: "person@example.com",
          }),
          platform: "openai",
          type: "oauth",
          credentials: {
            access_token: "fresh-access-token",
            refresh_token: "fresh-refresh-token",
            email: "person@example.com",
            client_id: "codex-client-id",
            model_mapping: buildSub2ApiOpenAiRelatedModelMapping(),
          },
          extra: {
            email: "person@example.com",
          },
          concurrency: 0,
          priority: 0,
        }),
      }),
    );
  });

  it("falls back to the email as the Sub2API account name when no workspace is provided", async () => {
    mocks.hasEnabledSub2ApiServiceConfig.mockResolvedValue(true);
    mocks.getCliSub2ApiConfig.mockResolvedValue({
      baseUrl: "https://sub2api.example.com",
      bearerToken: "sub2api-bearer",
    });

    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "success",
            data: {
              access_token: "fresh-access-token",
              email: "person@example.com",
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "success",
            data: {
              items: [],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: "success",
            data: {
              id: 303,
              name: "person@example.com",
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { syncManagedCodexOAuthSessionToSub2Api } = await import(
      "./sub2api-codex-oauth"
    );

    await expect(
      syncManagedCodexOAuthSessionToSub2Api({
        email: "person@example.com",
        clientId: "codex-client-id",
        sessionData: {
          tokens: {
            refresh_token: "codex-refresh-token",
          },
        },
      }),
    ).resolves.toEqual({
      accountId: 303,
      action: "created",
      email: "person@example.com",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://sub2api.example.com/api/v1/admin/accounts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "person@example.com",
          notes: JSON.stringify({
            workspaceId: null,
            email: "person@example.com",
          }),
          platform: "openai",
          type: "oauth",
          credentials: {
            access_token: "fresh-access-token",
            refresh_token: "codex-refresh-token",
            email: "person@example.com",
            client_id: "codex-client-id",
          },
          extra: {
            email: "person@example.com",
          },
          concurrency: 0,
          priority: 0,
        }),
      }),
    );
  });
});
