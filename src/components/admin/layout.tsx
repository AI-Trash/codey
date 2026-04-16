import type { ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  AppWindowIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MailIcon,
  MonitorSmartphoneIcon,
  PlusCircleIcon,
  ShieldCheckIcon,
} from 'lucide-react'

import { Badge } from '#/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '#/components/ui/breadcrumb'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#/components/ui/empty'
import { Separator } from '#/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '#/components/ui/sidebar'
import { cn } from '#/lib/utils'

type StatusTone = 'good' | 'warning' | 'danger' | 'neutral'

const operationsSubNavigation = [
  {
    label: 'Overview',
    to: '/admin',
    icon: LayoutDashboardIcon,
    matches: (pathname: string) => pathname === '/admin',
  },
  {
    label: 'Mail inbox',
    to: '/admin/emails',
    icon: MailIcon,
    matches: (pathname: string) => pathname === '/admin/emails',
  },
] as const

const oauthAppsSubNavigation = [
  {
    label: 'App registry',
    to: '/admin/apps',
    icon: AppWindowIcon,
    matches: (pathname: string) =>
      pathname === '/admin/apps' ||
      (pathname.startsWith('/admin/apps/') && pathname !== '/admin/apps/new'),
  },
  {
    label: 'Register app',
    to: '/admin/apps/new',
    icon: PlusCircleIcon,
    matches: (pathname: string) => pathname === '/admin/apps/new',
  },
] as const

const adminNavigation = [
  {
    label: 'Operations',
    to: '/admin',
    icon: LayoutDashboardIcon,
    matches: (pathname: string) =>
      pathname === '/admin' || pathname === '/admin/emails',
    children: operationsSubNavigation,
  },
  {
    label: 'OAuth apps',
    to: '/admin/apps',
    icon: AppWindowIcon,
    matches: (pathname: string) =>
      pathname === '/admin/apps' ||
      pathname === '/admin/apps/new' ||
      (pathname.startsWith('/admin/apps/') && pathname !== '/admin/apps/new'),
    children: oauthAppsSubNavigation,
  },
] as const

export function AdminShell(props: { children: ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <SidebarProvider defaultOpen className="min-h-svh bg-muted/30">
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader className="gap-3 p-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" tooltip="Codey admin">
                <Link to="/admin">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <ShieldCheckIcon className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">Codey Admin</span>
                    <span className="truncate text-xs text-muted-foreground">
                      Sidebar + table workspace
                    </span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Console</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNavigation.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={item.matches(pathname)}
                      tooltip={item.label}
                    >
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.children?.length ? (
                      <SidebarMenuSub>
                        {item.children.map((child) => (
                          <SidebarMenuSubItem key={child.to}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={child.matches(pathname)}
                            >
                              <Link to={child.to}>
                                <child.icon />
                                <span>{child.label}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>External</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Device flow">
                    <a href="/device">
                      <MonitorSmartphoneIcon />
                      <span>Device flow</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="gap-3 p-3">
          <Card className="gap-3 border-dashed py-4 shadow-none">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Layout controls</CardTitle>
              <CardDescription className="text-xs leading-5">
                Use Ctrl/Cmd + B to collapse the sidebar and open more table
                width.
              </CardDescription>
            </CardHeader>
          </Card>

          <form method="post" action="/auth/logout">
            <Button
              type="submit"
              variant="outline"
              className="w-full justify-start"
            >
              <LogOutIcon />
              Log out
            </Button>
          </form>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-h-svh">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <AdminBreadcrumb pathname={pathname} />
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="hidden md:inline-flex">
              Data-first admin
            </Badge>
          </div>
        </header>

        <main className="flex flex-1 flex-col p-4 md:p-6">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
            {props.children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function AdminBreadcrumb(props: { pathname: string }) {
  const currentLabel = getAdminPageLabel(props.pathname)

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/admin">Admin</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{currentLabel}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

export function AdminPageHeader(props: {
  eyebrow?: string
  title: string
  description: ReactNode
  actions?: ReactNode
  meta?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-5 rounded-xl border bg-background p-6 shadow-sm lg:flex-row lg:items-start lg:justify-between">
      <div className="max-w-4xl">
        {props.eyebrow ? (
          <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            {props.eyebrow}
          </p>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {props.title}
        </h1>
        <div className="mt-3 text-sm leading-7 text-muted-foreground">
          {props.description}
        </div>
      </div>

      <div className="flex min-w-0 flex-col items-start gap-3 lg:items-end">
        {props.meta}
        {props.actions ? (
          <div className="flex flex-wrap items-center gap-2">
            {props.actions}
          </div>
        ) : null}
      </div>
    </section>
  )
}

export function AdminMetricCard(props: {
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

export function StatusBadge(props: {
  value?: string | null
  tone?: StatusTone
  className?: string
}) {
  const value = props.value || 'Unknown'
  const tone = props.tone ?? getStatusTone(value)

  return (
    <Badge
      variant="outline"
      className={cn(
        'border px-2.5 py-1 text-xs font-medium capitalize',
        toneClasses[tone],
        props.className,
      )}
    >
      {value.replaceAll('_', ' ').toLowerCase()}
    </Badge>
  )
}

export function EmptyState(props: { title: string; description: string }) {
  return (
    <Empty className="rounded-xl border border-dashed py-10">
      <EmptyHeader>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function formatAdminDate(value: string | Date | null | undefined) {
  if (!value) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function getStatusTone(status?: string | null): StatusTone {
  const normalized = status?.toLowerCase() || ''

  if (
    normalized.includes('error') ||
    normalized.includes('denied') ||
    normalized.includes('failed') ||
    normalized.includes('missing') ||
    normalized.includes('inactive') ||
    normalized.includes('locked')
  ) {
    return 'danger'
  }

  if (
    normalized.includes('pending') ||
    normalized.includes('waiting') ||
    normalized.includes('queued') ||
    normalized.includes('partial') ||
    normalized.includes('review') ||
    normalized.includes('empty')
  ) {
    return 'warning'
  }

  if (!normalized) {
    return 'neutral'
  }

  return 'good'
}

function getAdminPageLabel(pathname: string) {
  if (pathname === '/admin') {
    return 'Operations'
  }

  if (pathname === '/admin/apps') {
    return 'OAuth apps'
  }

  if (pathname === '/admin/emails') {
    return 'Mail inbox'
  }

  if (pathname === '/admin/apps/new') {
    return 'Register app'
  }

  if (pathname.startsWith('/admin/apps/')) {
    return 'App details'
  }

  if (pathname === '/admin/login') {
    return 'Login'
  }

  return 'Admin'
}

const toneClasses: Record<StatusTone, string> = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-300',
  warning:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-950 dark:bg-amber-950/40 dark:text-amber-300',
  danger:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-950 dark:bg-red-950/40 dark:text-red-300',
  neutral: 'border-border bg-muted/50 text-muted-foreground dark:bg-muted/30',
}
