import { defineWebSocketHandler } from 'nitro'

import {
  buildInitialCliCursor,
  CLI_CONNECTION_TOUCH_INTERVAL_MS,
  CLI_EVENT_POLL_INTERVAL_MS,
  CLI_EVENT_TIMEOUT_MS,
  listPendingCliEvents,
  markCliEventConnectionDisconnected,
  registerCliEventConnection,
  touchCliEventConnection,
} from '../../../../src/lib/server/cli-events'
import { subscribeAdminInboxEmailEvents } from '../../../../src/lib/server/admin-inbox-events'
import { pollDeviceChallenge } from '../../../../src/lib/server/device-auth'
import { subscribeVerificationCodeEvents } from '../../../../src/lib/server/verification-events'
import { listVerificationCodeEventsAfterCursor } from '../../../../src/lib/server/verification'
import { toWsMessage } from '../../../../src/lib/server/ws'

interface CliSubscriptionState {
  connectionId: string
  target?: string
  cursor: ReturnType<typeof buildInitialCliCursor>
  lastTouchedAt: number
  interval?: ReturnType<typeof setInterval>
  timeout?: ReturnType<typeof setTimeout>
  ticking: boolean
}

interface PeerSubscriptions {
  cli?: CliSubscriptionState
  cleanup: Array<() => void>
}

const peerState = new WeakMap<object, PeerSubscriptions>()

function getPeerState(peer: object): PeerSubscriptions {
  const current = peerState.get(peer)
  if (current) return current
  const created: PeerSubscriptions = { cleanup: [] }
  peerState.set(peer, created)
  return created
}

function readHeader(peer: { request?: Request }, name: string): string | undefined {
  const value = peer.request?.headers.get(name)
  const normalized = value?.trim()
  return normalized || undefined
}

function readListHeader(peer: { request?: Request }, name: string): string[] {
  const value = readHeader(peer, name)
  if (!value) {
    return []
  }

  return Array.from(
    new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  )
}

function compareVerificationCodeCursor(left: string, right: string) {
  const [leftReceivedAt, leftId = ''] = left.split('|')
  const [rightReceivedAt, rightId = ''] = right.split('|')
  if (leftReceivedAt < rightReceivedAt) return -1
  if (leftReceivedAt > rightReceivedAt) return 1
  return leftId.localeCompare(rightId)
}

