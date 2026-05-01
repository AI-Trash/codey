import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import net from 'net'
import path from 'path'
import { getRuntimeConfig, type CliRuntimeConfig } from '../../config'
import { ensureDir, writeFileAtomic } from '../../utils/fs'
import { logCliEvent } from '../../utils/observability'
import { redactForOutput, sanitizeErrorForOutput } from '../../utils/redaction'
import { sleep } from '../../utils/wait'
import type { CodeyProxyNode } from '../app-auth/proxy-nodes'

const DEFAULT_MIXED_HOST = '127.0.0.1'
const DEFAULT_MIXED_PORT = 2080
const SELECTOR_OUTBOUND_TAG = 'codey-selector'
const DIRECT_OUTBOUND_TAG = 'direct'
const MAX_PROCESS_OUTPUT_CHARS = 8000

interface SingBoxOutbound {
  [key: string]: unknown
  type: string
  tag: string
  server?: string
  server_port?: number
  username?: string
  password?: string
  tls?: {
    enabled: boolean
    server_name?: string
    insecure?: boolean
  }
}

interface SingBoxConfig {
  log: {
    level: string
  }
  dns: {
    servers: Array<Record<string, unknown>>
  }
  inbounds: Array<Record<string, unknown>>
  outbounds: Array<Record<string, unknown>>
  route: {
    final: string
    rules: Array<Record<string, unknown>>
  }
}

export interface CodeySingBoxProxyRuntime {
  mixedProxy: {
    server: string
    host: string
    port: number
  }
  nodes: CodeyProxyNode[]
  selectedTag: string | null
  selectTag(tag: string): Promise<void>
  refresh(nodes: CodeyProxyNode[]): Promise<void>
  stop(): Promise<void>
}

let activeRuntime: CodeySingBoxProxyRuntime | undefined

function normalizeTag(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized || undefined
}

function normalizeNodeTag(node: CodeyProxyNode): CodeyProxyNode {
  return {
    ...node,
    tag: normalizeTag(node.tag) || node.tag,
  }
}

function sanitizeOutboundTag(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'node'
  )
}

function createOutboundTag(node: CodeyProxyNode, index: number): string {
  return `node-${sanitizeOutboundTag(node.tag)}-${sanitizeOutboundTag(node.name || node.id)}-${index + 1}`
}

function getSingBoxConfigDir(config: CliRuntimeConfig): string {
  return (
    config.singBox?.configDir || path.join(config.rootDir, '.codey', 'sing-box')
  )
}

function getSingBoxConfigPath(config: CliRuntimeConfig): string {
  return path.join(getSingBoxConfigDir(config), 'config.json')
}

function resolveMixedEndpoint(config: CliRuntimeConfig): {
  host: string
  port: number
  server: string
} {
  const host = config.singBox?.mixedHost || DEFAULT_MIXED_HOST
  const port = config.singBox?.mixedPort || DEFAULT_MIXED_PORT
  return {
    host,
    port,
    server: `http://${host}:${port}`,
  }
}

function shouldStartSingBox(config: CliRuntimeConfig): boolean {
  return (
    (config.singBox?.enabled ?? true) && (config.singBox?.autoStart ?? true)
  )
}

function hasUsableProxyNodes(nodes: CodeyProxyNode[]): boolean {
  return nodes.some((node) => node.protocol === 'hysteria2')
}

function pickDefaultNode(
  nodes: CodeyProxyNode[],
  preferredTag?: string,
): CodeyProxyNode {
  const normalizedPreferredTag = normalizeTag(preferredTag)
  if (normalizedPreferredTag) {
    const preferred = nodes.find(
      (node) => normalizeTag(node.tag) === normalizedPreferredTag,
    )
    if (preferred) {
      return preferred
    }
  }

  return nodes[0] as CodeyProxyNode
}

function toSingBoxOutbound(
  node: CodeyProxyNode,
  outboundTag: string,
): SingBoxOutbound {
  if (node.protocol !== 'hysteria2') {
    throw new Error(`sing-box managed proxy does not support ${node.protocol}`)
  }

  return {
    type: 'hysteria2',
    tag: outboundTag,
    server: node.server,
    server_port: node.serverPort,
    ...(node.username ? { username: node.username } : {}),
    ...(node.password ? { password: node.password } : {}),
    tls: {
      enabled: true,
      ...(node.tls?.serverName ? { server_name: node.tls.serverName } : {}),
      ...(node.tls?.insecure ? { insecure: true } : {}),
    },
  }
}

