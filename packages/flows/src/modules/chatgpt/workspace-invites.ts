import fs from 'fs'
import path from 'path'
import type { Page, Request } from 'patchright'
import type { SelectorTarget } from '../../types'
import type { FlowOptions } from '../flow-cli/helpers'
import { sleep } from '../../utils/wait'
import { firstVisible, toLocator } from '../../utils/selectors'
import { CHATGPT_HOME_URL } from './common'

const ACCOUNTS_CHECK_VERSION = 'v4-2023-04-27'
const CHATGPT_ADMIN_URL = new URL('/admin', CHATGPT_HOME_URL).toString()
const CHATGPT_BACKEND_ORIGIN = new URL(CHATGPT_HOME_URL).origin
const INVITE_ROUTE_TEMPLATE = '/backend-api/accounts/:accountId/invites'
const ACCOUNTS_CHECK_ROUTE_TEMPLATE = '/backend-api/accounts/check/:version'
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

const ADMIN_PAGE_SIGNAL_SELECTORS: SelectorTarget[] = [
  { text: /成员|members/i },
  { text: /管理\s*[|｜]\s*成员|admin\s*[|｜]\s*members/i },
  {
    role: 'button',
    options: { name: /邀请成员|invite members|邀请团队成员/i },
  },
  { text: /邀请成员加入|invite members to/i },
]

const INVITE_BUTTON_SELECTORS: SelectorTarget[] = [
  {
    role: 'button',
    options: { name: /邀请成员|invite members|邀请团队成员/i },
  },
  { role: 'button', options: { name: /^邀请$|^invite$/i } },
  { text: /邀请成员|invite members|邀请团队成员/i },
  { text: /^邀请$|^invite$/i },
]

const INVITE_DIALOG_TITLE_SELECTORS: SelectorTarget[] = [
  { text: /邀请成员加入|invite members to/i },
  { text: /邀请成员|invite members/i },
]

const INVITE_EMAIL_INPUT_SELECTORS: SelectorTarget[] = [
  { label: /邮箱|电子邮件|email/i },
  { placeholder: /邮箱|电子邮件|email|comma|换行|newline/i },
  'textarea',
  'input[type="email"]',
  'input[name*="email"]',
  'input[id*="email"]',
]

const INVITE_SUBMIT_SELECTORS: SelectorTarget[] = [
  { role: 'button', options: { name: /发送邀请|邀请成员|invite members/i } },
  { role: 'button', options: { name: /^邀请$|^invite$/i } },
  { text: /发送邀请|邀请成员|invite members/i },
  { text: /^邀请$|^invite$/i },
  'button[type="submit"]',
]

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
  strategy: 'api' | 'ui'
  accountId?: string
  requestedEmails: string[]
  invitedEmails: string[]
  skippedEmails: string[]
  erroredEmails: string[]
  apiStatus?: number
  apiError?: string
  uiError?: string
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
  status?: number
  error?: string
}

