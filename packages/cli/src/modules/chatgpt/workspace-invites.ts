import fs from 'fs'
import path from 'path'
import type { Page, Request } from 'patchright'
import type { FlowOptions } from '../flow-cli/helpers'
import { sleep } from '../../utils/wait'
import { CHATGPT_HOME_URL } from './common'

const ACCOUNTS_CHECK_VERSION = 'v4-2023-04-27'
const CHATGPT_ADMIN_URL = new URL('/admin', CHATGPT_HOME_URL).toString()
const CHATGPT_BACKEND_ORIGIN = new URL(CHATGPT_HOME_URL).origin
const INVITE_ROUTE_TEMPLATE = '/backend-api/accounts/:accountId/invites'
const WORKSPACE_USERS_ROUTE_TEMPLATE = '/backend-api/accounts/:accountId/users'
const WORKSPACE_USER_ROUTE_TEMPLATE =
  '/backend-api/accounts/:accountId/users/:userId'
const ACCOUNTS_CHECK_ROUTE_TEMPLATE = '/backend-api/accounts/check/:version'
const MAX_WORKSPACE_MEMBER_COUNT = 10
const PENDING_INVITES_PAGE_LIMIT = 100
const PENDING_INVITES_SCAN_LIMIT = 250
const WORKSPACE_USERS_PAGE_LIMIT = 25
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

const FORWARDABLE_API_HEADERS: Array<[source: string, target: string]> = [
  ['authorization', 'Authorization'],
  ['oai-client-build-number', 'OAI-Client-Build-Number'],
  ['oai-client-version', 'OAI-Client-Version'],
  ['oai-device-id', 'OAI-Device-Id'],
  ['oai-language', 'OAI-Language'],
  ['oai-session-id', 'OAI-Session-Id'],
]

export interface ResolvedInviteEmails {
  emails: string[]
  directInputEmails: string[]
  fileEmails: string[]
  inviteFilePath?: string
}

export interface ChatGPTInviteRecord {
  id?: string
  email_address?: string
  role?: string
  seat_type?: string
  created_time?: string
  is_scim_managed?: boolean
}

export interface ChatGPTWorkspaceInviteApiResponse {
  account_invites?: ChatGPTInviteRecord[]
  errored_emails?: string[]
}

export interface ChatGPTWorkspaceInvitesListResponse {
  account_invites?: ChatGPTInviteRecord[]
  limit?: number
  offset?: number
  total?: number
}

export interface ChatGPTWorkspaceUserRecord {
  id?: string
  account_user_id?: string
  email?: string
  verified_email?: string | null
  role?: string | null
  seat_type?: string | null
  credit_limits?: unknown
  name?: string | null
  created_time?: string | null
  is_scim_managed?: boolean
  deactivated_time?: string | null
}

export interface ChatGPTWorkspaceUsersListResponse {
  items?: ChatGPTWorkspaceUserRecord[]
  total?: number
  limit?: number
  offset?: number
}

export interface ChatGPTAccountsCheckResponse {
  accounts?: Record<
    string,
    {
      account?: {
        account_id?: string
        structure?: string | null
        plan_type?: string | null
        is_deactivated?: boolean | null
      }
      can_access_with_session?: boolean | null
    }
  >
  account_ordering?: string[]
}

export interface ChatGPTWorkspaceInviteResult {
  strategy: 'api'
  accountId?: string
  requestedEmails: string[]
  invitedEmails: string[]
  skippedEmails: string[]
  erroredEmails: string[]
  removedMemberEmails: string[]
  apiStatus?: number
  apiError?: string
}

interface BrowserApiResponse<T> {
  ok: boolean
  status: number
  url: string
  text: string
  data?: T
  error?: string
}

interface CapturedApiContext {
  accountId?: string
  headers: Record<string, string>
}

interface ApiInviteAttempt {
  ok: boolean
  accountId?: string
  invitedEmails: string[]
  skippedEmails: string[]
  erroredEmails: string[]
  removedMemberEmails: string[]
  status?: number
  error?: string
}

