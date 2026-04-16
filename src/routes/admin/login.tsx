import { createFileRoute } from '@tanstack/react-router'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { InfoTooltip } from '#/components/ui/info-tooltip'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/admin/login')({
  component: AdminLoginPage,
})

function getAdminCapabilities() {
  return [
    {
      title: m.admin_login_capability_approve_title(),
      detail: m.admin_login_capability_approve_detail(),
    },
    {
      title: m.admin_login_capability_inspect_title(),
      detail: m.admin_login_capability_inspect_detail(),
    },
    {
      title: m.admin_login_capability_manage_title(),
      detail: m.admin_login_capability_manage_detail(),
    },
  ] as const
}

function AdminLoginPage() {
  const capabilities = getAdminCapabilities()

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:py-14">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_380px]">
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{m.admin_login_badge()}</Badge>
              <Badge>{m.admin_login_github_badge()}</Badge>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <CardTitle className="text-4xl tracking-tight sm:text-5xl">
                  {m.admin_login_title()}
                </CardTitle>
                <InfoTooltip
                  content={m.admin_login_description()}
                  label={m.admin_login_title()}
                  className="mt-1.5"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <a href="/auth/github?redirectTo=/admin">
                {m.admin_login_primary_cta()}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="/device">{m.admin_login_secondary_cta()}</a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>
              {m.admin_login_capabilities_kicker()}
            </CardDescription>
            <CardTitle className="text-xl">
              {m.admin_login_capabilities_title()}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {capabilities.map((item) => (
              <div
                key={item.title}
                className="rounded-lg border bg-muted/30 p-4"
              >
                <div className="flex items-start gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {item.title}
                  </p>
                  <InfoTooltip
                    content={item.detail}
                    label={item.title}
                    className="mt-0.5"
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
