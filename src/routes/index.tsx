import { useId, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ActivityIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  MailIcon,
  MonitorSmartphoneIcon,
  ShieldCheckIcon,
  WorkflowIcon,
} from 'lucide-react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/')({ component: App })

const codeSample = `curl -X POST http://localhost:3000/api/verification/email-reservations \\
  -H "content-type: application/json" \\
  -d '{
    "flowType": "chatgpt-register",
    "target": "octocat",
    "ttlMs": 180000
  }'`

function getFeatureCards() {
  return [
    {
      title: m.home_feature_browser_sign_in_title(),
      description: m.home_feature_browser_sign_in_description(),
      cta: m.home_feature_browser_sign_in_cta(),
      href: '/admin',
      icon: ShieldCheckIcon,
    },
    {
      title: m.home_feature_device_approvals_title(),
      description: m.home_feature_device_approvals_description(),
      cta: m.home_feature_device_approvals_cta(),
      href: '/device',
      icon: MonitorSmartphoneIcon,
    },
    {
      title: m.home_feature_alias_reservations_title(),
      description: m.home_feature_alias_reservations_description(),
      cta: m.home_feature_alias_reservations_cta(),
      href: '/#example',
      icon: MailIcon,
    },
    {
      title: m.home_feature_email_ingest_title(),
      description: m.home_feature_email_ingest_description(),
      cta: m.home_feature_email_ingest_cta(),
      href: '/#metrics',
      icon: DatabaseIcon,
    },
    {
      title: m.home_feature_sse_delivery_title(),
      description: m.home_feature_sse_delivery_description(),
      cta: m.home_feature_sse_delivery_cta(),
      href: '/#process',
      icon: ActivityIcon,
    },
    {
      title: m.home_feature_shared_shell_title(),
      description: m.home_feature_shared_shell_description(),
      cta: m.home_feature_shared_shell_cta(),
      href: '/#start',
      icon: WorkflowIcon,
    },
  ] as const
}

function getMetrics() {
  return [
    {
      label: m.home_metric_auth_modes_label(),
      value: 'github+device',
      badge: m.home_metric_auth_modes_badge(),
      detail: m.home_metric_auth_modes_detail(),
    },
    {
      label: m.home_metric_verification_path_label(),
      value: 'sse-stream',
      badge: m.home_metric_verification_path_badge(),
      detail: m.home_metric_verification_path_detail(),
    },
    {
      label: m.home_metric_email_input_label(),
      value: 'cloudflare',
      badge: m.home_metric_email_input_badge(),
      detail: m.home_metric_email_input_detail(),
    },
  ] as const
}

function getProcessSteps() {
  return [
    {
      badge: '01',
      title: m.home_process_step_1_title(),
      description: m.home_process_step_1_description(),
    },
    {
      badge: '02',
      title: m.home_process_step_2_title(),
      description: m.home_process_step_2_description(),
    },
    {
      badge: '03',
      title: m.home_process_step_3_title(),
      description: m.home_process_step_3_description(),
    },
  ] as const
}

function App() {
  const statusId = useId()
  const [copyFeedback, setCopyFeedback] = useState(() => m.home_copy_ready())
  const featureCards = getFeatureCards()
  const metrics = getMetrics()
  const processSteps = getProcessSteps()

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(codeSample)
      setCopyFeedback(m.home_copy_success())
    } catch {
      setCopyFeedback(m.home_copy_unavailable())
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-10 md:py-14">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_380px] lg:items-start">
        <div className="space-y-6">
          <Badge variant="outline">{m.home_badge()}</Badge>
          <div className="space-y-4">
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              {m.home_title()}
            </h1>
            <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
              {m.home_description()}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/admin">{m.home_primary_cta()}</Link>
            </Button>
            <Button asChild variant="outline">
              <a href="/#example">{m.home_secondary_cta()}</a>
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardDescription>{m.home_entry_points_kicker()}</CardDescription>
            <CardTitle className="text-xl">
              {m.home_entry_points_title()}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <InfoRow
              title={m.home_entry_admin_title()}
              detail={m.home_entry_admin_detail()}
            />
            <InfoRow
              title={m.home_entry_device_title()}
              detail={m.home_entry_device_detail()}
            />
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{m.home_entry_badge_github()}</Badge>
              <Badge variant="secondary">
                {m.home_entry_badge_cloudflare()}
              </Badge>
              <Badge variant="secondary">{m.home_entry_badge_sse()}</Badge>
            </div>
          </CardContent>
        </Card>
      </section>

      <section id="features" className="scroll-mt-24 space-y-5">
        <SectionHeader
          badge={m.home_features_badge()}
          title={m.home_features_title()}
          description={m.home_features_description()}
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
            <CardDescription>{m.home_example_kicker()}</CardDescription>
            <CardTitle className="text-2xl">
              {m.home_example_title()}
            </CardTitle>
            <CardDescription className="text-sm leading-6">
              {m.home_example_description()}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/admin">{m.home_example_primary_cta()}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/device" search={{ userCode: undefined }}>
                {m.home_example_secondary_cta()}
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
              <CardDescription>{m.home_example_request_label()}</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              aria-describedby={statusId}
            >
              {m.home_copy_button()}
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
          badge={m.home_benefits_badge()}
          title={m.home_benefits_title()}
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
                <CardTitle className="font-mono text-2xl">
                  {metric.value}
                </CardTitle>
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
          badge={m.home_process_badge()}
          title={m.home_process_title()}
          description={m.home_process_description()}
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
            <CardDescription>{m.home_start_kicker()}</CardDescription>
            <CardTitle className="text-2xl">{m.home_start_title()}</CardTitle>
            <CardDescription className="max-w-2xl text-sm leading-6">
              {m.home_start_description()}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/admin">{m.home_start_primary_cta()}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/device" search={{ userCode: undefined }}>
                {m.home_start_secondary_cta()}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}

function SectionHeader(props: {
  badge: string
  title: string
  description?: string
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
  )
}

function InfoRow(props: { title: string; detail: string }) {
  return (
    <div className="space-y-1 rounded-lg border bg-muted/30 p-4">
      <p className="text-sm font-medium text-foreground">{props.title}</p>
      <p className="text-sm leading-6 text-muted-foreground">{props.detail}</p>
    </div>
  )
}
