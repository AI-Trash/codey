import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  AdminAppsHero,
  AdminAppsNav,
  AdminAuthRequired,
  EditOAuthClientPageContent,
  type ManagedOAuthClient,
} from "../../../components/admin/oauth-clients";

const loadOAuthClient = createServerFn({ method: "GET" })
  .inputValidator((data: { clientId: string }) => data)
  .handler(async ({ data }) => {
    const [
      { getRequest },
      { requireAdmin },
      { getOAuthClientSummaryById },
      { getAppEnv },
      { DEFAULT_OAUTH_SUPPORTED_SCOPES },
    ] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("../../../lib/server/auth"),
      import("../../../lib/server/oauth-clients"),
      import("../../../lib/server/env"),
      import("../../../lib/server/oauth-scopes"),
    ]);
    const request = getRequest();

    try {
      await requireAdmin(request);
    } catch {
      return { authorized: false as const };
    }

    const client = await getOAuthClientSummaryById(data.clientId);
    if (!client) {
      return {
        authorized: true as const,
        client: null,
        supportedScopes: [] as string[],
      };
    }

    const env = getAppEnv();

    return {
      authorized: true as const,
      client: client as ManagedOAuthClient,
      supportedScopes: env.oauthSupportedScopes.length
        ? env.oauthSupportedScopes
        : DEFAULT_OAUTH_SUPPORTED_SCOPES,
    };
  });

export const Route = createFileRoute("/admin/apps/$clientId")({
  loader: async ({ params }) => loadOAuthClient({ data: { clientId: params.clientId } }),
  component: AdminAppsDetailPage,
});

function AdminAppsDetailPage() {
  const data = Route.useLoaderData();

  if (!data.authorized) {
    return <AdminAuthRequired />;
  }

  if (!data.client) {
    return (
      <main className="page-wrap px-4 py-12">
        <AdminAppsHero
          kicker="Admin apps"
          title="OAuth app not found"
          description="The requested managed client is missing or has been removed. Return to the apps list to choose another record."
          actions={
            <a href="/admin/apps" className="admin-button admin-button-primary">
              Back to apps
            </a>
          }
        />
      </main>
    );
  }

  return (
    <main className="page-wrap px-4 py-12">
      <AdminAppsHero
        kicker="Admin apps"
        title={data.client.clientName}
        description="Update app metadata, change grant support, reveal the stored secret when needed, or rotate it to replace the previous credential."
        actions={
          <>
            <a href="/admin/apps" className="admin-button admin-button-secondary">
              Back to apps
            </a>
            <a href="/admin/apps/new" className="admin-button admin-button-secondary">
              Register another app
            </a>
          </>
        }
      />
      <AdminAppsNav current="detail" />
      <EditOAuthClientPageContent
        initialClient={data.client}
        supportedScopes={data.supportedScopes}
      />
    </main>
  );
}
