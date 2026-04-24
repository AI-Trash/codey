import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  experimental: {
    websocket: true,
  },
  handlers: [
    {
      route: "/oidc/**",
      handler: "./server/handlers/oidc.ts",
    },
  ],
});
