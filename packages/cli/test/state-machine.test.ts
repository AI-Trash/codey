import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  assignContext,
  assignContextFromInput,
  composeStateMachineConfig,
  createGuardedCaseTransitions,
  createStateMachine,
  defineStateMachineFragment,
  GuardedBranchError,
  isOpenAIAddPhoneRequiredError,
  OPENAI_ADD_PHONE_ERROR_MESSAGE,
  OPENAI_ADD_PHONE_URL,
  runGuardedBranches,
  runStateMachineEffects,
  type StateMachineRaisedErrorArgs,
} from '../src/state-machine'
import { createFlowLifecycleFragment } from '../src/flows/machine-fragments'

describe('state machine', () => {
  it('selects transitions by priority and runs exit, transition, and entry actions in order', async () => {
    const machine = createStateMachine<
      'idle' | 'preferred' | 'fallback',
      {
        log: string[]
        choice?: 'preferred' | 'fallback'
      },
      'select'
    >({
      id: 'test.machine',
      initialState: 'idle',
      initialContext: {
        log: [],
      },
      states: {
        idle: {
          exitActions: assignContext((context) => ({
            log: [...context.log, 'exit-idle'],
          })),
          on: {
            select: [
              {
                priority: 20,
                guard: ({ input }) =>
                  Boolean(
                    (input as { preferPreferred?: boolean }).preferPreferred,
                  ),
                target: 'preferred',
                actions: assignContext((context) => ({
                  choice: 'preferred',
                  log: [...context.log, 'transition-preferred'],
                })),
              },
              {
                priority: 10,
                target: 'fallback',
                actions: assignContext((context) => ({
                  choice: 'fallback',
                  log: [...context.log, 'transition-fallback'],
                })),
              },
            ],
          },
        },
        preferred: {
          entryActions: assignContext((context) => ({
            log: [...context.log, 'entry-preferred'],
          })),
        },
        fallback: {
          entryActions: assignContext((context) => ({
            log: [...context.log, 'entry-fallback'],
          })),
        },
      },
    })

    machine.start()
    const snapshot = await machine.send('select', {
      preferPreferred: true,
    })

    expect(snapshot.state).toBe('preferred')
    expect(snapshot.context.choice).toBe('preferred')
    expect(snapshot.context.log).toEqual([
      'exit-idle',
      'transition-preferred',
      'entry-preferred',
    ])
  })

  it('falls through to the next guarded branch when the first branch fails recoverably', async () => {
    const visited: string[] = []

    const resolved = await runGuardedBranches(
      [
        {
          branch: 'preferred' as const,
          priority: 20,
          guard: () => true,
          run: async () => {
            visited.push('preferred')
            throw new GuardedBranchError(
              'preferred',
              'Preferred branch was not enterable.',
            )
          },
        },
        {
          branch: 'fallback' as const,
          priority: 10,
          guard: ({ failures }) => failures.length === 1,
          run: async () => {
            visited.push('fallback')
            return 'fallback-result'
          },
        },
      ],
      {
        context: {
          kind: 'test',
        },
        input: {
          candidates: ['preferred', 'fallback'],
        },
      },
    )

    expect(visited).toEqual(['preferred', 'fallback'])
    expect(resolved.branch).toBe('fallback')
    expect(resolved.result).toBe('fallback-result')
    expect(resolved.failures).toHaveLength(1)
    expect(resolved.failures[0]).toMatchObject({
      branch: 'preferred',
      error: {
        message: 'Preferred branch was not enterable.',
      },
    })
  })

  it('composes fragments and resolves guarded case transitions declaratively', async () => {
    interface AdvanceInput {
      mode: 'preferred' | 'fallback'
      log: string
    }

    function isAdvanceInput(value: unknown): value is AdvanceInput {
      if (!value || typeof value !== 'object') {
        return false
      }

      const candidate = value as Partial<AdvanceInput>
      return (
        (candidate.mode === 'preferred' || candidate.mode === 'fallback') &&
        typeof candidate.log === 'string'
      )
    }

    const machine = createStateMachine<
      'idle' | 'preferred' | 'fallback',
      {
        log: string[]
        mode?: 'preferred' | 'fallback'
      },
      'advance'
    >(
      composeStateMachineConfig(
        {
          id: 'fragment.machine',
          initialState: 'idle',
          initialContext: {
            log: [],
          },
        },
        defineStateMachineFragment<
          'idle' | 'preferred' | 'fallback',
          {
            log: string[]
            mode?: 'preferred' | 'fallback'
          },
          'advance'
        >({
          states: {
            idle: {
              exitActions: assignContext((context) => ({
                log: [...context.log, 'exit-idle'],
              })),
            },
          },
        }),
        defineStateMachineFragment<
          'idle' | 'preferred' | 'fallback',
          {
            log: string[]
            mode?: 'preferred' | 'fallback'
          },
          'advance'
        >({
          on: {
            advance: createGuardedCaseTransitions<
              'idle' | 'preferred' | 'fallback',
              {
                log: string[]
                mode?: 'preferred' | 'fallback'
              },
              'advance',
              AdvanceInput
            >({
              isInput: isAdvanceInput,
              cases: [
                {
                  priority: 20,
                  when: ({ input }) => input.mode === 'preferred',
                  target: 'preferred',
                  actions: assignContextFromInput(
                    isAdvanceInput,
                    (context, { input }) => ({
                      mode: 'preferred',
                      log: [...context.log, input.log],
                    }),
                  ),
                },
                {
                  priority: 10,
                  target: 'fallback',
                  actions: assignContextFromInput(
                    isAdvanceInput,
                    (context, { input }) => ({
                      mode: 'fallback',
                      log: [...context.log, input.log],
                    }),
                  ),
                },
              ],
            }),
          },
        }),
        defineStateMachineFragment<
          'idle' | 'preferred' | 'fallback',
          {
            log: string[]
            mode?: 'preferred' | 'fallback'
          },
          'advance'
        >({
          states: {
            preferred: {
              entryActions: assignContext((context) => ({
                log: [...context.log, 'entry-preferred'],
              })),
            },
            fallback: {
              entryActions: assignContext((context) => ({
                log: [...context.log, 'entry-fallback'],
              })),
            },
          },
        }),
      ),
    )

    machine.start()
    const snapshot = await machine.send('advance', {
      mode: 'preferred',
      log: 'transition-preferred',
    })

    expect(snapshot.state).toBe('preferred')
    expect(snapshot.context.mode).toBe('preferred')
    expect(snapshot.context.log).toEqual([
      'exit-idle',
      'transition-preferred',
      'entry-preferred',
    ])
  })

  it('commits a raised error state before throwing', async () => {
    const machine = createStateMachine<
      'idle' | 'fatal',
      {
        url?: string
      },
      'explode'
    >({
      id: 'raised.machine',
      initialState: 'idle',
      initialContext: {},
      on: {
        explode: {
          target: 'fatal',
          actions: assignContext<'idle' | 'fatal', { url?: string }, 'explode'>(
            () => ({
              url: 'https://auth.openai.com/add-phone',
            }),
          ),
        },
      },
      states: {
        fatal: {
          raise: (
            args: StateMachineRaisedErrorArgs<
              'idle' | 'fatal',
              { url?: string },
              'explode'
            >,
          ) => new Error(`fatal:${args.context.url ?? 'unknown'}`),
        },
      },
    })

    machine.start()

    await expect(machine.send('explode')).rejects.toThrow(
      'fatal:https://auth.openai.com/add-phone',
    )

    expect(machine.getSnapshot()).toMatchObject({
      state: 'fatal',
      context: {
        url: 'https://auth.openai.com/add-phone',
      },
    })
  })

  it('runs state effects and lets emitted events choose the next state', async () => {
    const machine = createStateMachine<
      'idle' | 'observing' | 'done',
      {
        observed?: boolean
      },
      'observe' | 'finish'
    >({
      id: 'effect.machine',
      initialState: 'idle',
      initialContext: {},
      on: {
        observe: {
          target: 'observing',
        },
        finish: {
          target: 'done',
          actions: assignContextFromInput(
            (value): value is { observed: boolean } =>
              Boolean(value && typeof value === 'object'),
            (_context, { input }) => ({
              observed: input.observed,
            }),
          ),
        },
      },
    })

    machine.start()
    await machine.send('observe')
    const snapshot = await runStateMachineEffects(machine, {
      observing: async () => ({
        event: 'finish',
        input: {
          observed: true,
        },
      }),
    })

    expect(snapshot).toMatchObject({
      state: 'done',
      context: {
        observed: true,
      },
    })
  })

  it('tracks parallel regions without replacing the primary state', async () => {
    type MainState = 'idle' | 'checkout-ready'
    type Event =
      | 'checkout.ready'
      | 'unlink.started'
      | 'unlink.waiting'
      | 'unlink.completed'
    type Context = {
      log: string[]
      unlinkStatus?: string
    }

    const machine = createStateMachine<MainState, Context, Event>({
      id: 'parallel-region.machine',
      initialState: 'idle',
      initialContext: {
        log: [],
      },
      on: {
        'checkout.ready': {
          target: 'checkout-ready',
          actions: assignContext((context) => ({
            log: [...context.log, 'checkout-ready'],
          })),
        },
      },
      regions: {
        unlink: {
          initialState: 'idle',
          on: {
            'unlink.started': {
              target: 'running',
              actions: assignContext((context) => ({
                unlinkStatus: 'running',
                log: [...context.log, 'unlink-started'],
              })),
            },
            'unlink.waiting': {
              target: 'waiting',
              actions: assignContext((context) => ({
                unlinkStatus: 'waiting',
                log: [...context.log, 'unlink-waiting'],
              })),
            },
            'unlink.completed': {
              target: 'completed',
              actions: assignContext((context) => ({
                unlinkStatus: 'completed',
                log: [...context.log, 'unlink-completed'],
              })),
            },
          },
        },
      },
    })

    machine.start()
    await machine.send('checkout.ready')
    await machine.send('unlink.started')
    await machine.send('unlink.waiting')
    await machine.send('unlink.completed')

    expect(machine.getSnapshot()).toMatchObject({
      state: 'checkout-ready',
      regions: {
        unlink: 'completed',
      },
      context: {
        unlinkStatus: 'completed',
        log: [
          'checkout-ready',
          'unlink-started',
          'unlink-waiting',
          'unlink-completed',
        ],
      },
    })
    expect(machine.getSnapshot().history.at(-1)).toMatchObject({
      from: 'checkout-ready',
      to: 'checkout-ready',
      region: 'unlink',
      regionFrom: 'waiting',
      regionTo: 'completed',
      event: 'unlink.completed',
    })
  })

  it('ignores target overrides in flow lifecycle fragments by default', async () => {
    type FlowLifecycleTestState = 'idle' | 'ready' | 'failed'
    type FlowLifecycleTestContext = {
      retryCount?: number
      retryReason?: string
      retryFromState?: FlowLifecycleTestState
      lastAttempt?: number
      lastMessage?: string
      value?: string
    }
    type FlowLifecycleTestEvent =
      | 'flow.ready'
      | 'context.updated'
      | 'flow.retry.requested'

    const machine = createStateMachine<
      FlowLifecycleTestState,
      FlowLifecycleTestContext,
      FlowLifecycleTestEvent
    >(
      composeStateMachineConfig(
        {
          id: 'flow.lifecycle.strict-default',
          initialState: 'idle',
          initialContext: {},
          states: {
            idle: {},
            ready: {},
            failed: {},
          },
        },
        createFlowLifecycleFragment<
          FlowLifecycleTestState,
          FlowLifecycleTestContext,
          FlowLifecycleTestEvent
        >({
          eventTargets: {
            'flow.ready': 'ready',
          },
          mutableContextEvents: ['context.updated'],
          retryEvent: 'flow.retry.requested',
          retryTarget: 'failed',
          defaultRetryMessage: 'Retrying flow',
        }),
      ),
    )

    machine.start()

    await machine.send('flow.ready', {
      target: 'failed',
      patch: {
        value: 'event patch',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'ready',
      context: {
        value: 'event patch',
      },
    })

    await machine.send('context.updated', {
      target: 'idle',
      patch: {
        value: 'context patch',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'ready',
      context: {
        value: 'context patch',
      },
    })
  })

  it('keeps flow runners from sending explicit next-state targets', () => {
    const srcRoot = path.resolve(import.meta.dirname, '../src')
    const files = collectTypeScriptFiles(srcRoot)
    const source = files
      .map((filePath) => fs.readFileSync(filePath, 'utf8'))
      .join('\n')

    expect(source).not.toMatch(
      /send[A-Za-z0-9]*Machine\(\s*machine\s*,\s*['"][^'"]+['"]\s*,\s*['"][^'"]+['"]/,
    )
    expect(source).not.toMatch(
      /markAuthStep\(\s*[^,\n]+\s*,\s*['"][^'"]+['"]\s*,\s*['"][^'"]+['"]/,
    )
    expect(source).not.toMatch(/target:\s*state\b/)
  })

  it('identifies add-phone failures for task-level retry decisions', () => {
    expect(
      isOpenAIAddPhoneRequiredError(new Error(OPENAI_ADD_PHONE_ERROR_MESSAGE)),
    ).toBe(true)
    expect(
      isOpenAIAddPhoneRequiredError(`redirected to ${OPENAI_ADD_PHONE_URL}`),
    ).toBe(true)
    expect(isOpenAIAddPhoneRequiredError(new Error('different failure'))).toBe(
      false,
    )
  })
})

function collectTypeScriptFiles(root: string): string[] {
  const files: string[] = []

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(fullPath))
      continue
    }

    if (entry.isFile() && fullPath.endsWith('.ts')) {
      files.push(fullPath)
    }
  }

  return files
}
