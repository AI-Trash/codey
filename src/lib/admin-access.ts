export const adminPermissionValues = [
  'OPERATIONS',
  'OAUTH_APPS',
  'USERS',
] as const

export const defaultAdminRouteByPermission: Record<AdminPermission, string> = {
  OPERATIONS: '/admin/emails',
  OAUTH_APPS: '/admin/apps',
  USERS: '/admin/users',
}

export type AdminPermission = (typeof adminPermissionValues)[number]

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

  return adminPermissionValues.filter((permission) =>
    permissions.includes(permission),
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
  if (hasAdminPermission(user, 'OPERATIONS')) {
    return defaultAdminRouteByPermission.OPERATIONS
  }

  if (hasAdminPermission(user, 'OAUTH_APPS')) {
    return defaultAdminRouteByPermission.OAUTH_APPS
  }

  if (hasAdminPermission(user, 'USERS')) {
    return defaultAdminRouteByPermission.USERS
  }

  return '/admin/login'
}
