import type { AxonHubAdminConfig } from '../../config'
import { ensureJson } from '../app-auth/http'
import type { CodexTokenResponse } from './codex-client'
import { fetchWithHarCapture, type NodeHarRecorder } from './har-recorder'

interface AxonHubAdminUser {
  id?: string
  email?: string | null
  name?: string | null
}

interface AxonHubAdminSignInResponse {
  user?: AxonHubAdminUser
  token: string
}

export interface AxonHubOAuthCredentialsInput {
  oauth: {
    accessToken: string
    refreshToken?: string
    clientID: string
    expiresAt?: string
    tokenType?: string
    scopes: string[]
  }
}

export interface CreateAxonHubChannelInput {
  type: string
  baseURL?: string
  name: string
  credentials: AxonHubOAuthCredentialsInput
  supportedModels: string[]
  manualModels: string[]
  autoSyncSupportedModels?: boolean
  autoSyncModelPattern?: string
  tags: string[]
  defaultTestModel: string
  policies?: Record<string, unknown>
  settings?: Record<string, unknown>
  orderingWeight?: number
  remark?: string
}

interface CreateChannelGraphQLResponse {
  createChannel?: {
    id?: string
    type?: string
    name?: string
    baseURL?: string | null
    supportedModels?: string[] | null
    manualModels?: string[] | null
    tags?: string[] | null
    defaultTestModel?: string | null
    remark?: string | null
    createdAt?: string | null
    updatedAt?: string | null
    credentials?: unknown
  }
}

interface GraphQLErrorItem {
  message?: string
}

interface GraphQLResponse<T> {
  data?: T
  errors?: GraphQLErrorItem[]
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

function getRequiredConfigValue(
  value: string | undefined,
  message: string,
): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error(message)
  }
  return trimmed
}

export function resolveCodexTokenExpiresAt(
  token: CodexTokenResponse,
): string | undefined {
  if (!token.expiresIn) return undefined
  const createdAt = new Date(token.createdAt).getTime()
  if (!Number.isFinite(createdAt)) return undefined
  return new Date(createdAt + token.expiresIn * 1000).toISOString()
}

export function buildCodexOAuthCredentials(
  token: CodexTokenResponse,
  clientId: string,
): AxonHubOAuthCredentialsInput {
  const scopes = token.scope
    ?.split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)

  return {
    oauth: {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      clientID: clientId,
      expiresAt: resolveCodexTokenExpiresAt(token),
      tokenType: token.tokenType,
      scopes: scopes?.length ? scopes : [],
    },
  }
}

export class AxonHubAdminClient {
  constructor(
    private readonly config: AxonHubAdminConfig,
    private readonly options: {
      harRecorder?: NodeHarRecorder
    } = {},
  ) {}

  private getBaseUrl(): string {
    return normalizeBaseUrl(
      getRequiredConfigValue(
        this.config.baseUrl,
        'AXONHUB_BASE_URL is required for Codex channel creation.',
      ),
    )
  }

  private getGraphqlPath(): string {
    return this.config.graphqlPath?.trim() || '/graphql'
  }

  private buildUrl(pathname: string): string {
    return new URL(pathname, this.getBaseUrl()).toString()
  }

  private buildHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }

    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const projectId = this.config.projectId?.trim()
    if (projectId) {
      headers['X-Project-ID'] = projectId
    }

    return headers
  }

  async signIn(): Promise<AxonHubAdminSignInResponse> {
    const email = getRequiredConfigValue(
      this.config.email,
      'AXONHUB_ADMIN_EMAIL is required for Codex channel creation.',
    )
    const password = getRequiredConfigValue(
      this.config.password,
      'AXONHUB_ADMIN_PASSWORD is required for Codex channel creation.',
    )

    const response = await fetchWithHarCapture(
      this.options.harRecorder,
      this.buildUrl('/admin/auth/signin'),
      {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ email, password }),
      },
      {
        comment: 'AxonHub admin sign-in',
      },
    )

    const payload = await ensureJson<AxonHubAdminSignInResponse>(response)
    if (!payload.token?.trim()) {
      throw new Error('AxonHub admin sign-in did not return a bearer token.')
    }
    return payload
  }

  async createChannel(
    token: string,
    input: CreateAxonHubChannelInput,
  ): Promise<NonNullable<CreateChannelGraphQLResponse['createChannel']>> {
    const response = await fetchWithHarCapture(
      this.options.harRecorder,
      this.buildUrl(this.getGraphqlPath()),
      {
        method: 'POST',
        headers: this.buildHeaders(token),
        body: JSON.stringify({
          query: `mutation CreateChannel($input: CreateChannelInput!) {
  createChannel(input: $input) {
    id
    type
    name
    baseURL
    supportedModels
    manualModels
    tags
    defaultTestModel
    remark
    createdAt
    updatedAt
  }
}`,
          variables: { input },
        }),
      },
      {
        comment: 'AxonHub createChannel mutation',
      },
    )

    const payload =
      await ensureJson<GraphQLResponse<CreateChannelGraphQLResponse>>(response)
    if (payload.errors?.length) {
      throw new Error(
        payload.errors
          .map((entry) => entry.message)
          .filter(Boolean)
          .join('; ') || 'AxonHub createChannel failed.',
      )
    }

    if (!payload.data?.createChannel) {
      throw new Error('AxonHub createChannel returned no channel payload.')
    }

    return payload.data.createChannel
  }
}
