import {
  type FormEvent,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import DOMPurify from 'dompurify'
import { extract as extractLetterMail } from 'letterparser'
import {
  ArchiveIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileCodeIcon,
  LoaderCircleIcon,
  MailIcon,
  RefreshCcwIcon,
  RefreshCwIcon,
  RefreshCwOffIcon,
  SearchIcon,
  SquarePenIcon,
  WifiIcon,
  WifiOffIcon,
} from 'lucide-react'
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import {
  AdminDataTableFilterBar,
  useAdminDataTableFilters,
} from '#/components/admin/filterable-table'
import {
  EmptyState,
  formatAdminDate,
  StatusBadge,
} from '#/components/admin/layout'
import {
  AdminTableSelectionCell,
  AdminTableSelectionHead,
  AdminTableSelectionToolbar,
  useAdminTableSelection,
} from '#/components/admin/table-selection'
import { createColumnConfigHelper } from '#/components/data-table-filter/core/filters'
import type { FiltersState } from '#/components/data-table-filter/core/types'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { CopyableValue } from '#/components/ui/copyable-value'
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { serializeDataTableFilters } from '#/lib/data-table-filters'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

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
  managedIdentityId: string | null
  managedIdentityLabel: string | null
  managedIdentityAccount: string | null
  managedIdentityStatus: string | null
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

type ResolvedEmailContent = {
  htmlPreview: string | null
  textPreview: string | null
  htmlSource: string | null
  textSource: string | null
}

const adminMailInboxQueryBaseKey = ['admin-mail-inbox'] as const

function adminMailInboxQueryKey(params: {
  page: number
  pageSize: number
  search: string
  filters: string
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
  const [filters, setFilters] = useState<FiltersState>([])
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(
    props.initialPage.emails[0]?.id ?? null,
  )
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting')
  const [streamError, setStreamError] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(search.trim())
  const locale = getLocale()
  const dtf = createColumnConfigHelper<AdminMailInboxEmail>()
  const columnsConfig = useMemo(
    () =>
      [
        dtf
          .date()
          .id('receivedAt')
          .accessor((email) => normalizeDate(email.receivedAt))
          .displayName(m.mail_inbox_table_received())
          .icon(MailIcon)
          .build(),
        dtf
          .option()
          .id('delivery')
          .accessor((email) => (email.latestCode ? 'ready' : 'received'))
          .displayName(m.mail_inbox_table_delivery())
          .icon(WifiIcon)
          .options([
            { label: m.status_ready(), value: 'ready' },
            { label: m.status_received(), value: 'received' },
          ])
          .build(),
      ] as const,
    [locale],
  )
  const serializedFilters = useMemo(
    () => serializeDataTableFilters(filters),
    [filters],
  )

  const queryKey = useMemo(
    () =>
      adminMailInboxQueryKey({
        page,
        pageSize,
        search: deferredSearch,
        filters: serializedFilters,
      }),
    [page, pageSize, deferredSearch, serializedFilters],
  )

  const query = useQuery({
    queryKey,
    queryFn: () =>
      fetchAdminMailInboxPage({
        page,
        pageSize,
        search: deferredSearch,
        filters,
      }),
    initialData:
      page === props.initialPage.page &&
      pageSize === props.initialPage.pageSize &&
      deferredSearch === props.initialPage.search &&
      filters.length === 0
        ? props.initialPage
        : undefined,
    placeholderData: keepPreviousData,
  })

  const data = query.data ?? props.initialPage
  const filterTable = useAdminDataTableFilters({
    strategy: 'server',
    data: data.emails,
    columnsConfig,
    filters,
    onFiltersChange: setFilters,
  })
  const selection = useAdminTableSelection({
    rows: data.emails,
    getRowId: (email) => email.id,
  })

  useEffect(() => {
    // `keepPreviousData` keeps the prior page visible while the next page loads.
    if (query.isPlaceholderData) {
      return
    }

    if (data.page !== page) {
      setPage(data.page)
    }
  }, [data.page, page, query.isPlaceholderData])

  useEffect(() => {
    setSelectedEmailId((current) => {
      if (current && data.emails.some((email) => email.id === current)) {
        return current
      }

      return data.emails[0]?.id ?? null
    })
  }, [data.emails])

  useEffect(() => {
    setPage(1)
  }, [serializedFilters])

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

  const hasActiveFilters = Boolean(deferredSearch || filters.length > 0)
  const invalidateInboxQueries = async () => {
    await queryClient.invalidateQueries({
      queryKey: adminMailInboxQueryBaseKey,
    })
  }

  function openEmailDetails(emailId: string) {
    setSelectedEmailId(emailId)
    setDetailsOpen(true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 gap-4">
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

          <div className="flex flex-wrap items-center gap-3">
            <label className="relative block min-w-[220px] flex-[1_1_280px]">
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

            <div className="min-w-[280px] flex-[2_1_420px]">
              <AdminDataTableFilterBar table={filterTable} />
            </div>

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {data.emails.length ? (
                <AdminTableSelectionToolbar selection={selection} />
              ) : null}
              <NativeSelect
                value={String(pageSize)}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
                }}
                className="w-[110px]"
                aria-label={m.mail_inbox_page_size_label()}
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

              <div
                className={cn(
                  'inline-flex size-9 items-center justify-center rounded-md border bg-muted/20',
                  liveStatus === 'offline' || query.isError
                    ? 'text-destructive'
                    : 'text-muted-foreground',
                )}
                aria-live="polite"
                aria-label={getInboxRefreshStatusLabel({
                  isFetching: query.isFetching,
                  isError: query.isError,
                  liveStatus,
                })}
                title={getInboxRefreshStatusLabel({
                  isFetching: query.isFetching,
                  isError: query.isError,
                  liveStatus,
                })}
              >
                {query.isError || liveStatus === 'offline' ? (
                  <RefreshCwOffIcon className="size-4" />
                ) : query.isFetching ||
                    liveStatus === 'connecting' ||
                    liveStatus === 'reconnecting' ? (
                  <RefreshCwIcon className="size-4 animate-spin" />
                ) : (
                  <RefreshCcwIcon className="size-4" />
                )}
              </div>
            </div>
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
                      <AdminTableSelectionHead
                        rows={data.emails}
                        selection={selection}
                      />
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
                        data-selected={selection.isSelected(email) || undefined}
                        className={cn(
                          activeEmail?.id === email.id && 'bg-muted/40',
                        )}
                      >
                        <AdminTableSelectionCell
                          row={email}
                          selection={selection}
                        />
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
                          <ManualVerificationCodeForm
                            email={email.recipient}
                            initialCode={email.latestCode}
                            onUpdated={invalidateInboxQueries}
                            compact
                          />
                        </TableCell>
                        <TableCell className="align-top text-right">
                          <TooltipProvider>
                            <div className="flex flex-wrap justify-end gap-2">
                              <ArchiveManagedIdentityButton
                                identityId={email.managedIdentityId}
                                identityStatus={email.managedIdentityStatus}
                                onUpdated={invalidateInboxQueries}
                                compact
                              />
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-sm"
                                    aria-label={m.mail_inbox_open_button()}
                                    title={m.mail_inbox_open_button()}
                                    onClick={() => {
                                      openEmailDetails(email.id)
                                    }}
                                  >
                                    <MailIcon />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent sideOffset={6}>
                                  {m.mail_inbox_open_button()}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TooltipProvider>
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
                hasActiveFilters
                  ? m.mail_inbox_empty_filtered_title()
                  : m.mail_inbox_empty_title()
              }
              description={
                hasActiveFilters
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
        onCodeUpdated={invalidateInboxQueries}
        onIdentityUpdated={invalidateInboxQueries}
      />
    </div>
  )
}

function MessageDetailsDialog(props: {
  email: AdminMailInboxEmail | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCodeUpdated?: () => Promise<void> | void
  onIdentityUpdated?: () => Promise<void> | void
}) {
  const email = props.email
  const isOpen = props.open && Boolean(email)
  const resolvedContent = useMemo(
    () => (email ? resolveEmailContent(email) : null),
    [email],
  )

  return (
    <Dialog open={isOpen} onOpenChange={props.onOpenChange}>
      {email ? (
        <DialogContent
          className="grid h-[min(92vh,980px)] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[min(1400px,calc(100%-2rem))]"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const dialog = event.currentTarget as HTMLElement | null
            const closeButton = dialog?.querySelector<HTMLElement>(
              '[data-slot="dialog-close"]',
            )
            closeButton?.focus()
          }}
        >
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
              {resolvedContent?.htmlPreview ? (
                <Badge variant="outline">{m.mail_detail_badge_html()}</Badge>
              ) : resolvedContent?.textPreview ? (
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
                      copyValue={email.recipient}
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
                      copyValue={email.messageId}
                      code
                    />
                    <DetailItem
                      label={m.mail_detail_label_mailbox()}
                      value={
                        email.reservationMailbox ||
                        m.mail_detail_not_configured()
                      }
                      copyValue={email.reservationMailbox}
                      code
                    />
                    <DetailItem
                      label={m.mail_detail_label_reservation()}
                      value={
                        email.reservationEmail || m.mail_detail_not_linked()
                      }
                      copyValue={email.reservationEmail}
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

                  <div className="space-y-3 rounded-lg border bg-background p-4">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-foreground">
                        {m.mail_detail_label_identity()}
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {email.managedIdentityId
                          ? email.managedIdentityAccount ||
                            email.managedIdentityId
                          : m.mail_detail_not_linked()}
                      </p>
                    </div>

                    {email.managedIdentityId ? (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <div className="font-medium text-foreground">
                            {email.managedIdentityLabel ||
                              email.managedIdentityAccount ||
                              email.managedIdentityId}
                          </div>
                          {email.managedIdentityAccount &&
                          email.managedIdentityLabel !==
                            email.managedIdentityAccount ? (
                            <CopyableValue
                              value={email.managedIdentityAccount}
                              title={m.clipboard_copy_value({
                                label:
                                  m.admin_dashboard_account_email_label(),
                              })}
                              className="max-w-full text-sm text-muted-foreground"
                              contentClassName="break-all"
                            />
                          ) : null}
                          <CopyableValue
                            value={email.managedIdentityId}
                            code
                            title={m.clipboard_copy_value({
                              label: m.admin_dashboard_identity_id_label(),
                            })}
                            className="max-w-full text-sm text-muted-foreground"
                            contentClassName="break-all"
                          />
                          {email.managedIdentityStatus ? (
                            <StatusBadge value={email.managedIdentityStatus} />
                          ) : null}
                        </div>

                        <ArchiveManagedIdentityButton
                          identityId={email.managedIdentityId}
                          identityStatus={email.managedIdentityStatus}
                          onUpdated={props.onIdentityUpdated}
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {m.mail_detail_not_linked()}
                      </p>
                    )}
                  </div>

                  <div className="space-y-3 rounded-lg border bg-background p-4">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-foreground">
                        {m.mail_manual_code_section_title()}
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {m.mail_manual_code_description()}
                      </p>
                    </div>
                    <ManualVerificationCodeForm
                      email={email.recipient}
                      initialCode={email.latestCode}
                      onUpdated={props.onCodeUpdated}
                    />
                  </div>

                  <Tabs
                    key={email.id}
                    defaultValue={getInitialContentTab(resolvedContent)}
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
                        value={resolvedContent?.textSource ?? email.textBody}
                        className="h-[320px] xl:h-[420px]"
                      />
                    </TabsContent>

                    <TabsContent value="html">
                      <EmailContentPanel
                        value={resolvedContent?.htmlSource ?? email.htmlBody}
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
              html={resolvedContent?.htmlPreview ?? null}
              text={resolvedContent?.textPreview ?? null}
              className="min-h-[360px] lg:min-h-0"
            />
          </div>

          <DialogFooter showCloseButton className="border-t px-6 py-4" />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

type ArchiveManagedIdentityButtonProps = {
  identityId?: string | null
  identityStatus?: string | null
  onUpdated?: () => Promise<void> | void
  compact?: boolean
}

function ArchiveManagedIdentityButton(props: ArchiveManagedIdentityButtonProps) {
  const [status, setStatus] = useState<
    'idle' | 'submitting' | 'success' | 'error'
  >('idle')
  const [message, setMessage] = useState<string | null>(null)
  const isArchived = props.identityStatus === 'archived'

  useEffect(() => {
    setStatus('idle')
    setMessage(null)
  }, [props.identityId, props.identityStatus])

  if (!props.identityId) {
    return null
  }

  async function archiveIdentity() {
    if (!props.identityId || isArchived || status === 'submitting') {
      return
    }

    setStatus('submitting')
    setMessage(null)

    try {
      await submitAdminIdentityAction({
        identityId: props.identityId,
        intent: 'archive',
      })
      await props.onUpdated?.()
      setStatus('success')
      setMessage(m.mail_identity_archive_success())
    } catch (error) {
      setStatus('error')
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : m.mail_identity_archive_error(),
      )
    }
  }

  return (
    <TooltipProvider>
      <div
        className={cn(
          'space-y-2',
          props.compact ? 'max-w-fit text-left' : 'w-full max-w-[280px]',
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant={isArchived ? 'secondary' : 'outline'}
              disabled={status === 'submitting'}
              aria-label={
                isArchived
                  ? m.mail_identity_archive_done()
                  : m.mail_identity_archive_button()
              }
              title={
                isArchived
                  ? m.mail_identity_archive_done()
                  : m.mail_identity_archive_button()
              }
              onClick={() => {
                void archiveIdentity()
              }}
            >
              {status === 'submitting' ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <ArchiveIcon />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>
            {isArchived
              ? m.mail_identity_archive_done()
              : m.mail_identity_archive_button()}
          </TooltipContent>
        </Tooltip>

        {message && (!props.compact || status === 'error') ? (
          <p
            className={cn(
              'text-xs',
              status === 'error'
                ? 'text-destructive'
                : 'text-emerald-600',
            )}
          >
            {message}
          </p>
        ) : null}
      </div>
    </TooltipProvider>
  )
}

type ManualVerificationCodeFormProps = {
  email: string
  initialCode?: string | null
  onUpdated?: () => Promise<void> | void
  compact?: boolean
}

function ManualVerificationCodeForm(props: ManualVerificationCodeFormProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [code, setCode] = useState(props.initialCode || '')
  const [isEditing, setIsEditing] = useState(false)
  const [status, setStatus] = useState<
    'idle' | 'submitting' | 'success' | 'error'
  >('idle')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setCode(props.initialCode || '')
    setIsEditing(false)
    setStatus('idle')
    setMessage(null)
  }, [props.email, props.initialCode])

  useEffect(() => {
    if (!isEditing) {
      return
    }

    const input = inputRef.current
    if (!input) {
      return
    }

    input.focus()
    const cursorPosition = input.value.length
    input.setSelectionRange(cursorPosition, cursorPosition)
  }, [isEditing])
  async function submitCode() {
    setStatus('submitting')
    setMessage(null)

    try {
      await submitAdminVerificationCode({
        email: props.email,
        code,
      })
      await props.onUpdated?.()
      setIsEditing(false)
      setStatus('success')
      setMessage(m.mail_manual_code_success())
    } catch (error) {
      setStatus('error')
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : m.mail_manual_code_error(),
      )
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isEditing || code.length !== 6 || status === 'submitting') {
      return
    }

    await submitCode()
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event)
      }}
      className={cn(
        'space-y-2',
        props.compact ? 'max-w-[220px]' : 'w-full max-w-[280px]',
      )}
    >
      <div className="flex items-center gap-2">
        {isEditing ? (
          <Input
            ref={inputRef}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
              if (status !== 'idle') {
                setStatus('idle')
                setMessage(null)
              }
            }}
            disabled={status === 'submitting'}
            inputMode="numeric"
            maxLength={6}
            placeholder={m.admin_dashboard_code_input_placeholder()}
            aria-label={m.admin_dashboard_code_input_label()}
            className={cn(
              'h-8 font-mono tracking-[0.28em] text-center disabled:cursor-default disabled:opacity-100 disabled:bg-muted/40 disabled:text-foreground',
              props.compact ? 'w-[132px]' : 'w-full',
            )}
          />
        ) : (
          <CopyableValue
            value={code}
            displayValue={code || m.admin_dashboard_code_input_placeholder()}
            disabled={!code}
            code
            iconMode="overlay"
            title={m.mail_manual_code_copy_button()}
            onCopySuccess={() => {
              setStatus('success')
              setMessage(m.mail_manual_code_copy_success())
            }}
            onCopyError={() => {
              setStatus('error')
              setMessage(m.mail_manual_code_copy_error())
            }}
            className={cn(
              'h-8 justify-center rounded-md border border-border/70 bg-muted/40 px-3 pr-8',
              code ? 'text-foreground' : 'text-muted-foreground',
              code && 'hover:bg-accent/50 active:bg-accent/70',
              props.compact ? 'w-[132px]' : 'w-full',
            )}
            copiedClassName="border-emerald-500/70 bg-emerald-50/70 text-emerald-700 dark:border-emerald-500/60 dark:bg-emerald-500/10 dark:text-emerald-300"
            contentClassName="w-full text-center font-mono tracking-[0.28em]"
          />
        )}
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          disabled={status === 'submitting' || (isEditing && code.length !== 6)}
          onClick={() => {
            if (isEditing) {
              void submitCode()
              return
            }

            setIsEditing(true)
            setStatus('idle')
            setMessage(null)
          }}
          className={cn(
            isEditing &&
              'border-emerald-500/70 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-500/60 dark:text-emerald-300 dark:hover:bg-emerald-500/10',
          )}
          aria-label={
            isEditing
              ? m.mail_manual_code_update_button()
              : m.mail_manual_code_edit_button()
          }
          title={
            isEditing
              ? m.mail_manual_code_update_button()
              : m.mail_manual_code_edit_button()
          }
        >
          {status === 'submitting' ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : isEditing ? (
            <CheckIcon />
          ) : (
            <SquarePenIcon />
          )}
        </Button>
      </div>

      {message && (!props.compact || status === 'error') ? (
        <p
          className={cn(
            'text-xs',
            status === 'error'
              ? 'text-destructive'
              : status === 'success'
                ? 'text-emerald-600'
                : 'text-muted-foreground',
          )}
        >
          {message}
        </p>
      ) : null}
    </form>
  )
}

