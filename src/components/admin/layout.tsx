import type { ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  ActivityIcon,
  AppWindowIcon,
  BotIcon,
  ChevronsUpDownIcon,
  FingerprintIcon,
  GlobeIcon,
  KeyRoundIcon,
  LanguagesIcon,
  LogOutIcon,
  MailIcon,
  NetworkIcon,
  ShieldCheckIcon,
  SunMoonIcon,
  UsersIcon,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar'
import { Badge } from '#/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '#/components/ui/breadcrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#/components/ui/empty'
import { InfoTooltip } from '#/components/ui/info-tooltip'
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
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '#/components/ui/sidebar'
import {
  getDefaultAdminRoute,
  hasAdminPermission,
  type AdminPermission,
} from '#/lib/admin-access'
import { useThemeMode } from '#/hooks/use-theme-mode'
import {
  getCurrentLocaleDisplayName,
  getLocaleDisplayName,
  getThemeModeLabel,
  getThemeToggleLabel,
  translateStatusLabel,
} from '#/lib/i18n'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale, locales, setLocale } from '#/paraglide/runtime'

type StatusTone = 'good' | 'warning' | 'danger' | 'neutral'

export type AdminShellUser = {
  name: string | null
  email: string | null
  githubLogin: string | null
  avatarUrl: string | null
  role: 'ADMIN' | 'USER'
  permissions: AdminPermission[]
}

function getAdminNavigation(currentUser?: AdminShellUser | null) {
  const navigation = []

  if (hasAdminPermission(currentUser, 'MANAGED_IDENTITIES')) {
    navigation.push({
      label: m.admin_nav_workspaces(),
      to: '/admin/workspaces',
      icon: AppWindowIcon,
      matches: (pathname: string) => pathname === '/admin/workspaces',
    })
    navigation.push({
      label: m.admin_nav_identities(),
      to: '/admin/identities',
      icon: FingerprintIcon,
      matches: (pathname: string) =>
        pathname === '/admin/identities' ||
        pathname.startsWith('/admin/identities/'),
    })
  }

  if (hasAdminPermission(currentUser, 'CLI_OPERATIONS')) {
    navigation.push({
      label: m.admin_nav_flows(),
      to: '/admin/flows',
      icon: ActivityIcon,
      matches: (pathname: string) =>
        pathname === '/admin/flows' || pathname.startsWith('/admin/flows/'),
    })
  }

  if (hasAdminPermission(currentUser, 'MAIL_INBOX')) {
    navigation.push({
      label: m.admin_nav_mail_inbox(),
      to: '/admin/emails',
      icon: MailIcon,
      matches: (pathname: string) =>
        pathname === '/admin' || pathname === '/admin/emails',
    })
  }

  if (hasAdminPermission(currentUser, 'CLI_OPERATIONS')) {
    navigation.push({
      label: m.admin_nav_cli_connections(),
      to: '/admin/cli',
      icon: BotIcon,
      matches: (pathname: string) => pathname === '/admin/cli',
    })
  }

  if (hasAdminPermission(currentUser, 'MANAGED_SESSIONS')) {
    navigation.push({
      label: m.admin_nav_sessions(),
      to: '/admin/sessions',
      icon: KeyRoundIcon,
      matches: (pathname: string) => pathname === '/admin/sessions',
    })
  }

  if (hasAdminPermission(currentUser, 'OAUTH_CLIENTS')) {
    navigation.push({
      label: m.admin_nav_app_registry(),
      to: '/admin/apps',
      icon: AppWindowIcon,
      matches: (pathname: string) =>
        pathname === '/admin/apps' ||
        pathname === '/admin/apps/new' ||
        (pathname.startsWith('/admin/apps/') && pathname !== '/admin/apps/new'),
    })
    navigation.push({
      label: m.admin_nav_external_services(),
      to: '/admin/external-services',
      icon: AppWindowIcon,
      matches: (pathname: string) => pathname === '/admin/external-services',
    })
  }

  if (hasAdminPermission(currentUser, 'VERIFICATION_DOMAINS')) {
    navigation.push({
      label: m.admin_nav_domains(),
      to: '/admin/domains',
      icon: GlobeIcon,
      matches: (pathname: string) => pathname === '/admin/domains',
    })
  }

  if (hasAdminPermission(currentUser, 'PROXY_NODES')) {
    navigation.push({
      label: m.admin_nav_proxy_nodes(),
      to: '/admin/proxy-nodes',
      icon: NetworkIcon,
      matches: (pathname: string) => pathname === '/admin/proxy-nodes',
    })
  }

  if (hasAdminPermission(currentUser, 'USER_ACCESS')) {
    navigation.push({
      label: m.admin_nav_users(),
      to: '/admin/users',
      icon: UsersIcon,
      matches: (pathname: string) => pathname === '/admin/users',
    })
  }

  return navigation
}

