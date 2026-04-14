import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const loadChallenge = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { userCode?: string } }) => {
    const { prisma } = await import("../lib/server/prisma");
    if (!data.userCode) {
      return null;
    }

    return prisma.deviceChallenge.findUnique({
      where: { userCode: data.userCode },
      include: { user: true },
    });
  },
);

export const Route = createFileRoute("/device")({
  validateSearch: (search: Record<string, unknown>) => ({
    userCode: typeof search.userCode === "string" ? search.userCode : undefined,
  }),
  loader: ({ search }) =>
    loadChallenge({ data: { userCode: search.userCode } }),
  component: DevicePage,
});

function DevicePage() {
  const challenge = Route.useLoaderData();

  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">Device authorization</p>
        <h1 className="display-title mb-3 text-4xl font-bold text-[var(--sea-ink)] sm:text-5xl">
          Approve a CLI session.
        </h1>
        {challenge ? (
          <div className="space-y-3 text-base text-[var(--sea-ink-soft)]">
            <p>
              User code:{" "}
              <strong className="text-[var(--sea-ink)]">
                {challenge.userCode}
              </strong>
            </p>
            <p>Status: {challenge.status}</p>
            <p>Flow: {challenge.flowType || "n/a"}</p>
            <p>CLI: {challenge.cliName || "n/a"}</p>
            <p>
              Finish sign-in as an admin in the browser, then approve this
              device from the
              <a className="ml-1 underline" href="/admin">
                admin dashboard
              </a>
              .
            </p>
          </div>
        ) : (
          <p className="m-0 max-w-2xl text-base leading-8 text-[var(--sea-ink-soft)]">
            Open this page with <code>?userCode=XXXX-XXXX</code> to inspect a
            pending device challenge.
          </p>
        )}
      </section>
    </main>
  );
}
