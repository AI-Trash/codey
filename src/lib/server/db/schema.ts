import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["ADMIN", "USER"]);
export const sessionKindEnum = pgEnum("session_kind", ["BROWSER", "CLI"]);
export const deviceChallengeStatusEnum = pgEnum("device_challenge_status", [
  "PENDING",
  "APPROVED",
  "DENIED",
  "EXPIRED",
  "CONSUMED",
]);
export const verificationCodeSourceEnum = pgEnum("verification_code_source", [
  "MANUAL",
  "CLOUDFLARE_EMAIL",
]);
export const flowAppRequestStatusEnum = pgEnum("flow_app_request_status", [
  "PENDING",
  "IN_REVIEW",
  "FULFILLED",
  "REJECTED",
]);
export const managedIdentityStatusEnum = pgEnum("managed_identity_status", [
  "ACTIVE",
  "REVIEW",
  "ARCHIVED",
]);
export const managedIdentitySessionStatusEnum = pgEnum(
  "managed_identity_session_status",
  ["ACTIVE", "REVOKED"],
);
export const oauthClientAuthMethodEnum = pgEnum("oauth_client_auth_method", [
  "client_secret_basic",
  "client_secret_post",
]);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email"),
    githubId: text("github_id"),
    githubLogin: text("github_login"),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    role: userRoleEnum("role").default("USER").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_github_id_unique").on(table.githubId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    kind: sessionKindEnum("kind").default("BROWSER").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("sessions_token_hash_unique").on(table.tokenHash)],
);

export const verificationEmailReservations = pgTable(
  "verification_email_reservations",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    prefix: text("prefix"),
    mailbox: text("mailbox"),
    identityId: text("identity_id").references(() => managedIdentities.identityId, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("verification_email_reservations_email_unique").on(table.email),
  ],
);

export const verificationCodes = pgTable(
  "verification_codes",
  {
    id: text("id").primaryKey(),
    reservationId: text("reservation_id")
      .notNull()
      .references(() => verificationEmailReservations.id, {
        onDelete: "cascade",
      }),
    code: text("code").notNull(),
    source: verificationCodeSourceEnum("source").notNull(),
    messageId: text("message_id"),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    consumedAt: timestamp("consumed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("verification_codes_reservation_received_at_idx").on(
      table.reservationId,
      table.receivedAt,
    ),
    uniqueIndex("verification_codes_reservation_code_received_at_unique").on(
      table.reservationId,
      table.code,
      table.receivedAt,
    ),
  ],
);

export const emailIngestRecords = pgTable(
  "email_ingest_records",
  {
    id: text("id").primaryKey(),
    reservationId: text("reservation_id").references(
      () => verificationEmailReservations.id,
      { onDelete: "set null" },
    ),
    messageId: text("message_id"),
    recipient: text("recipient").notNull(),
    subject: text("subject"),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    rawPayload: text("raw_payload"),
    verificationCode: text("verification_code"),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("email_ingest_records_recipient_received_at_idx").on(
      table.recipient,
      table.receivedAt,
    ),
  ],
);

export const deviceChallenges = pgTable(
  "device_challenges",
  {
    id: text("id").primaryKey(),
    deviceCode: text("device_code").notNull(),
    userCode: text("user_code").notNull(),
    status: deviceChallengeStatusEnum("status").default("PENDING").notNull(),
    scope: text("scope"),
    flowType: text("flow_type"),
    cliName: text("cli_name"),
    requestedBy: text("requested_by"),
    approvalMessage: text("approval_message"),
    accessTokenHash: text("access_token_hash"),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    approvedAt: timestamp("approved_at", {
      withTimezone: true,
      mode: "date",
    }),
    deniedAt: timestamp("denied_at", {
      withTimezone: true,
      mode: "date",
    }),
    consumedAt: timestamp("consumed_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastPolledAt: timestamp("last_polled_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    uniqueIndex("device_challenges_device_code_unique").on(table.deviceCode),
    uniqueIndex("device_challenges_user_code_unique").on(table.userCode),
  ],
);

export const adminNotifications = pgTable("admin_notifications", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  flowType: text("flow_type"),
  target: text("target"),
  createdAt: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  })
    .defaultNow()
    .notNull(),
});