export default defineWebSocketHandler({
  open(peer) {
    getPeerState(peer)
  },
  async message(peer, message) {
    try {
      let payload: Record<string, unknown>
      payload = JSON.parse(message.text()) as Record<string, unknown>

      const action = typeof payload.action === 'string' ? payload.action : ''
      const channel = typeof payload.channel === 'string' ? payload.channel : ''
      if (action === 'ping') {
        peer.send(
          toWsMessage({
            event: 'pong',
            data: {
              ok: true,
              receivedAt: new Date().toISOString(),
            },
          }),
        )
        return
      }

      if (action !== 'subscribe') {
        peer.send(
          toWsMessage({ event: 'error', data: { message: 'Unsupported action' } }),
        )
        return
      }

      peer.send(
        toWsMessage({
          event: 'realtime_subscription',
          data: { channel, status: 'received' },
        }),
      )

      const state = getPeerState(peer)

      if (channel === 'cli') {
      if (state.cli) {
        return
      }
      const cliName =
        (typeof payload.cliName === 'string' && payload.cliName.trim()) ||
        readHeader(peer, 'x-codey-cli-name') ||
        'codey'
      const workerId = readHeader(peer, 'x-codey-worker-id')
      const target = typeof payload.target === 'string' ? payload.target : undefined
      const after = typeof payload.after === 'string' ? payload.after : null

      const { connection, event } = await registerCliEventConnection({
        sessionRef: readHeader(peer, 'x-codey-session-ref') || null,
        userId: readHeader(peer, 'x-codey-user-id') || null,
        authClientId: readHeader(peer, 'x-codey-auth-client-id') || null,
        workerId,
        cliName,
        target,
        userAgent: readHeader(peer, 'user-agent'),
        registeredFlows: readListHeader(peer, 'x-codey-registered-flows'),
        connectionPath: '/api/realtime/ws',
      })

      const cliState: CliSubscriptionState = {
        connectionId: connection.id,
        target,
        cursor: buildInitialCliCursor(after),
        lastTouchedAt: 0,
        ticking: false,
      }
      state.cli = cliState
      peer.send(JSON.stringify(event))

      const touchConnection = async (force = false) => {
        const current = getPeerState(peer).cli
        if (!current) return
        const now = Date.now()
        if (!force && now - current.lastTouchedAt < CLI_CONNECTION_TOUCH_INTERVAL_MS) {
          return
        }
        current.lastTouchedAt = now
        await touchCliEventConnection(current.connectionId)
      }

      const runTick = async () => {
        const current = getPeerState(peer).cli
        if (!current || current.ticking) return
        current.ticking = true
        try {
          await touchConnection()
          const pending = await listPendingCliEvents({
            cursor: current.cursor,
            target: current.target,
            workerId: current.connectionId,
          })
          if (!pending) return
          current.cursor = pending.cursor
          await touchConnection(true)
          peer.send(JSON.stringify(pending.event))
        } finally {
          const latest = getPeerState(peer).cli
          if (latest) latest.ticking = false
        }
      }

      cliState.interval = setInterval(() => {
        void runTick().catch(async () => {
          const current = getPeerState(peer).cli
          if (!current) return
          await markCliEventConnectionDisconnected(current.connectionId)
          peer.close()
        })
      }, CLI_EVENT_POLL_INTERVAL_MS)
      cliState.timeout = setTimeout(async () => {
        const current = getPeerState(peer).cli
        if (!current) return
        peer.send(toWsMessage({ event: 'timeout', data: { status: 'timeout' } }))
        await markCliEventConnectionDisconnected(current.connectionId)
        peer.close()
      }, CLI_EVENT_TIMEOUT_MS)

      await touchConnection(true)
      await runTick()
        return
      }

      if (channel === 'verification') {
      const email = typeof payload.email === 'string' ? payload.email : ''
      const startedAt = typeof payload.startedAt === 'string' ? payload.startedAt : ''
      if (!email || !startedAt) {
        peer.send(toWsMessage({ event: 'error', data: { message: 'email and startedAt are required' } }))
        return
      }

      const normalizedEmail = email.toLowerCase()
      const startedAtDate = new Date(startedAt)
      const normalizedStartedAt = Number.isNaN(startedAtDate.getTime())
        ? new Date(0).toISOString()
        : startedAtDate.toISOString()
      let cursor = typeof payload.after === 'string' ? payload.after : null
      const pendingEvents: Awaited<ReturnType<typeof listVerificationCodeEventsAfterCursor>> = []
      let backlogReady = false

      const sendVerificationCode = (
        event: Awaited<ReturnType<typeof listVerificationCodeEventsAfterCursor>>[number],
      ) => {
        if (cursor && compareVerificationCodeCursor(event.cursor, cursor) <= 0) {
          return
        }
        cursor = event.cursor
        peer.send(toWsMessage({ id: event.cursor, event: 'verification_code', data: event }))
      }

      const unsubscribe = subscribeVerificationCodeEvents((event) => {
        if (event.email.toLowerCase() !== normalizedEmail) return
        if (event.receivedAt < normalizedStartedAt) return
        if (!backlogReady) {
          pendingEvents.push(event)
          return
        }
        sendVerificationCode(event)
      })
      state.cleanup.push(() => unsubscribe())

      while (true) {
        const backlogEvents = await listVerificationCodeEventsAfterCursor({
          email,
          startedAt: normalizedStartedAt,
          cursor,
          limit: 100,
        })
        if (!backlogEvents.length) break
        for (const event of backlogEvents) {
          sendVerificationCode(event)
        }
        if (backlogEvents.length < 100) break
      }

      backlogReady = true
      pendingEvents
        .sort((left, right) => compareVerificationCodeCursor(left.cursor, right.cursor))
        .forEach(sendVerificationCode)
        return
      }

      if (channel === 'device') {
      const deviceCode = typeof payload.deviceCode === 'string' ? payload.deviceCode : ''
      if (!deviceCode) {
        peer.send(toWsMessage({ event: 'error', data: { message: 'deviceCode is required' } }))
        return
      }

      const interval = setInterval(async () => {
        const challenge = await pollDeviceChallenge(deviceCode)
        if (!challenge) {
          peer.send(toWsMessage({ event: 'missing', data: { status: 'missing' } }))
          peer.close()
          return
        }
        if (challenge.status === 'PENDING') return
        peer.send(
          toWsMessage({
            id: challenge.lastPolledAt?.toISOString() || challenge.createdAt.toISOString(),
            event: 'device_status',
            data: {
              status: challenge.status,
              userCode: challenge.userCode,
              approvalMessage: challenge.approvalMessage,
            },
          }),
        )
        peer.close()
      }, 2000)
      const timeout = setTimeout(() => {
        peer.send(toWsMessage({ event: 'timeout', data: { status: 'timeout' } }))
        peer.close()
      }, 120000)
      state.cleanup.push(() => {
        clearInterval(interval)
        clearTimeout(timeout)
      })
        return
      }

      if (channel === 'admin_inbox') {
      const unsubscribe = subscribeAdminInboxEmailEvents(() => {
        peer.send(toWsMessage({ event: 'email', data: { ok: true } }))
      })
      state.cleanup.push(() => unsubscribe())
        return
      }

      peer.send(toWsMessage({ event: 'error', data: { message: 'Unsupported channel' } }))
    } catch (error) {
      peer.send(
        toWsMessage({
          event: 'error',
          data: {
            message:
              error instanceof Error
                ? error.message
                : 'Realtime subscription failed',
          },
        }),
      )
    }
  },
  async close(peer) {
    const state = peerState.get(peer)
    if (!state) {
      return
    }

    if (state.cli) {
      if (state.cli.interval) clearInterval(state.cli.interval)
      if (state.cli.timeout) clearTimeout(state.cli.timeout)
      await markCliEventConnectionDisconnected(state.cli.connectionId)
    }

    for (const cleanup of state.cleanup) {
      cleanup()
    }
    peerState.delete(peer)
  },
})
