import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { createRequire } from 'module'
import { Readable } from 'stream'
import type {
  AppWhatsAppNotificationIngestInput,
  AppWhatsAppNotificationIngestResponse,
} from '../verification/app-client'
import { sleep } from '../../utils/wait'

export const DEFAULT_WHATSAPP_PACKAGES = [
  'com.whatsapp',
  'com.whatsapp.w4b',
] as const
export const DEFAULT_FRIDA_REMOTE_PATH = '/data/local/tmp/frida-server'
export const DEFAULT_FRIDA_SERVER_PORT = 27042
export const DEFAULT_FRIDA_TARGET = 'system_server'
export const DEFAULT_ADB_PATH = os.platform() === 'win32' ? 'adb.exe' : 'adb'
export const DEFAULT_FRIDA_DOWNLOAD_DIR = path.join(
  os.homedir(),
  '.codey',
  'frida',
)

export interface WhatsAppNotificationEvent {
  packageName: string
  notificationId?: string
  sender?: string
  chatName?: string
  title?: string
  body?: string
  rawPayload?: unknown
  receivedAt: string
}

export interface AndroidWhatsAppNotificationWatchOptions {
  adbPath?: string
  androidUdid?: string
  deviceId?: string
  fridaServerPath?: string
  fridaRemotePath?: string
  fridaServerPort?: number
  fridaStartServer?: boolean
  fridaAutoDownload?: boolean
  fridaDownloadDir?: string
  fridaTarget?: string
  whatsappPackages?: string[]
  reservationId?: string
  email?: string
  durationMs?: number
  once?: boolean
  dryRun?: boolean
  signal?: AbortSignal
  onStatus?: (message: string) => void
  onNotification?: (
    event: WhatsAppNotificationEvent,
    payload: AppWhatsAppNotificationIngestInput,
    result?: AppWhatsAppNotificationIngestResponse,
  ) => void | Promise<void>
  ingestNotification?: (
    payload: AppWhatsAppNotificationIngestInput,
  ) => Promise<AppWhatsAppNotificationIngestResponse>
}

export interface AndroidWhatsAppNotificationAutoWatchOptions extends AndroidWhatsAppNotificationWatchOptions {
  enabled?: boolean
}

export interface AndroidWhatsAppNotificationWatchResult {
  serial: string
  deviceId: string
  processedCount: number
  forwardedCount: number
  dryRun: boolean
}

export interface AndroidWhatsAppNotificationAutoWatcherHandle {
  done: Promise<void>
  stop(): Promise<void>
}

interface AdbDevice {
  id: string
  type?: string
}

interface AdbClient {
  listDevices(): Promise<AdbDevice[]>
  shell(serial: string, command: string): Promise<NodeJS.ReadableStream>
  push(
    serial: string,
    localPath: string,
    remotePath: string,
  ): Promise<NodeJS.ReadableStream>
  forward(serial: string, local: string, remote: string): Promise<void>
}

interface AdbkitRuntime {
  createClient(): AdbClient
}

interface FridaSignal {
  connect(callback: (message: unknown, data?: unknown) => void): void
}

interface FridaScript {
  message: FridaSignal
  load(): Promise<void>
  unload(): Promise<void>
}

interface FridaSession {
  createScript(source: string): Promise<FridaScript>
  detach(): Promise<void>
}

interface FridaDevice {
  id?: string
  name?: string
  attach(target: string | number): Promise<FridaSession>
}

interface FridaDeviceManager {
  enumerateDevices(): Promise<FridaDevice[]>
}

interface FridaRuntime {
  getUsbDevice?(options?: { timeout?: number }): Promise<FridaDevice>
  getDevice?(id: string, options?: { timeout?: number }): Promise<FridaDevice>
  getDeviceManager?(): Promise<FridaDeviceManager> | FridaDeviceManager
}

interface ActiveFridaSession {
  script: FridaScript
  session: FridaSession
}

interface ExecFileResult {
  stdout: string
  stderr: string
}

interface AndroidAdbPathCandidateOptions {
  env?: NodeJS.ProcessEnv
  homeDir?: string
  platform?: NodeJS.Platform
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function withModuleDefault<T>(moduleValue: unknown): T {
  const moduleRecord = asRecord(moduleValue)
  const defaultExport = moduleRecord ? moduleRecord.default : undefined
  return (defaultExport ?? moduleValue) as T
}

function createAbortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError('Android WhatsApp watcher startup was aborted.')
  }
}