interface WorkspaceInviteOptions {
  pruneUnmanagedWorkspaceMembers?: boolean
  protectedEmails?: string[]
}

export function normalizeInviteEmails(inputs: Iterable<string>): string[] {
  const normalized = new Map<string, string>()

  for (const input of inputs) {
    const matches =
      typeof input === 'string' ? input.match(EMAIL_PATTERN) : null
    if (!matches) continue

    for (const match of matches) {
      const email = match.trim().toLowerCase()
      if (!email) continue
      normalized.set(email, email)
    }
  }

  return [...normalized.values()]
}

export function extractInviteEmailsFromJson(value: unknown): string[] {
  if (typeof value === 'string') {
    return normalizeInviteEmails([value])
  }

  if (Array.isArray(value)) {
    return normalizeInviteEmails(
      value.flatMap((entry) => extractInviteEmailsFromJson(entry)),
    )
  }

  if (value && typeof value === 'object') {
    return normalizeInviteEmails(
      Object.values(value).flatMap((entry) =>
        extractInviteEmailsFromJson(entry),
      ),
    )
  }

  return []
}

export function extractInviteEmailsFromCsv(content: string): string[] {
  const rows = parseCsvRows(stripByteOrderMark(content))
  if (!rows.length) return []

  const headerIndexes = findEmailColumnIndexes(rows[0] || [])
  if (headerIndexes.length && rows.length > 1) {
    return normalizeInviteEmails(
      rows
        .slice(1)
        .flatMap((row) => headerIndexes.map((index) => row[index] || '')),
    )
  }

  return normalizeInviteEmails(rows.flatMap((row) => row))
}

export function loadInviteEmailsFromFile(filePath: string): {
  emails: string[]
  inviteFilePath: string
} {
  const inviteFilePath = path.resolve(filePath)
  const content = stripByteOrderMark(fs.readFileSync(inviteFilePath, 'utf8'))
  const ext = path.extname(inviteFilePath).toLowerCase()

  if (ext === '.json') {
    return {
      emails: extractInviteEmailsFromJson(JSON.parse(content)),
      inviteFilePath,
    }
  }

  if (ext === '.csv') {
    return {
      emails: extractInviteEmailsFromCsv(content),
      inviteFilePath,
    }
  }

  return {
    emails: normalizeInviteEmails(content.split(/[\r\n,;]+/)),
    inviteFilePath,
  }
}

export function resolveInviteEmails(
  options: Pick<FlowOptions, 'inviteEmail' | 'inviteFile'>,
): ResolvedInviteEmails {
  const directInputEmails = normalizeInviteEmails(asArray(options.inviteEmail))
  const fileResolution = options.inviteFile
    ? loadInviteEmailsFromFile(options.inviteFile)
    : undefined
  const fileEmails = fileResolution?.emails || []

  return {
    emails: normalizeInviteEmails([...directInputEmails, ...fileEmails]),
    directInputEmails,
    fileEmails,
    inviteFilePath: fileResolution?.inviteFilePath,
  }
}

export function selectInviteCapableAccount(
  payload: ChatGPTAccountsCheckResponse,
  currentAccountId?: string,
): string | undefined {
  const entries = new Map<
    string,
    NonNullable<ChatGPTAccountsCheckResponse['accounts']>[string]
  >()

  for (const [key, entry] of Object.entries(payload.accounts || {})) {
    const accountId = entry?.account?.account_id || key
    if (!accountId || accountId === 'default') continue
    entries.set(accountId, entry)
  }

  const orderedIds = dedupe([
    currentAccountId,
    ...(payload.account_ordering || []),
    ...entries.keys(),
  ])

  const currentEntry = currentAccountId
    ? entries.get(currentAccountId)
    : undefined
  if (currentAccountId && isInviteCapableAccount(currentEntry)) {
    return currentAccountId
  }

  for (const accountId of orderedIds) {
    if (isInviteCapableAccount(entries.get(accountId))) {
      return accountId
    }
  }

  return undefined
}

