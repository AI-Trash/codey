import { createFileRoute } from "@tanstack/react-router";
import { getDefaultAdminRoute } from "../../../lib/admin-access";
import {
  createBrowserSession,
  buildSessionCookie,
} from "../../../lib/server/auth";
import {
  exchangeGitHubCode,
  readGitHubState,
} from "../../../lib/server/github-oauth";
import { redirect, text } from "../../../lib/server/http";

export const Route = createFileRoute("/auth/github/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        if (!code) {
          return text("Missing OAuth code", 400);
        }

        try {
          const state = readGitHubState(url.searchParams.get("state"));
          const { user } = await exchangeGitHubCode(request, code);
          const { token } = await createBrowserSession(user.id);
          const requestedRedirect = state.redirectTo || "/admin";
          const defaultAdminRoute = getDefaultAdminRoute(user);
          const redirectTo =
            requestedRedirect === "/admin" || requestedRedirect === "/admin/"
              ? defaultAdminRoute
              : requestedRedirect.startsWith("/admin") &&
                  defaultAdminRoute === "/admin/login"
                ? "/admin/login?access=restricted"
                : requestedRedirect;
          const response = redirect(redirectTo);
          response.headers.set("Set-Cookie", buildSessionCookie(token));
          return response;
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "GitHub login failed",
            500,
          );
        }
      },
    },
  },
});