interface UiInviteAttempt {
  ok: boolean
  invitedEmails: string[]
  skippedEmails: string[]
  erroredEmails: string[]
  error?: string
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
  })
  if (initialApiAttempt.ok) {
    return {
      strategy: 'api',
      accountId: initialApiAttempt.accountId,
      requestedEmails: emails,
      invitedEmails: initialApiAttempt.invitedEmails,
      skippedEmails: initialApiAttempt.skippedEmails,
      erroredEmails: initialApiAttempt.erroredEmails,
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
  })
  if (capturedApiAttempt.ok) {
    return {
      strategy: 'api',
      accountId: capturedApiAttempt.accountId,
      requestedEmails: emails,
      invitedEmails: capturedApiAttempt.invitedEmails,
      skippedEmails: capturedApiAttempt.skippedEmails,
      erroredEmails: capturedApiAttempt.erroredEmails,
      apiStatus: capturedApiAttempt.status,
      apiError: initialApiAttempt.error,
    }
  }

  const uiAttempt = await inviteMembersViaUi(page, emails, { accountId })
  if (uiAttempt.ok) {
    return {
      strategy: 'ui',
      accountId,
      requestedEmails: emails,
      invitedEmails: uiAttempt.invitedEmails,
      skippedEmails: uiAttempt.skippedEmails,
      erroredEmails: uiAttempt.erroredEmails,
      apiStatus: capturedApiAttempt.status || initialApiAttempt.status,
      apiError: capturedApiAttempt.error || initialApiAttempt.error,
    }
  }

  throw new Error(
    [
      'Failed to invite workspace members via API and UI fallback.',
      capturedApiAttempt.error || initialApiAttempt.error,
      uiAttempt.error,
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
      error: 'No invite-capable workspace account could be resolved.',
    }
  }

  const pendingInvites = await listPendingInvites(
    page,
    accountId,
    options.requestHeaders,
  )
  const alreadyPending = new Set(
    normalizeInviteEmails(
      pendingInvites.data?.account_invites?.map(
        (invite) => invite.email_address || '',
      ) || [],
    ),
  )
  const skippedEmails = requestedEmails.filter((email) =>
    alreadyPending.has(email),
  )
  const pendingInviteEmails = requestedEmails.filter(
    (email) => !alreadyPending.has(email),
  )

  if (!pendingInviteEmails.length) {
    return {
      ok: true,
      accountId,
      invitedEmails: [],
      skippedEmails,
      erroredEmails: [],
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
    status: response.status,
  }
}

async function inviteMembersViaUi(
  page: Page,
  requestedEmails: string[],
  options: {
    accountId?: string
  } = {},
): Promise<UiInviteAttempt> {
  try {
    await ensureWorkspaceAccountCookie(page, options.accountId)
    await page.goto(CHATGPT_ADMIN_URL, { waitUntil: 'domcontentloaded' })
    await waitForPageSignal(page, ADMIN_PAGE_SIGNAL_SELECTORS, 15000)

    await clickFirstVisible(page, INVITE_BUTTON_SELECTORS)
    const dialog = await waitForInviteDialog(page)
    const dialogRoot = dialog || page

    const input = await findEditableLocator(
      dialogRoot,
      INVITE_EMAIL_INPUT_SELECTORS,
    )
    if (!input) {
      throw new Error(
        'Invite dialog opened but no editable email input was found.',
      )
    }

    await input.click().catch(() => undefined)
    await input.fill(requestedEmails.join('\n'))

    const submitButton = await findVisibleLocator(
      dialogRoot,
      INVITE_SUBMIT_SELECTORS,
    )
    if (!submitButton) {
      throw new Error('Invite dialog opened but no submit button was found.')
    }

    await submitButton.click()

    if (dialog) {
      const dialogClosed = await dialog
        .waitFor({ state: 'hidden', timeout: 10000 })
        .then(() => true)
        .catch(() => false)
      if (dialogClosed) {
        return {
          ok: true,
          invitedEmails: requestedEmails,
          skippedEmails: [],
          erroredEmails: [],
        }
      }
    }

    const inviteSignals = [
      ...requestedEmails.map(
        (email) => ({ text: email }) satisfies SelectorTarget,
      ),
      {
        text: /\(邀请已发送\)|invite sent|pending invite/i,
      } satisfies SelectorTarget,
    ]
    const successDetected = await waitForPageSignal(page, inviteSignals, 10000)
    if (!successDetected) {
      throw new Error(
        'Invite dialog submit did not produce a visible success signal.',
      )
    }

    return {
      ok: true,
      invitedEmails: requestedEmails,
      skippedEmails: [],
      erroredEmails: [],
    }
  } catch (error) {
    return {
      ok: false,
      invitedEmails: [],
      skippedEmails: [],
      erroredEmails: [],
      error: error instanceof Error ? error.message : String(error),
    }
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
  const requestPath = `/backend-api/accounts/${accountId}/invites?offset=0&limit=250&query=`
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

async function ensureWorkspaceAccountCookie(
  page: Page,
  accountId?: string,
): Promise<void> {
  if (!accountId) return

  const currentCookie = (await page.context().cookies(CHATGPT_HOME_URL)).find(
    (entry) => entry.name === '_account',
  )
  if (currentCookie?.value === accountId) return

  await page.context().addCookies([
    {
      name: '_account',
      value: accountId,
      domain: currentCookie?.domain || 'chatgpt.com',
      path: currentCookie?.path || '/',
      expires: currentCookie?.expires || -1,
      httpOnly: currentCookie?.httpOnly || false,
      secure: currentCookie?.secure ?? true,
      sameSite: currentCookie?.sameSite || 'Lax',
    },
  ])
}

async function waitForInviteDialog(page: Page) {
  const titleReady = await waitForPageSignal(
    page,
    INVITE_DIALOG_TITLE_SELECTORS,
    10000,
  )
  if (!titleReady) return null

  const candidateDialogs = page.locator('[role="dialog"]')
  const dialogCount = await candidateDialogs.count().catch(() => 0)
  for (let index = dialogCount - 1; index >= 0; index -= 1) {
    const dialog = candidateDialogs.nth(index)
    if (await dialog.isVisible().catch(() => false)) {
      return dialog
    }
  }

  return null
}

async function waitForPageSignal(
  page: Page,
  selectors: SelectorTarget[],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = toLocator(page, selector).first()
      if (await locator.isVisible().catch(() => false)) {
        return true
      }
    }

    await sleep(250)
  }

  return false
}