export async function inviteWorkspaceMembers(
  page: Page,
  requestedEmails: string[],
  options: WorkspaceInviteOptions = {},
): Promise<ChatGPTWorkspaceInviteResult> {
  const emails = normalizeInviteEmails(requestedEmails)
  if (!emails.length) {
    throw new Error(
      'No invite emails were provided. Pass --inviteEmail or --inviteFile.',
    )
  }

  let accountId = await resolveWorkspaceAccountId(page)
  const initialApiAttempt = await inviteMembersViaApi(page, emails, {
    accountId,
    pruneUnmanagedWorkspaceMembers: options.pruneUnmanagedWorkspaceMembers,
    protectedEmails: options.protectedEmails,
  })
  if (initialApiAttempt.ok) {
    return {
      strategy: 'api',
      accountId: initialApiAttempt.accountId,
      requestedEmails: emails,
      invitedEmails: initialApiAttempt.invitedEmails,
      skippedEmails: initialApiAttempt.skippedEmails,
      erroredEmails: initialApiAttempt.erroredEmails,
      removedMemberEmails: initialApiAttempt.removedMemberEmails,
      apiStatus: initialApiAttempt.status,
    }
  }

  const capturedApiContext = await captureApiContextFromAdmin(page)
  accountId =
    capturedApiContext?.accountId ||
    accountId ||
    (await resolveWorkspaceAccountId(page, capturedApiContext?.headers))

  const capturedApiAttempt = await inviteMembersViaApi(page, emails, {
    accountId,
    requestHeaders: capturedApiContext?.headers,
    pruneUnmanagedWorkspaceMembers: options.pruneUnmanagedWorkspaceMembers,
    protectedEmails: options.protectedEmails,
  })
  if (capturedApiAttempt.ok) {
    return {
      strategy: 'api',
      accountId: capturedApiAttempt.accountId,
      requestedEmails: emails,
      invitedEmails: capturedApiAttempt.invitedEmails,
      skippedEmails: capturedApiAttempt.skippedEmails,
      erroredEmails: capturedApiAttempt.erroredEmails,
      removedMemberEmails: capturedApiAttempt.removedMemberEmails,
      apiStatus: capturedApiAttempt.status,
      apiError: initialApiAttempt.error,
    }
  }

  throw new Error(
    [
      'Failed to invite workspace members via API.',
      capturedApiAttempt.error || initialApiAttempt.error,
    ]
      .filter(Boolean)
      .join(' '),
  )
}

