import { useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { AdminPageHeader } from '#/components/admin/layout'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import {
  CreateProxyNodeDialog,
  type ManagedProxyNode,
  ProxyNodesPageContent,
} from '#/components/admin/proxy-nodes'
import { Button } from '#/components/ui/button'
import { m } from '#/paraglide/messages'

const loadProxyNodes = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ getRequest }, { requireAdminPermission }, { listProxyNodes }] =
    await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../lib/server/auth'),
      import('../../lib/server/proxy-nodes'),
    ])
  const request = getRequest()

  try {
    await requireAdminPermission(request, 'PROXY_NODES')

    return {
      authorized: true as const,
      nodes: (await listProxyNodes()) as ManagedProxyNode[],
    }
  } catch {
    return { authorized: false as const }
  }
})

export const Route = createFileRoute('/admin/proxy-nodes')({
  validateSearch: (search: Record<string, unknown>) => ({
    create:
      search.create === true ||
      search.create === 'true' ||
      search.create === '1'
        ? true
        : undefined,
  }),
  loader: async () => loadProxyNodes(),
  component: AdminProxyNodesPage,
})

function AdminProxyNodesPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [createdNode, setCreatedNode] = useState<ManagedProxyNode | null>(null)

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  function setCreateDialogOpen(open: boolean) {
    void navigate({
      to: '/admin/proxy-nodes',
      search: {
        create: open ? true : undefined,
      },
      replace: true,
    })
  }

  return (
    <>
      <AdminPageHeader
        eyebrow={m.proxy_nodes_page_eyebrow()}
        title={m.proxy_nodes_page_title()}
        description={m.proxy_nodes_page_description()}
        variant="plain"
        actions={
          <Button
            type="button"
            onClick={() => {
              setCreateDialogOpen(true)
            }}
          >
            {m.proxy_nodes_create_submit()}
          </Button>
        }
      />

      <ProxyNodesPageContent
        initialNodes={data.nodes}
        createdNode={createdNode}
      />

      <CreateProxyNodeDialog
        open={Boolean(search.create)}
        onOpenChange={setCreateDialogOpen}
        onNodeCreated={(node) => {
          setCreatedNode(node)
        }}
      />
    </>
  )
}