async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([task, timeoutPromise])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

function execFileText(
  file: string,
  args: string[],
  options: {
    timeoutMs: number
  },
): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: options.timeoutMs,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error)
          return
        }

        resolve({
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        })
      },
    )
  })
}

function getPlatformPath(platform: NodeJS.Platform): typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix
}

function expandHomePath(
  value: string,
  homeDir: string | undefined,
  platform: NodeJS.Platform,
): string {
  const trimmed = value.trim()
  if (!homeDir || trimmed !== '~') {
    const slashPrefix = platform === 'win32' ? '~\\' : '~/'
    if (!homeDir || !trimmed.startsWith(slashPrefix)) {
      return trimmed
    }

    return getPlatformPath(platform).join(homeDir, trimmed.slice(2))
  }

  return homeDir
}

export function getAndroidStudioAdbPathCandidates(
  options: AndroidAdbPathCandidateOptions = {},
): string[] {
  const env = options.env ?? process.env
  const platform = options.platform ?? os.platform()
  const platformPath = getPlatformPath(platform)
  const homeDir = options.homeDir ?? os.homedir()
  const executable = platform === 'win32' ? 'adb.exe' : 'adb'
  const candidates: string[] = []
  const seen = new Set<string>()
  const pushCandidate = (candidate: string | undefined): void => {
    const normalized = candidate?.trim()
    if (!normalized) {
      return
    }

    const key = platform === 'win32' ? normalized.toLowerCase() : normalized
    if (!seen.has(key)) {
      seen.add(key)
      candidates.push(normalized)
    }
  }
  const pushSdkRoot = (root: string | undefined): void => {
    const normalizedRoot = root
      ? expandHomePath(root, homeDir, platform)
      : undefined
    if (!normalizedRoot) {
      return
    }

    pushCandidate(
      platformPath.join(normalizedRoot, 'platform-tools', executable),
    )
  }

  pushSdkRoot(env.ANDROID_HOME)
  pushSdkRoot(env.ANDROID_SDK_ROOT)
  pushSdkRoot(env.ANDROID_SDK_HOME)

  if (platform === 'win32') {
    pushSdkRoot(
      env.LOCALAPPDATA
        ? platformPath.join(env.LOCALAPPDATA, 'Android', 'Sdk')
        : undefined,
    )
    pushSdkRoot(
      env.USERPROFILE
        ? platformPath.join(
            env.USERPROFILE,
            'AppData',
            'Local',
            'Android',
            'Sdk',
          )
        : undefined,
    )
    pushSdkRoot(
      env.ProgramFiles
        ? platformPath.join(
            env.ProgramFiles,
            'Android',
            'Android Studio',
            'sdk',
          )
        : undefined,
    )
    pushSdkRoot(
      env['ProgramFiles(x86)']
        ? platformPath.join(env['ProgramFiles(x86)'], 'Android', 'android-sdk')
        : undefined,
    )
  } else if (platform === 'darwin') {
    pushSdkRoot(
      homeDir
        ? platformPath.join(homeDir, 'Library', 'Android', 'sdk')
        : undefined,
    )
  } else {
    pushSdkRoot(
      homeDir ? platformPath.join(homeDir, 'Android', 'Sdk') : undefined,
    )
    pushSdkRoot(
      homeDir ? platformPath.join(homeDir, 'Android', 'sdk') : undefined,
    )
  }

  pushCandidate(executable)
  if (executable !== 'adb') {
    pushCandidate('adb')
  }

  return candidates
}

async function ensureAdbBinary(input: {
  adbPath?: string
  onStatus?: (message: string) => void
}): Promise<string | null> {
  const explicitAdbPath = input.adbPath?.trim()
  const candidates = explicitAdbPath
    ? [explicitAdbPath]
    : getAndroidStudioAdbPathCandidates()
  let lastError: unknown
  for (const adbPath of candidates) {
    try {
      await execFileText(adbPath, ['version'], { timeoutMs: 3000 })
      await execFileText(adbPath, ['start-server'], { timeoutMs: 5000 })
      return adbPath
    } catch (error) {
      lastError = error
    }
  }

  input.onStatus?.(
    `ADB not available from ${
      explicitAdbPath ? explicitAdbPath : candidates.join(', ')
    } (${String(
      lastError instanceof Error ? lastError.message : lastError,
    )}); Android WhatsApp watcher skipped.`,
  )
  return null
}

