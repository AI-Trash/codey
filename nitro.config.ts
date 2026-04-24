import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  features: {
    websocket: true,
  },
  handlers: [
    {
      route: "/oidc/**",
      handler: "./server/handlers/oidc.ts",
    },
  ],
});