async function inviteMembersViaApi(
  page: Page,
  requestedEmails: string[],
  options: {
    accountId?: string
    requestHeaders?: Record<string, string>
    pruneUnmanagedWorkspaceMembers?: boolean
    protectedEmails?: string[]
  } = {},
): Promise<ApiInviteAttempt> {
  const accountId =
    options.accountId ||
    (await resolveWorkspaceAccountId(page, options.requestHeaders))
  if (!accountId) {
    return {
      ok: false,
      invitedEmails: [],
      skippedEmails: [],
      erroredEmails: [],
      removedMemberEmails: [],
      error: 'No invite-capable workspace account could be resolved.',
    }
  }

  const workspaceMembers = await listWorkspaceMembers(
    page,
    accountId,
    options.requestHeaders,
  )
  if (!workspaceMembers.ok) {
    return {
      ok: false,
      accountId,
      invitedEmails: [],
      skippedEmails: [],
      erroredEmails: [],
      removedMemberEmails: [],
      status: workspaceMembers.status,
      error: buildApiErrorMessage('list workspace members', workspaceMembers),
    }
  }

  const pendingInvites = await listPendingInvites(
    page,
    accountId,
    options.requestHeaders,
  )
  if (!pendingInvites.ok) {
    return {
      ok: false,
      accountId,
      invitedEmails: [],
      skippedEmails: [],
      erroredEmails: [],
      removedMemberEmails: [],
      status: pendingInvites.status,
      error: buildApiErrorMessage('list pending invites', pendingInvites),
    }
  }

  let existingMembers = workspaceMembers.data?.items || []
  const removedMemberEmails: string[] = []
  if (options.pruneUnmanagedWorkspaceMembers) {
    const unmanagedRemovalPlan = planUnmanagedWorkspaceMemberRemovals({
      members: existingMembers,
      managedEmails: requestedEmails,
      protectedEmails: options.protectedEmails,
    })
    const removal = await removeWorkspaceMemberList(
      page,
      accountId,
      unmanagedRemovalPlan,
      options.requestHeaders,
    )

    if (!removal.ok) {
      return {
        ok: false,
        accountId,
        invitedEmails: [],
        skippedEmails: [],
        erroredEmails: [],
        removedMemberEmails,
        status: removal.status,
        error: removal.error,
      }
    }

    removedMemberEmails.push(...removal.removedMemberEmails)
    const removedMembers = new Set(unmanagedRemovalPlan)
    existingMembers = existingMembers.filter(
      (member) => !removedMembers.has(member),
    )
  }

  const existingMemberEmails = new Set(
    normalizeInviteEmails(existingMembers.map(getWorkspaceUserEmail)),
  )
  const alreadyPending = new Set(
    normalizeInviteEmails(
      pendingInvites.data?.account_invites?.map(
        (invite) => invite.email_address || '',
      ) || [],
    ),
  )
  const skippedEmails = requestedEmails.filter(
    (email) => alreadyPending.has(email) || existingMemberEmails.has(email),
  )
  const pendingInviteEmails = requestedEmails.filter((email) => {
    return !alreadyPending.has(email) && !existingMemberEmails.has(email)
  })

  const removalPlan = planWorkspaceMemberRemovals({
    members: existingMembers,
    inviteCount: pendingInviteEmails.length,
  })
  const requiredSeatCount = Math.max(
    0,
    existingMembers.length +
      pendingInviteEmails.length -
      MAX_WORKSPACE_MEMBER_COUNT,
  )

  if (requiredSeatCount > removalPlan.length) {
    return {
      ok: false,
      accountId,
      invitedEmails: [],
      skippedEmails,
      erroredEmails: [],
      removedMemberEmails,
      error: buildWorkspaceCapacityError({
        currentMemberCount: existingMembers.length,
        inviteCount: pendingInviteEmails.length,
        removableCount: removalPlan.length,
      }),
    }
  }

  const capacityRemoval = await removeWorkspaceMemberList(
    page,
    accountId,
    removalPlan,
    options.requestHeaders,
  )
  if (!capacityRemoval.ok) {
    return {
      ok: false,
      accountId,
      invitedEmails: [],
      skippedEmails,
      erroredEmails: [],
      removedMemberEmails,
      status: capacityRemoval.status,
      error: capacityRemoval.error,
    }
  }
  removedMemberEmails.push(...capacityRemoval.removedMemberEmails)

  if (!pendingInviteEmails.length) {
    return {
      ok: true,
      accountId,
      invitedEmails: [],
      skippedEmails,
      erroredEmails: [],
      removedMemberEmails,
      status: pendingInvites.status,
    }
  }

  const requestPath = `/backend-api/accounts/${accountId}/invites`
  const response = await fetchChatGPTJsonApi<ChatGPTWorkspaceInviteApiResponse>(
    page,
    `${CHATGPT_BACKEND_ORIGIN}${requestPath}`,
    {
      method: 'POST',
      headers: buildChatGPTApiHeaders({
        accountId,
        requestHeaders: options.requestHeaders,
        path: requestPath,
        route: INVITE_ROUTE_TEMPLATE,
        contentType: 'application/json',
      }),
      body: JSON.stringify({
        email_addresses: pendingInviteEmails,
        role: 'standard-user',
        seat_type: 'default',
        resend_emails: true,
      }),
    },
  )

  if (!response.ok) {
    return {
      ok: false,
      accountId,
      invitedEmails: [],
      skippedEmails,
      erroredEmails: [],
      removedMemberEmails,
      status: response.status,
      error: buildApiErrorMessage('invite members', response),
    }
  }

  const invitedEmails = normalizeInviteEmails(
    response.data?.account_invites?.map(
      (invite) => invite.email_address || '',
    ) || [],
  )
  const erroredEmails = normalizeInviteEmails(
    response.data?.errored_emails || [],
  )

  return {
    ok: true,
    accountId,
    invitedEmails: invitedEmails.length
      ? invitedEmails
      : pendingInviteEmails.filter((email) => !erroredEmails.includes(email)),
    skippedEmails,
    erroredEmails,
    removedMemberEmails,
    status: response.status,
  }
}