export function normalizeWhatsAppPackageList(
  input: string | string[] | undefined,
): string[] {
  const raw = Array.isArray(input) ? input : input ? input.split(',') : []
  const normalized = raw
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean)

  const packages = normalized.length
    ? normalized
    : [...DEFAULT_WHATSAPP_PACKAGES]
  for (const packageName of packages) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)
    ) {
      throw new Error(`Invalid Android package name: ${packageName}`)
    }
  }

  return packages
}

export function normalizeFridaWhatsAppNotificationMessage(
  message: unknown,
): WhatsAppNotificationEvent | null {
  const record = asRecord(message)
  if (!record || record.type !== 'send') {
    return null
  }

  const payload = asRecord(record.payload)
  if (!payload || payload.type !== 'whatsapp_notification') {
    return null
  }

  const packageName = readString(payload.packageName)
  if (!packageName) {
    return null
  }

  const receivedAt = readString(payload.receivedAt) || new Date().toISOString()
  return {
    packageName,
    notificationId: readString(payload.notificationId),
    sender: readString(payload.sender),
    chatName: readString(payload.chatName),
    title: readString(payload.title),
    body:
      readString(payload.body) ||
      readString(payload.text) ||
      readString(payload.message),
    rawPayload: payload.rawPayload,
    receivedAt,
  }
}

export function extractVerificationCodeFromNotificationText(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return undefined
  }

  const patterns = [
    /(?:verification\s*code|code|验证码|驗證碼|安全码|安全碼)[^\d]{0,24}(\d{4,8})/i,
    /\b(\d{6})\b/,
    /\b(\d{4,8})\b/,
  ]

  for (const pattern of patterns) {
    const match = pattern.exec(value)
    if (match?.[1]) {
      return match[1]
    }
  }

  return undefined
}

export function buildWhatsAppNotificationIngestPayload(
  event: WhatsAppNotificationEvent,
  options: {
    reservationId?: string
    email?: string
    deviceId?: string
  } = {},
): AppWhatsAppNotificationIngestInput {
  const text = [event.title, event.body].filter(Boolean).join('\n')

  return {
    reservationId: options.reservationId,
    email: options.email,
    deviceId: options.deviceId,
    notificationId: event.notificationId,
    packageName: event.packageName,
    sender: event.sender,
    chatName: event.chatName,
    title: event.title,
    body: event.body,
    rawPayload: event.rawPayload,
    extractedCode: extractVerificationCodeFromNotificationText(text),
    receivedAt: event.receivedAt,
  }
}

export function createWhatsAppNotificationDeduper(ttlMs = 10 * 60 * 1000): {
  shouldProcess(event: WhatsAppNotificationEvent, now?: number): boolean
} {
  const seen = new Map<string, number>()

  return {
    shouldProcess(event, now = Date.now()) {
      for (const [key, expiresAt] of seen.entries()) {
        if (expiresAt <= now) {
          seen.delete(key)
        }
      }

      const key = [
        event.packageName,
        event.notificationId,
        event.title,
        event.body,
      ]
        .filter(Boolean)
        .join('|')

      if (seen.has(key)) {
        return false
      }

      seen.set(key, now + ttlMs)
      return true
    },
  }
}

async function loadAdbkit(): Promise<AdbkitRuntime> {
  const runtime = withModuleDefault<Partial<AdbkitRuntime>>(
    await import('adbkit'),
  )
  if (typeof runtime.createClient !== 'function') {
    throw new Error('adbkit did not expose createClient().')
  }

  return runtime as AdbkitRuntime
}

async function loadFrida(): Promise<FridaRuntime> {
  const runtime = withModuleDefault<Partial<FridaRuntime>>(
    await import('frida'),
  )
  if (
    typeof runtime.getUsbDevice !== 'function' &&
    typeof runtime.getDevice !== 'function'
  ) {
    throw new Error('frida did not expose a supported device API.')
  }

  return runtime as FridaRuntime
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: unknown) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    })
    stream.on('error', reject)
    stream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8').trim())
    })
  })
}

async function readAdbShell(
  adb: AdbClient,
  serial: string,
  command: string,
): Promise<string> {
  return streamToString(await adb.shell(serial, command))
}

async function readAdbShellWithTimeout(
  adb: AdbClient,
  serial: string,
  command: string,
  timeoutMs: number,
  label: string,
): Promise<string> {
  return withTimeout(readAdbShell(adb, serial, command), timeoutMs, label)
}

