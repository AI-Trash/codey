import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileCodeIcon,
  MailIcon,
  SearchIcon,
  WifiIcon,
  WifiOffIcon,
} from 'lucide-react'
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import {
  EmptyState,
  StatusBadge,
  formatAdminDate,
} from '#/components/admin/layout'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
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
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '#/components/ui/resizable'
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
import { cn } from '#/lib/utils'
import type { PanelImperativeHandle } from 'react-resizable-panels'

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

export type AdminMailInboxPageData = {
  emails: AdminMailInboxEmail[]
  page: number
  pageSize: number
  totalCount: number
  pageCount: number
  hasNextPage: boolean
  hasPreviousPage: boolean
  search: string
}

type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'

const adminMailInboxQueryBaseKey = ['admin-mail-inbox'] as const

function adminMailInboxQueryKey(params: {
  page: number
  pageSize: number
  search: string
}) {
  return [...adminMailInboxQueryBaseKey, params] as const
}

export function AdminMailInbox(props: {
  initialPage: AdminMailInboxPageData
  initialCursor: string
}) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(props.initialPage.page)
  const [pageSize, setPageSize] = useState(props.initialPage.pageSize)
  const [search, setSearch] = useState(props.initialPage.search)
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(
    props.initialPage.emails[0]?.id ?? null,
  )
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting')
  const [streamError, setStreamError] = useState<string | null>(null)
  const previewPanelRef = useRef<PanelImperativeHandle | null>(null)
  const [previewPanelCollapsed, setPreviewPanelCollapsed] = useState(
    !Boolean(
      props.initialPage.emails[0]?.htmlBody || props.initialPage.emails[0]?.textBody,
    ),
  )
  const deferredSearch = useDeferredValue(search.trim())

  const queryKey = useMemo(
    () => adminMailInboxQueryKey({ page, pageSize, search: deferredSearch }),
    [page, pageSize, deferredSearch],
  )

  const query = useQuery({
    queryKey,
    queryFn: () =>
      fetchAdminMailInboxPage({
        page,
        pageSize,
        search: deferredSearch,
      }),
    initialData:
      page === props.initialPage.page &&
      pageSize === props.initialPage.pageSize &&
      deferredSearch === props.initialPage.search
        ? props.initialPage
        : undefined,
    placeholderData: keepPreviousData,
  })

  const data = query.data ?? props.initialPage

  useEffect(() => {
    if (data.page !== page) {
      setPage(data.page)
    }
  }, [data.page, page])

  useEffect(() => {
    setSelectedEmailId((current) => {
      if (current && data.emails.some((email) => email.id === current)) {
        return current
      }

      return data.emails[0]?.id ?? null
    })
  }, [data.emails])

  const activeEmail =
    data.emails.find((email) => email.id === selectedEmailId) ||
    data.emails[0] ||
    null

  useEffect(() => {
    const hasPreview = Boolean(activeEmail?.htmlBody || activeEmail?.textBody)

    if (!previewPanelRef.current) {
      setPreviewPanelCollapsed(!hasPreview)
      return
    }

    if (hasPreview) {
      previewPanelRef.current.expand()
      setPreviewPanelCollapsed(false)
      return
    }

    previewPanelRef.current.collapse()
    setPreviewPanelCollapsed(true)
  }, [activeEmail?.htmlBody, activeEmail?.id, activeEmail?.textBody])

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

    const handleEmail = () => {
      startTransition(() => {
        void queryClient.invalidateQueries({
          queryKey: adminMailInboxQueryBaseKey,
        })
      })
      setLiveStatus('live')
      setStreamError(null)
    }

    eventSource.onopen = () => {
      setLiveStatus('live')
      setStreamError(null)
    }

    eventSource.onerror = () => {
      setLiveStatus('reconnecting')
      setStreamError('Live mail stream disconnected. Trying to reconnect...')
    }

    eventSource.addEventListener('email', handleEmail)
    eventSource.addEventListener('timeout', () => {
      setLiveStatus('reconnecting')
    })

    return () => {
      eventSource.close()
    }
  }, [props.initialCursor, queryClient])

  const codeReadyCount = data.emails.filter((email) => email.latestCode).length
  const htmlPreviewCount = data.emails.filter((email) => email.htmlBody).length

  return (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Matched emails"
          value={String(data.totalCount)}
          description="Total inbound emails matching the current mailbox search."
        />
        <MetricCard
          label="Current page"
          value={`${data.page} / ${Math.max(1, data.pageCount || 1)}`}
          description="Paginated inbox results loaded through TanStack Query."
        />
        <MetricCard
          label="Codes on page"
          value={String(codeReadyCount)}
          description="Messages on the current page already associated with a code."
        />
        <MetricCard
          label="HTML previews"
          value={String(htmlPreviewCount)}
          description="Messages on the current page that include HTML content."
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(620px,0.95fr)]">
        <Card>
          <CardHeader className="gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <CardDescription>Mailbox stream</CardDescription>
                <CardTitle>Inbound verification mail</CardTitle>
                <CardDescription className="max-w-2xl text-sm leading-6">
                  Query-backed pagination keeps the inbox manageable, while the
                  live stream invalidates the current cache as new mail arrives.
                </CardDescription>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  value={getLiveStatusLabel(liveStatus)}
                  tone={getLiveStatusTone(liveStatus)}
                />
                <Badge variant="outline">
                  {query.isFetching ? 'Refreshing' : 'Synced'}
                </Badge>
                <Badge variant="outline">{data.emails.length} on page</Badge>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px]">
              <label className="relative block">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                  placeholder="Search recipient, subject, HTML, text, or message id"
                  className="pl-9"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  Page size
                </span>
                <NativeSelect
                  value={String(pageSize)}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value))
                    setPage(1)
                  }}
                  className="w-full"
                >
                  <NativeSelectOption value="10">10 rows</NativeSelectOption>
                  <NativeSelectOption value="25">25 rows</NativeSelectOption>
                  <NativeSelectOption value="50">50 rows</NativeSelectOption>
                </NativeSelect>
              </label>
            </div>

            {query.isError ? (
              <Alert variant="destructive">
                <WifiOffIcon />
                <AlertTitle>Inbox query failed</AlertTitle>
                <AlertDescription>
                  {query.error instanceof Error
                    ? query.error.message
                    : 'Unable to load inbox data.'}
                </AlertDescription>
              </Alert>
            ) : null}

            {streamError && !query.isError ? (
              <Alert>
                {liveStatus === 'offline' ? <WifiOffIcon /> : <WifiIcon />}
                <AlertTitle>Live updates need attention</AlertTitle>
                <AlertDescription>{streamError}</AlertDescription>
              </Alert>
            ) : null}
          </CardHeader>

          <CardContent className="space-y-4">
            {data.emails.length > 0 ? (
              <>
                <Table className="min-w-[920px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Received</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Code</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.emails.map((email) => (
                      <TableRow
                        key={email.id}
                        data-state={
                          activeEmail?.id === email.id ? 'selected' : undefined
                        }
                        className="cursor-pointer"
                        onClick={() => {
                          setSelectedEmailId(email.id)
                        }}
                      >
                        <TableCell className="align-top text-sm text-muted-foreground">
                          {formatAdminDate(email.receivedAt) ||
                            'Timestamp unavailable'}
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">
                    Showing page <strong className="text-foreground">{data.page}</strong>{' '}
                    of{' '}
                    <strong className="text-foreground">
                      {Math.max(1, data.pageCount || 1)}
                    </strong>{' '}
                    with <strong className="text-foreground">{data.totalCount}</strong>{' '}
                    matched emails.
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!data.hasPreviousPage || query.isPlaceholderData}
                      onClick={() => {
                        setPage((current) => Math.max(1, current - 1))
                      }}
                    >
                      <ChevronLeftIcon />
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!data.hasNextPage || query.isPlaceholderData}
                      onClick={() => {
                        setPage((current) => current + 1)
                      }}
                    >
                      Next
                      <ChevronRightIcon />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState
                title={deferredSearch ? 'No matching emails' : 'No inbound emails yet'}
                description={
                  deferredSearch
                    ? 'Try a broader search term or switch back to the first page.'
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
              Message details stay on the left, while the rendered email preview
              now lives in a sidebar-style panel that can collapse sideways.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {activeEmail ? (
              <ResizablePanelGroup
                orientation="horizontal"
                className="h-[70vh] min-h-[620px] max-h-[780px] overflow-hidden rounded-lg border bg-muted/20"
              >
                <ResizablePanel defaultSize="58%" minSize="42%" className="min-w-0">
                  <ScrollArea className="h-full">
                    <div className="space-y-4 p-4">
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
                        {activeEmail.htmlBody ? (
                          <Badge variant="outline">HTML email</Badge>
                        ) : activeEmail.textBody ? (
                          <Badge variant="outline">Text preview</Badge>
                        ) : null}
                      </div>

                      <dl className="grid gap-3 text-sm">
                        <DetailItem
                          label="Recipient"
                          value={activeEmail.recipient}
                          code
                        />
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
                  </ScrollArea>
                </ResizablePanel>

                <ResizableHandle withHandle />

                <ResizablePanel
                  collapsible
                  collapsedSize={56}
                  defaultSize="42%"
                  minSize="28%"
                  panelRef={previewPanelRef}
                  className="min-w-0 border-l bg-background"
                  onResize={(size) => {
                    setPreviewPanelCollapsed(size.inPixels <= 80)
                  }}
                >
                  <RenderedEmailPreview
                    html={activeEmail.htmlBody}
                    text={activeEmail.textBody}
                    collapsed={previewPanelCollapsed}
                    onToggle={() => {
                      if (!previewPanelRef.current) {
                        return
                      }

                      if (previewPanelCollapsed) {
                        previewPanelRef.current.expand()
                        setPreviewPanelCollapsed(false)
                        return
                      }

                      previewPanelRef.current.collapse()
                      setPreviewPanelCollapsed(true)
                    }}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <EmptyState
                title="No email selected"
                description="Choose a row from the inbox table to inspect the full message."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MetricCard(props: {
  label: string
  value: string
  description: string
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-2">
        <CardDescription className="text-xs font-medium tracking-[0.14em] uppercase">
          {props.label}
        </CardDescription>
        <CardTitle className="text-3xl">{props.value}</CardTitle>
        <CardDescription className="text-sm leading-6">
          {props.description}
        </CardDescription>
      </CardHeader>
    </Card>
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

function RenderedEmailPreview(props: {
  html: string | null
  text: string | null
  collapsed: boolean
  onToggle: () => void
}) {
  const hasPreview = Boolean(props.html || props.text)

  if (props.collapsed) {
    return (
      <button
        type="button"
        onClick={props.onToggle}
        disabled={!hasPreview}
        className={cn(
          'flex h-full w-full flex-col items-center justify-center gap-4 px-2 py-4 text-center transition-colors',
          hasPreview
            ? 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
            : 'cursor-not-allowed text-muted-foreground/60',
        )}
      >
        <ChevronLeftIcon className="size-4 shrink-0" />
        <span className="[writing-mode:vertical-rl] rotate-180 text-[11px] font-medium tracking-[0.22em] uppercase">
          {hasPreview ? 'Email preview' : 'No preview'}
        </span>
      </button>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileCodeIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Email preview</div>
            <div className="truncate text-xs text-muted-foreground">
              {props.html
                ? 'Rendered from the HTML body.'
                : props.text
                  ? 'Showing text content because no HTML body was captured.'
                  : 'No previewable content was captured for this message.'}
            </div>
          </div>
        </div>

        <Button type="button" variant="ghost" size="sm" onClick={props.onToggle}>
          <ChevronRightIcon />
          Collapse
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {props.html ? (
          <iframe
            title="Rendered email preview"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={buildHtmlPreviewDocument(props.html)}
            className="h-full w-full bg-white"
          />
        ) : props.text ? (
          <ScrollArea className="h-full bg-background">
            <div className="whitespace-pre-wrap p-4 text-sm leading-6 text-foreground">
              {props.text}
            </div>
          </ScrollArea>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            This message did not include previewable content.
          </div>
        )}
      </div>
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

async function fetchAdminMailInboxPage(params: {
  page: number
  pageSize: number
  search: string
}): Promise<AdminMailInboxPageData> {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  })

  if (params.search) {
    searchParams.set('search', params.search)
  }

  const response = await fetch(`/api/admin/emails/?${searchParams.toString()}`, {
    headers: {
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  return (await response.json()) as AdminMailInboxPageData
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

function buildHtmlPreviewDocument(html: string) {
  const sanitizedHtml = sanitizeHtmlPreviewSource(html)
  const extractedHeadStyles =
    sanitizedHtml.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi)?.join('\n') ?? ''
  const bodyMatch = sanitizedHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const bodyContent = bodyMatch?.[1] ?? sanitizedHtml

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base target="_blank" />
    ${extractedHeadStyles}
    <style>
      :root {
        color-scheme: light;
      }

      html {
        background: #f8fafc;
      }

      body {
        margin: 0;
        padding: 20px;
        font-family: ui-sans-serif, system-ui, sans-serif;
        color: #0f172a;
        background: #ffffff;
        overflow-wrap: anywhere;
      }

      .email-preview-shell {
        min-height: 100%;
      }

      img {
        max-width: 100%;
        height: auto;
      }

      table {
        max-width: 100%;
      }

      pre {
        white-space: pre-wrap;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    <div class="email-preview-shell">${bodyContent}</div>
  </body>
</html>`
}

function sanitizeHtmlPreviewSource(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*>/gi, '')
    .replace(/\s(on[a-z-]+)\s*=\s*(['"]).*?\2/gi, '')
    .replace(/\s(on[a-z-]+)\s*=\s*[^\s>]+/gi, '')
    .replace(
      /\s(href|src|xlink:href)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi,
      ' $1=$2#$2',
    )
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
