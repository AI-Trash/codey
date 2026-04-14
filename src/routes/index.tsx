import { useId, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: App });

const featureCards = [
  {
    title: "Browser sign-in",
    description:
      "Authenticate operators in the browser and keep sensitive secrets out of CLI workflows.",
    cta: "Open admin",
    href: "/admin",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
        <path d="M10 2 3 5v5c0 4 2.7 6.8 7 8 4.3-1.2 7-4 7-8V5l-7-3Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="m7.5 10 1.6 1.6 3.4-3.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Device approvals",
    description:
      "Review user codes in a browser flow so long-running automations can ask for approval safely.",
    cta: "Review device route",
    href: "/device",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
        <rect x="5" y="2.5" width="10" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 5.5h4M8 14.5h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "Alias reservations",
    description:
      "Reserve verification mailbox aliases from the app before flows start waiting for events.",
    cta: "Read request example",
    href: "/#example",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
        <path d="M3 5.5h14v9H3z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="m4 6.5 6 4 6-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Email ingest",
    description:
      "Accept Cloudflare-routed messages and turn inbound mail into verification data for operators.",
    cta: "View benefits",
    href: "/#metrics",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
        <path d="M4 4.5h12v11H4z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 8.5h6M7 11.5h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "SSE delivery",
    description:
      "Stream verification updates back to waiting clients instead of relying on repeated inbox polling.",
    cta: "See process",
    href: "/#process",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
        <path d="M3 10h4l2-3 2 6 2-3h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Shared shell",
    description:
      "Use one consistent landing page, header, and footer to guide operators into the routes that matter.",
    cta: "Get started",
    href: "/#start",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
        <path d="M3 5.5h14M3 10h14M3 14.5h9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
] as const;

const metrics = [
  {
    label: "Auth modes",
    value: "github+device",
    badge: "shifted browser-side",
    detail: "Browser admins and CLI sessions share one boundary instead of splitting trust across separate tools.",
  },
  {
    label: "Verification path",
    value: "sse-stream",
    badge: "less polling",
    detail: "Waiting clients can react as codes arrive instead of repeatedly checking mailbox state.",
  },
  {
    label: "Email input",
    value: "cloudflare",
    badge: "more direct intake",
    detail: "Inbound mail can become app-visible verification events with a clearer route into the control plane.",
  },
] as const;

const processSteps = [
  {
    badge: "01",
    title: "Connect runtime inputs",
    description:
      "Configure the database, GitHub OAuth credentials, and optional webhook secrets for the verification path you plan to use.",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
        <path d="M5 10a3 3 0 1 1 0-6h2M15 10a3 3 0 1 0 0-6h-2M7 13h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    badge: "02",
    title: "Verify operator routes",
    description:
      "Use the shared shell to open the admin and device routes, confirm sign-in works, and inspect the operator-facing flow before automation runs.",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
        <path d="M4 4.5h12v11H4z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 8h6M7 11h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    badge: "03",
    title: "Run the delivery loop",
    description:
      "Reserve aliases, receive ingest events, and stream verification data back to flow clients through the app instead of polling mailboxes directly.",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
        <path d="M4 10h4l2-3 2 6 2-3h2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
] as const;

const codeSample = `curl -X POST http://localhost:3000/api/verification/email-reservations \\
  -H "content-type: application/json" \\
  -d '{
    "flowType": "chatgpt-register",
    "target": "octocat",
    "ttlMs": 180000
  }'`;

function App() {
  const statusId = useId();
  const [copyFeedback, setCopyFeedback] = useState("Ready to copy request example.");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(codeSample);
      setCopyFeedback("Request example copied to clipboard.");
    } catch {
      setCopyFeedback("Clipboard access unavailable. Copy the request example manually.");
    }
  }

  return (
    <main className="page-wrap px-4 pb-12 pt-8 sm:pt-10">
      <section className="scroll-mt-24 border-b border-[var(--line)] pb-8 sm:pb-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-start">
          <div>
            <p className="mb-3 text-sm font-medium text-[var(--lagoon-deep)]">
              Developer verification control plane
            </p>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-[var(--sea-ink)] sm:text-5xl">
              One practical shell for browser sign-in, device approvals, and verification delivery.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--sea-ink-soft)] sm:text-lg">
              Codey gives automation teams a neutral landing page and shared shell that point directly to the real routes and APIs already present in this repo.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/admin"
                className="inline-flex items-center rounded-md bg-[var(--lagoon-deep)] px-4 py-2.5 text-sm font-semibold text-white no-underline transition hover:bg-[color-mix(in_oklab,var(--lagoon-deep)_88%,black)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lagoon-deep)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
              >
                Open admin
              </Link>
              <a
                href="/#example"
                className="inline-flex items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--sea-ink)] no-underline transition hover:border-[color-mix(in_oklab,var(--lagoon-deep)_35%,var(--line))] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lagoon-deep)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
              >
                View API example
              </a>
            </div>
          </div>

          <aside className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
            <p className="mb-3 text-sm font-semibold text-[var(--sea-ink)]">Included routes and workflows</p>
            <div className="space-y-3 text-sm text-[var(--sea-ink-soft)]">
              <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3">
                <p className="mb-1 font-medium text-[var(--sea-ink)]">Admin route</p>
                <p className="m-0">Sign in, review pending approvals, inspect reservations, and monitor activity.</p>
              </div>
              <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3">
                <p className="mb-1 font-medium text-[var(--sea-ink)]">Device route</p>
                <p className="m-0">Load a user code and connect CLI approval to an authenticated browser session.</p>
              </div>
              <div className="flex flex-wrap gap-2 pt-1 text-xs font-medium text-[var(--sea-ink)]">
                <span className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-1">GitHub OAuth</span>
                <span className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-1">Cloudflare ingest</span>
                <span className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-1">SSE events</span>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section id="features" className="scroll-mt-24 border-b border-[var(--line)] py-8 sm:py-10">
        <div className="mb-5 flex flex-col gap-2">
          <p className="text-sm font-medium text-[var(--lagoon-deep)]">Features</p>
          <h2 className="text-2xl font-semibold text-[var(--sea-ink)] sm:text-3xl">
            Six practical pieces for the browser-facing control plane.
          </h2>
          <p className="max-w-3xl text-sm leading-7 text-[var(--sea-ink-soft)]">
            The page now uses a stronger utility-style feature grid: bordered cards, simple icons, short copy, and a next action on every item.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {featureCards.map((card) => (
            <article
              key={card.title}
              className="flex h-full flex-col rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm"
            >
              <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface-muted)] text-[var(--lagoon-deep)]">
                {card.icon}
              </div>
              <h3 className="mb-2 text-base font-semibold text-[var(--sea-ink)]">{card.title}</h3>
              <p className="m-0 text-sm leading-7 text-[var(--sea-ink-soft)]">{card.description}</p>
              <a
                href={card.href}
                className="mt-5 inline-flex w-fit items-center gap-1 text-sm font-semibold text-[var(--lagoon-deep)] no-underline"
              >
                {card.cta}
                <span aria-hidden="true">→</span>
              </a>
            </article>
          ))}
        </div>
      </section>

      <section
        id="example"
        className="scroll-mt-24 grid gap-4 border-b border-[var(--line)] py-8 sm:py-10 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
      >
        <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm">
          <p className="text-sm font-medium text-[var(--lagoon-deep)]">Docs</p>
          <h2 className="mt-2 text-2xl font-semibold text-[var(--sea-ink)] sm:text-3xl">
            Start with a request developers can read at a glance.
          </h2>
          <p className="mt-4 text-sm leading-7 text-[var(--sea-ink-soft)]">
            This example shows the reservation call for the app-backed verification path. It is intentionally plain: a concrete request, a visible endpoint, and direct paths into the live routes.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/admin"
              className="inline-flex items-center rounded-md bg-[var(--lagoon-deep)] px-4 py-2.5 text-sm font-semibold text-white no-underline transition hover:bg-[color-mix(in_oklab,var(--lagoon-deep)_88%,black)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lagoon-deep)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
            >
              Open admin route
            </Link>
            <Link
              to="/device"
              search={{ userCode: undefined }}
              className="inline-flex items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--sea-ink)] no-underline transition hover:border-[color-mix(in_oklab,var(--lagoon-deep)_35%,var(--line))] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lagoon-deep)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
            >
              Review device route
            </Link>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-[#0f172a] bg-[#0f172a] shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div>
              <p className="mb-1 font-mono text-sm font-semibold text-white">
                POST /api/verification/email-reservations
              </p>
              <p className="m-0 text-xs uppercase tracking-[0.16em] text-slate-400">
                Reservation request
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              aria-describedby={statusId}
              aria-label="Copy verification reservation request example"
              className="rounded-md border border-white/15 bg-slate-900 px-3 py-2 font-mono text-sm font-medium text-white transition hover:border-[var(--lagoon)] hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lagoon)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f172a]"
            >
              Copy
            </button>
          </div>
          <pre className="m-0 overflow-x-auto px-5 py-5 font-mono text-sm leading-7 text-slate-100">
            <code>{codeSample}</code>
          </pre>
          <p id={statusId} aria-live="polite" className="border-t border-white/10 px-5 py-4 text-sm text-slate-300">
            {copyFeedback}
          </p>
        </section>
      </section>

      <section id="metrics" className="scroll-mt-24 border-b border-[var(--line)] py-8 sm:py-10">
        <div className="mb-5 flex flex-col gap-2">
          <p className="text-sm font-medium text-[var(--lagoon-deep)]">Benefits</p>
          <h2 className="text-2xl font-semibold text-[var(--sea-ink)] sm:text-3xl">
            A stat strip for the core operating model.
          </h2>
        </div>

        <dl className="grid gap-4 lg:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sea-ink-soft)]">
                  {metric.label}
                </dt>
                <span className="rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-2 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--lagoon-deep)]">
                  {metric.badge}
                </span>
              </div>
              <dd className="mt-3 mb-0 font-mono text-lg font-semibold text-[var(--sea-ink)]">
                {metric.value}
              </dd>
              <p className="mt-2 mb-0 text-sm leading-7 text-[var(--sea-ink-soft)]">{metric.detail}</p>
            </div>
          ))}
        </dl>
      </section>

      <section id="process" className="scroll-mt-24 border-b border-[var(--line)] py-8 sm:py-10">
        <div className="mb-5 flex flex-col gap-2">
          <p className="text-sm font-medium text-[var(--lagoon-deep)]">Process</p>
          <h2 className="text-2xl font-semibold text-[var(--sea-ink)] sm:text-3xl">
            A clearer rollout block for the shared shell.
          </h2>
          <p className="max-w-3xl text-sm leading-7 text-[var(--sea-ink-soft)]">
            Process stays in place of pricing so the page remains grounded in supported flows instead of invented commercial claims.
          </p>
        </div>

        <ol className="grid gap-4 lg:grid-cols-3">
          {processSteps.map((step) => (
            <li
              key={step.title}
              className="list-none rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface-muted)] text-[var(--lagoon-deep)]">
                  {step.icon}
                </span>
                <span className="rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-2 py-1 font-mono text-[11px] font-medium text-[var(--lagoon-deep)]">
                  {step.badge}
                </span>
              </div>
              <h3 className="mb-2 text-base font-semibold text-[var(--sea-ink)]">{step.title}</h3>
              <p className="m-0 text-sm leading-7 text-[var(--sea-ink-soft)]">{step.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="start" className="scroll-mt-24 py-8 sm:py-10">
        <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-6 py-8 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-[var(--lagoon-deep)]">Start</p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--sea-ink)] sm:text-3xl">
                Open the real routes and keep the rest of the app functional.
              </h2>
              <p className="mt-4 text-sm leading-7 text-[var(--sea-ink-soft)]">
                Use the shared shell to move directly into admin and device workflows from a landing page that stays neutral, practical, and route-aware.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                to="/admin"
                className="inline-flex items-center rounded-md bg-[var(--lagoon-deep)] px-4 py-2.5 text-sm font-semibold text-white no-underline transition hover:bg-[color-mix(in_oklab,var(--lagoon-deep)_88%,black)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lagoon-deep)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
              >
                Go to admin
              </Link>
              <Link
                to="/device"
                search={{ userCode: undefined }}
                className="inline-flex items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--sea-ink)] no-underline transition hover:border-[color-mix(in_oklab,var(--lagoon-deep)_35%,var(--line))] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lagoon-deep)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
              >
                Review device flow
              </Link>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
