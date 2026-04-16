import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { InfoTooltip } from '#/components/ui/info-tooltip'
import { Input } from '#/components/ui/input'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
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
import { m } from '#/paraglide/messages'

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
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting')
  const [streamError, setStreamError] = useState<string | null>(null)
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
    if (!activeEmail && detailsOpen) {
      setDetailsOpen(false)
    }
  }, [activeEmail, detailsOpen])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (typeof window.EventSource === 'undefined') {
      setLiveStatus('offline')
      setStreamError(m.mail_inbox_error_sse_unsupported())
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
      setStreamError(m.mail_inbox_error_stream_reconnecting())
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

  function openEmailDetails(emailId: string) {
    setSelectedEmailId(emailId)
    setDetailsOpen(true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <section className="grid shrink-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={m.mail_inbox_metric_matched_label()}
          value={String(data.totalCount)}
          description={m.mail_inbox_metric_matched_description()}
        />
        <MetricCard
          label={m.mail_inbox_metric_current_page_label()}
          value={`${data.page} / ${Math.max(1, data.pageCount || 1)}`}
          description={m.mail_inbox_metric_current_page_description()}
        />
        <MetricCard
          label={m.mail_inbox_metric_codes_label()}
          value={String(codeReadyCount)}
          description={m.mail_inbox_metric_codes_description()}
        />
        <MetricCard
          label={m.mail_inbox_metric_html_label()}
          value={String(htmlPreviewCount)}
          description={m.mail_inbox_metric_html_description()}
        />
      </section>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <CardDescription>{m.mail_inbox_stream_kicker()}</CardDescription>
              <div className="flex items-start gap-2">
                <CardTitle>{m.mail_inbox_stream_title()}</CardTitle>
                <InfoTooltip
                  content={m.mail_inbox_stream_description()}
                  label={m.mail_inbox_stream_title()}
                  className="mt-0.5"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                value={getLiveStatusLabel(liveStatus)}
                tone={getLiveStatusTone(liveStatus)}
              />
              <Badge variant="outline">
                {query.isFetching ? m.status_refreshing() : m.status_synced()}
              </Badge>
              <Badge variant="outline">
                {m.mail_inbox_badge_on_page({
                  count: String(data.emails.length),
                })}
              </Badge>
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
                placeholder={m.mail_inbox_search_placeholder()}
                className="pl-9"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                {m.mail_inbox_page_size_label()}
              </span>
              <NativeSelect
                value={String(pageSize)}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
                }}
                className="w-full"
              >
                <NativeSelectOption value="10">
                  {m.mail_inbox_rows_option({ count: '10' })}
                </NativeSelectOption>
                <NativeSelectOption value="25">
                  {m.mail_inbox_rows_option({ count: '25' })}
                </NativeSelectOption>
                <NativeSelectOption value="50">
                  {m.mail_inbox_rows_option({ count: '50' })}
                </NativeSelectOption>
              </NativeSelect>
            </label>
          </div>

          {query.isError ? (
            <Alert variant="destructive">
              <WifiOffIcon />
              <AlertTitle>{m.mail_inbox_query_failed_title()}</AlertTitle>
              <AlertDescription>
                {query.error instanceof Error
                  ? query.error.message
                  : m.mail_inbox_query_failed_description()}
              </AlertDescription>
            </Alert>
          ) : null}

          {streamError && !query.isError ? (
            <Alert>
              {liveStatus === 'offline' ? <WifiOffIcon /> : <WifiIcon />}
              <AlertTitle>{m.mail_inbox_live_attention_title()}</AlertTitle>
              <AlertDescription>{streamError}</AlertDescription>
            </Alert>
          ) : null}
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
          {data.emails.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
                <Table className="min-w-[1120px]">
                  <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card [&_th]:shadow-[0_1px_0_hsl(var(--border))]">
                    <TableRow>
                      <TableHead>{m.mail_inbox_table_received()}</TableHead>
                      <TableHead>{m.mail_inbox_table_recipient()}</TableHead>
                      <TableHead>{m.mail_inbox_table_subject()}</TableHead>
                      <TableHead>{m.mail_inbox_table_delivery()}</TableHead>
                      <TableHead>{m.mail_inbox_table_code()}</TableHead>
                      <TableHead className="text-right">
                        {m.mail_inbox_table_details()}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.emails.map((email) => (
                      <TableRow
                        key={email.id}
                        data-state={
                          activeEmail?.id === email.id ? 'selected' : undefined
                        }
                      >
                        <TableCell className="align-top text-sm text-muted-foreground">
                          {formatAdminDate(email.receivedAt) ||
                            m.mail_inbox_timestamp_unavailable()}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            <div className="font-medium text-foreground">
                              {email.recipient}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {email.reservationMailbox ||
                                m.mail_inbox_app_alias()}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[360px] whitespace-normal align-top">
                          <div className="font-medium text-foreground">
                            {email.subject || m.mail_inbox_no_subject()}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <StatusBadge
                            value={email.latestCode ? 'ready' : 'received'}
                            tone={email.latestCode ? 'good' : 'warning'}
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          {email.latestCode ? (
                            <code>{email.latestCode}</code>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {m.status_pending()}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              openEmailDetails(email.id)
                            }}
                          >
                            {m.mail_inbox_open_button()}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  {m.mail_inbox_pagination_summary({
                    page: String(data.page),
                    total_pages: String(Math.max(1, data.pageCount || 1)),
                    total_count: String(data.totalCount),
                  })}
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
                    {m.ui_previous()}
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
                    {m.ui_next()}
                    <ChevronRightIcon />
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              title={
                deferredSearch
                  ? m.mail_inbox_empty_filtered_title()
                  : m.mail_inbox_empty_title()
              }
              description={
                deferredSearch
                  ? m.mail_inbox_empty_filtered_description()
                  : m.mail_inbox_empty_description()
              }
            />
          )}
        </CardContent>
      </Card>

      <MessageDetailsDialog
        email={activeEmail}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </div>
  )
}