function DetailItem(props: {
  label: string
  value: string
  copyValue?: string | null
  code?: boolean
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {props.label}
      </dt>
      <dd className="m-0 text-foreground">
        {props.copyValue ? (
          <CopyableValue
            value={props.copyValue}
            displayValue={props.value}
            code={props.code}
            title={m.clipboard_copy_value({ label: props.label })}
            contentClassName="break-all"
          />
        ) : props.code ? (
          <code>{props.value}</code>
        ) : (
          props.value
        )}
      </dd>
    </div>
  )
}

function RenderedEmailPreview(props: {
  html: string | null
  text: string | null
  className?: string
}) {
  const [isClient, setIsClient] = useState(false)
  const hasPreview = Boolean(props.html || props.text)
  const previewDocument = useMemo(() => {
    if (!isClient || !props.html) {
      return null
    }

    return buildHtmlPreviewDocument(props.html)
  }, [isClient, props.html])

  useEffect(() => {
    setIsClient(true)
  }, [])

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
          previewDocument ? (
            <iframe
              title={m.mail_preview_iframe_title()}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={previewDocument}
              className="h-full w-full bg-white"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              {m.ui_loading()}
            </div>
          )
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
  filters: FiltersState
}): Promise<AdminMailInboxPageData> {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  })

  if (params.search) {
    searchParams.set('search', params.search)
  }

  if (params.filters.length > 0) {
    searchParams.set('filters', serializeDataTableFilters(params.filters))
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

async function submitAdminVerificationCode(params: {
  email: string
  code: string
}) {
  const form = new FormData()
  form.set('email', params.email)
  form.set('code', params.code)

  const response = await fetch('/api/admin/verification-codes', {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
    body: form,
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  return (await response.json()) as { ok: true; id: string }
}

async function submitAdminIdentityAction(params: {
  identityId: string
  intent: 'archive'
}) {
  const form = new FormData()
  form.set('identityId', params.identityId)
  form.set('intent', params.intent)

  const response = await fetch('/api/admin/identities', {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
    body: form,
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  return (await response.json()) as { ok: true; id: string }
}

function buildHtmlPreviewDocument(html: string) {
  const purify = DOMPurify(window)
  const sanitizedHtml = purify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    SANITIZE_DOM: true,
    USE_PROFILES: {
      html: true,
    },
  })
  const parsedDocument = new window.DOMParser().parseFromString(
    sanitizedHtml,
    'text/html',
  )
  const extractedHeadStyles = Array.from(
    parsedDocument.head.querySelectorAll('style'),
  )
    .map((element) => element.outerHTML)
    .join('\n')

  for (const link of parsedDocument.body.querySelectorAll('a[href]')) {
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  }

  const bodyContent = parsedDocument.body.innerHTML || sanitizedHtml

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

function resolveEmailContent(
  email: AdminMailInboxEmail,
): ResolvedEmailContent {
  const parsedContent = extractEmailContentFromRaw(email)
  const storedHtml = normalizeEmailContent(email.htmlBody)
  const storedText = normalizeEmailContent(email.textBody)
  const htmlSource = storedHtml ?? parsedContent?.html ?? null
  const textSource = parsedContent?.text ?? storedText ?? null
  const textPreview =
    parsedContent?.text ??
    (isLikelyRawEmailSource(storedText) ? null : storedText)

  return {
    htmlPreview: htmlSource,
    textPreview,
    htmlSource,
    textSource,
  }
}

function extractEmailContentFromRaw(
  email: Pick<AdminMailInboxEmail, 'rawPayload' | 'textBody'>,
) {
  const rawSource = getLikelyRawEmailSource(email)
  if (!rawSource) {
    return null
  }

  try {
    const parsedMail = extractLetterMail(rawSource)
    return {
      html: normalizeEmailContent(parsedMail.html),
      text: normalizeEmailContent(parsedMail.text),
    }
  } catch {
    return null
  }
}

function getLikelyRawEmailSource(
  email: Pick<AdminMailInboxEmail, 'rawPayload' | 'textBody'>,
) {
  if (isLikelyRawEmailSource(email.rawPayload)) {
    return email.rawPayload
  }

  if (isLikelyRawEmailSource(email.textBody)) {
    return email.textBody
  }

  return null
}

function isLikelyRawEmailSource(value: string | null | undefined) {
  if (!value) {
    return false
  }

  const headerBlock = value.split(/\r?\n\r?\n/, 1)[0]
  const headerCount =
    headerBlock.match(/^[A-Za-z0-9-]+:\s.*$/gm)?.length ?? 0

  return headerCount >= 2
}

function normalizeEmailContent(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeDate(value: string | Date | null | undefined) {
  if (!value) {
    return undefined
  }

  const normalized = value instanceof Date ? value : new Date(value)
  return Number.isNaN(normalized.getTime()) ? undefined : normalized
}

function getInitialContentTab(content: ResolvedEmailContent | null) {
  if (content?.htmlSource) {
    return 'html'
  }

  if (content?.textSource) {
    return 'text'
  }

  return 'raw'
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

function getInboxRefreshStatusLabel(params: {
  liveStatus: LiveStatus
  isFetching: boolean
  isError: boolean
}) {
  if (params.isError || params.liveStatus === 'offline') {
    return m.status_offline()
  }

  if (
    params.isFetching ||
    params.liveStatus === 'connecting' ||
    params.liveStatus === 'reconnecting'
  ) {
    return params.isFetching
      ? m.status_refreshing()
      : getLiveStatusLabel(params.liveStatus)
  }

  return getLiveStatusLabel(params.liveStatus)
}
