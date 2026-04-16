import { startTransition, useDeferredValue, useEffect, useState } from 'react'
import { MailIcon, SearchIcon, WifiIcon, WifiOffIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { ScrollArea } from '#/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import {
  EmptyState,
  StatusBadge,
  formatAdminDate,
} from '#/components/admin/layout'

export type AdminMailInboxEmail = {
  id: string
  cursor: string
  messageId: string | null
  recipient: string
  subject: string | null
  textBody: string | null
  htmlBody: string | null
  rawPayload: string | null
  receivedAt: string
  createdAt: string
  reservationId: string | null
  reservationEmail: string | null
  reservationMailbox: string | null
  reservationExpiresAt: string | null
  latestCode: string | null
  latestCodeSource: string | null
  latestCodeReceivedAt: string | null
}

type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'

export function AdminMailInbox(props: {
  initialEmails: AdminMailInboxEmail[]
  initialCursor: string
}) {
  const [emails, setEmails] = useState(props.initialEmails)
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(
    props.initialEmails[0]?.id ?? null,
  )
  const [query, setQuery] = useState('')
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting')
  const [streamError, setStreamError] = useState<string | null>(null)
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    setEmails(props.initialEmails)
    setSelectedEmailId((current) => {
      if (current && props.initialEmails.some((email) => email.id === current)) {
        return current
      }

      return props.initialEmails[0]?.id ?? null
    })
  }, [props.initialEmails])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (typeof window.EventSource === 'undefined') {
      setLiveStatus('offline')
      setStreamError('Current browser does not support SSE live delivery.')
      return
    }

    const eventSource = new window.EventSource(
      `/api/admin/emails/events?after=${encodeURIComponent(props.initialCursor)}`,
    )

    const handleEmail = (event: Event) => {
      try {
        const nextEmail = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as AdminMailInboxEmail

        startTransition(() => {
          setEmails((current) => mergeIncomingEmail(current, nextEmail))
          setSelectedEmailId((current) => current || nextEmail.id)
        })
        setLiveStatus('live')
        setStreamError(null)
      } catch {
        setStreamError('A live email update arrived, but could not be read.')
      }
    }

    eventSource.onopen = () => {
      setLiveStatus('live')
      setStreamError(null)
    }

    eventSource.onerror = () => {
      setLiveStatus('reconnecting')
    }

    eventSource.addEventListener('email', handleEmail)
    eventSource.addEventListener('timeout', () => {
      setLiveStatus('reconnecting')
    })

    return () => {
      eventSource.close()
    }
  }, [props.initialCursor])

  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const filteredEmails = normalizedQuery
    ? emails.filter((email) => emailMatchesQuery(email, normalizedQuery))
    : emails

  const activeEmail =
    filteredEmails.find((email) => email.id === selectedEmailId) ||
    filteredEmails[0] ||
    emails.find((email) => email.id === selectedEmailId) ||
    emails[0] ||
    null

  const codeReadyCount = emails.filter((email) => email.latestCode).length
  const textCapturedCount = emails.filter((email) => email.textBody).length

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_420px]">
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <CardDescription>Mailbox stream</CardDescription>
              <CardTitle>Inbound verification mail</CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6">
                New emails appear automatically after delivery, and the
                dedicated table keeps the full subject and message preview out
                of the crowded dashboard.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                value={getLiveStatusLabel(liveStatus)}
                tone={getLiveStatusTone(liveStatus)}
              />
              <Badge variant="outline">{emails.length} loaded</Badge>
              <Badge variant="outline">{codeReadyCount} codes visible</Badge>
              <Badge variant="outline">{textCapturedCount} text bodies</Badge>
            </div>
          </div>

          <label className="relative block">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
              }}
              placeholder="Search recipient, subject, body preview, or code"
              className="pl-9"
            />
          </label>

          {streamError ? (
            <Alert>
              {liveStatus === 'offline' ? <WifiOffIcon /> : <WifiIcon />}
              <AlertTitle>Live updates need attention</AlertTitle>
              <AlertDescription>{streamError}</AlertDescription>
            </Alert>
          ) : null}
        </CardHeader>

        <CardContent>
          {filteredEmails.length > 0 ? (
            <Table className="min-w-[1180px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Preview</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmails.map((email) => (
                  <TableRow
                    key={email.id}
                    data-state={activeEmail?.id === email.id ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedEmailId(email.id)
                    }}
                  >
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatAdminDate(email.receivedAt) || 'Timestamp unavailable'}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="space-y-1">
                        <div className="font-medium text-foreground">
                          {email.recipient}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {email.reservationMailbox || 'App-managed alias'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[260px] whitespace-normal align-top">
                      <div className="font-medium text-foreground">
                        {email.subject || 'No subject captured'}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge
                        value={email.latestCode ? 'code ready' : 'received'}
                        tone={email.latestCode ? 'good' : 'warning'}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      {email.latestCode ? (
                        <code>{email.latestCode}</code>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          Pending
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[380px] whitespace-normal align-top text-sm leading-6 text-muted-foreground">
                      {getEmailPreview(email)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title={emails.length ? 'No matching emails' : 'No inbound emails yet'}
              description={
                emails.length
                  ? 'Try a different search term to bring messages back into view.'
                  : 'Inbound verification email will appear here as soon as it is ingested.'
              }
            />
          )}
        </CardContent>
      </Card>

      <Card className="xl:sticky xl:top-[5.5rem]">
        <CardHeader className="gap-3">
          <CardDescription>Message details</CardDescription>
          <CardTitle className="flex items-center gap-2 text-xl">
            <MailIcon className="size-5" />
            {activeEmail?.subject || 'Select an email'}
          </CardTitle>
          <CardDescription>
            Full message content stays visible here while you keep browsing the
            inbox table.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {activeEmail ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusBadge
                  value={activeEmail.latestCode ? 'code ready' : 'received'}
                  tone={activeEmail.latestCode ? 'good' : 'warning'}
                />
                {activeEmail.latestCode ? (
                  <Badge variant="outline">
                    {activeEmail.latestCodeSource || 'code'} ·{' '}
                    {activeEmail.latestCode}
                  </Badge>
                ) : null}
              </div>

              <dl className="grid gap-3 text-sm">
                <DetailItem label="Recipient" value={activeEmail.recipient} code />
                <DetailItem
                  label="Received"
                  value={
                    formatAdminDate(activeEmail.receivedAt) ||
                    'Timestamp unavailable'
                  }
                />
                <DetailItem
                  label="Message ID"
                  value={activeEmail.messageId || 'Not captured'}
                  code
                />
                <DetailItem
                  label="Mailbox"
                  value={activeEmail.reservationMailbox || 'Not configured'}
                  code
                />
                <DetailItem
                  label="Reservation"
                  value={activeEmail.reservationEmail || 'Not linked'}
                  code
                />
                <DetailItem
                  label="Expires"
                  value={
                    formatAdminDate(activeEmail.reservationExpiresAt) ||
                    'Not available'
                  }
                />
              </dl>

              <Tabs
                key={activeEmail.id}
                defaultValue={getInitialContentTab(activeEmail)}
                className="gap-3"
              >
                <TabsList variant="line" className="w-full justify-start">
                  <TabsTrigger value="text">Text</TabsTrigger>
                  <TabsTrigger value="html">HTML source</TabsTrigger>
                  <TabsTrigger value="raw">Raw payload</TabsTrigger>
                </TabsList>

                <TabsContent value="text">
                  <EmailContentPanel value={activeEmail.textBody} />
                </TabsContent>
                <TabsContent value="html">
                  <EmailContentPanel value={activeEmail.htmlBody} />
                </TabsContent>
                <TabsContent value="raw">
                  <EmailContentPanel value={activeEmail.rawPayload} />
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <EmptyState
              title="No email selected"
              description="Choose a row from the inbox table to inspect the full message."
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DetailItem(props: { label: string; value: string; code?: boolean }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {props.label}
      </dt>
      <dd className="m-0 text-foreground">
        {props.code ? <code>{props.value}</code> : props.value}
      </dd>
    </div>
  )
}

function EmailContentPanel(props: { value: string | null }) {
  return (
    <ScrollArea className="h-[380px] rounded-lg border bg-muted/20">
      <pre className="min-h-full whitespace-pre-wrap p-4 font-mono text-xs leading-6 text-foreground">
        {props.value || 'No content captured for this section.'}
      </pre>
    </ScrollArea>
  )
}

function mergeIncomingEmail(
  currentEmails: AdminMailInboxEmail[],
  nextEmail: AdminMailInboxEmail,
) {
  const remainingEmails = currentEmails.filter((email) => email.id !== nextEmail.id)
  return [nextEmail, ...remainingEmails].slice(0, 200)
}

function emailMatchesQuery(email: AdminMailInboxEmail, query: string) {
  return [
    email.recipient,
    email.subject,
    email.textBody,
    email.htmlBody,
    email.rawPayload,
    email.latestCode,
    email.messageId,
  ]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(query))
}

function getEmailPreview(email: AdminMailInboxEmail) {
  const previewSource =
    email.textBody || email.htmlBody || email.rawPayload || email.subject || ''
  const compactPreview = previewSource.replace(/\s+/g, ' ').trim()
  if (!compactPreview) {
    return 'No preview captured.'
  }

  return compactPreview.length > 220
    ? `${compactPreview.slice(0, 217)}...`
    : compactPreview
}

function getInitialContentTab(email: AdminMailInboxEmail) {
  if (email.textBody) {
    return 'text'
  }

  if (email.htmlBody) {
    return 'html'
  }

  return 'raw'
}

function getLiveStatusLabel(status: LiveStatus) {
  switch (status) {
    case 'live':
      return 'live'
    case 'reconnecting':
      return 'reconnecting'
    case 'offline':
      return 'offline'
    default:
      return 'connecting'
  }
}

function getLiveStatusTone(status: LiveStatus) {
  switch (status) {
    case 'live':
      return 'good' as const
    case 'offline':
      return 'danger' as const
    default:
      return 'warning' as const
  }
}
