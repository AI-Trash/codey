import { defineNitroConfig } from 'nitro/config'

export default defineNitroConfig({
  handlers: [
    {
      route: '/oidc/**',
      handler: './server/handlers/oidc.ts',
    },
  ],
})
