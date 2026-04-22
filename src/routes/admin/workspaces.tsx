import { useEffect, useMemo, useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  CalendarIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react'

import {
  AdminPageHeader,
  EmptyState,
  formatAdminDate,
} from '#/components/admin/layout'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { CopyableValue } from '#/components/ui/copyable-value'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Textarea } from '#/components/ui/textarea'
import { m } from '#/paraglide/messages'

const loadAdminWorkspaces = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [
      { getRequest },
      { requireAdminPermission },
      { listAdminManagedWorkspaceSummaries },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../lib/server/auth'),
      import('../../lib/server/workspaces'),
    ])

    const request = getRequest()

    try {
      await requireAdminPermission(request, 'MANAGED_IDENTITIES')
    } catch {
      return { authorized: false as const }
    }

    return {
      authorized: true as const,
      workspaces: await listAdminManagedWorkspaceSummaries(),
    }
  },
)

export const Route = createFileRoute('/admin/workspaces')({
  loader: async () => loadAdminWorkspaces(),
  component: AdminWorkspacesPage,
})

type WorkspaceMemberSummary = {
  id: string
  email: string
  identityId?: string | null
  identityLabel?: string | null
}

type WorkspaceSummary = {
  id: string
  workspaceId: string
  label?: string | null
  memberCount: number
  members: WorkspaceMemberSummary[]
  createdAt: string
  updatedAt: string
}

type SaveWorkspaceResponse = {
  ok: boolean
  workspace: WorkspaceSummary
}

type DeleteWorkspaceResponse = {
  ok: boolean
  id: string
}

type WorkspaceEditorState = {
  id?: string
  workspaceId: string
  label: string
  memberEmails: string
}

function createWorkspaceEditorState(
  summary?: WorkspaceSummary | null,
): WorkspaceEditorState {
  return {
    id: summary?.id,
    workspaceId: summary?.workspaceId || '',
    label: summary?.label || '',
    memberEmails: summary?.members.map((member) => member.email).join('\n') || '',
  }
}

function sortWorkspaceSummaries(workspaces: WorkspaceSummary[]) {
  return [...workspaces].sort((left, right) => {
    return (
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    )
  })
}

function upsertWorkspaceSummary(
  current: WorkspaceSummary[],
  workspace: WorkspaceSummary,
) {
  return sortWorkspaceSummaries([
    workspace,
    ...current.filter((entry) => entry.id !== workspace.id),
  ])
}

function filterWorkspaceSummaries(
  workspaces: WorkspaceSummary[],
  query: string,
): WorkspaceSummary[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return workspaces
  }

  return workspaces.filter((workspace) => {
    const searchableValues = [
      workspace.label,
      workspace.workspaceId,
      ...workspace.members.flatMap((member) => [
        member.email,
        member.identityId,
        member.identityLabel,
      ]),
    ]

    return searchableValues.some((value) =>
      String(value || '')
        .toLowerCase()
        .includes(normalizedQuery),
    )
  })
}

async function readResponseError(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  return body.trim() || m.admin_workspace_save_error_fallback()
}

async function saveWorkspace(
  editor: WorkspaceEditorState,
): Promise<WorkspaceSummary> {
  const response = await fetch('/api/admin/workspaces', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'save',
      id: editor.id,
      workspaceId: editor.workspaceId,
      label: editor.label,
      memberEmails: editor.memberEmails,
    }),
  })

  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }

  const payload = (await response.json()) as SaveWorkspaceResponse
  return payload.workspace
}

async function deleteWorkspace(id: string): Promise<string> {
  const response = await fetch('/api/admin/workspaces', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'delete',
      id,
    }),
  })

  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }

  const payload = (await response.json()) as DeleteWorkspaceResponse
  return payload.id
}

