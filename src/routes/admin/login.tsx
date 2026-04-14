import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/login")({
  component: AdminLoginPage,
});

function AdminLoginPage() {
  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">Admin Login</p>
        <h1 className="display-title mb-3 text-4xl font-bold text-[var(--sea-ink)] sm:text-5xl">
          Sign in with GitHub.
        </h1>
        <p className="mb-6 max-w-2xl text-base leading-8 text-[var(--sea-ink-soft)]">
          Browser login is used to approve CLI device challenges, inspect
          inbound verification mail, and inject manual verification codes during
          setup.
        </p>
        <a
          href="/auth/github?redirectTo=/admin"
          className="inline-flex rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2.5 text-sm font-semibold text-[var(--lagoon-deep)] no-underline transition hover:-translate-y-0.5 hover:bg-[rgba(79,184,178,0.24)]"
        >
          Continue with GitHub
        </a>
      </section>
    </main>
  );
}