async function captureApiContextFromAdmin(
  page: Page,
): Promise<CapturedApiContext | undefined> {
  const captures: CapturedApiContext[] = []
  const handleRequest = (request: Request) => {
    const url = request.url()
    if (!url.startsWith(`${CHATGPT_BACKEND_ORIGIN}/backend-api/`)) return

    const headers = request.headers()
    if (!headers.authorization && !headers['chatgpt-account-id']) return

    captures.push({
      accountId:
        extractAccountIdFromUrl(url) ||
        headers['chatgpt-account-id'] ||
        undefined,
      headers,
    })
  }

  page.on('request', handleRequest)
  try {
    await page.goto(CHATGPT_ADMIN_URL, { waitUntil: 'domcontentloaded' })
    await Promise.allSettled([
      page.waitForLoadState('networkidle', { timeout: 5000 }),
      sleep(1500),
    ])
  } finally {
    page.off('request', handleRequest)
  }

  return pickBestCapturedApiContext(captures)
}

async function resolveWorkspaceAccountId(
  page: Page,
  requestHeaders?: Record<string, string>,
): Promise<string | undefined> {
  const currentAccountId = await readCurrentAccountCookie(page)
  const timezoneOffsetMinutes = await page
    .evaluate(() => new Date().getTimezoneOffset())
    .catch(() => new Date().getTimezoneOffset())
  const requestPath =
    `/backend-api/accounts/check/${ACCOUNTS_CHECK_VERSION}` +
    `?timezone_offset_min=${timezoneOffsetMinutes}`

  const response = await fetchChatGPTJsonApi<ChatGPTAccountsCheckResponse>(
    page,
    `${CHATGPT_BACKEND_ORIGIN}${requestPath}`,
    {
      headers: buildChatGPTApiHeaders({
        requestHeaders,
        path: requestPath,
        route: ACCOUNTS_CHECK_ROUTE_TEMPLATE,
      }),
    },
  )

  if (response.ok && response.data) {
    return (
      selectInviteCapableAccount(response.data, currentAccountId) ||
      currentAccountId
    )
  }

  return currentAccountId
}

async function listPendingInvites(
  page: Page,
  accountId: string,
  requestHeaders?: Record<string, string>,
): Promise<BrowserApiResponse<ChatGPTWorkspaceInvitesListResponse>> {
  const collectedInvites: ChatGPTInviteRecord[] = []
  let offset = 0
  let total: number | undefined
  let lastResponse:
    | BrowserApiResponse<ChatGPTWorkspaceInvitesListResponse>
    | undefined

  while (offset < PENDING_INVITES_SCAN_LIMIT) {
    const limit = Math.min(
      PENDING_INVITES_PAGE_LIMIT,
      PENDING_INVITES_SCAN_LIMIT - offset,
    )
    const response = await listPendingInvitesPage(
      page,
      accountId,
      offset,
      limit,
      requestHeaders,
    )

    if (!response.ok) {
      return response
    }

    const pageInvites = response.data?.account_invites || []
    collectedInvites.push(...pageInvites)
    total = readNonNegativeInteger(response.data?.total) ?? total
    lastResponse = response

    if (pageInvites.length < limit) {
      break
    }

    offset += limit
    if (total != null && offset >= total) {
      break
    }
  }

  return {
    ok: lastResponse?.ok ?? true,
    status: lastResponse?.status ?? 200,
    url: lastResponse?.url ?? '',
    text: lastResponse?.text ?? '',
    data: {
      ...lastResponse?.data,
      account_invites: collectedInvites,
      limit: collectedInvites.length,
      offset: 0,
      total,
    },
  }
}