async function waitForAdbTransfer(
  stream: NodeJS.ReadableStream,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject)
    stream.on('end', resolve)
  })
}

async function resolveAndroidSerial(
  adb: AdbClient,
  preferredSerial?: string,
): Promise<string> {
  if (preferredSerial?.trim()) {
    return preferredSerial.trim()
  }

  const devices = await adb.listDevices()
  const connected = devices.filter((device) => device.type !== 'offline')
  if (connected.length === 1) {
    return connected[0].id
  }

  if (!connected.length) {
    throw new Error(
      'No Android device is visible to adb. Connect a device or set ANDROID_UDID.',
    )
  }

  throw new Error(
    `Multiple Android devices are visible to adb (${connected
      .map((device) => device.id)
      .join(', ')}). Pass --androidUdid to select one.`,
  )
}

async function resolveAndroidSerialForAutoWatch(
  adb: AdbClient,
  preferredSerial?: string,
): Promise<string | null> {
  try {
    return await withTimeout(
      resolveAndroidSerial(adb, preferredSerial),
      5000,
      'ADB device discovery',
    )
  } catch {
    return null
  }
}

async function findInstalledWhatsAppPackages(input: {
  adb: AdbClient
  serial: string
  packages: string[]
  onStatus?: (message: string) => void
}): Promise<string[]> {
  const installedPackages: string[] = []

  for (const packageName of input.packages) {
    const output = await readAdbShellWithTimeout(
      input.adb,
      input.serial,
      `pm path ${packageName} 2>/dev/null || true`,
      5000,
      `Checking ${packageName}`,
    ).catch(() => '')
    if (output.includes('package:')) {
      installedPackages.push(packageName)
    }
  }

  if (!installedPackages.length) {
    input.onStatus?.(
      `No watched WhatsApp package found on ${input.serial}; Android WhatsApp watcher skipped.`,
    )
  }

  return installedPackages
}

export function mapAndroidAbiToFridaArch(abi: string): string | undefined {
  const normalized = abi.trim().toLowerCase()
  if (normalized === 'arm64-v8a') return 'arm64'
  if (normalized === 'armeabi-v7a' || normalized === 'armeabi') return 'arm'
  if (normalized === 'x86_64') return 'x86_64'
  if (normalized === 'x86') return 'x86'
  return undefined
}

export function buildFridaServerDownloadUrl(input: {
  version: string
  arch: string
}): string {
  const fileName = `frida-server-${input.version}-android-${input.arch}.xz`
  return `https://github.com/frida/frida/releases/download/${input.version}/${fileName}`
}

function normalizeRemoteFridaPath(value: string | undefined): string {
  const remotePath = value?.trim() || DEFAULT_FRIDA_REMOTE_PATH
  if (!/^\/[A-Za-z0-9._/-]+$/.test(remotePath)) {
    throw new Error(
      `Unsupported Android remote frida-server path: ${remotePath}. Use an absolute path containing only letters, numbers, dots, dashes, underscores, and slashes.`,
    )
  }

  return remotePath
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

function getFridaPackageVersion(): string {
  const require = createRequire(import.meta.url)
  let currentDir = path.dirname(require.resolve('frida'))

  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(
        fs.readFileSync(packageJsonPath, 'utf8'),
      ) as {
        version?: string
      }
      if (packageJson.version?.trim()) {
        return packageJson.version.trim()
      }
    }

    const parent = path.dirname(currentDir)
    if (parent === currentDir) {
      break
    }
    currentDir = parent
  }

  throw new Error('Unable to resolve installed frida package version.')
}

async function getDeviceFridaArch(input: {
  adb: AdbClient
  serial: string
}): Promise<string> {
  const abi = await readAdbShellWithTimeout(
    input.adb,
    input.serial,
    'getprop ro.product.cpu.abi',
    5000,
    'Reading Android CPU ABI',
  )
  const arch = mapAndroidAbiToFridaArch(abi)
  if (!arch) {
    throw new Error(`Unsupported Android CPU ABI for frida-server: ${abi}`)
  }

  return arch
}

async function decompressXzFile(inputPath: string, outputPath: string) {
  const { XzReadableStream } = await import('xz-decompress')
  const compressedStream = Readable.toWeb(
    fs.createReadStream(inputPath),
  ) as ReadableStream<Uint8Array>
  const response = new Response(new XzReadableStream(compressedStream))
  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.promises.writeFile(outputPath, buffer)
}

