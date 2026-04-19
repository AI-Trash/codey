import "@tanstack/react-start/server-only";

import { asc, eq } from "drizzle-orm";
import {
  getEffectiveAdminPermissions,
  getAllAdminPermissions,
  hasAdminPermission,
  normalizeAdminPermissions,
  type AdminPermission,
} from "../admin-access";
import { getDb } from "./db/client";
import { users } from "./db/schema";
import { getAppEnv } from "./env";
import { isAllowlistedAdminLogin } from "./github-oauth";

export type AdminUserAccessPolicy = "ALLOWLIST" | "MANUAL";

export interface AdminUserSummary {
  id: string;
  email: string | null;
  githubLogin: string | null;
  name: string | null;
  avatarUrl: string | null;
  role: "ADMIN" | "USER";
  permissions: AdminPermission[];
  hasConsoleAccess: boolean;
  isAllowlistedAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

function getAdminUserAccessPolicy(): AdminUserAccessPolicy {
  return getAppEnv().adminGitHubLogins.length > 0 ? "ALLOWLIST" : "MANUAL";
}

function buildAdminUserSummary(row: {
  id: string;
  email: string | null;
  githubLogin: string | null;
  name: string | null;
  avatarUrl: string | null;
  role: "ADMIN" | "USER";
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}): AdminUserSummary {
  const env = getAppEnv();
  const permissions = getEffectiveAdminPermissions({
    role: row.role,
    permissions: row.permissions,
  });
  const isAllowlistedAdmin =
    !!row.githubLogin &&
    isAllowlistedAdminLogin(row.githubLogin, env.adminGitHubLogins);

  return {
    id: row.id,
    email: row.email,
    githubLogin: row.githubLogin,
    name: row.name,
    avatarUrl: row.avatarUrl,
    role: permissions.length > 0 ? "ADMIN" : "USER",
    permissions,
    hasConsoleAccess: permissions.length > 0,
    isAllowlistedAdmin,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } satisfies AdminUserSummary;
}

export async function listAdminUsers(): Promise<{
  policy: AdminUserAccessPolicy;
  users: AdminUserSummary[];
}> {
  const rows = await getDb().query.users.findMany({
    orderBy: [asc(users.createdAt)],
  });

  return {
    policy: getAdminUserAccessPolicy(),
    users: rows.map((row) => buildAdminUserSummary(row)),
  };
}

export async function updateAdminUserPermissions(params: {
  actorUserId: string;
  targetUserId: string;
  permissions: AdminPermission[];
}) {
  const db = getDb();
  const policy = getAdminUserAccessPolicy();
  const target = await db.query.users.findFirst({
    where: eq(users.id, params.targetUserId),
  });

  if (!target) {
    throw new Error("Unknown user");
  }

  const env = getAppEnv();
  const nextPermissions =
    policy === "ALLOWLIST"
      ? target.githubLogin &&
          isAllowlistedAdminLogin(target.githubLogin, env.adminGitHubLogins)
        ? getAllAdminPermissions()
        : []
      : normalizeAdminPermissions(params.permissions);
  const currentPermissions = getEffectiveAdminPermissions({
    role: target.role,
    permissions: target.permissions,
  });
  const nextRole = nextPermissions.length > 0 ? "ADMIN" : "USER";
  const removesUserManagement =
    hasAdminPermission(
      { role: target.role, permissions: currentPermissions },
      "USER_ACCESS",
    ) &&
    !hasAdminPermission(
      { role: nextRole, permissions: nextPermissions },
      "USER_ACCESS",
    );

  if (removesUserManagement) {
    const allUsers = await db.query.users.findMany({
      columns: {
        id: true,
        role: true,
        permissions: true,
      },
    });
    const hasAnotherUserManager = allUsers.some((user) => {
      if (user.id === target.id) {
        return false;
      }

      return hasAdminPermission(
        {
          role: user.role,
          permissions: user.permissions,
        },
        "USER_ACCESS",
      );
    });

    if (!hasAnotherUserManager) {
      throw new Error("At least one user must retain user management access");
    }
  }

  const [record] = await db
    .update(users)
    .set({
      role: nextRole,
      permissions: nextPermissions,
      updatedAt: new Date(),
    })
    .where(eq(users.id, target.id))
    .returning();

  if (!record) {
    throw new Error("Unable to update user permissions");
  }

  return {
    policy,
    user: buildAdminUserSummary(record),
    updatedSelf: params.actorUserId === target.id,
  };
}
