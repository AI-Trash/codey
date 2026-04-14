export interface DeviceChallengeResponse {
  deviceCode: string;
  userCode: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CONSUMED";
  expiresAt: string;
  verificationUri: string;
  verificationUriComplete: string;
}

export interface DeviceChallengeStatusResponse {
  deviceCode: string;
  userCode: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CONSUMED";
  flowType?: string;
  cliName?: string;
  approvalMessage?: string;
  expiresAt: string;
}

export interface DeviceChallengeTokenResponse {
  accessToken: string;
  user: {
    id: string;
    email?: string | null;
    githubLogin?: string | null;
    name?: string | null;
    role?: "ADMIN" | "USER";
  };
}

export interface AdminNotificationEvent {
  id: string;
  title: string;
  body: string;
  flowType?: string | null;
  target?: string | null;
  createdAt: string;
}
