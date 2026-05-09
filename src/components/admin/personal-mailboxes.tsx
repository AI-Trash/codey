import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { AlertCircleIcon, FileUpIcon, RefreshCwIcon } from 'lucide-react'

import {
  EmptyState,
  formatAdminDate,
  StatusBadge,
  type StatusTone,
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
import { Textarea } from '#/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { getToastErrorDescription, showAppToast } from '#/lib/toast'
import { m } from '#/paraglide/messages'

export type ManagedPersonalMailbox = {
  id: string
  email: string
  provider: 'outlook'
  mailboxPrefix: string | null
  description: string | null
  registrationEnabled: boolean
  isDefault: boolean
  graphTenantId: string
  graphClientId: string
  graphScopes: string
  graphRefreshTokenPreview: string | null
  passwordPreview: string | null
  lastGraphReadAt: string | null
  lastGraphError: string | null
  status: 'configured' | 'missing_credentials' | 'error'
  createdAt: string | Date
  updatedAt: string | Date
}

type ImportResult = {
  imported: ManagedPersonalMailbox[]
  failed: Array<{
    row: number
    error: string
  }>
}

export function PersonalMailboxesPageContent({
  initialMailboxes,
}: {
  initialMailboxes: ManagedPersonalMailbox[]
}) {
  const [mailboxes, setMailboxes] = useState(initialMailboxes)
  const [importOpen, setImportOpen] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  useEffect(() => {
    setMailboxes(initialMailboxes)
  }, [initialMailboxes])

  function handleImported(result: ImportResult) {
    setImportResult(result)
    if (!result.imported.length) {
      return
    }

    setMailboxes((current) => mergeMailboxes(current, result.imported))
  }

  const configuredCount = useMemo(
    () => mailboxes.filter((mailbox) => mailbox.status === 'configured').length,
    [mailboxes],
  )

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {m.personal_mailbox_count({ count: String(mailboxes.length) })}
          </Badge>
          <Badge variant="outline">
            {m.personal_mailbox_graph_ready_count({
              count: String(configuredCount),
            })}
          </Badge>
        </div>
        <Button
          type="button"
          onClick={() => {
            setImportOpen(true)
          }}
        >
          <FileUpIcon />
          {m.personal_mailbox_import_submit()}
        </Button>
      </div>

      {importResult?.failed.length ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{m.personal_mailbox_import_partial_title()}</AlertTitle>
          <AlertDescription>
            {m.personal_mailbox_import_partial_description({
              failed: String(importResult.failed.length),
              imported: String(importResult.imported.length),
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {mailboxes.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{m.personal_mailbox_table_title()}</CardTitle>
            <CardDescription>
              {m.personal_mailbox_table_description()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{m.personal_mailbox_table_email()}</TableHead>
                  <TableHead>{m.personal_mailbox_table_graph()}</TableHead>
                  <TableHead>
                    {m.personal_mailbox_table_registration()}
                  </TableHead>
                  <TableHead>{m.personal_mailbox_table_token()}</TableHead>
                  <TableHead>{m.personal_mailbox_table_last_read()}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mailboxes.map((mailbox) => (
                  <TableRow key={mailbox.id}>
                    <TableCell>
                      <div className="grid gap-1 whitespace-normal">
                        <span className="font-medium text-foreground">
                          {mailbox.email}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {mailbox.description ||
                            m.personal_mailbox_no_description()}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="grid gap-1 whitespace-normal">
                        <StatusBadge
                          value={getMailboxStatusLabel(mailbox.status)}
                          tone={getMailboxStatusTone(mailbox.status)}
                        />
                        {mailbox.lastGraphError ? (
                          <span className="max-w-80 text-xs text-destructive">
                            {mailbox.lastGraphError}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {m.personal_mailbox_graph_preferred()}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          mailbox.registrationEnabled ? 'outline' : 'secondary'
                        }
                      >
                        {mailbox.registrationEnabled
                          ? m.domain_badge_registration_enabled()
                          : m.domain_badge_registration_excluded()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">
                        {mailbox.graphRefreshTokenPreview ||
                          m.personal_mailbox_missing_token()}
                      </code>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {formatAdminDate(mailbox.lastGraphReadAt) ||
                          m.personal_mailbox_never_read()}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              title={m.personal_mailbox_empty_title()}
              description={m.personal_mailbox_empty_description()}
            />
          </CardContent>
        </Card>
      )}

      <ImportPersonalMailboxesDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={handleImported}
      />
    </div>
  )
}

function ImportPersonalMailboxesDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (result: ImportResult) => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [csvText, setCsvText] = useState('')
  const [importing, setImporting] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      return
    }

    setCsvText('')
    setFileName(null)
    setImporting(false)
  }, [open])

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setFileName(file.name)
    setCsvText(await file.text())
  }

  async function handleImport() {
    setImporting(true)

    try {
      const response = await fetch('/api/admin/personal-mailboxes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ csv: csvText }),
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const result = (await response.json()) as ImportResult
      onImported(result)
      showAppToast({
        kind: result.failed.length ? 'error' : 'success',
        title: result.failed.length
          ? m.personal_mailbox_import_partial_title()
          : m.personal_mailbox_import_success_title(),
        description: m.personal_mailbox_import_success_description({
          count: String(result.imported.length),
        }),
      })
      if (!result.failed.length) {
        onOpenChange(false)
      }
    } catch (error) {
      showAppToast({
        kind: 'error',
        title: m.personal_mailbox_import_failed_title(),
        description: getToastErrorDescription(
          error,
          m.personal_mailbox_import_failed_description(),
        ),
      })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[min(760px,calc(100%-2rem))] overflow-y-auto sm:max-w-[min(760px,calc(100%-2rem))]">
        <DialogHeader>
          <DialogDescription>
            {m.personal_mailbox_import_kicker()}
          </DialogDescription>
          <DialogTitle>{m.personal_mailbox_import_title()}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              void handleFileChange(event)
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUpIcon />
              {m.personal_mailbox_choose_file()}
            </Button>
            <span className="text-sm text-muted-foreground">
              {fileName || m.personal_mailbox_no_file_selected()}
            </span>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground">
              {m.personal_mailbox_csv_label()}
            </label>
            <Textarea
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              placeholder={m.personal_mailbox_csv_placeholder()}
              className="min-h-56 font-mono text-xs"
            />
            <p className="text-sm text-muted-foreground">
              {m.personal_mailbox_csv_description()}
            </p>
          </div>
        </div>

        <DialogFooter showCloseButton>
          <Button
            type="button"
            disabled={importing || !csvText.trim()}
            onClick={() => {
              void handleImport()
            }}
          >
            {importing ? <RefreshCwIcon className="animate-spin" /> : null}
            {importing
              ? m.personal_mailbox_importing()
              : m.personal_mailbox_import_submit()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function mergeMailboxes(
  current: ManagedPersonalMailbox[],
  imported: ManagedPersonalMailbox[],
) {
  const byId = new Map(current.map((mailbox) => [mailbox.id, mailbox]))
  for (const mailbox of imported) {
    byId.set(mailbox.id, mailbox)
  }

  return Array.from(byId.values()).sort((left, right) =>
    left.email.localeCompare(right.email),
  )
}

function getMailboxStatusLabel(status: ManagedPersonalMailbox['status']) {
  switch (status) {
    case 'configured':
      return m.status_configured()
    case 'error':
      return m.status_failed()
    default:
      return m.status_missing()
  }
}

function getMailboxStatusTone(
  status: ManagedPersonalMailbox['status'],
): StatusTone {
  switch (status) {
    case 'configured':
      return 'good'
    case 'error':
      return 'danger'
    default:
      return 'warning'
  }
}
