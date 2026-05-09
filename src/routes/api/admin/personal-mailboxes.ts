import { createFileRoute } from '@tanstack/react-router'
import { requireAdminPermission } from '../../../lib/server/auth'
import { json, text } from '../../../lib/server/http'
import { readJsonBody } from '../../../lib/server/request'
import {
  importPersonalMailboxesFromCsv,
  listPersonalMailboxes,
} from '../../../lib/server/personal-mailboxes'

interface ImportPersonalMailboxesBody {
  csv?: string
}

export const Route = createFileRoute('/api/admin/personal-mailboxes')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdminPermission(request, 'VERIFICATION_DOMAINS')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        return json({
          mailboxes: await listPersonalMailboxes(),
        })
      },
      POST: async ({ request }) => {
        try {
          await requireAdminPermission(request, 'VERIFICATION_DOMAINS')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        const body = await readJsonBody<ImportPersonalMailboxesBody>(request)
        const csv = typeof body.csv === 'string' ? body.csv : ''
        if (!csv.trim()) {
          return text('CSV content is required', 400)
        }

        try {
          const result = await importPersonalMailboxesFromCsv(csv)
          return json(result)
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to import personal mailboxes',
            400,
          )
        }
      },
    },
  },
})
