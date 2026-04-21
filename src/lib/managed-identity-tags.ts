export const managedIdentityPresetTagValues = [
  'sub-account',
  'parent-account',
] as const

export type ManagedIdentityPresetTag =
  (typeof managedIdentityPresetTagValues)[number]

const managedIdentityPresetTagAliasMap = new Map<
  string,
  ManagedIdentityPresetTag
>([
  ['sub-account', 'sub-account'],
  ['sub account', 'sub-account'],
  ['sub', 'sub-account'],
  ['child', 'sub-account'],
  ['child-account', 'sub-account'],
  ['child account', 'sub-account'],
  ['子号', 'sub-account'],
  ['parent-account', 'parent-account'],
  ['parent account', 'parent-account'],
  ['parent', 'parent-account'],
  ['mother', 'parent-account'],
  ['mother-account', 'parent-account'],
  ['mother account', 'parent-account'],
  ['母号', 'parent-account'],
])

function getManagedIdentityPresetTagRank(value: string) {
  const index = managedIdentityPresetTagValues.indexOf(
    value as ManagedIdentityPresetTag,
  )
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

export function isManagedIdentityPresetTag(
  value: string,
): value is ManagedIdentityPresetTag {
  return managedIdentityPresetTagValues.includes(
    value as ManagedIdentityPresetTag,
  )
}

export function normalizeManagedIdentityTag(value?: string | null) {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  const alias =
    managedIdentityPresetTagAliasMap.get(trimmed.toLowerCase()) || null

  return alias || trimmed
}

export function normalizeManagedIdentityTags(
  values?: Iterable<string | null | undefined> | null,
) {
  if (!values) {
    return []
  }

  const seen = new Set<string>()
  const tags: string[] = []

  for (const value of values) {
    const normalized = normalizeManagedIdentityTag(value)
    if (!normalized) {
      continue
    }

    const dedupeKey = normalized.toLowerCase()
    if (seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    tags.push(normalized)
  }

  return tags.sort((left, right) => {
    const rankDelta =
      getManagedIdentityPresetTagRank(left) -
      getManagedIdentityPresetTagRank(right)

    if (rankDelta !== 0) {
      return rankDelta
    }

    return left.localeCompare(right, 'en', { sensitivity: 'base' })
  })
}

export function parseManagedIdentityTagsInput(value?: string | null) {
  return normalizeManagedIdentityTags(value?.split(/[\n,，]/g))
}