export const flowAppRequests = pgTable(
  "flow_app_requests",
  {
    id: text("id").primaryKey(),
    appName: text("app_name").notNull(),
    flowType: text("flow_type"),
    requestedBy: text("requested_by"),
    requestedIdentity: text("requested_identity"),
    notes: text("notes"),
    status: flowAppRequestStatusEnum("status").default("PENDING").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("flow_app_requests_created_at_idx").on(table.createdAt),
    index("flow_app_requests_status_created_at_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const managedIdentities = pgTable(
  "managed_identities",
  {
    id: text("id").primaryKey(),
    identityId: text("identity_id").notNull(),
    email: text("email").notNull(),
    label: text("label"),
    credentialCount: integer("credential_count").default(0).notNull(),
    status: managedIdentityStatusEnum("status").default("ACTIVE").notNull(),
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("managed_identities_identity_id_unique").on(table.identityId),
    index("managed_identities_email_idx").on(table.email),
    index("managed_identities_status_updated_at_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
);

export const managedIdentitySessions = pgTable(
  "managed_identity_sessions",
  {
    id: text("id").primaryKey(),
    identityId: text("identity_id")
      .notNull()
      .references(() => managedIdentities.identityId, {
        onDelete: "cascade",
      }),
    email: text("email").notNull(),
    authMode: text("auth_mode").notNull(),
    flowType: text("flow_type").notNull(),
    accountId: text("account_id"),
    sessionId: text("session_id"),
    sessionData: jsonb("session_data")
      .$type<Record<string, unknown>>()
      .notNull(),
    status: managedIdentitySessionStatusEnum("status")
      .default("ACTIVE")
      .notNull(),
    lastRefreshAt: timestamp("last_refresh_at", {
      withTimezone: true,
      mode: "date",
    }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("managed_identity_sessions_identity_id_unique").on(
      table.identityId,
    ),
    index("managed_identity_sessions_status_last_seen_at_idx").on(
      table.status,
      table.lastSeenAt,
    ),
    index("managed_identity_sessions_email_idx").on(table.email),
    index("managed_identity_sessions_account_id_idx").on(table.accountId),
    index("managed_identity_sessions_session_id_idx").on(table.sessionId),
  ],
);

export const verificationDomains = pgTable(
  "verification_domains",
  {
    id: text("id").primaryKey(),
    domain: text("domain").notNull(),
    description: text("description"),
    enabled: boolean("enabled").default(true).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("verification_domains_domain_unique").on(table.domain),
    index("verification_domains_default_idx").on(table.isDefault),
    index("verification_domains_enabled_domain_idx").on(
      table.enabled,
      table.domain,
    ),
  ],
);

export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    clientName: text("client_name").notNull(),
    description: text("description"),
    enabled: boolean("enabled").default(true).notNull(),
    clientCredentialsEnabled: boolean("client_credentials_enabled")
      .default(false)
      .notNull(),
    deviceFlowEnabled: boolean("device_flow_enabled")
      .default(false)
      .notNull(),
    tokenEndpointAuthMethod: oauthClientAuthMethodEnum(
      "token_endpoint_auth_method",
    )
      .default("client_secret_basic")
      .notNull(),
    clientSecretCiphertext: text("client_secret_ciphertext").notNull(),
    clientSecretPreview: text("client_secret_preview").notNull(),
    allowedScopes: text("allowed_scopes").default("").notNull(),
    verificationDomainId: text("verification_domain_id").references(
      () => verificationDomains.id,
      {
        onDelete: "set null",
      },
    ),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    clientSecretUpdatedAt: timestamp("client_secret_updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("oauth_clients_client_id_unique").on(table.clientId),
    index("oauth_clients_enabled_updated_at_idx").on(
      table.enabled,
      table.updatedAt,
    ),
    index("oauth_clients_created_at_idx").on(table.createdAt),
  ],
);

export const oidcArtifacts = pgTable(
  "oidc_artifacts",
  {
    key: text("key").primaryKey(),
    kind: text("kind").notNull(),
    artifactId: text("artifact_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    grantId: text("grant_id"),
    userCode: text("user_code"),
    uid: text("uid"),
    consumedAt: timestamp("consumed_at", {
      withTimezone: true,
      mode: "date",
    }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("oidc_artifacts_kind_artifact_id_unique").on(
      table.kind,
      table.artifactId,
    ),
    index("oidc_artifacts_kind_grant_id_idx").on(table.kind, table.grantId),
    index("oidc_artifacts_kind_user_code_idx").on(table.kind, table.userCode),
    index("oidc_artifacts_kind_uid_idx").on(table.kind, table.uid),
    index("oidc_artifacts_expires_at_idx").on(table.expiresAt),
  ],
);

export const oidcSigningKeys = pgTable(
  "oidc_signing_keys",
  {
    id: text("id").primaryKey(),
    kid: text("kid").notNull(),
    algorithm: text("algorithm").notNull(),
    publicJwk: jsonb("public_jwk")
      .$type<Record<string, unknown>>()
      .notNull(),
    privateJwk: jsonb("private_jwk")
      .$type<Record<string, unknown>>()
      .notNull(),
    isActive: boolean("is_active").default(false).notNull(),
    activatedAt: timestamp("activated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    rotatesAt: timestamp("rotates_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    retiresAt: timestamp("retires_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("oidc_signing_keys_kid_unique").on(table.kid),
    index("oidc_signing_keys_active_rotates_at_idx").on(
      table.isActive,
      table.rotatesAt,
    ),
    index("oidc_signing_keys_retires_at_idx").on(table.retiresAt),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  deviceChallenges: many(deviceChallenges),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const verificationEmailReservationsRelations = relations(
  verificationEmailReservations,
  ({ many }) => ({
    codes: many(verificationCodes),
    emails: many(emailIngestRecords),
  }),
);

export const verificationCodesRelations = relations(
  verificationCodes,
  ({ one }) => ({
    reservation: one(verificationEmailReservations, {
      fields: [verificationCodes.reservationId],
      references: [verificationEmailReservations.id],
    }),
  }),
);

export const emailIngestRecordsRelations = relations(
  emailIngestRecords,
  ({ one }) => ({
    reservation: one(verificationEmailReservations, {
      fields: [emailIngestRecords.reservationId],
      references: [verificationEmailReservations.id],
    }),
  }),
);

export const deviceChallengesRelations = relations(
  deviceChallenges,
  ({ one }) => ({
    user: one(users, {
      fields: [deviceChallenges.userId],
      references: [users.id],
    }),
  }),
);

export const managedIdentitiesRelations = relations(
  managedIdentities,
  ({ many }) => ({
    sessions: many(managedIdentitySessions),
  }),
);

export const managedIdentitySessionsRelations = relations(
  managedIdentitySessions,
  ({ one }) => ({
    identity: one(managedIdentities, {
      fields: [managedIdentitySessions.identityId],
      references: [managedIdentities.identityId],
    }),
  }),
);

export const verificationDomainsRelations = relations(
  verificationDomains,
  ({ many }) => ({
    oauthClients: many(oauthClients),
  }),
);

export const oauthClientsRelations = relations(oauthClients, ({ one }) => ({
  verificationDomain: one(verificationDomains, {
    fields: [oauthClients.verificationDomainId],
    references: [verificationDomains.id],
  }),
}));

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type SessionKind = (typeof sessionKindEnum.enumValues)[number];
export type DeviceChallengeStatus =
  (typeof deviceChallengeStatusEnum.enumValues)[number];
export type VerificationCodeSource =
  (typeof verificationCodeSourceEnum.enumValues)[number];
export type FlowAppRequestStatus =
  (typeof flowAppRequestStatusEnum.enumValues)[number];
export type ManagedIdentityStatus =
  (typeof managedIdentityStatusEnum.enumValues)[number];
export type ManagedIdentitySessionStatus =
  (typeof managedIdentitySessionStatusEnum.enumValues)[number];
export type OAuthClientAuthMethod =
  (typeof oauthClientAuthMethodEnum.enumValues)[number];

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type VerificationEmailReservationRow =
  typeof verificationEmailReservations.$inferSelect;
export type VerificationCodeRow = typeof verificationCodes.$inferSelect;
export type EmailIngestRecordRow = typeof emailIngestRecords.$inferSelect;
export type DeviceChallengeRow = typeof deviceChallenges.$inferSelect;
export type AdminNotificationRow = typeof adminNotifications.$inferSelect;
export type FlowAppRequestRow = typeof flowAppRequests.$inferSelect;
export type ManagedIdentityRow = typeof managedIdentities.$inferSelect;
export type ManagedIdentitySessionRow =
  typeof managedIdentitySessions.$inferSelect;
export type VerificationDomainRow = typeof verificationDomains.$inferSelect;
export type OAuthClientRow = typeof oauthClients.$inferSelect;
export type OidcArtifactRow = typeof oidcArtifacts.$inferSelect;
export type OidcSigningKeyRow = typeof oidcSigningKeys.$inferSelect;