async function clickFirstVisible(
  page: Page,
  selectors: SelectorTarget[],
): Promise<void> {
  const locator = await firstVisible(page, selectors)
  await locator.click()
}

async function findVisibleLocator(
  root: ScopedLocatorRoot,
  selectors: SelectorTarget[],
) {
  for (const selector of selectors) {
    const locator = toScopedLocator(root, selector)
    if (await locator.isVisible().catch(() => false)) {
      return locator
    }
  }

  for (const selector of selectors) {
    const locator = toScopedLocator(root, selector)
    try {
      await locator.waitFor({ state: 'visible', timeout: 3000 })
      return locator
    } catch {}
  }

  return null
}

async function findEditableLocator(
  root: ScopedLocatorRoot,
  selectors: SelectorTarget[],
) {
  for (const selector of selectors) {
    const locator = toScopedLocator(root, selector)
    const visible = await locator.isVisible().catch(() => false)
    if (!visible) continue

    const editable = await locator
      .evaluate((element) => {
        const candidate = element as HTMLInputElement | HTMLTextAreaElement
        const htmlElement = element as HTMLElement & { disabled?: boolean }
        return (
          !candidate.readOnly &&
          !htmlElement.disabled &&
          htmlElement.getAttribute('aria-disabled') !== 'true'
        )
      })
      .catch(async () => locator.isEditable().catch(() => false))

    if (editable) return locator
  }

  return null
}

type ScopedLocatorRoot = Page | ReturnType<Page['locator']>

function toScopedLocator(root: ScopedLocatorRoot, selector: SelectorTarget) {
  if (
    'locator' in root &&
    typeof root.locator === 'function' &&
    !('goto' in root)
  ) {
    if (typeof selector === 'string') {
      return root.locator(selector).first()
    }
    if ('css' in selector) return root.locator(selector.css).first()
    if ('role' in selector)
      return root.getByRole(selector.role, selector.options || {}).first()
    if ('text' in selector)
      return root.getByText(selector.text, selector.options || {}).first()
    if ('label' in selector)
      return root.getByLabel(selector.label, selector.options || {}).first()
    if ('placeholder' in selector) {
      return root
        .getByPlaceholder(selector.placeholder, selector.options || {})
        .first()
    }
    if ('testId' in selector) return root.getByTestId(selector.testId).first()
  }

  return toLocator(root as Page, selector).first()
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
