import { createFileRoute } from '@tanstack/react-router'

import { deserializeDataTableFilters } from '../../../../lib/data-table-filters'
import { requireAdminPermission } from '../../../../lib/server/auth'
import { json, text } from '../../../../lib/server/http'
import { listAdminVerificationMessagesPage } from '../../../../lib/server/verification'

function readPositiveNumber(value: string | null) {
  if (!value) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    return undefined
  }

  return parsed
}

export const Route = createFileRoute('/api/admin/verification-messages/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdminPermission(request, 'VERIFICATION_MESSAGES')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        const url = new URL(request.url)
        const page = readPositiveNumber(url.searchParams.get('page'))
        const pageSize = readPositiveNumber(url.searchParams.get('pageSize'))
        const search = url.searchParams.get('search')
        const filters = deserializeDataTableFilters(
          url.searchParams.get('filters'),
        )

        return json(
          await listAdminVerificationMessagesPage({
            page,
            pageSize,
            search,
            filters,
          }),
        )
      },
    },
  },
})