async function listPendingInvitesPage(
  page: Page,
  accountId: string,
  offset: number,
  limit: number,
  requestHeaders?: Record<string, string>,
): Promise<BrowserApiResponse<ChatGPTWorkspaceInvitesListResponse>> {
  const requestPath =
    `/backend-api/accounts/${accountId}/invites` +
    `?offset=${offset}&limit=${limit}&query=`
  return fetchChatGPTJsonApi<ChatGPTWorkspaceInvitesListResponse>(
    page,
    `${CHATGPT_BACKEND_ORIGIN}${requestPath}`,
    {
      headers: buildChatGPTApiHeaders({
        accountId,
        requestHeaders,
        path: requestPath,
        route: INVITE_ROUTE_TEMPLATE,
      }),
    },
  )
}

async function listWorkspaceMembers(
  page: Page,
  accountId: string,
  requestHeaders?: Record<string, string>,
): Promise<BrowserApiResponse<ChatGPTWorkspaceUsersListResponse>> {
  const requestPath =
    `/backend-api/accounts/${accountId}/users` +
    `?offset=0&limit=${WORKSPACE_USERS_PAGE_LIMIT}&query=`

  return fetchChatGPTJsonApi<ChatGPTWorkspaceUsersListResponse>(
    page,
    `${CHATGPT_BACKEND_ORIGIN}${requestPath}`,
    {
      headers: buildChatGPTApiHeaders({
        accountId,
        requestHeaders,
        path: requestPath,
        route: WORKSPACE_USERS_ROUTE_TEMPLATE,
      }),
    },
  )
}

async function removeWorkspaceMember(
  page: Page,
  accountId: string,
  userId: string,
  requestHeaders?: Record<string, string>,
): Promise<BrowserApiResponse<{ success?: boolean }>> {
  const requestPath = `/backend-api/accounts/${accountId}/users/${userId}`
  return fetchChatGPTJsonApi<{ success?: boolean }>(
    page,
    `${CHATGPT_BACKEND_ORIGIN}${requestPath}`,
    {
      method: 'DELETE',
      headers: buildChatGPTApiHeaders({
        accountId,
        requestHeaders,
        path: requestPath,
        route: WORKSPACE_USER_ROUTE_TEMPLATE,
      }),
    },
  )
}

async function removeWorkspaceMemberList(
  page: Page,
  accountId: string,
  members: ChatGPTWorkspaceUserRecord[],
  requestHeaders?: Record<string, string>,
): Promise<{
  ok: boolean
  status?: number
  error?: string
  removedMemberEmails: string[]
}> {
  const removedMemberEmails: string[] = []

  for (const member of members) {
    const userId = typeof member.id === 'string' ? member.id.trim() : ''
    if (!userId) {
      return {
        ok: false,
        removedMemberEmails,
        error: 'A removable workspace member did not include a user id.',
      }
    }

    const removal = await removeWorkspaceMember(
      page,
      accountId,
      userId,
      requestHeaders,
    )
    if (!removal.ok || removal.data?.success === false) {
      return {
        ok: false,
        removedMemberEmails,
        status: removal.status,
        error: buildApiErrorMessage(
          `remove workspace member ${getWorkspaceUserEmail(member) || userId}`,
          removal,
        ),
      }
    }

    const email = getWorkspaceUserEmail(member)
    if (email) {
      removedMemberEmails.push(email)
    }
  }

  return {
    ok: true,
    removedMemberEmails,
  }
}

