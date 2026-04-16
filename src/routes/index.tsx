import { useId, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ActivityIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  MailIcon,
  MonitorSmartphoneIcon,
  ShieldCheckIcon,
  WorkflowIcon,
} from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";

export const Route = createFileRoute("/")({ component: App });

const featureCards = [
  {
    title: "Browser sign-in",
    description:
      "Authenticate operators in the browser and keep sensitive secrets out of CLI workflows.",
    cta: "Open admin",
    href: "/admin",
    icon: ShieldCheckIcon,
  },
  {
    title: "Device approvals",
    description:
      "Review user codes in a browser flow so long-running automations can ask for approval safely.",
    cta: "Review device route",
    href: "/device",
    icon: MonitorSmartphoneIcon,
  },
  {
    title: "Alias reservations",
    description:
      "Reserve verification mailbox aliases from the app before flows start waiting for events.",
    cta: "Read request example",
    href: "/#example",
    icon: MailIcon,
  },
  {
    title: "Email ingest",
    description:
      "Accept Cloudflare-routed messages and turn inbound mail into verification data for operators.",
    cta: "View benefits",
    href: "/#metrics",
    icon: DatabaseIcon,
  },
  {
    title: "SSE delivery",
    description:
      "Stream verification updates back to waiting clients instead of relying on repeated inbox polling.",
    cta: "See process",
    href: "/#process",
    icon: ActivityIcon,
  },
  {
    title: "Shared shell",
    description:
      "Use one consistent landing page, header, and footer to guide operators into the routes that matter.",
    cta: "Get started",
    href: "/#start",
    icon: WorkflowIcon,
  },
] as const;

const metrics = [
  {
    label: "Auth modes",
    value: "github+device",
    badge: "browser-side",
    detail:
      "Browser admins and CLI sessions share one boundary instead of splitting trust across separate tools.",
  },
  {
    label: "Verification path",
    value: "sse-stream",
    badge: "less polling",
    detail:
      "Waiting clients can react as codes arrive instead of repeatedly checking mailbox state.",
  },
  {
    label: "Email input",
    value: "cloudflare",
    badge: "direct intake",
    detail:
      "Inbound mail becomes app-visible verification events with a clearer route into the control plane.",
  },
] as const;

