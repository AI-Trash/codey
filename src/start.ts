import { createMiddleware, createStart } from '@tanstack/react-start'

import { paraglideMiddleware } from './paraglide/server'

const localeMiddleware = createMiddleware({ type: 'request' }).server(
  async ({ request, next }) => {
    return paraglideMiddleware(request, async () => {
      const result = await next()
      return result.response
    })
  },
)

export const startInstance = createStart(() => ({
  requestMiddleware: [localeMiddleware],
}))
