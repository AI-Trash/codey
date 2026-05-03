import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildSingBoxConfigForTest,
  installSingBoxExecutableForTest,
  resolveSingBoxExecutableForTest,
  selectCodeySingBoxProxyConfig,
} from '../src/modules/proxy/sing-box'
import type { CliRuntimeConfig } from '../src/config'

const fakeWindowsZipBase64 =
  'UEsDBBQAAAAIAAAAAAAAm/ZYEwAAABEAAAArAAAAc2luZy1ib3gtMS4xMy4xMS13aW5kb3dzLWFtZDY0L3NpbmctYm94LmV4ZUtLzE5VKM7MS9dNyq9QSK1IBQA='

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('managed sing-box auto install', () => {
  it('downloads and extracts the matching Windows release asset', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codey-sing-box-'))
    const config = createRuntimeConfig(rootDir, {
      version: '1.13.11',
    })
    const archive = Buffer.from(fakeWindowsZipBase64, 'base64')
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/tags/v1.13.11')) {
        return createJsonResponse({
          tag_name: 'v1.13.11',
          assets: [
            {
              name: 'sing-box-1.13.11-windows-amd64.zip',
              browser_download_url: 'https://example.test/sing-box.zip',
            },
          ],
        })
      }

      if (url === 'https://example.test/sing-box.zip') {
        return createBufferResponse(archive)
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const executable = await installSingBoxExecutableForTest(config)

    expect(executable).toBe(
      path.join(
        rootDir,
        '.codey',
        'sing-box',
        'bin',
        '1.13.11',
        'windows',
        'amd64',
        'sing-box.exe',
      ),
    )
    expect(fs.readFileSync(executable, 'utf8')).toBe('fake sing-box exe')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await installSingBoxExecutableForTest(config)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('prefers a usable configured executable before auto install', async () => {
    const config = createRuntimeConfig(os.tmpdir(), {
      executable: 'C:\\tools\\sing-box.exe',
      autoInstall: true,
    })

    vi.stubGlobal('fetch', vi.fn())
    const executable = await resolveSingBoxExecutableForTest(
      config,
      async () => true,
    )

    expect(executable).toBe('C:\\tools\\sing-box.exe')
  })

  it('does not emit unsupported hysteria2 username fields', () => {
    const { config } = buildSingBoxConfigForTest({
      host: '127.0.0.1',
      port: 2080,
      nodes: [
        {
          id: 'node-1',
          name: 'Japan 1',
          tag: 'japan',
          protocol: 'hysteria2',
          server: '203.0.113.1',
          serverPort: 443,
          username: 'unused-user',
          password: 'shared-password',
          tls: {
            enabled: true,
            serverName: 'example.test',
          },
        },
      ],
    })

    const outbound = config.outbounds.find(
      (entry) => entry.type === 'hysteria2',
    )

    expect(outbound).toMatchObject({
      type: 'hysteria2',
      password: 'shared-password',
    })
    expect(outbound).not.toHaveProperty('username')
  })

  it('emits trojan outbound fields', () => {
    const { config } = buildSingBoxConfigForTest({
      host: '127.0.0.1',
      port: 2080,
      nodes: [
        {
          id: 'node-1',
          name: 'Trojan 1',
          tag: 'japan',
          protocol: 'trojan',
          server: '203.0.113.2',
          serverPort: 443,
          password: 'trojan-password',
          tls: {
            enabled: true,
            serverName: 'trojan.example.test',
            insecure: true,
          },
        },
      ],
    })

    const outbound = config.outbounds.find((entry) => entry.type === 'trojan')

    expect(outbound).toMatchObject({
      type: 'trojan',
      password: 'trojan-password',
      tls: {
        enabled: true,
        server_name: 'trojan.example.test',
        insecure: true,
      },
    })
  })

  it('emits vless outbound fields', () => {
    const { config } = buildSingBoxConfigForTest({
      host: '127.0.0.1',
      port: 2080,
      nodes: [
        {
          id: 'node-1',
          name: 'VLESS 1',
          tag: 'singapore',
          protocol: 'vless',
          server: '203.0.113.3',
          serverPort: 443,
          uuid: '11111111-1111-4111-8111-111111111111',
          vlessFlow: 'xtls-rprx-vision',
          tls: {
            enabled: true,
            serverName: 'vless.example.test',
          },
        },
      ],
    })

    const outbound = config.outbounds.find((entry) => entry.type === 'vless')

    expect(outbound).toMatchObject({
      type: 'vless',
      uuid: '11111111-1111-4111-8111-111111111111',
      flow: 'xtls-rprx-vision',
      tls: {
        enabled: true,
        server_name: 'vless.example.test',
      },
    })
    expect(outbound).not.toHaveProperty('password')
  })

  it('selects state proxy configs through the current flow runtime', async () => {
    const runtime = {
      runtimeId: 'flow-1',
      mixedProxy: {
        server: 'http://127.0.0.1:22080',
        host: '127.0.0.1',
        port: 22080,
      },
      nodes: [],
      selectedTag: 'japan',
      selectTag: vi.fn(async (tag: string) => {
        runtime.selectedTag = tag
      }),
      refresh: vi.fn(),
      stop: vi.fn(),
    }

    const { runWithCodeySingBoxProxyRuntime } =
      await import('../src/modules/proxy/sing-box')

    const unchanged = await runWithCodeySingBoxProxyRuntime(runtime, () =>
      selectCodeySingBoxProxyConfig({
        label: 'japan',
        tags: ['japan'],
      }),
    )
    const changed = await runWithCodeySingBoxProxyRuntime(runtime, () =>
      selectCodeySingBoxProxyConfig({
        label: 'singapore',
        tags: ['singapore'],
      }),
    )

    expect(runtime.selectTag).toHaveBeenNthCalledWith(1, 'japan')
    expect(runtime.selectTag).toHaveBeenNthCalledWith(2, 'singapore')
    expect(unchanged).toMatchObject({
      selected: true,
      selectedTag: 'japan',
      changed: false,
    })
    expect(changed).toMatchObject({
      selected: true,
      selectedTag: 'singapore',
      changed: true,
    })
  })

  it('fails flow proxy startup when the requested tag is not available', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codey-sing-box-'))
    const { startCodeySingBoxFlowProxy } =
      await import('../src/modules/proxy/sing-box')

    await expect(
      startCodeySingBoxFlowProxy({
        config: createRuntimeConfig(rootDir, {
          enabled: true,
          executable: 'sing-box',
          autoInstall: false,
          mixedHost: '127.0.0.1',
          mixedPort: 2080,
        }),
        nodes: [
          {
            id: 'node-1',
            name: 'Japan 1',
            tag: 'japan',
            protocol: 'hysteria2',
            server: '203.0.113.1',
            serverPort: 443,
            password: 'shared-password',
          },
        ],
        selectedTag: 'singapore',
      }),
    ).rejects.toThrow('No enabled proxy node has tag singapore')
  })
})

function createRuntimeConfig(
  rootDir: string,
  singBox: NonNullable<CliRuntimeConfig['singBox']>,
): CliRuntimeConfig {
  return {
    rootDir,
    artifactsDir: path.join(rootDir, 'artifacts'),
    browser: {
      headless: true,
      slowMo: 0,
      defaultTimeoutMs: 30000,
      navigationTimeoutMs: 30000,
      recordHar: false,
    },
    openai: {
      baseUrl: 'https://openai.com',
      chatgptUrl: 'https://chatgpt.com',
    },
    singBox,
  }
}

function createJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  }
}

function createBufferResponse(body: Buffer) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  }
}