function buildSingBoxConfig(input: {
  nodes: CodeyProxyNode[]
  selectedTag?: string
  host: string
  port: number
}): {
  config: SingBoxConfig
  selectedNode: CodeyProxyNode
} {
  const nodes = input.nodes.map(normalizeNodeTag)
  const selectedNode = pickDefaultNode(nodes, input.selectedTag)
  const outbounds = nodes.map((node, index) =>
    toSingBoxOutbound(node, createOutboundTag(node, index)),
  )
  const selectedOutboundTag = createOutboundTag(
    selectedNode,
    Math.max(
      0,
      nodes.findIndex((node) => node.id === selectedNode.id),
    ),
  )

  return {
    selectedNode,
    config: {
      log: {
        level: 'info',
      },
      dns: {
        servers: [
          {
            type: 'tls',
            server: '1.1.1.1',
          },
        ],
      },
      inbounds: [
        {
          type: 'mixed',
          tag: 'mixed-in',
          listen: input.host,
          listen_port: input.port,
        },
      ],
      outbounds: [
        {
          type: 'selector',
          tag: SELECTOR_OUTBOUND_TAG,
          outbounds: outbounds.map((outbound) => outbound.tag),
          default: selectedOutboundTag,
        },
        ...outbounds,
        {
          type: 'direct',
          tag: DIRECT_OUTBOUND_TAG,
        },
      ],
      route: {
        final: SELECTOR_OUTBOUND_TAG,
        rules: [
          {
            action: 'sniff',
          },
          {
            protocol: 'dns',
            action: 'hijack-dns',
          },
        ],
      },
    },
  }
}

function canConnect(
  host: string,
  port: number,
  timeoutMs = 500,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, timeoutMs)

    socket.once('connect', () => {
      clearTimeout(timer)
      socket.end()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

async function waitForPort(host: string, port: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5000) {
    if (await canConnect(host, port)) {
      return
    }
    await sleep(200)
  }

  throw new Error(`sing-box mixed inbound did not open at ${host}:${port}`)
}

function appendProcessOutput(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf8')
  return next.length > MAX_PROCESS_OUTPUT_CHARS
    ? next.slice(-MAX_PROCESS_OUTPUT_CHARS)
    : next
}

async function terminateProcess(
  child: ChildProcess | undefined,
): Promise<void> {
  if (!child || child.exitCode !== null || child.killed) {
    return
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 3000)

    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })

    child.kill('SIGTERM')
  })
}

class LocalSingBoxProxyRuntime implements CodeySingBoxProxyRuntime {
  mixedProxy: {
    server: string
    host: string
    port: number
  }

  nodes: CodeyProxyNode[]
  selectedTag: string | null

  private readonly config: CliRuntimeConfig
  private child?: ChildProcess
  private stderr = ''
  private stdout = ''

  constructor(input: {
    config: CliRuntimeConfig
    nodes: CodeyProxyNode[]
    selectedTag: string | null
  }) {
    this.config = input.config
    this.nodes = input.nodes.map(normalizeNodeTag)
    this.selectedTag = input.selectedTag
    this.mixedProxy = resolveMixedEndpoint(input.config)
  }

  async start(): Promise<void> {
    await this.restart(this.selectedTag || undefined)
  }

  async selectTag(tag: string): Promise<void> {
    const normalizedTag = normalizeTag(tag)
    if (!normalizedTag) {
      throw new Error('Proxy tag is required')
    }

    const matchingNode = this.nodes.find((node) => node.tag === normalizedTag)
    if (!matchingNode) {
      throw new Error(`No enabled proxy node has tag ${tag}`)
    }

    if (this.selectedTag === normalizedTag) {
      return
    }

    await this.restart(normalizedTag)
  }

  async refresh(nodes: CodeyProxyNode[]): Promise<void> {
    this.nodes = nodes.map(normalizeNodeTag)
    if (!hasUsableProxyNodes(this.nodes)) {
      await this.stop()
      throw new Error('No enabled hysteria2 proxy nodes are available')
    }

    await this.restart(this.selectedTag || undefined)
  }

