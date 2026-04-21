import { createFileRoute } from '@tanstack/react-router'
import { requireAdminPermission } from '../../../lib/server/auth'
import { json, redirect, text } from '../../../lib/server/http'
import {
  deleteManagedIdentities,
  deleteManagedIdentity,
  findAdminIdentitySummary,
  listAdminIdentitySummaries,
  updateManagedIdentity,
  upsertManagedIdentity,
} from '../../../lib/server/identities'
import {
  applyManagedIdentityTagPatch,
  parseManagedIdentityTagsInput,
} from '../../../lib/managed-identity-tags'

function readManagedIdentityPlan(
  value: FormDataEntryValue | null,
): 'free' | 'plus' | 'team' {
  const normalized = String(value || 'free')
    .trim()
    .toLowerCase()
  if (normalized === 'free' || normalized === 'plus' || normalized === 'team') {
    return normalized
  }

  return 'free'
}

function readManagedIdentityStatus(
  value: FormDataEntryValue | null,
): 'ACTIVE' | 'REVIEW' | 'ARCHIVED' {
  const normalized = String(value || 'ACTIVE').toUpperCase()
  if (
    normalized === 'ACTIVE' ||
    normalized === 'REVIEW' ||
    normalized === 'ARCHIVED'
  ) {
    return normalized
  }

  return 'ACTIVE'
}

function readRedirectTo(value: FormDataEntryValue | null): string | undefined {
  const redirectTo = String(value || '').trim()
  if (!redirectTo || !redirectTo.startsWith('/admin')) {
    return undefined
  }

  return redirectTo
}

function readManagedIdentityIntent(value: FormDataEntryValue | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function readManagedIdentityTags(value: FormDataEntryValue | null) {
  return parseManagedIdentityTagsInput(String(value || ''))
}

function readManagedIdentityIds(form: FormData, key = 'identityIds') {
  return Array.from(
    new Set(
      form
        .getAll(key)
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  )
}

export const Route = createFileRoute('/api/admin/identities')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireAdminPermission(request, 'MANAGED_IDENTITIES')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        const form = await request.formData()
        const intent = readManagedIdentityIntent(form.get('intent'))
        const accept = request.headers.get('accept') || ''
        const wantsJson = accept.includes('application/json')

        if (intent === 'bulk-save-tags') {
          const identityIds = readManagedIdentityIds(form)
          const tagsToAdd = readManagedIdentityTags(form.get('tagsToAdd'))
          const tagsToRemove = readManagedIdentityTags(form.get('tagsToRemove'))

          if (!identityIds.length) {
            return text('identityIds are required', 400)
          }

          const existingSummaries = await listAdminIdentitySummaries()
          const summariesById = new Map(
            existingSummaries.map((summary) => [summary.id, summary]),
          )

          for (const managedIdentityId of identityIds) {
            const summary = summariesById.get(managedIdentityId)
            if (!summary) {
              return text(`Unknown identityId: ${managedIdentityId}`, 400)
            }

            const record = await updateManagedIdentity({
              identityId: managedIdentityId,
              tags: applyManagedIdentityTagPatch(summary.tags, {
                addTags: tagsToAdd,
                removeTags: tagsToRemove,
              }),
            })

            if (!record) {
              return text(
                `Unable to update managed identity: ${managedIdentityId}`,
                400,
              )
            }
          }

          const updatedSummaries = await listAdminIdentitySummaries()
          const updatedById = new Map(
            updatedSummaries.map((summary) => [summary.id, summary]),
          )
          const identities = identityIds
            .map((managedIdentityId) => updatedById.get(managedIdentityId))
            .filter((summary): summary is NonNullable<typeof summary> =>
              Boolean(summary),
            )

          if (wantsJson) {
            return json({
              ok: true,
              identityIds,
              identities,
            })
          }

          return redirect(
            readRedirectTo(form.get('redirectTo')) || '/admin/identities',
          )
        }

        if (intent === 'bulk-delete') {
          const identityIds = readManagedIdentityIds(form)

          if (!identityIds.length) {
            return text('identityIds are required', 400)
          }

          const existingSummaries = await listAdminIdentitySummaries()
          const summariesById = new Map(
            existingSummaries.map((summary) => [summary.id, summary]),
          )

          for (const managedIdentityId of identityIds) {
            if (!summariesById.has(managedIdentityId)) {
              return text(`Unknown identityId: ${managedIdentityId}`, 400)
            }
          }

          const deletedRecords = await deleteManagedIdentities(identityIds)
          if (deletedRecords.length !== identityIds.length) {
            return text('Unable to delete all managed identities', 400)
          }

          if (wantsJson) {
            return json({
              ok: true,
              identityIds,
            })
          }

          return redirect(
            readRedirectTo(form.get('redirectTo')) || '/admin/identities',
          )
        }

        const identityId = String(form.get('identityId') || '').trim()
        const email = String(form.get('email') || '').trim()

        if (!identityId) {
          return text('identityId is required', 400)
        }

        const knownIdentity = await findAdminIdentitySummary(identityId)
        if (!knownIdentity) {
          return text('Unknown identityId', 400)
        }

        if (email && knownIdentity.account !== email) {
          return text('Identity email mismatch', 400)
        }

        if (intent === 'delete') {
          const record = await deleteManagedIdentity(identityId)
          if (!record) {
            return text('Unknown identityId', 400)
          }

          if (wantsJson) {
            return json({ ok: true, id: record.id })
          }

          return redirect(
            readRedirectTo(form.get('redirectTo')) || '/admin/identities',
          )
        }

        const record =
          intent === 'save-label'
            ? await updateManagedIdentity({
                identityId,
                label: String(form.get('label') || ''),
              })
            : intent === 'save-details'
              ? await updateManagedIdentity({
                  identityId,
                  label: String(form.get('label') || ''),
                  tags: readManagedIdentityTags(form.get('tags')),
                })
              : intent === 'save-plan'
                ? await updateManagedIdentity({
                    identityId,
                    plan: readManagedIdentityPlan(form.get('plan')),
                  })
                : intent === 'activate'
                  ? await updateManagedIdentity({
                      identityId,
                      status: 'ACTIVE',
                    })
                  : intent === 'review'
                    ? await updateManagedIdentity({
                        identityId,
                        status: 'REVIEW',
                      })
                    : intent === 'archive'
                      ? await updateManagedIdentity({
                          identityId,
                          status: 'ARCHIVED',
                        })
                      : !email
                        ? null
                        : await upsertManagedIdentity({
                            identityId,
                            email,
                            label: String(form.get('label') || ''),
                            tags: readManagedIdentityTags(form.get('tags')),
                            plan: readManagedIdentityPlan(form.get('plan')),
                            status: readManagedIdentityStatus(
                              form.get('status'),
                            ),
                          })

        if (!record) {
          return text('Unable to update managed identity', 400)
        }

        if (wantsJson) {
          return json({
            ok: true,
            id: record.id,
            identity: await findAdminIdentitySummary(identityId),
          })
        }

        return redirect(
          readRedirectTo(form.get('redirectTo')) || '/admin/identities',
        )
      },
    },
  },
})
