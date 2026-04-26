import { createFileRoute } from '@tanstack/react-router'
import { buildGitHubAuthorizeUrl } from '../../lib/server/github-oauth'
import { redirect, text } from '../../lib/server/http'

export const Route = createFileRoute('/auth/github')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const redirectTo = url.searchParams.get('redirectTo') || '/admin'
          return redirect(buildGitHubAuthorizeUrl(request, redirectTo))
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'GitHub OAuth is unavailable',
            503,
          )
        }
      },
    },
  },
})