  async stop(): Promise<void> {
    await terminateProcess(this.child)
    this.child = undefined
  }

  private async restart(selectedTag?: string): Promise<void> {
    await terminateProcess(this.child)
    this.child = undefined
    this.stderr = ''
    this.stdout = ''

    const { config, selectedNode } = buildSingBoxConfig({
      nodes: this.nodes,
      selectedTag,
      host: this.mixedProxy.host,
      port: this.mixedProxy.port,
    })
    this.selectedTag = selectedNode.tag

    const configPath = getSingBoxConfigPath(this.config)
    ensureDir(path.dirname(configPath))
    writeFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`)

    const executable = this.config.singBox?.executable || 'sing-box'
    const child = spawn(executable, ['run', '-c', configPath], {
      cwd: this.config.rootDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child

    child.stdout?.on('data', (chunk: Buffer) => {
      this.stdout = appendProcessOutput(this.stdout, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderr = appendProcessOutput(this.stderr, chunk)
    })
    child.once('exit', (code, signal) => {
      if (this.child?.pid === child.pid) {
        logCliEvent('warn', 'singbox.exit', {
          code,
          signal,
          stderr: this.stderr,
        })
      }
    })

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 250)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        reject(
          new Error(
            `sing-box exited before startup completed (code=${code ?? 'null'}, signal=${signal ?? 'null'}): ${this.stderr || this.stdout}`,
          ),
        )
      })
    })

    await waitForPort(this.mixedProxy.host, this.mixedProxy.port)

    logCliEvent('info', 'singbox.started', {
      proxy: this.mixedProxy.server,
      selectedTag: this.selectedTag,
      nodeCount: this.nodes.length,
      configPath,
    })
  }
}

export async function startCodeySingBoxProxy(input: {
  config: CliRuntimeConfig
  nodes: CodeyProxyNode[]
}): Promise<CodeySingBoxProxyRuntime | undefined> {
  if (!shouldStartSingBox(input.config)) {
    return undefined
  }

  const nodes = input.nodes
    .map(normalizeNodeTag)
    .filter((node) => node.protocol === 'hysteria2')
  if (!hasUsableProxyNodes(nodes)) {
    return undefined
  }

  const runtime = new LocalSingBoxProxyRuntime({
    config: input.config,
    nodes,
    selectedTag: normalizeTag(input.config.singBox?.defaultTag) || null,
  })
  await runtime.start()
  activeRuntime = runtime
  return runtime
}

export function getActiveCodeySingBoxProxy():
  | CodeySingBoxProxyRuntime
  | undefined {
  return activeRuntime
}

export async function selectCodeySingBoxProxyTag(
  tag: string,
): Promise<boolean> {
  if (!activeRuntime) {
    return false
  }

  await activeRuntime.selectTag(tag)
  return true
}

export async function stopActiveCodeySingBoxProxy(): Promise<void> {
  const runtime = activeRuntime
  activeRuntime = undefined
  await runtime?.stop()
}

export function buildSingBoxProxyBrowserOverride(
  runtime: CodeySingBoxProxyRuntime | undefined,
): Pick<CliRuntimeConfig, 'browser'> | undefined {
  if (!runtime) {
    return undefined
  }

  const config = getRuntimeConfig()
  return {
    browser: {
      ...config.browser,
      proxy: {
        server: runtime.mixedProxy.server,
        bypass: 'localhost,127.0.0.1,::1',
      },
    },
  }
}

export function formatSingBoxProxyStartupError(error: unknown): string {
  const sanitized = sanitizeErrorForOutput(error).message
  return `Unable to start Codey sing-box proxy: ${sanitized}`
}

export function summarizeProxyNodes(nodes: CodeyProxyNode[]) {
  return redactForOutput(
    nodes.map((node) => ({
      id: node.id,
      name: node.name,
      tag: node.tag,
      protocol: node.protocol,
      server: node.server,
      serverPort: node.serverPort,
    })),
  )
}

export function deleteSingBoxConfigFile(config: CliRuntimeConfig): void {
  const configPath = getSingBoxConfigPath(config)
  try {
    fs.rmSync(configPath, { force: true })
  } catch {
    // Best-effort cleanup only.
  }
}