export function planWorkspaceMemberRemovals(input: {
  members: ChatGPTWorkspaceUserRecord[]
  inviteCount: number
  memberLimit?: number
}): ChatGPTWorkspaceUserRecord[] {
  const inviteCount = Math.max(0, Math.trunc(input.inviteCount))
  const memberLimit =
    typeof input.memberLimit === 'number' && input.memberLimit > 0
      ? Math.trunc(input.memberLimit)
      : MAX_WORKSPACE_MEMBER_COUNT
  const seatsToFree = Math.max(
    0,
    input.members.length + inviteCount - memberLimit,
  )

  if (!seatsToFree) {
    return []
  }

  return [...input.members]
    .filter(isRemovableWorkspaceMember)
    .sort(compareWorkspaceRemovalCandidates)
    .slice(0, seatsToFree)
}

export function planUnmanagedWorkspaceMemberRemovals(input: {
  members: ChatGPTWorkspaceUserRecord[]
  managedEmails: string[]
  protectedEmails?: string[]
}): ChatGPTWorkspaceUserRecord[] {
  const managedEmails = new Set(normalizeInviteEmails(input.managedEmails))
  const protectedEmails = new Set(
    normalizeInviteEmails(input.protectedEmails || []),
  )

  return [...input.members]
    .filter((member) => {
      const email = getWorkspaceUserEmail(member)
      return (
        email &&
        !managedEmails.has(email) &&
        !protectedEmails.has(email) &&
        isRemovableWorkspaceMember(member)
      )
    })
    .sort(compareWorkspaceRemovalCandidates)
}