export function AdminShell(props: {
  children: ReactNode
  currentUser?: AdminShellUser | null
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const adminNavigation = getAdminNavigation(props.currentUser)
  const usesViewportShell =
    pathname === '/admin' ||
    pathname === '/admin/emails' ||
    pathname === '/admin/identities' ||
    pathname === '/admin/workspaces' ||
    pathname === '/admin/sessions' ||
    pathname === '/admin/users' ||
    pathname === '/admin/cli' ||
    pathname === '/admin/flows' ||
    pathname.startsWith('/admin/flows/') ||
    pathname === '/admin/apps'

  return (
    <SidebarProvider defaultOpen className="min-h-svh bg-muted/30">
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader className="gap-3 p-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" tooltip={m.meta_app_title()}>
                <Link to="/">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <ShieldCheckIcon className="size-4" />
                  </div>
                  <div className="flex flex-1 items-center text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {m.meta_app_title()}
                    </span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent>
          {adminNavigation.length ? (
            <SidebarGroup>
              <SidebarGroupLabel>{m.admin_group_console()}</SidebarGroupLabel>
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
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}
        </SidebarContent>

        <SidebarSeparator />

        <SidebarFooter className="p-2">
          <AdminSidebarPreferences />
          {props.currentUser ? (
            <AdminUserMenu user={props.currentUser} />
          ) : null}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset
        className={cn(
          'min-h-svh',
          usesViewportShell && 'lg:h-svh lg:overflow-hidden',
        )}
      >
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <AdminBreadcrumb
            currentUser={props.currentUser}
            pathname={pathname}
          />
        </header>

        <main
          className={cn(
            'flex flex-1 flex-col p-4 md:p-6',
            usesViewportShell && 'lg:min-h-0 lg:overflow-hidden',
          )}
        >
          <div
            className={cn(
              'flex w-full flex-col gap-6',
              usesViewportShell && 'lg:min-h-0 lg:flex-1',
            )}
          >
            {props.children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function AdminBreadcrumb(props: {
  currentUser?: AdminShellUser | null
  pathname: string
}) {
  const currentLabel = getAdminPageLabel(props.pathname)
  const defaultRoute = getDefaultAdminRoute(props.currentUser)

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <a href={defaultRoute}>{m.admin_breadcrumb_root()}</a>
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
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  variant?: 'card' | 'plain'
}) {
  const isPlain = props.variant === 'plain'

  return (
    <section
      className={cn(
        'flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between',
        isPlain ? 'p-0' : 'rounded-xl border bg-background p-6 shadow-sm',
      )}
    >
      <div className="max-w-4xl">
        {props.eyebrow ? (
          <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            {props.eyebrow}
          </p>
        ) : null}
        <div className="flex items-start gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {props.title}
          </h1>
          <InfoTooltip
            content={props.description}
            label={props.title}
            className="mt-1.5"
          />
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

function AdminSidebarPreferences() {
  const { isMobile } = useSidebar()
  const currentLocale = getLocale()
  const { mode, setMode } = useThemeMode()
  const localeLabel = `${m.language_label()}. ${m.current_locale({
    locale: getCurrentLocaleDisplayName(),
  })}`
  const themeLabel = getThemeToggleLabel(mode)
  const dropdownSide = isMobile ? 'bottom' : 'right'

  return (
    <div className="flex flex-col gap-2">
      <SidebarGroupLabel>{m.admin_layout_controls_title()}</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                tooltip={localeLabel}
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <LanguagesIcon />
                <span>{getCurrentLocaleDisplayName()}</span>
                <ChevronsUpDownIcon className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-40 rounded-lg"
              side={dropdownSide}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel>{m.language_label()}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {locales.map((locale) => (
                <DropdownMenuItem
                  key={locale}
                  onSelect={() => setLocale(locale)}
                  className={
                    locale === currentLocale ? 'font-semibold' : undefined
                  }
                >
                  {getLocaleDisplayName(locale)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>

        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                tooltip={themeLabel}
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <SunMoonIcon />
                <span>{getThemeModeLabel(mode)}</span>
                <ChevronsUpDownIcon className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-40 rounded-lg"
              side={dropdownSide}
              align="end"
              sideOffset={4}
            >
              {(['light', 'dark', 'auto'] as const).map((nextMode) => (
                <DropdownMenuItem
                  key={nextMode}
                  onSelect={() => setMode(nextMode)}
                  className={nextMode === mode ? 'font-semibold' : undefined}
                >
                  {getThemeModeLabel(nextMode)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  )
}

function AdminUserMenu(props: { user: AdminShellUser }) {
  const { isMobile } = useSidebar()
  const primaryLabel = getAdminUserPrimaryLabel(props.user)
  const secondaryLabel = getAdminUserSecondaryLabel(props.user)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              tooltip={primaryLabel}
            >
              <Avatar className="rounded-lg" size="sm">
                <AvatarImage src={props.user.avatarUrl || undefined} />
                <AvatarFallback className="rounded-lg">
                  {getAdminUserInitials(props.user)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{primaryLabel}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {secondaryLabel}
                </span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="rounded-lg" size="sm">
                  <AvatarImage src={props.user.avatarUrl || undefined} />
                  <AvatarFallback className="rounded-lg">
                    {getAdminUserInitials(props.user)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{primaryLabel}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {secondaryLabel}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <form method="post" action="/auth/logout">
              <DropdownMenuItem asChild variant="destructive">
                <button type="submit" className="w-full">
                  <LogOutIcon />
                  {m.admin_log_out()}
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function StatusBadge(props: {
  value?: string | null
  tone?: StatusTone
  className?: string
}) {
  const value = props.value || m.status_unknown()
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
      {translateStatusLabel(value)}
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

  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function getStatusTone(status?: string | null): StatusTone {
  const normalized = status?.toLowerCase() || ''

  if (
    normalized.includes('banned') ||
    normalized.includes('deactivated') ||
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
    normalized.includes('leased') ||
    normalized.includes('waiting') ||
    normalized.includes('queued') ||
    normalized.includes('canceled') ||
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
    return m.admin_nav_mail_inbox()
  }

  if (pathname === '/admin/apps') {
    return m.admin_nav_app_registry()
  }

  if (pathname === '/admin/emails') {
    return m.admin_nav_mail_inbox()
  }

  if (pathname === '/admin/identities') {
    return m.admin_nav_identities()
  }

  if (pathname.startsWith('/admin/identities/')) {
    return m.admin_nav_identity_details()
  }

  if (pathname === '/admin/workspaces') {
    return m.admin_nav_workspaces()
  }

  if (pathname === '/admin/sessions') {
    return m.admin_nav_sessions()
  }

  if (pathname === '/admin/cli') {
    return m.admin_nav_cli_connections()
  }

  if (pathname === '/admin/flows') {
    return m.admin_nav_flows()
  }

  if (pathname.startsWith('/admin/flows/')) {
    return m.mail_inbox_table_details()
  }

  if (pathname === '/admin/apps/new') {
    return m.admin_nav_register_app()
  }

  if (pathname === '/admin/domains') {
    return m.admin_nav_domains()
  }

  if (pathname === '/admin/external-services') {
    return m.admin_nav_external_services()
  }

  if (pathname === '/admin/users') {
    return m.admin_nav_users()
  }

  if (pathname.startsWith('/admin/apps/')) {
    return m.admin_nav_app_details()
  }

  if (pathname === '/admin/login') {
    return m.admin_nav_login()
  }

  return m.admin_breadcrumb_root()
}

function getAdminUserPrimaryLabel(user: AdminShellUser) {
  return (
    user.name ||
    user.githubLogin ||
    user.email ||
    m.admin_sidebar_unknown_user()
  )
}

function getAdminUserSecondaryLabel(user: AdminShellUser) {
  const primaryLabel = getAdminUserPrimaryLabel(user)

  if (user.email && user.email !== primaryLabel) {
    return user.email
  }

  if (user.githubLogin && user.githubLogin !== primaryLabel) {
    return `@${user.githubLogin}`
  }

  return user.role === 'ADMIN'
    ? m.admin_sidebar_role_admin()
    : m.admin_sidebar_role_user()
}

function getAdminUserInitials(user: AdminShellUser) {
  const label = getAdminUserPrimaryLabel(user).trim()

  if (!label) {
    return 'AD'
  }

  const words = label.split(/[\s@._-]+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0]?.slice(0, 1) || ''}${words[1]?.slice(0, 1) || ''}`.toUpperCase()
  }

  return label.slice(0, 2).toUpperCase()
}

const toneClasses: Record<StatusTone, string> = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-300',
  warning:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-950 dark:bg-amber-950/40 dark:text-amber-300',
  danger:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-950 dark:bg-red-950/40 dark:text-red-300',
  neutral: 'border-border bg-muted/50 text-muted-foreground dark:bg-muted/30',
}
