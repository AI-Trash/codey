export interface DeviceChallengeResponse {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresAt: string
  expiresIn: number
  interval?: number
  scope?: string
}

export interface DeviceChallengeStatusResponse {
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED'
  error?: string
  errorDescription?: string
  expiresAt?: string
  pollIntervalSeconds?: number
}

export interface AppTokenSet {
  accessToken: string
  tokenType: string
  refreshToken?: string
  idToken?: string
  scope?: string
  obtainedAt: string
  expiresAt?: string
}

export interface AppSessionUser {
  id: string
  email?: string | null
  githubLogin?: string | null
  name?: string | null
  role?: 'ADMIN' | 'USER'
}

export interface DeviceChallengeTokenResponse extends AppTokenSet {
  status: 'APPROVED'
  subject?: string
  user?: AppSessionUser
}

export interface AdminNotificationEvent {
  id: string
  title: string
  body: string
  kind?: string | null
  flowType?: string | null
  target?: string | null
  cliConnectionId?: string | null
  payload?: Record<string, unknown> | null
  createdAt: string
}

export interface CliConnectionEvent {
  connectionId: string
  workerId?: string
  cliName?: string
  target?: string
  browserLimit?: number
  connectedAt: string
}
