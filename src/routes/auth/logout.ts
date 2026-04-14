import { createFileRoute } from "@tanstack/react-router";
import {
  clearSessionCookie,
  destroyBrowserSession,
} from "../../lib/server/auth";
import { redirect } from "../../lib/server/http";

export const Route = createFileRoute("/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await destroyBrowserSession(request);
        const response = redirect("/admin/login");
        response.headers.set("Set-Cookie", clearSessionCookie());
        return response;
      },
    },
  },
});