const processSteps = [
  {
    badge: "01",
    title: "Connect runtime inputs",
    description:
      "Configure the database, GitHub OAuth credentials, and optional webhook secrets for the verification path you plan to use.",
  },
  {
    badge: "02",
    title: "Verify operator routes",
    description:
      "Open the admin and device routes, confirm sign-in works, and inspect the operator-facing flow before automation runs.",
  },
  {
    badge: "03",
    title: "Run the delivery loop",
    description:
      "Reserve aliases, receive ingest events, and stream verification data back to flow clients through the app instead of polling mailboxes directly.",
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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-10 md:py-14">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_380px] lg:items-start">
        <div className="space-y-6">
          <Badge variant="outline">Developer verification control plane</Badge>
          <div className="space-y-4">
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              One practical shell for browser sign-in, device approvals, and
              verification delivery.
            </h1>
            <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
              Codey gives automation teams a shared app shell that points
              directly to the routes and APIs already present in this repo.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/admin">Open admin</Link>
            </Button>
            <Button asChild variant="outline">
              <a href="/#example">View API example</a>
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardDescription>Included routes and workflows</CardDescription>
            <CardTitle className="text-xl">Operator entry points</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <InfoRow
              title="Admin route"
              detail="Sign in, review pending approvals, inspect reservations, and monitor activity."
            />
            <InfoRow
              title="Device route"
              detail="Load a user code and connect CLI approval to an authenticated browser session."
            />
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">GitHub OAuth</Badge>
              <Badge variant="secondary">Cloudflare ingest</Badge>
              <Badge variant="secondary">SSE events</Badge>
            </div>
          </CardContent>
        </Card>
      </section>

      <section id="features" className="scroll-mt-24 space-y-5">
        <SectionHeader
          badge="Features"
          title="Six practical pieces for the browser-facing control plane."
          description="The frontend now uses standard shadcn cards and buttons instead of custom decorative wrappers."
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {featureCards.map((card) => (
            <Card key={card.title} className="h-full">
              <CardHeader className="space-y-4">
                <div className="inline-flex size-10 items-center justify-center rounded-lg border bg-muted">
                  <card.icon className="size-5" />
                </div>
                <div className="space-y-2">
                  <CardTitle className="text-lg">{card.title}</CardTitle>
                  <CardDescription className="text-sm leading-6">
                    {card.description}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Button asChild variant="ghost" className="-ml-3">
                  <a href={card.href}>
                    {card.cta}
                    <ArrowRightIcon className="size-4" />
                  </a>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section
        id="example"
        className="scroll-mt-24 grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
      >
        <Card>
          <CardHeader>
            <CardDescription>Docs</CardDescription>
            <CardTitle className="text-2xl">
              Start with a request developers can read at a glance.
            </CardTitle>
            <CardDescription className="text-sm leading-6">
              This example shows the reservation call for the app-backed
              verification path with direct links into the live routes.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/admin">Open admin route</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/device" search={{ userCode: undefined }}>
                Review device route
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 border-b">
            <div className="space-y-1">
              <CardTitle className="font-mono text-base">
                POST /api/verification/email-reservations
              </CardTitle>
              <CardDescription>Reservation request</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              aria-describedby={statusId}
            >
              Copy
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 p-0">
            <pre className="overflow-x-auto bg-muted/50 p-6 text-sm leading-7">
              <code>{codeSample}</code>
            </pre>
            <p
              id={statusId}
              aria-live="polite"
              className="px-6 pb-6 text-sm text-muted-foreground"
            >
              {copyFeedback}
            </p>
          </CardContent>
        </Card>
      </section>

      <section id="metrics" className="scroll-mt-24 space-y-5">
        <SectionHeader
          badge="Benefits"
          title="A stat strip for the core operating model."
        />

        <div className="grid gap-4 lg:grid-cols-3">
          {metrics.map((metric) => (
            <Card key={metric.label}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardDescription className="text-xs font-medium tracking-[0.14em] uppercase">
                    {metric.label}
                  </CardDescription>
                  <Badge variant="secondary">{metric.badge}</Badge>
                </div>
                <CardTitle className="font-mono text-2xl">{metric.value}</CardTitle>
                <CardDescription className="text-sm leading-6">
                  {metric.detail}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section id="process" className="scroll-mt-24 space-y-5">
        <SectionHeader
          badge="Process"
          title="A clearer rollout block for the shared shell."
          description="Process stays in place of pricing so the page remains grounded in supported flows instead of invented commercial claims."
        />

        <div className="grid gap-4 lg:grid-cols-3">
          {processSteps.map((step) => (
            <Card key={step.title}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex size-10 items-center justify-center rounded-lg border bg-muted">
                    <CheckCircle2Icon className="size-5" />
                  </div>
                  <Badge variant="outline">{step.badge}</Badge>
                </div>
                <CardTitle className="text-lg">{step.title}</CardTitle>
                <CardDescription className="text-sm leading-6">
                  {step.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section id="start" className="scroll-mt-24">
        <Card>
          <CardHeader>
            <CardDescription>Start</CardDescription>
            <CardTitle className="text-2xl">
              Open the real routes and keep the rest of the app functional.
            </CardTitle>
            <CardDescription className="max-w-2xl text-sm leading-6">
              Use the shared shell to move directly into admin and device
              workflows from a standard, component-based landing page.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/admin">Go to admin</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/device" search={{ userCode: undefined }}>
                Review device flow
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function SectionHeader(props: {
  badge: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-2">
      <Badge variant="outline">{props.badge}</Badge>
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {props.title}
      </h2>
      {props.description ? (
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {props.description}
        </p>
      ) : null}
    </div>
  );
}

function InfoRow(props: { title: string; detail: string }) {
  return (
    <div className="space-y-1 rounded-lg border bg-muted/30 p-4">
      <p className="text-sm font-medium text-foreground">{props.title}</p>
      <p className="text-sm leading-6 text-muted-foreground">{props.detail}</p>
    </div>
  );
}