function WorkspaceMembersPreview(props: { workspace: WorkspaceSummary }) {
  if (!props.workspace.members.length) {
    return (
      <span className="text-sm text-muted-foreground">{m.oauth_none()}</span>
    )
  }

  const visibleMembers = props.workspace.members.slice(0, 2)
  const hiddenCount = props.workspace.members.length - visibleMembers.length

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {visibleMembers.map((member) => (
          <Badge key={member.id} variant="secondary" className="max-w-full">
            <span className="truncate">
              {member.identityLabel || member.email}
            </span>
          </Badge>
        ))}
        {hiddenCount > 0 ? (
          <Badge variant="outline">
            {m.admin_workspace_member_more({
              count: String(hiddenCount),
            })}
          </Badge>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground">
        {props.workspace.memberCount} {m.admin_workspace_members_label()}
      </div>
    </div>
  )
}

function AdminWorkspacesPage() {
  const data = Route.useLoaderData()
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>(
    () => ('workspaces' in data ? (data.workspaces as WorkspaceSummary[]) : []),
  )
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<WorkspaceEditorState>(
    createWorkspaceEditorState(),
  )
  const [editorOpen, setEditorOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSummary | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if ('workspaces' in data) {
      setWorkspaces(sortWorkspaceSummaries(data.workspaces as WorkspaceSummary[]))
    }
  }, [data])

  const filteredWorkspaces = useMemo(
    () => filterWorkspaceSummaries(workspaces, query),
    [query, workspaces],
  )

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        <AdminPageHeader
          title={m.admin_workspace_page_title()}
          description={m.admin_workspace_page_description()}
          variant="plain"
          actions={
            <>
              <Button asChild variant="outline">
                <a href="/admin">{m.admin_back_to_operations()}</a>
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setErrorMessage(null)
                  setEditor(createWorkspaceEditorState())
                  setEditorOpen(true)
                }}
              >
                <PlusIcon />
                {m.admin_workspace_create_button()}
              </Button>
            </>
          }
        />

        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>{m.status_failed()}</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CardHeader className="gap-4">
            <div>
              <CardDescription>
                {m.admin_workspace_table_kicker()}
              </CardDescription>
              <CardTitle>{m.admin_workspace_table_title()}</CardTitle>
            </div>
            <div className="relative max-w-md">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                }}
                placeholder={m.admin_workspace_search_placeholder()}
                className="pl-9"
              />
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col">
            {filteredWorkspaces.length ? (
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
                <Table className="min-w-[1080px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{m.admin_workspace_table_label()}</TableHead>
                      <TableHead>{m.admin_workspace_table_workspace_id()}</TableHead>
                      <TableHead>{m.admin_workspace_table_members()}</TableHead>
                      <TableHead>{m.admin_workspace_table_updated_at()}</TableHead>
                      <TableHead>{m.admin_dashboard_table_manage()}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredWorkspaces.map((workspace) => (
                      <TableRow key={workspace.id}>
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            <div className="font-medium text-foreground">
                              {workspace.label || m.admin_workspace_unnamed_label()}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {workspace.memberCount} {m.admin_workspace_members_label()}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <CopyableValue
                            value={workspace.workspaceId}
                            code
                            className="max-w-full text-sm text-muted-foreground"
                            contentClassName="break-all"
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <WorkspaceMembersPreview workspace={workspace} />
                        </TableCell>
                        <TableCell className="align-top text-sm text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <CalendarIcon className="size-4" />
                            {formatAdminDate(workspace.updatedAt)}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setErrorMessage(null)
                                setEditor(createWorkspaceEditorState(workspace))
                                setEditorOpen(true)
                              }}
                            >
                              <PencilIcon />
                              {m.admin_workspace_edit_button()}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setDeleteTarget(workspace)
                              }}
                            >
                              <Trash2Icon />
                              {m.admin_workspace_delete_button()}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState
                title={
                  query
                    ? m.admin_table_filtered_empty_title()
                    : m.admin_workspace_empty_title()
                }
                description={
                  query
                    ? m.admin_table_filtered_empty_description()
                    : m.admin_workspace_empty_description()
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (!isSaving) {
            setEditorOpen(open)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editor.id
                ? m.admin_workspace_dialog_edit_title()
                : m.admin_workspace_dialog_create_title()}
            </DialogTitle>
            <DialogDescription>
              {m.admin_workspace_dialog_description()}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <label className="space-y-2">
              <span className="text-sm font-medium">
                {m.admin_workspace_id_label()}
              </span>
              <Input
                value={editor.workspaceId}
                onChange={(event) => {
                  setEditor((current) => ({
                    ...current,
                    workspaceId: event.target.value,
                  }))
                }}
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium">
                {m.admin_workspace_label_label()}
              </span>
              <Input
                value={editor.label}
                placeholder={m.admin_workspace_label_placeholder()}
                onChange={(event) => {
                  setEditor((current) => ({
                    ...current,
                    label: event.target.value,
                  }))
                }}
              />
            </label>

            <label className="space-y-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                <UsersIcon className="size-4" />
                {m.admin_workspace_members_label()}
              </span>
              <Textarea
                value={editor.memberEmails}
                rows={8}
                onChange={(event) => {
                  setEditor((current) => ({
                    ...current,
                    memberEmails: event.target.value,
                  }))
                }}
              />
              <p className="text-sm text-muted-foreground">
                {m.admin_workspace_members_description()}
              </p>
            </label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditorOpen(false)
              }}
              disabled={isSaving}
            >
              {m.ui_close()}
            </Button>
            <Button
              type="button"
              disabled={isSaving}
              onClick={async () => {
                setIsSaving(true)
                setErrorMessage(null)

                try {
                  const workspace = await saveWorkspace(editor)
                  setWorkspaces((current) =>
                    upsertWorkspaceSummary(current, workspace),
                  )
                  setEditorOpen(false)
                } catch (error) {
                  setErrorMessage(
                    error instanceof Error
                      ? error.message
                      : m.admin_workspace_save_error_fallback(),
                  )
                } finally {
                  setIsSaving(false)
                }
              }}
            >
              {m.admin_workspace_save_button()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!isDeleting && !open) {
            setDeleteTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {m.admin_workspace_delete_confirm_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {m.admin_workspace_delete_confirm_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {m.ui_close()}
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeleting || !deleteTarget}
              onClick={async () => {
                if (!deleteTarget) {
                  return
                }

                setIsDeleting(true)
                setErrorMessage(null)

                try {
                  const deletedId = await deleteWorkspace(deleteTarget.id)
                  setWorkspaces((current) =>
                    current.filter((workspace) => workspace.id !== deletedId),
                  )
                  setDeleteTarget(null)
                } catch (error) {
                  setErrorMessage(
                    error instanceof Error
                      ? error.message
                      : m.admin_workspace_save_error_fallback(),
                  )
                } finally {
                  setIsDeleting(false)
                }
              }}
            >
              {m.admin_workspace_delete_button()}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
