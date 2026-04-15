import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  AdminAppsHero,
  AdminAppsNav,
  AdminAuthRequired,
  OAuthClientsList,
  type ManagedOAuthClient,
} from "../../../components/admin/oauth-clients";

const loadOAuthClients = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getRequest }, { requireAdmin }, { listOAuthClients }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("../../../lib/server/auth"),
    import("../../../lib/server/oauth-clients"),
  ]);
  const request = getRequest();

  try {
    await requireAdmin(request);
  } catch {
    return { authorized: false as const };
  }

  return {
    authorized: true as const,
    clients: (await listOAuthClients()) as ManagedOAuthClient[],
  };
});

export const Route = createFileRoute("/admin/apps/")({
  loader: async () => loadOAuthClients(),
  component: AdminAppsListPage,
});

function AdminAppsListPage() {
  const data = Route.useLoaderData();

  if (!data.authorized) {
    return <AdminAuthRequired />;
  }

  return (
    <main className="page-wrap px-4 py-12">
      <AdminAppsHero
        kicker="Admin apps"
        title="Managed OAuth clients"
        description="Register, inspect, and maintain OAuth apps that use client credentials or admin-approved device flow inside Codey."
        actions={
          <>
            <a href="/admin" className="admin-button admin-button-secondary">
              Back to operations
            </a>
            <a href="/admin/apps/new" className="admin-button admin-button-primary">
              Register app
            </a>
          </>
        }
      />
      <AdminAppsNav current="list" />

      <section className="admin-grid mt-8">
        <article className="admin-panel admin-panel-strong">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="island-kicker mb-2">Client inventory</p>
              <h2 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
                OAuth app registry
              </h2>
            </div>
            <span
              className="admin-status-pill"
              data-tone={data.clients.length > 0 ? "good" : "warning"}
            >
              {data.clients.length} app{data.clients.length === 1 ? "" : "s"}
            </span>
          </div>
          <OAuthClientsList clients={data.clients} />
        </article>
      </section>
    </main>
  );
}