function MetricCard(props: {
  label: string
  value: string
  description: string
}) {
  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex items-center gap-2">
          <CardDescription className="text-xs font-medium tracking-[0.14em] uppercase">
            {props.label}
          </CardDescription>
          <InfoTooltip
            content={props.description}
            label={props.label}
            className="size-4"
            iconClassName="size-3"
          />
        </div>
        <CardTitle className="text-3xl">{props.value}</CardTitle>
      </CardHeader>
    </Card>
  )
}

function MessageDetailsDialog(props: {
  email: AdminMailInboxEmail | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const email = props.email
  const isOpen = props.open && Boolean(email)

  return (
    <Dialog open={isOpen} onOpenChange={props.onOpenChange}>
      {email ? (
        <DialogContent className="grid h-[min(92vh,980px)] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[min(1400px,calc(100%-2rem))]">
          <DialogHeader className="gap-3 border-b px-6 py-5 pr-14">
            <DialogDescription>{m.mail_detail_kicker()}</DialogDescription>
            <div className="flex items-start gap-2">
              <DialogTitle className="flex items-center gap-2 text-xl">
                <MailIcon className="size-5" />
                {email.subject || m.mail_inbox_no_subject()}
              </DialogTitle>
              <InfoTooltip
                content={m.mail_detail_description()}
                label={email.subject || m.mail_inbox_no_subject()}
                className="mt-0.5"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                value={email.latestCode ? 'ready' : 'received'}
                tone={email.latestCode ? 'good' : 'warning'}
              />
              {email.latestCode ? (
                <Badge variant="outline">
                  {email.latestCodeSource || m.mail_detail_code_source()} ·{' '}
                  {email.latestCode}
                </Badge>
              ) : null}
              {email.htmlBody ? (
                <Badge variant="outline">{m.mail_detail_badge_html()}</Badge>
              ) : email.textBody ? (
                <Badge variant="outline">{m.mail_detail_badge_text()}</Badge>
              ) : (
                <Badge variant="outline">
                  {m.mail_detail_badge_no_preview()}
                </Badge>
              )}
            </div>
          </DialogHeader>

          <div className="grid min-h-0 gap-4 p-6 lg:grid-cols-[minmax(360px,0.95fr)_minmax(0,1.25fr)]">
            <div className="min-h-0 rounded-lg border bg-muted/20">
              <ScrollArea className="h-full">
                <div className="space-y-4 p-4">
                  <dl className="grid gap-3 text-sm">
                    <DetailItem
                      label={m.mail_detail_label_recipient()}
                      value={email.recipient}
                      code
                    />
                    <DetailItem
                      label={m.mail_detail_label_received()}
                      value={
                        formatAdminDate(email.receivedAt) ||
                        m.mail_inbox_timestamp_unavailable()
                      }
                    />
                    <DetailItem
                      label={m.mail_detail_label_message_id()}
                      value={email.messageId || m.mail_detail_not_captured()}
                      code
                    />
                    <DetailItem
                      label={m.mail_detail_label_mailbox()}
                      value={
                        email.reservationMailbox ||
                        m.mail_detail_not_configured()
                      }
                      code
                    />
                    <DetailItem
                      label={m.mail_detail_label_reservation()}
                      value={
                        email.reservationEmail || m.mail_detail_not_linked()
                      }
                      code
                    />
                    <DetailItem
                      label={m.mail_detail_label_expires()}
                      value={
                        formatAdminDate(email.reservationExpiresAt) ||
                        m.device_value_not_available()
                      }
                    />
                  </dl>

                  <Tabs
                    key={email.id}
                    defaultValue={getInitialContentTab(email)}
                    className="gap-3"
                  >
                    <TabsList variant="line" className="w-full justify-start">
                      <TabsTrigger value="text">
                        {m.mail_detail_tab_text()}
                      </TabsTrigger>
                      <TabsTrigger value="html">
                        {m.mail_detail_tab_html()}
                      </TabsTrigger>
                      <TabsTrigger value="raw">
                        {m.mail_detail_tab_raw()}
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="text">
                      <EmailContentPanel
                        value={email.textBody}
                        className="h-[320px] xl:h-[420px]"
                      />
                    </TabsContent>

                    <TabsContent value="html">
                      <EmailContentPanel
                        value={email.htmlBody}
                        className="h-[320px] xl:h-[420px]"
                      />
                    </TabsContent>

                    <TabsContent value="raw">
                      <EmailContentPanel
                        value={email.rawPayload}
                        className="h-[320px] xl:h-[420px]"
                      />
                    </TabsContent>
                  </Tabs>
                </div>
              </ScrollArea>
            </div>

            <RenderedEmailPreview
              html={email.htmlBody}
              text={email.textBody}
              className="min-h-[360px] lg:min-h-0"
            />
          </div>

          <DialogFooter showCloseButton className="border-t px-6 py-4" />
        </DialogContent>
      ) : null}
    </Dialog>
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
  className?: string
}) {
  const hasPreview = Boolean(props.html || props.text)

  return (
    <div
      className={cn(
        'flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-background',
        props.className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileCodeIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {m.mail_preview_title()}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {props.html
                ? m.mail_preview_html_description()
                : props.text
                  ? m.mail_preview_text_description()
                  : m.mail_preview_empty_description()}
            </div>
          </div>
        </div>

        {hasPreview ? (
          <Badge variant="outline">
            {props.html
              ? m.mail_preview_badge_html()
              : m.mail_preview_badge_text()}
          </Badge>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        {props.html ? (
          <iframe
            title={m.mail_preview_iframe_title()}
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
            {m.mail_preview_empty_panel()}
          </div>
        )}
      </div>
    </div>
  )
}

function EmailContentPanel(props: {
  value: string | null
  className?: string
}) {
  return (
    <ScrollArea
      className={cn(
        'rounded-lg border bg-muted/20',
        props.className || 'h-[380px]',
      )}
    >
      <pre className="min-h-full whitespace-pre-wrap p-4 font-mono text-xs leading-6 text-foreground">
        {props.value || m.mail_content_empty()}
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

  const response = await fetch(
    `/api/admin/emails/?${searchParams.toString()}`,
    {
      headers: {
        accept: 'application/json',
      },
    },
  )

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
      return m.status_live()
    case 'reconnecting':
      return m.status_reconnecting()
    case 'offline':
      return m.status_offline()
    default:
      return m.status_connecting()
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
