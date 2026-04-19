export const adminPermissionValues = [
  'MAIL_INBOX',
  'MANAGED_IDENTITIES',
  'CLI_OPERATIONS',
  'MANAGED_SESSIONS',
  'OAUTH_CLIENTS',
  'VERIFICATION_DOMAINS',
  'USER_ACCESS',
] as const

export type AdminPermission = (typeof adminPermissionValues)[number]

const legacyAdminPermissionAliases: Record<string, readonly AdminPermission[]> = {
  OPERATIONS: [
    'MAIL_INBOX',
    'MANAGED_IDENTITIES',
    'CLI_OPERATIONS',
    'MANAGED_SESSIONS',
  ],
  OAUTH_APPS: ['OAUTH_CLIENTS', 'VERIFICATION_DOMAINS'],
  USERS: ['USER_ACCESS'],
}

const adminPermissionSet = new Set<string>(adminPermissionValues)

export const defaultAdminRouteByPermission: Record<AdminPermission, string> = {
  MAIL_INBOX: '/admin/emails',
  MANAGED_IDENTITIES: '/admin/identities',
  CLI_OPERATIONS: '/admin/cli',
  MANAGED_SESSIONS: '/admin/sessions',
  OAUTH_CLIENTS: '/admin/apps',
  VERIFICATION_DOMAINS: '/admin/domains',
  USER_ACCESS: '/admin/users',
}

export type AdminAccessUserLike = {
  role: 'ADMIN' | 'USER'
  permissions?: readonly string[] | null
}

export function getAllAdminPermissions(): AdminPermission[] {
  return [...adminPermissionValues]
}

export function normalizeAdminPermissions(
  permissions?: readonly string[] | null,
): AdminPermission[] {
  if (!permissions?.length) {
    return []
  }

  const normalizedPermissions = new Set<AdminPermission>()

  for (const permission of permissions) {
    if (adminPermissionSet.has(permission)) {
      normalizedPermissions.add(permission as AdminPermission)
      continue
    }

    const legacyPermissions = legacyAdminPermissionAliases[permission]
    if (!legacyPermissions) {
      continue
    }

    for (const legacyPermission of legacyPermissions) {
      normalizedPermissions.add(legacyPermission)
    }
  }

  return adminPermissionValues.filter((permission) =>
    normalizedPermissions.has(permission),
  )
}

export function getEffectiveAdminPermissions(
  user: AdminAccessUserLike | null | undefined,
): AdminPermission[] {
  if (!user) {
    return []
  }

  const permissions = normalizeAdminPermissions(user.permissions)
  if (user.role === 'ADMIN' && permissions.length === 0) {
    return getAllAdminPermissions()
  }

  return permissions
}

export function hasAdminPermission(
  user: AdminAccessUserLike | null | undefined,
  permission: AdminPermission,
): boolean {
  if (!user || user.role !== 'ADMIN') {
    return false
  }

  return getEffectiveAdminPermissions(user).includes(permission)
}

export function hasAnyAdminPermission(
  user: AdminAccessUserLike | null | undefined,
): boolean {
  if (!user || user.role !== 'ADMIN') {
    return false
  }

  return getEffectiveAdminPermissions(user).length > 0
}

export function getDefaultAdminRoute(
  user: AdminAccessUserLike | null | undefined,
): string {
  for (const permission of adminPermissionValues) {
    if (hasAdminPermission(user, permission)) {
      return defaultAdminRouteByPermission[permission]
    }
  }

  return '/admin/login'
}
