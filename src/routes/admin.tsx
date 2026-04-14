import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const loadDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getRequest }, { getSessionUser }, { listAdminDashboardData }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("../lib/server/auth"),
      import("../lib/server/admin"),
    ]);
  const request = getRequest();
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return { authorized: false as const };
  }

  const data = await listAdminDashboardData();
  return {
    authorized: true as const,
    user: {
      name: sessionUser.user.name,
      email: sessionUser.user.email,
      githubLogin: sessionUser.user.githubLogin,
      role: sessionUser.user.role,
    },
    ...data,
  };
});

export const Route = createFileRoute("/admin")({
  loader: async () => loadDashboard(),
  component: AdminPage,
});

function AdminPage() {
  const data = Route.useLoaderData();
  if (!data.authorized) {
    return (
      <main className="page-wrap px-4 py-12">
        <section className="island-shell rounded-2xl p-6 sm:p-8">
          <p className="island-kicker mb-2">Admin</p>
          <h1 className="display-title mb-3 text-4xl font-bold text-[var(--sea-ink)] sm:text-5xl">
            Sign in required.
          </h1>
          <a
            href="/admin/login"
            className="inline-flex rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2.5 text-sm font-semibold text-[var(--lagoon-deep)] no-underline transition hover:-translate-y-0.5 hover:bg-[rgba(79,184,178,0.24)]"
          >
            Go to admin login
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="island-kicker mb-2">Admin Dashboard</p>
            <h1 className="display-title mb-3 text-4xl font-bold text-[var(--sea-ink)] sm:text-5xl">
              Codey control plane.
            </h1>
            <p className="m-0 max-w-2xl text-base leading-8 text-[var(--sea-ink-soft)]">
              Signed in as{" "}
              {data.user.githubLogin ||
                data.user.email ||
                data.user.name ||
                "unknown user"}
              .
            </p>
          </div>
          <form method="post" action="/auth/logout">
            <button className="rounded-full border border-[rgba(23,58,64,0.2)] bg-white/50 px-5 py-2.5 text-sm font-semibold text-[var(--sea-ink)] transition hover:-translate-y-0.5 hover:border-[rgba(23,58,64,0.35)]">
              Log out
            </button>
          </form>
        </div>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <article className="island-shell rounded-2xl p-6">
          <p className="island-kicker mb-2">Manual verification code</p>
          <form
            method="post"
            action="/api/admin/verification-codes"
            className="grid gap-3"
          >
            <input
              name="email"
              placeholder="target email"
              className="rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3"
            />
            <input
              name="code"
              placeholder="6-digit code"
              className="rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3"
            />
            <button className="rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2.5 text-sm font-semibold text-[var(--lagoon-deep)]">
              Inject verification code
            </button>
          </form>
        </article>

        <article className="island-shell rounded-2xl p-6">
          <p className="island-kicker mb-2">Admin notification</p>
          <form
            method="post"
            action="/api/admin/notifications"
            className="grid gap-3"
          >
            <input
              name="title"
              placeholder="title"
              className="rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3"
            />
            <input
              name="flowType"
              placeholder="flow type (optional)"
              className="rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3"
            />
            <input
              name="target"
              placeholder="target (optional)"
              className="rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3"
            />
            <textarea
              name="body"
              placeholder="message"
              className="min-h-28 rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3"
            />
            <button className="rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2.5 text-sm font-semibold text-[var(--lagoon-deep)]">
              Create notification
            </button>
          </form>
        </article>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-3">
        <article className="island-shell rounded-2xl p-6">
          <p className="island-kicker mb-2">Recent device challenges</p>
          <ul className="m-0 list-none space-y-3 p-0 text-sm text-[var(--sea-ink-soft)]">
            {data.deviceChallenges.map((challenge) => (
              <li
                key={challenge.id}
                className="rounded-xl border border-[var(--line)] p-3"
              >
                <div className="font-semibold text-[var(--sea-ink)]">
                  {challenge.userCode}
                </div>
                <div>Status: {challenge.status}</div>
                <div>Flow: {challenge.flowType || "n/a"}</div>
                <div>CLI: {challenge.cliName || "n/a"}</div>
                {challenge.status === "PENDING" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <form
                      method="post"
                      action={`/api/admin/device/${challenge.deviceCode}/approve`}
                    >
                      <button className="rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-4 py-2 text-xs font-semibold text-[var(--lagoon-deep)]">
                        Approve
                      </button>
                    </form>
                    <form
                      method="post"
                      action={`/api/admin/device/${challenge.deviceCode}/deny`}
                    >
                      <button className="rounded-full border border-[rgba(156,60,60,0.25)] bg-[rgba(181,82,82,0.08)] px-4 py-2 text-xs font-semibold text-[rgb(144,52,52)]">
                        Deny
                      </button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </article>

        <article className="island-shell rounded-2xl p-6 lg:col-span-2">
          <p className="island-kicker mb-2">Recent verification codes</p>
          <ul className="m-0 list-none space-y-3 p-0 text-sm text-[var(--sea-ink-soft)]">
            {data.verification.codes.map((code) => (
              <li
                key={code.id}
                className="rounded-xl border border-[var(--line)] p-3"
              >
                <div className="font-semibold text-[var(--sea-ink)]">
                  {code.reservation.email}
                </div>
                <div>Code: {code.code}</div>
                <div>Source: {code.source}</div>
                <div>
                  Received: {new Date(code.receivedAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <article className="island-shell rounded-2xl p-6">
          <p className="island-kicker mb-2">Reservations</p>
          <ul className="m-0 list-none space-y-3 p-0 text-sm text-[var(--sea-ink-soft)]">
            {data.verification.reservations.map((reservation) => (
              <li
                key={reservation.id}
                className="rounded-xl border border-[var(--line)] p-3"
              >
                <div className="font-semibold text-[var(--sea-ink)]">
                  {reservation.email}
                </div>
                <div>
                  Expires: {new Date(reservation.expiresAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="island-shell rounded-2xl p-6">
          <p className="island-kicker mb-2">Inbound emails</p>
          <ul className="m-0 list-none space-y-3 p-0 text-sm text-[var(--sea-ink-soft)]">
            {data.verification.emails.map((email) => (
              <li
                key={email.id}
                className="rounded-xl border border-[var(--line)] p-3"
              >
                <div className="font-semibold text-[var(--sea-ink)]">
                  {email.recipient}
                </div>
                <div>Subject: {email.subject || "n/a"}</div>
                <div>Code: {email.verificationCode || "not detected"}</div>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
