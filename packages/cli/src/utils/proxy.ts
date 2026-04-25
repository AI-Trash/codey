import { execFileSync } from 'child_process'

export interface ProxyConfig {
  server: string
  bypass?: string
  username?: string
  password?: string
}

const WINDOWS_INTERNET_SETTINGS_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

const LOCAL_BYPASS_ENTRIES = ['localhost', '127.0.0.1', '::1']

const EXPLICIT_PROXY_ENV_NAMES = [
  'CODEY_PROXY_URL',
  'CODEY_PROXY_SERVER',
  'CODEY_BROWSER_PROXY_URL',
  'CODEY_BROWSER_PROXY_SERVER',
  'CODEX_PROXY_URL',
  'HTTPS_PROXY',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'HTTP_PROXY',
  'http_proxy',
] as const

function readFirstEnvValue(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = env[name]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return undefined
}

function isDisabledProxyValue(value: string): boolean {
  return /^(?:0|false|no|off|none|direct|direct:\/\/)$/i.test(value.trim())
}

function isFalseEnvValue(value: string | undefined): boolean {
  return /^(?:0|false|no|off)$/i.test(value?.trim() || '')
}

function serializeProxyUrl(url: URL): string {
  const serialized = url.toString()
  if (url.pathname === '/' && !url.search && !url.hash) {
    return serialized.slice(0, -1)
  }

  return serialized
}

function normalizeProxyServer(
  server: string,
  defaultScheme?: 'http' | 'socks5',
):
  | {
      server: string
      username?: string
      password?: string
    }
  | undefined {
  const trimmed = server.trim()
  if (!trimmed || isDisabledProxyValue(trimmed)) {
    return undefined
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  const shouldParseAsUrl = hasScheme || trimmed.includes('@') || defaultScheme
  if (!shouldParseAsUrl) {
    return {
      server: trimmed,
    }
  }

  try {
    const url = new URL(hasScheme ? trimmed : `${defaultScheme}://${trimmed}`)
    const username = url.username ? decodeURIComponent(url.username) : undefined
    const password = url.password ? decodeURIComponent(url.password) : undefined
    url.username = ''
    url.password = ''

    return {
      server: serializeProxyUrl(url),
      username,
      password,
    }
  } catch {
    return {
      server: trimmed,
    }
  }
}

function splitBypassEntries(value: string | undefined): string[] {
  if (!value) {
    return []
  }

  return value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function combineProxyBypass(...values: (string | undefined)[]): string {
  const entries = [...LOCAL_BYPASS_ENTRIES]
  for (const value of values) {
    entries.push(...splitBypassEntries(value))
  }

  const seen = new Set<string>()
  return entries
    .filter((entry) => {
      const key = entry.toLowerCase()
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    .join(',')
}

export function normalizeProxyConfig(input: {
  server?: string
  bypass?: string
  username?: string
  password?: string
  defaultScheme?: 'http' | 'socks5'
}): ProxyConfig | undefined {
  if (!input.server) {
    return undefined
  }

  const normalized = normalizeProxyServer(input.server, input.defaultScheme)
  if (!normalized) {
    return undefined
  }

  return {
    server: normalized.server,
    bypass: combineProxyBypass(input.bypass),
    username: input.username || normalized.username,
    password: input.password || normalized.password,
  }
}

function parseRegistryOutput(output: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*([^\s]+)\s+REG_\S+\s+(.+?)\s*$/.exec(line)
    if (!match) {
      continue
    }

    values[match[1]] = match[2]
  }

  return values
}

function isWindowsProxyEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  if (normalized.startsWith('0x')) {
    return Number.parseInt(normalized.slice(2), 16) !== 0
  }

  return normalized === '1' || normalized === 'true'
}

function parseWindowsProxyServer(value: string | undefined):
  | {
      server: string
      defaultScheme?: 'http' | 'socks5'
    }
  | undefined {
  if (!value?.trim()) {
    return undefined
  }

  const entries = value
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  const keyedEntries = new Map<string, string>()

  for (const entry of entries) {
    const separatorIndex = entry.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = entry.slice(0, separatorIndex).trim().toLowerCase()
    const proxyServer = entry.slice(separatorIndex + 1).trim()
    if (key && proxyServer) {
      keyedEntries.set(key, proxyServer)
    }
  }

  if (keyedEntries.size > 0) {
    const socksServer = keyedEntries.get('socks')
    const server =
      keyedEntries.get('https') ||
      keyedEntries.get('http') ||
      socksServer ||
      keyedEntries.values().next().value

    return server
      ? {
          server,
          defaultScheme: server === socksServer ? 'socks5' : 'http',
        }
      : undefined
  }

  return entries[0]
    ? {
        server: entries[0],
        defaultScheme: 'http',
      }
    : undefined
}

export function parseWindowsInternetSettingsProxy(
  output: string,
): ProxyConfig | undefined {
  const values = parseRegistryOutput(output)
  if (!isWindowsProxyEnabled(values.ProxyEnable)) {
    return undefined
  }

  const parsedServer = parseWindowsProxyServer(values.ProxyServer)
  return normalizeProxyConfig({
    server: parsedServer?.server,
    bypass: values.ProxyOverride,
    defaultScheme: parsedServer?.defaultScheme,
  })
}

function queryWindowsInternetSettingsProxy(): string | undefined {
  try {
    return execFileSync('reg', ['query', WINDOWS_INTERNET_SETTINGS_KEY], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
  } catch {
    return undefined
  }
}

function resolveEnvProxyConfig(
  env: NodeJS.ProcessEnv,
): ProxyConfig | undefined {
  const proxyServer = readFirstEnvValue(env, EXPLICIT_PROXY_ENV_NAMES)
  if (!proxyServer || isDisabledProxyValue(proxyServer)) {
    return undefined
  }

  return normalizeProxyConfig({
    server: proxyServer,
    bypass: env.CODEY_PROXY_BYPASS || env.NO_PROXY || env.no_proxy,
    username: env.CODEY_PROXY_USERNAME,
    password: env.CODEY_PROXY_PASSWORD,
    defaultScheme: 'http',
  })
}

export function resolveProxyConfig(
  options: {
    env?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
    queryWindowsProxy?: () => string | undefined
  } = {},
): ProxyConfig | undefined {
  const env = options.env || process.env
  const envProxy = resolveEnvProxyConfig(env)
  if (envProxy) {
    return envProxy
  }

  if (isFalseEnvValue(env.CODEY_USE_SYSTEM_PROXY)) {
    return undefined
  }

  const platform = options.platform || process.platform
  if (platform !== 'win32') {
    return undefined
  }

  const registryOutput =
    options.queryWindowsProxy?.() || queryWindowsInternetSettingsProxy()
  return registryOutput
    ? parseWindowsInternetSettingsProxy(registryOutput)
    : undefined
}