async function fetchChatGPTJsonApi<T>(
  page: Page,
  url: string,
  init: {
    method?: string
    headers?: Record<string, string>
    body?: string
  } = {},
): Promise<BrowserApiResponse<T>> {
  const response = await page.evaluate(
    async ({ url: nextUrl, method, headers, body }) => {
      try {
        const requestInit: RequestInit = {
          method,
          headers,
          credentials: 'include',
        }
        if (body != null) {
          requestInit.body = body
        }
        const request = await fetch(nextUrl, {
          ...requestInit,
        })
        const text = await request.text()
        return {
          ok: request.ok,
          status: request.status,
          url: request.url,
          text,
        }
      } catch (error) {
        return {
          ok: false,
          status: 0,
          url: nextUrl,
          text: '',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
    {
      url,
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body,
    },
  )

  if (response.error) {
    return response
  }

  try {
    return {
      ...response,
      data: response.text ? (JSON.parse(response.text) as T) : undefined,
    }
  } catch {
    return response
  }
}

function buildChatGPTApiHeaders(options: {
  accountId?: string
  requestHeaders?: Record<string, string>
  path: string
  route: string
  contentType?: string
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-OpenAI-Target-Path': options.path,
    'X-OpenAI-Target-Route': options.route,
  }

  if (options.contentType) {
    headers['Content-Type'] = options.contentType
  }

  if (options.accountId) {
    headers['ChatGPT-Account-ID'] = options.accountId
  }

  for (const [source, target] of FORWARDABLE_API_HEADERS) {
    const value = options.requestHeaders?.[source]
    if (value) {
      headers[target] = value
    }
  }

  return headers
}

function buildApiErrorMessage(
  action: string,
  response: BrowserApiResponse<unknown>,
): string {
  if (response.error) {
    return `Unable to ${action}: ${response.error}`
  }

  const excerpt = response.text.trim().slice(0, 240)
  return excerpt
    ? `Unable to ${action}: HTTP ${response.status} ${excerpt}`
    : `Unable to ${action}: HTTP ${response.status}`
}

function extractAccountIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/backend-api\/accounts\/([^/?]+)/i)
  return match?.[1]
}

function pickBestCapturedApiContext(
  captures: CapturedApiContext[],
): CapturedApiContext | undefined {
  return (
    captures.find((capture) => Boolean(capture.accountId)) ||
    captures.find((capture) => Boolean(capture.headers.authorization)) ||
    captures[0]
  )
}

async function readCurrentAccountCookie(
  page: Page,
): Promise<string | undefined> {
  const cookie = (await page.context().cookies(CHATGPT_HOME_URL)).find(
    (entry) => entry.name === '_account',
  )
  return cookie?.value || undefined
}

function isInviteCapableAccount(
  entry?: NonNullable<ChatGPTAccountsCheckResponse['accounts']>[string],
): boolean {
  const account = entry?.account
  if (!account?.account_id) return false
  if (account.is_deactivated) return false
  if (account.structure !== 'workspace') return false
  return entry?.can_access_with_session !== false
}

function getWorkspaceUserEmail(member: ChatGPTWorkspaceUserRecord): string {
  return (
    normalizeInviteEmails([member.email || member.verified_email || ''])[0] ||
    ''
  )
}

function isRemovableWorkspaceMember(
  member: ChatGPTWorkspaceUserRecord,
): boolean {
  const userId = typeof member.id === 'string' ? member.id.trim() : ''
  if (!userId) {
    return false
  }

  const role = member.role?.trim().toLowerCase() || ''
  return !role.includes('owner')
}

function compareWorkspaceRemovalCandidates(
  left: ChatGPTWorkspaceUserRecord,
  right: ChatGPTWorkspaceUserRecord,
): number {
  const deactivatedDelta =
    Number(Boolean(right.deactivated_time)) -
    Number(Boolean(left.deactivated_time))
  if (deactivatedDelta !== 0) {
    return deactivatedDelta
  }

  const roleDelta =
    readWorkspaceRemovalRolePriority(left.role) -
    readWorkspaceRemovalRolePriority(right.role)
  if (roleDelta !== 0) {
    return roleDelta
  }

  const createdDelta =
    readSortableTimestamp(left.created_time) -
    readSortableTimestamp(right.created_time)
  if (Number.isFinite(createdDelta) && createdDelta !== 0) {
    return createdDelta
  }

  return (left.email || left.id || '').localeCompare(
    right.email || right.id || '',
  )
}

function readWorkspaceRemovalRolePriority(
  role: string | null | undefined,
): number {
  const normalized = role?.trim().toLowerCase() || ''
  if (!normalized) {
    return 10
  }
  if (normalized.includes('standard') || normalized.includes('member')) {
    return 0
  }
  if (normalized.includes('admin')) {
    return 20
  }
  return 10
}

function readSortableTimestamp(value: string | null | undefined): number {
  if (!value) {
    return Number.POSITIVE_INFINITY
  }

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}

function buildWorkspaceCapacityError(input: {
  currentMemberCount: number
  inviteCount: number
  removableCount: number
}): string {
  return [
    `Workspace member limit is ${MAX_WORKSPACE_MEMBER_COUNT}.`,
    `Current members: ${input.currentMemberCount}.`,
    `Pending new invites: ${input.inviteCount}.`,
    `Removable members available: ${input.removableCount}.`,
  ].join(' ')
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < content.length; index += 1) {
    const current = content[index]
    const next = content[index + 1]

    if (current === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        index += 1
        continue
      }

      inQuotes = !inQuotes
      continue
    }

    if (!inQuotes && current === ',') {
      row.push(cell)
      cell = ''
      continue
    }

    if (!inQuotes && (current === '\n' || current === '\r')) {
      if (current === '\r' && next === '\n') {
        index += 1
      }
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += current
  }

  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }

  return rows.filter((currentRow) =>
    currentRow.some((cellValue) => cellValue.trim().length),
  )
}

function findEmailColumnIndexes(headerRow: string[]): number[] {
  const indexes: number[] = []

  for (const [index, column] of headerRow.entries()) {
    const normalized = column.trim().toLowerCase()
    if (
      normalized === 'email' ||
      normalized === 'emails' ||
      normalized === 'email_address' ||
      normalized === 'email address' ||
      normalized === 'mail'
    ) {
      indexes.push(index)
    }
  }

  return indexes
}

function stripByteOrderMark(content: string): string {
  return content.replace(/^\uFEFF/, '')
}

function dedupe(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function asArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [value]
  return []
}
