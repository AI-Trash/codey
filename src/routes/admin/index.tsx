import type { ReactNode } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import {
  AdminMetricCard,
  AdminPageHeader,
  EmptyState,
  StatusBadge,
  formatAdminDate,
  getStatusTone,
} from '#/components/admin/layout'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Textarea } from '#/components/ui/textarea'

const loadDashboard = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ getRequest }, { requireAdmin }, { listAdminDashboardData }] =
    await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../lib/server/auth'),
      import('../../lib/server/admin'),
    ])
  const request = getRequest()
  let sessionUser
  try {
    sessionUser = await requireAdmin(request)
  } catch {
    return { authorized: false as const }
  }

  const data = await listAdminDashboardData()
  return {
    authorized: true as const,
    user: {
      name: sessionUser.user.name,
      email: sessionUser.user.email,
      githubLogin: sessionUser.user.githubLogin,
      role: sessionUser.user.role,
      avatarUrl: sessionUser.user.avatarUrl,
    },
    ...data,
  }
})

export const Route = createFileRoute('/admin/')({
  loader: async () => loadDashboard(),
  component: AdminPage,
})

type VerificationData = {
  codes?: Array<{
    id: string
    code: string
    source: string
    receivedAt: string | Date
    reservation: {
      email: string
    }
  }>
  reservations?: Array<{
    id: string
    email: string
    expiresAt: string | Date
  }>
  emails?: Array<{
    id: string
    recipient: string
    subject: string | null
    verificationCode: string | null
    receivedAt?: string | Date
  }>
  activity?: Array<{
    id: string
    title?: string | null
    detail?: string | null
    status?: string | null
    createdAt?: string | Date
  }>
}

type DeviceChallenge = {
  id: string
  deviceCode: string
  userCode: string
  status: string
  flowType: string | null
  cliName: string | null
  target?: string | null
  createdAt?: string | Date
  updatedAt?: string | Date
}

type AdminNotification = {
  id: string
  title: string
  body: string
  flowType: string | null
  target: string | null
  createdAt?: string | Date
}

type IdentitySummary = {
  id: string
  label: string
  provider?: string | null
  account?: string | null
  flowCount?: number | null
  lastSeenAt?: string | Date | null
  status?: string | null
}

type ConfigStatusItem = {
  id?: string
  key?: string
  label: string
  description?: string | null
  status: string
  detail?: string | null
}

type FlowAppRequest = {
  id: string
  appName: string
  flowType?: string | null
  requestedBy?: string | null
  requestedIdentity?: string | null
  notes?: string | null
  status?: string | null
  createdAt?: string | Date
}

