import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  features: {
    websocket: true,
  },
  handlers: [
    {
      route: "/api/realtime/ws",
      handler: "./server/routes/api/realtime/ws.ts",
    },
    {
      route: "/oidc/**",
      handler: "./server/handlers/oidc.ts",
    },
  ],
});