async function downloadFridaServer(input: {
  adb: AdbClient
  serial: string
  downloadDir?: string
  onStatus?: (message: string) => void
}): Promise<string> {
  const version = getFridaPackageVersion()
  const arch = await getDeviceFridaArch({
    adb: input.adb,
    serial: input.serial,
  })
  const fileName = `frida-server-${version}-android-${arch}`
  const downloadDir = input.downloadDir?.trim() || DEFAULT_FRIDA_DOWNLOAD_DIR
  const localPath = path.join(downloadDir, fileName)
  const compressedPath = `${localPath}.xz`

  await fs.promises.mkdir(downloadDir, { recursive: true })
  if (await fileExists(localPath)) {
    return localPath
  }

  const url = buildFridaServerDownloadUrl({ version, arch })
  input.onStatus?.(`Downloading ${fileName}.xz`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Unable to download frida-server from ${url}: HTTP ${response.status}`,
    )
  }

  const compressedBuffer = Buffer.from(await response.arrayBuffer())
  await fs.promises.writeFile(compressedPath, compressedBuffer)
  await decompressXzFile(compressedPath, localPath)
  return localPath
}

async function ensureFridaServer(input: {
  adb: AdbClient
  serial: string
  localPath?: string
  remotePath: string
  port: number
  autoDownload?: boolean
  downloadDir?: string
  onStatus?: (message: string) => void
}): Promise<void> {
  const {
    adb,
    serial,
    localPath,
    remotePath,
    port,
    autoDownload,
    downloadDir,
    onStatus,
  } = input

  const pushFridaServer = async (candidatePath: string): Promise<void> => {
    const resolvedLocalPath = candidatePath.trim()
    if (!fs.existsSync(resolvedLocalPath)) {
      throw new Error(`frida-server binary was not found: ${resolvedLocalPath}`)
    }

    onStatus?.(`Pushing frida-server to ${serial}:${remotePath}`)
    await waitForAdbTransfer(
      await adb.push(serial, resolvedLocalPath, remotePath),
    )
  }

  if (localPath?.trim()) {
    await pushFridaServer(localPath)
  }

  const remoteState = await readAdbShellWithTimeout(
    adb,
    serial,
    `if [ -f ${remotePath} ]; then echo found; else echo missing; fi`,
    5000,
    'Checking remote frida-server',
  )
  if (!remoteState.includes('found')) {
    if (autoDownload !== false) {
      const downloadedPath = await downloadFridaServer({
        adb,
        serial,
        downloadDir,
        onStatus,
      })
      await pushFridaServer(downloadedPath)
    } else {
      throw new Error(
        `frida-server is missing on ${serial}:${remotePath}. Provide ANDROID_FRIDA_SERVER_PATH or enable ANDROID_FRIDA_AUTO_DOWNLOAD.`,
      )
    }
  }

  onStatus?.(`Starting frida-server on ${serial}`)
  await readAdbShellWithTimeout(
    adb,
    serial,
    `su -c 'pkill -f frida-server >/dev/null 2>&1 || true; chmod 755 ${remotePath}; ${remotePath} >/dev/null 2>&1 &'`,
    5000,
    'Starting frida-server',
  )
  await sleep(1500)

  try {
    await adb.forward(serial, `tcp:${port}`, `tcp:${port}`)
  } catch (error) {
    onStatus?.(
      `Could not create adb forward tcp:${port}; continuing with Frida USB discovery (${String(
        error,
      )})`,
    )
  }
}

async function resolveFridaDevice(
  frida: FridaRuntime,
  serial: string,
): Promise<FridaDevice> {
  if (typeof frida.getDeviceManager === 'function') {
    const manager = await frida.getDeviceManager()
    const devices = await manager.enumerateDevices()
    const match = devices.find((device) => {
      const id = device.id || ''
      const name = device.name || ''
      return id === serial || name === serial || id.includes(serial)
    })
    if (match) {
      return match
    }
  }

  if (typeof frida.getDevice === 'function') {
    try {
      return await frida.getDevice(serial, { timeout: 5000 })
    } catch {
      // Fall through to USB discovery. Frida device ids do not always match adb serials.
    }
  }

  if (typeof frida.getUsbDevice === 'function') {
    return frida.getUsbDevice({ timeout: 5000 })
  }

  throw new Error('Unable to resolve a Frida USB device.')
}

function buildWhatsAppNotificationFridaScript(packages: string[]): string {
  return `
const WATCH_PACKAGES = ${JSON.stringify(packages)};
const ASSUMED_PACKAGE = WATCH_PACKAGES[0] || 'com.whatsapp';

function toJsString(value) {
  try {
    if (value === null || value === undefined) return null;
    const text = String(value);
    return text.length ? text : null;
  } catch (_) {
    return null;
  }
}

function isWatchedPackage(packageName) {
  return packageName && WATCH_PACKAGES.indexOf(packageName) !== -1;
}

function readExtra(bundle, key) {
  try {
    if (!bundle) return null;
    const value = bundle.get(key);
    return toJsString(value);
  } catch (_) {
    return null;
  }
}

function readTextLines(bundle) {
  try {
    if (!bundle) return [];
    const value = bundle.get('android.textLines');
    if (!value) return [];
    const lines = [];
    const length = value.length || 0;
    for (let index = 0; index < length; index += 1) {
      const text = toJsString(value[index]);
      if (text) lines.push(text);
    }
    return lines;
  } catch (_) {
    return [];
  }
}

function getNotificationExtras(notification) {
  try {
    if (!notification) return null;
    return notification.extras.value || notification.extras;
  } catch (_) {
    return null;
  }
}

function emitNotification(packageName, notification, details) {
  try {
    if (!isWatchedPackage(packageName)) return;
    const extras = getNotificationExtras(notification);
    const title = readExtra(extras, 'android.title');
    const text = readExtra(extras, 'android.text');
    const bigText = readExtra(extras, 'android.bigText');
    const subText = readExtra(extras, 'android.subText');
    const infoText = readExtra(extras, 'android.infoText');
    const textLines = readTextLines(extras);
    const bodyParts = [text, bigText, subText, infoText].concat(textLines).filter(Boolean);
    const body = bodyParts.length ? bodyParts.join('\\n') : null;
    send({
      type: 'whatsapp_notification',
      packageName,
      notificationId: details && details.notificationId ? details.notificationId : null,
      sender: subText,
      chatName: title,
      title,
      body,
      rawPayload: {
        source: details && details.source ? details.source : 'frida',
        title,
        text,
        bigText,
        subText,
        infoText,
        textLines,
        notificationId: details && details.notificationId ? details.notificationId : null,
        tag: details && details.tag ? details.tag : null
      },
      receivedAt: new Date().toISOString()
    });
  } catch (error) {
    send({ type: 'debug', message: 'emitNotification failed: ' + error });
  }
}

function findJavaClassName(value) {
  try {
    if (!value || !value.getClass) return null;
    return String(value.getClass().getName());
  } catch (_) {
    return null;
  }
}

function maybeEmitFromSystemArgs(args) {
  let packageName = null;
  let notification = null;
  let notificationId = null;
  let tag = null;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    const text = toJsString(value);
    const className = findJavaClassName(value);
    if (!packageName && isWatchedPackage(text)) packageName = text;
    if (!tag && text && !isWatchedPackage(text)) tag = text;
    if (notificationId === null && typeof value === 'number') notificationId = String(value);
    if (className === 'android.app.Notification') notification = value;
    if (className === 'android.service.notification.StatusBarNotification') {
      try {
        const sbnPackageName = toJsString(value.getPackageName());
        const sbnNotification = value.getNotification();
        emitNotification(sbnPackageName, sbnNotification, {
          source: 'StatusBarNotification',
          notificationId: toJsString(value.getKey())
        });
        return;
      } catch (_) {}
    }
    if (className === 'com.android.server.notification.NotificationRecord') {
      try {
        const sbn = value.getSbn();
        const sbnPackageName = toJsString(sbn.getPackageName());
        emitNotification(sbnPackageName, sbn.getNotification(), {
          source: 'NotificationRecord',
          notificationId: toJsString(sbn.getKey())
        });
        return;
      } catch (_) {}
    }
  }
  if (packageName && notification) {
    emitNotification(packageName, notification, {
      source: 'NotificationManagerService',
      notificationId: notificationId,
      tag: tag
    });
  }
}

function hookOverloads(method, label, handler) {
  try {
    method.overloads.forEach(function (overload) {
      overload.implementation = function () {
        const args = Array.prototype.slice.call(arguments);
        const result = overload.call.apply(overload, [this].concat(args));
        try {
          handler(args);
        } catch (error) {
          send({ type: 'debug', message: label + ' handler failed: ' + error });
        }
        return result;
      };
    });
    send({ type: 'ready', hook: label, overloads: method.overloads.length });
  } catch (error) {
    send({ type: 'debug', message: label + ' hook failed: ' + error });
  }
}

Java.perform(function () {
  try {
    const NotificationManagerService = Java.use('com.android.server.notification.NotificationManagerService');
    hookOverloads(NotificationManagerService.enqueueNotificationInternal, 'NotificationManagerService.enqueueNotificationInternal', maybeEmitFromSystemArgs);
  } catch (error) {
    send({ type: 'debug', message: 'NotificationManagerService unavailable: ' + error });
  }

  try {
    const NotificationManager = Java.use('android.app.NotificationManager');
    if (NotificationManager.notify) {
      hookOverloads(NotificationManager.notify, 'NotificationManager.notify', function (args) {
        let notification = null;
        let notificationId = null;
        let tag = null;
        for (let index = 0; index < args.length; index += 1) {
          const value = args[index];
          const className = findJavaClassName(value);
          const text = toJsString(value);
          if (className === 'android.app.Notification') notification = value;
          if (notificationId === null && typeof value === 'number') notificationId = String(value);
          if (!tag && text) tag = text;
        }
        if (notification) {
          emitNotification(ASSUMED_PACKAGE, notification, {
            source: 'NotificationManager.notify',
            notificationId: notificationId,
            tag: tag
          });
        }
      });
    }
  } catch (error) {
    send({ type: 'debug', message: 'NotificationManager unavailable: ' + error });
  }
});
`
}

async function attachFridaScript(input: {
  frida: FridaRuntime
  serial: string
  target: string
  packages: string[]
  onStatus?: (message: string) => void
  onMessage: (message: unknown, data?: unknown) => void
}): Promise<ActiveFridaSession> {
  const device = await resolveFridaDevice(input.frida, input.serial)
  input.onStatus?.(
    `Attaching Frida to ${input.target} on ${device.name || device.id || input.serial}`,
  )
  const session = await device.attach(input.target)
  const script = await session.createScript(
    buildWhatsAppNotificationFridaScript(input.packages),
  )
  script.message.connect(input.onMessage)
  await script.load()
  return { script, session }
}

async function cleanupFridaSession(
  activeSession: ActiveFridaSession | undefined,
): Promise<void> {
  if (!activeSession) {
    return
  }

  await Promise.allSettled([
    activeSession.script.unload(),
    activeSession.session.detach(),
  ])
}

async function runAndroidWhatsAppNotificationAutoWatcher(
  options: AndroidWhatsAppNotificationAutoWatchOptions,
  signal: AbortSignal,
): Promise<void> {
  if (options.enabled === false) {
    options.onStatus?.('Android WhatsApp watcher disabled by configuration.')
    return
  }

  throwIfAborted(signal)
  const adbPath = await ensureAdbBinary({
    adbPath: options.adbPath,
    onStatus: options.onStatus,
  })
  if (!adbPath) {
    return
  }

  throwIfAborted(signal)
  const packages = normalizeWhatsAppPackageList(options.whatsappPackages)
  const adbkit = await loadAdbkit()
  const adb = adbkit.createClient()
  const serial = await resolveAndroidSerialForAutoWatch(
    adb,
    options.androidUdid,
  )
  if (!serial) {
    options.onStatus?.(
      'No single online Android device is available; Android WhatsApp watcher skipped.',
    )
    return
  }

  throwIfAborted(signal)
  const installedPackages = await findInstalledWhatsAppPackages({
    adb,
    serial,
    packages,
    onStatus: options.onStatus,
  })
  if (!installedPackages.length) {
    return
  }

  throwIfAborted(signal)
  await runAndroidWhatsAppNotificationWatcher({
    ...options,
    androidUdid: serial,
    deviceId: options.deviceId || serial,
    whatsappPackages: installedPackages,
    signal,
  })
}

export function startAndroidWhatsAppNotificationAutoWatcher(
  options: AndroidWhatsAppNotificationAutoWatchOptions,
): AndroidWhatsAppNotificationAutoWatcherHandle {
  const abortController = new AbortController()
  const externalAbortHandler = (): void => {
    abortController.abort()
  }

  if (options.signal) {
    if (options.signal.aborted) {
      abortController.abort()
    } else {
      options.signal.addEventListener('abort', externalAbortHandler, {
        once: true,
      })
    }
  }

  const done = runAndroidWhatsAppNotificationAutoWatcher(
    options,
    abortController.signal,
  )
    .catch((error) => {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }

      options.onStatus?.(
        `Android WhatsApp watcher stopped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    })
    .finally(() => {
      options.signal?.removeEventListener('abort', externalAbortHandler)
    })

  return {
    done,
    async stop() {
      abortController.abort()
      await done
    },
  }
}

