import { useEffect, useState, type ReactNode } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { StatusBadge } from '#/components/admin/layout'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { m } from '#/paraglide/messages'

const loadChallenge = createServerFn({ method: 'GET' })
  .inputValidator((data: { userCode?: string }) => data)
  .handler(async ({ data }) => {
    const { getDeviceChallengeByUserCode } = await import(
      '../lib/server/device-auth'
    )
    if (!data.userCode) {
      return null
    }

    return getDeviceChallengeByUserCode(data.userCode)
  })

export const Route = createFileRoute('/device')({
  validateSearch: (search: Record<string, unknown>) => ({
    userCode: typeof search.userCode === 'string' ? search.userCode : undefined,
  }),
  loaderDeps: ({ search: { userCode } }) => ({ userCode }),
  loader: ({ deps }) => loadChallenge({ data: { userCode: deps.userCode } }),
  component: DevicePage,
})

function normalizeUserCode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (compact.length <= 4) {
    return compact
  }

  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}`
}

function DevicePage() {
  const challenge = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  const [userCode, setUserCode] = useState(search.userCode || '')

  useEffect(() => {
    setUserCode(search.userCode || '')
  }, [search.userCode])

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 md:py-14">
      <Card>
        <CardHeader>
          <CardDescription>{m.device_kicker()}</CardDescription>
          <CardTitle className="text-3xl">{m.device_title()}</CardTitle>
          <CardDescription className="max-w-2xl text-sm leading-6">
            {m.device_description()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form
            className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              const nextUserCode = normalizeUserCode(userCode)
              navigate({
                to: '/device',
                search: {
                  userCode: nextUserCode || undefined,
                },
              })
            }}
          >
            <label className="grid gap-2">
              <span className="text-sm font-medium text-foreground">
                {m.device_user_code_label()}
              </span>
              <Input
                value={userCode}
                onChange={(event) => {
                  setUserCode(normalizeUserCode(event.target.value))
                }}
                placeholder="ABCD-EFGH"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={9}
                className="uppercase"
              />
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <Button type="submit">{m.device_inspect_button()}</Button>
              {userCode ? (
                <Button asChild variant="outline">
                  <Link to="/device" search={{ userCode: undefined }}>
                    {m.device_clear_button()}
                  </Link>
                </Button>
              ) : null}
            </div>
          </form>

          {challenge ? (
            <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
              <Info
                label={m.device_info_user_code()}
                value={challenge.userCode}
                strong
              />
              <Info
                label={m.device_info_status()}
                value={<StatusBadge value={challenge.status} />}
              />
              <Info
                label={m.device_info_flow()}
                value={challenge.flowType || m.device_value_not_available()}
              />
              <Info
                label={m.device_info_cli()}
                value={challenge.cliName || m.device_value_not_available()}
              />
              <div className="sm:col-span-2">
                <p className="text-sm leading-6 text-muted-foreground">
                  {m.device_challenge_hint_prefix()}{' '}
                  <a
                    className="font-medium text-foreground underline underline-offset-4"
                    href="/admin"
                  >
                    {m.device_challenge_hint_link()}
                  </a>
                  .
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <p className="leading-6">{m.device_empty_first()}</p>
              <p className="leading-6">
                {m.device_empty_second_prefix()}{' '}
                <a
                  className="font-medium text-foreground underline underline-offset-4"
                  href="/admin"
                >
                  {m.device_empty_second_link()}
                </a>{' '}
                {m.device_empty_second_suffix()}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

function Info(props: {
  label: string
  value: ReactNode
  strong?: boolean
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {props.label}
      </p>
      <div
        className={props.strong ? 'font-semibold text-foreground' : 'text-foreground'}
      >
        {props.value}
      </div>
    </div>
  )
}
