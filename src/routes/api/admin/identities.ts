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

function readManagedIdentityStatus(
  value: FormDataEntryValue | null,
): 'ACTIVE' | 'REVIEW' | 'ARCHIVED' | 'BANNED' {
  const normalized = String(value || 'ACTIVE').toUpperCase()
  if (
    normalized === 'ACTIVE' ||
    normalized === 'REVIEW' ||
    normalized === 'ARCHIVED' ||
    normalized === 'BANNED'
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
                  : intent === 'ban'
                    ? await updateManagedIdentity({
                        identityId,
                        status: 'BANNED',
                      })
                    : !email
                      ? null
                      : await upsertManagedIdentity({
                          identityId,
                          email,
                          label: String(form.get('label') || ''),
                          status: readManagedIdentityStatus(form.get('status')),
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