function AdminPage() {
  const data = Route.useLoaderData()
  if (!data.authorized) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardDescription>Admin</CardDescription>
          <CardTitle>Admin sign-in required</CardTitle>
          <CardDescription>
            Sign in with GitHub to review operational data, manage apps, and
            approve device sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/admin/login">Go to admin login</a>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const identitySummaries = getIdentitySummaries(data)
  const configStatuses = getConfigStatuses(data)
  const flowAppRequests = getFlowAppRequests(data)
  const verificationActivity = getVerificationActivity(data.verification)
  const deviceChallenges = data.deviceChallenges as DeviceChallenge[]
  const notifications = data.notifications as AdminNotification[]

  const pendingCount = deviceChallenges.filter(
    (challenge) => challenge.status === 'PENDING',
  ).length

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin"
        title="Operations"
        description={
          <>
            Signed in as{' '}
            <strong className="text-foreground">
              {data.user.githubLogin ||
                data.user.email ||
                data.user.name ||
                'unknown user'}
            </strong>
            . The admin console is now organized around high-density tables so
            device sessions, verification activity, identities, and request
            queues stay visible.
          </>
        }
        meta={
          <StatusBadge
            value={summarizeConfigState(configStatuses)}
            tone={getConfigTone(configStatuses)}
          />
        }
        actions={
          <>
            <Button asChild variant="outline">
              <a href="/admin/apps">OAuth apps</a>
            </Button>
            <Button asChild variant="outline">
              <a href="/device">Device route</a>
            </Button>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <AdminMetricCard
          label="Identities"
          value={String(identitySummaries.length)}
          description="Saved identities currently available from the local store."
        />
        <AdminMetricCard
          label="Pending approvals"
          value={String(pendingCount)}
          description="Device handshakes waiting for an operator decision."
        />
        <AdminMetricCard
          label="Verification events"
          value={String(verificationActivity.length)}
          description="Recent verification activity available for review."
        />
        <AdminMetricCard
          label="Notifications"
          value={String(notifications.length)}
          description="Recent admin notifications stored for clients."
        />
        <AdminMetricCard
          label="Flow requests"
          value={String(flowAppRequests.length)}
          description="App onboarding requests currently in the queue."
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <ActionCard
          eyebrow="Manual verification code"
          title="Inject verification code"
          description="Add a known verification code directly when you need to unblock a flow."
        >
          <form
            method="post"
            action="/api/admin/verification-codes"
            className="grid gap-3"
          >
            <LabeledInput label="Target email">
              <Input name="email" placeholder="target@example.com" />
            </LabeledInput>
            <LabeledInput label="6-digit code">
              <Input name="code" placeholder="123456" inputMode="numeric" />
            </LabeledInput>
            <Button type="submit">Inject code</Button>
          </form>
        </ActionCard>

        <ActionCard
          eyebrow="Admin notification"
          title="Create notification"
          description="Send a browser-side message to operators or attached clients."
        >
          <form
            method="post"
            action="/api/admin/notifications"
            className="grid gap-3"
          >
            <LabeledInput label="Title">
              <Input name="title" placeholder="Title" />
            </LabeledInput>
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledInput label="Flow type">
                <Input name="flowType" placeholder="codex-oauth" />
              </LabeledInput>
              <LabeledInput label="Target">
                <Input name="target" placeholder="all or octocat" />
              </LabeledInput>
            </div>
            <LabeledInput label="Message">
              <Textarea
                name="body"
                placeholder="Message"
                className="min-h-28"
              />
            </LabeledInput>
            <Button type="submit">Create notification</Button>
          </form>
        </ActionCard>

        <ActionCard
          eyebrow="GitHub Actions flow apps"
          title="Submit flow app request"
          description="Queue support requests for auto-add-account coverage in flow apps."
        >
          <form
            method="post"
            action="/api/admin/flow-app-requests"
            className="grid gap-3"
          >
            <LabeledInput label="App name">
              <Input name="appName" placeholder="GitHub Actions app name" />
            </LabeledInput>
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledInput label="Flow type">
                <Input name="flowType" placeholder="chatgpt-register" />
              </LabeledInput>
              <LabeledInput label="Requested identity">
                <Input name="requestedIdentity" placeholder="octocat" />
              </LabeledInput>
            </div>
            <LabeledInput label="Notes">
              <Textarea
                name="notes"
                placeholder="Why this app needs auto-add-account support"
                className="min-h-28"
              />
            </LabeledInput>
            <Button type="submit">Submit request</Button>
          </form>
        </ActionCard>
      </section>

      <TableCard
        eyebrow="Config status"
        title="Configuration status"
        description="Readiness across OAuth, identity storage, signing keys, and flow support."
      >
        {configStatuses.length > 0 ? (
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Capability</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {configStatuses.map((item, index) => (
                <TableRow key={item.id ?? item.key ?? `${item.label}-${index}`}>
                  <TableCell className="align-top">
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">
                        {item.label}
                      </div>
                      {item.description ? (
                        <p className="max-w-[280px] text-sm leading-6 text-muted-foreground">
                          {item.description}
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <StatusBadge value={item.status} />
                  </TableCell>
                  <TableCell className="whitespace-normal align-top text-sm leading-6 text-muted-foreground">
                    {item.detail || 'Waiting for backend status detail.'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title="No configuration data"
            description="Configuration readiness is not available yet."
          />
        )}
      </TableCard>

      <TableCard
        eyebrow="Identity summaries"
        title="Saved identities"
        description="Review local store coverage and edit label or managed status inline."
      >
        {identitySummaries.length > 0 ? (
          <Table className="min-w-[1200px]">
            <TableHeader>
              <TableRow>
                <TableHead>Identity</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Flows</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {identitySummaries.map((summary) => (
                <TableRow key={summary.id}>
                  <TableCell className="align-top">
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">
                        {summary.label}
                      </div>
                      <code>{summary.id}</code>
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">
                    {summary.account || 'Not linked yet'}
                  </TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">
                    {summary.provider || 'Saved identity'}
                  </TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">
                    {summary.flowCount != null
                      ? `${summary.flowCount} flows`
                      : 'Pending'}
                  </TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">
                    {formatAdminDate(summary.lastSeenAt) || 'Not captured yet'}
                  </TableCell>
                  <TableCell className="align-top">
                    <StatusBadge value={summary.status || 'available'} />
                  </TableCell>
                  <TableCell className="align-top">
                    <form
                      method="post"
                      action="/api/admin/identities"
                      className="grid min-w-[320px] gap-2 md:grid-cols-[minmax(0,1fr)_160px_auto]"
                    >
                      <input
                        type="hidden"
                        name="identityId"
                        value={summary.id}
                      />
                      <input
                        type="hidden"
                        name="email"
                        value={summary.account || summary.label}
                      />
                      <Input
                        name="label"
                        defaultValue={
                          summary.label !== summary.account ? summary.label : ''
                        }
                        placeholder={summary.account || 'Identity label'}
                        className="h-8"
                      />
                      <NativeSelect
                        name="status"
                        defaultValue={toManagedStatus(summary.status)}
                        size="sm"
                        className="w-full min-w-[140px]"
                      >
                        <NativeSelectOption value="ACTIVE">
                          Active
                        </NativeSelectOption>
                        <NativeSelectOption value="REVIEW">
                          Needs review
                        </NativeSelectOption>
                        <NativeSelectOption value="ARCHIVED">
                          Archived
                        </NativeSelectOption>
                      </NativeSelect>
                      <Button type="submit" size="sm" variant="outline">
                        Save
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title="No saved identities"
            description="Capture an identity through the flows package and it will appear here."
          />
        )}
      </TableCard>

      <TableCard
        eyebrow="Device flow management"
        title="Device approvals"
        description="Approve or deny pending device sessions without losing the surrounding queue context."
      >
        {deviceChallenges.length > 0 ? (
          <Table className="min-w-[1040px]">
            <TableHeader>
              <TableRow>
                <TableHead>User code</TableHead>
                <TableHead>Flow</TableHead>
                <TableHead>CLI client</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deviceChallenges.map((challenge) => (
                <TableRow key={challenge.id}>
                  <TableCell className="align-top">
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">
                        {challenge.userCode}
                      </div>
                      <code>{challenge.deviceCode}</code>
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">
                    {challenge.flowType || 'CLI device flow'}
                  </TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">
                    {challenge.cliName || 'Unknown client'}
                  </TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">
                    {challenge.target || 'No explicit target'}
                  </TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">
                    {formatAdminDate(
                      challenge.updatedAt || challenge.createdAt,
                    ) || 'Awaiting timestamp'}
                  </TableCell>
                  <TableCell className="align-top">
                    <StatusBadge
                      value={challenge.status}
                      tone={getChallengeTone(challenge.status)}
                    />
                  </TableCell>
                  <TableCell className="align-top text-right">
                    {challenge.status === 'PENDING' ? (
                      <div className="flex justify-end gap-2">
                        <form
                          method="post"
                          action={`/api/admin/device/${challenge.deviceCode}/approve`}
                        >
                          <Button type="submit" size="sm">
                            Approve
                          </Button>
                        </form>
                        <form
                          method="post"
                          action={`/api/admin/device/${challenge.deviceCode}/deny`}
                        >
                          <Button type="submit" size="sm" variant="outline">
                            Deny
                          </Button>
                        </form>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Resolved
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title="No device challenges"
            description="Pending CLI approvals will appear here."
          />
        )}
      </TableCard>

      <TableCard
        eyebrow="Verification activity"
        title="Recent verification activity"
        description="Latest verification events, parsed codes, and inbound mail state."
      >
        {verificationActivity.length > 0 ? (
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {verificationActivity.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="align-top">
                    <div className="font-medium text-foreground">
                      {item.title}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[560px] whitespace-normal align-top text-sm leading-6 text-muted-foreground">
                    {item.detail}
                  </TableCell>
                  <TableCell className="align-top">
                    <StatusBadge value={item.status} />
                  </TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">
                    {formatAdminDate(item.createdAt) || 'Timestamp unavailable'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title="No verification activity"
            description="Verification events will populate here as codes and emails arrive."
          />
        )}
      </TableCard>

      <section className="grid gap-4 2xl:grid-cols-2">
        <TableCard
          eyebrow="Recent notifications"
          title="Stored notifications"
          description="Messages currently available to operators or subscribed clients."
        >
          {notifications.length > 0 ? (
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Flow type</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notifications.map((notification) => (
                  <TableRow key={notification.id}>
                    <TableCell className="align-top">
                      <div className="font-medium text-foreground">
                        {notification.title}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {notification.target || 'all clients'}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {notification.flowType || 'General'}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatAdminDate(notification.createdAt) ||
                        'Timestamp unavailable'}
                    </TableCell>
                    <TableCell className="max-w-[380px] whitespace-normal align-top text-sm leading-6 text-muted-foreground">
                      {notification.body}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title="No notifications"
              description="Saved notifications will appear here after creation."
            />
          )}
        </TableCard>

        <TableCard
          eyebrow="Request queue"
          title="Flow app requests"
          description="Queued requests for app coverage and managed identity support."
        >
          {flowAppRequests.length > 0 ? (
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead>App</TableHead>
                  <TableHead>Flow type</TableHead>
                  <TableHead>Requested identity</TableHead>
                  <TableHead>Requested by</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flowAppRequests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell className="align-top">
                      <div className="font-medium text-foreground">
                        {request.appName}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {request.flowType || 'Flow app'}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {request.requestedIdentity || 'No identity attached yet'}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {request.requestedBy || 'Unknown requester'}
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge value={request.status || 'pending'} />
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatAdminDate(request.createdAt) ||
                        'Awaiting timestamp'}
                    </TableCell>
                    <TableCell className="max-w-[320px] whitespace-normal align-top text-sm leading-6 text-muted-foreground">
                      {request.notes || 'No notes provided.'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title="No queued requests"
              description="New flow app requests will show up here after submission."
            />
          )}
        </TableCard>
      </section>
    </>
  )
}

function TableCard(props: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{props.eyebrow}</CardDescription>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  )
}

function ActionCard(props: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{props.eyebrow}</CardDescription>
        <CardTitle className="text-lg">{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  )
}

function LabeledInput(props: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-foreground">{props.label}</span>
      {props.children}
    </label>
  )
}

function getIdentitySummaries(data: Record<string, unknown>) {
  const candidate = data.identitySummaries
  return Array.isArray(candidate) ? (candidate as IdentitySummary[]) : []
}

function getConfigStatuses(data: Record<string, unknown>) {
  const candidate = data.configStatus
  return Array.isArray(candidate) ? (candidate as ConfigStatusItem[]) : []
}

function getFlowAppRequests(data: Record<string, unknown>) {
  const candidate = data.flowAppRequests
  return Array.isArray(candidate) ? (candidate as FlowAppRequest[]) : []
}

function getVerificationActivity(verification: VerificationData) {
  if (Array.isArray(verification.activity)) {
    return verification.activity.map((item) => ({
      id: item.id,
      title: item.title || 'Verification event',
      detail: item.detail || 'Recent verification activity was recorded.',
      status: item.status || 'active',
      createdAt: item.createdAt,
    }))
  }

  const codeEvents = (verification.codes ?? []).slice(0, 3).map((code) => ({
    id: `code-${code.id}`,
    title: code.reservation.email,
    detail: `Code ${code.code} arrived from ${code.source}.`,
    status: 'received',
    createdAt: code.receivedAt,
  }))

  const emailEvents = (verification.emails ?? []).slice(0, 3).map((email) => ({
    id: `email-${email.id}`,
    title: email.recipient,
    detail: email.subject || 'Inbound verification email received.',
    status: email.verificationCode ? 'parsed' : 'received',
    createdAt: email.receivedAt,
  }))

  return [...codeEvents, ...emailEvents]
}

function getConfigTone(items: ConfigStatusItem[]) {
  if (items.some((item) => getStatusTone(item.status) === 'danger')) {
    return 'danger' as const
  }

  if (items.some((item) => getStatusTone(item.status) === 'warning')) {
    return 'warning' as const
  }

  return items.length > 0 ? ('good' as const) : ('warning' as const)
}

function summarizeConfigState(items: ConfigStatusItem[]) {
  if (items.length === 0) {
    return 'Waiting for status'
  }

  if (items.every((item) => getStatusTone(item.status) === 'good')) {
    return 'All systems ready'
  }

  if (items.some((item) => getStatusTone(item.status) === 'danger')) {
    return 'Action required'
  }

  return 'Needs review'
}

function getChallengeTone(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === 'pending') {
    return 'warning' as const
  }

  if (
    normalized === 'approved' ||
    normalized === 'consumed' ||
    normalized === 'complete'
  ) {
    return 'good' as const
  }

  return 'danger' as const
}

function toManagedStatus(status?: string | null) {
  const normalized = status?.toLowerCase()
  if (normalized === 'archived') {
    return 'ARCHIVED'
  }

  if (normalized === 'review' || normalized === 'pending') {
    return 'REVIEW'
  }

  return 'ACTIVE'
}