export async function runAndroidWhatsAppNotificationWatcher(
  options: AndroidWhatsAppNotificationWatchOptions,
): Promise<AndroidWhatsAppNotificationWatchResult> {
  const packages = normalizeWhatsAppPackageList(options.whatsappPackages)
  const remotePath = normalizeRemoteFridaPath(options.fridaRemotePath)
  const port = options.fridaServerPort || DEFAULT_FRIDA_SERVER_PORT
  const target = options.fridaTarget?.trim() || DEFAULT_FRIDA_TARGET
  const adbkit = await loadAdbkit()
  const adb = adbkit.createClient()
  const serial = await resolveAndroidSerial(adb, options.androidUdid)
  const deviceId = options.deviceId?.trim() || serial
  const dryRun = readBoolean(options.dryRun) ?? false

  if (!dryRun && !options.ingestNotification) {
    throw new Error('ingestNotification is required unless dryRun is enabled.')
  }

  if (options.fridaStartServer !== false) {
    await ensureFridaServer({
      adb,
      serial,
      localPath: options.fridaServerPath,
      remotePath,
      port,
      autoDownload: options.fridaAutoDownload,
      downloadDir: options.fridaDownloadDir,
      onStatus: options.onStatus,
    })
  }

  const frida = await loadFrida()
  const deduper = createWhatsAppNotificationDeduper()
  let processedCount = 0
  let forwardedCount = 0
  let activeSession: ActiveFridaSession | undefined
  let stopRequested = false
  let timeout: NodeJS.Timeout | undefined
  let resolveFinished: (() => void) | undefined
  let rejectFinished: ((error: unknown) => void) | undefined
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve
    rejectFinished = reject
  })

  const stop = (): void => {
    if (stopRequested) {
      return
    }
    stopRequested = true
    resolveFinished?.()
  }

  const abortHandler = (): void => {
    options.onStatus?.('Stopping WhatsApp notification watcher')
    stop()
  }

  if (options.signal) {
    if (options.signal.aborted) {
      abortHandler()
    } else {
      options.signal.addEventListener('abort', abortHandler, { once: true })
    }
  }

  if (options.durationMs && options.durationMs > 0) {
    timeout = setTimeout(stop, options.durationMs)
  }

  activeSession = await attachFridaScript({
    frida,
    serial,
    target,
    packages,
    onStatus: options.onStatus,
    onMessage(message) {
      const notification = normalizeFridaWhatsAppNotificationMessage(message)
      if (!notification || !packages.includes(notification.packageName)) {
        const payload = asRecord(message)?.payload
        const debugMessage = readString(asRecord(payload)?.message)
        if (debugMessage) {
          options.onStatus?.(debugMessage)
        }
        return
      }

      if (!deduper.shouldProcess(notification)) {
        return
      }

      const ingestPayload = buildWhatsAppNotificationIngestPayload(
        notification,
        {
          reservationId: options.reservationId,
          email: options.email,
          deviceId,
        },
      )
      processedCount += 1

      void (async () => {
        try {
          const result = dryRun
            ? undefined
            : await options.ingestNotification?.(ingestPayload)
          if (result) {
            forwardedCount += 1
          }
          await options.onNotification?.(notification, ingestPayload, result)
          if (
            options.once &&
            (result?.codeRecordId || ingestPayload.extractedCode)
          ) {
            stop()
          }
        } catch (error) {
          rejectFinished?.(error)
        }
      })()
    },
  })

  options.onStatus?.(
    `Watching ${packages.join(', ')} notifications on ${serial} via ${target}`,
  )

  try {
    await finished
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
    options.signal?.removeEventListener('abort', abortHandler)
    await cleanupFridaSession(activeSession)
  }

  return {
    serial,
    deviceId,
    processedCount,
    forwardedCount,
    dryRun,
  }
}
