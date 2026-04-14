import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  component: About,
});

function About() {
  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">About</p>
        <h1 className="display-title mb-3 text-4xl font-bold text-[var(--sea-ink)] sm:text-5xl">
          Codey now includes a control plane backend.
        </h1>
        <p className="m-0 max-w-3xl text-base leading-8 text-[var(--sea-ink-soft)]">
          The repository now preserves the existing Exchange-based flow client
          while adding the app-side primitives needed for browser GitHub
          sign-in, device-style CLI authorization, verification email
          reservations, Cloudflare email ingest, and SSE-based verification
          updates.
        </p>
      </section>
    </main>
  );
}
