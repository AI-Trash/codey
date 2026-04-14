import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/login")({
  component: AdminLoginPage,
});

function AdminLoginPage() {
  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell admin-hero rise-in rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10">
        <div className="relative z-10 grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="admin-chip">Admin login</span>
              <span className="admin-status-pill" data-tone="good">
                GitHub OAuth
              </span>
            </div>
            <h1 className="display-title mb-4 text-4xl leading-[1.02] font-bold tracking-tight text-[var(--sea-ink)] sm:text-6xl">
              Open the operator side of Codey.
            </h1>
            <p className="mb-6 max-w-2xl text-base leading-8 text-[var(--sea-ink-soft)] sm:text-lg">
              Browser sign-in is the gateway to device approvals, verification
              oversight, saved identity review, and flow app queue management.
              Keep the session in GitHub, then step back into the control plane.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="/auth/github?redirectTo=/admin"
                className="admin-button admin-button-primary"
              >
                Continue with GitHub
              </a>
              <a href="/device" className="admin-button admin-button-secondary">
                View device page
              </a>
            </div>
          </div>

          <article className="admin-panel admin-panel-muted">
            <p className="island-kicker mb-2">What you unlock</p>
            <ul className="admin-list">
              {[
                [
                  "Approve CLI device challenges",
                  "Review pending browser handshakes and unblock flow operators quickly.",
                ],
                [
                  "Inspect verification motion",
                  "Scan code capture, reservations, and inbound email summaries from one page.",
                ],
                [
                  "Manage account coverage",
                  "See saved identities, config readiness, and GitHub Actions auto-add-account requests.",
                ],
              ].map(([title, detail]) => (
                <li key={title} className="admin-list-item">
                  <strong className="block text-[var(--sea-ink)]">{title}</strong>
                  <p className="mt-2 mb-0 text-sm leading-7 text-[var(--sea-ink-soft)]">
                    {detail}
                  </p>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>
    </main>
  );
}
