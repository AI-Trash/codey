import { getPathsFromEvents } from 'xstate/graph'
import { assign, createMachine } from 'xstate'
import { describe, expect, it } from 'vitest'
import { createLoginMachine } from '../src/modules/auth-machine'
import {
  assignContext,
  assignContextFromInput,
  composeStateMachineConfig,
  createGuardedCaseTransitions,
  createStateMachine,
  defineStateMachineFragment,
  type StateMachineController,
} from '../src/state-machine'

interface GraphPath {
  state: {
    value: unknown
    context: unknown
  }
  steps: Array<{
    event: {
      type: string
      input?: unknown
    }
    state: {
      value: unknown
      context: unknown
    }
  }>
}

function assertStringState(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected a simple string state, received ${String(value)}`)
  }

  return value
}

function assertObjectContext(value: unknown): object {
  if (!value || typeof value !== 'object') {
    throw new Error('Expected state context to be an object')
  }

  return value
}

async function expectGraphPathsToMatchRuntime<
  State extends string,
  Context extends object,
  Event extends string,
>(options: {
  createSut: () => StateMachineController<State, Context, Event>
  startContext?: Partial<Context>
  paths: GraphPath[]
}) {
  expect(options.paths.length).toBeGreaterThan(0)

  for (const path of options.paths) {
    const sut = options.createSut()
    sut.start(options.startContext)

    for (const step of path.steps) {
      let raisedError: unknown
      try {
        await sut.send(step.event.type as Event, step.event.input)
      } catch (error) {
        raisedError = error
      }
      const snapshot = sut.getSnapshot()
      const expectedState = assertStringState(step.state.value)
      expect(snapshot.state).toBe(expectedState)
      expect(snapshot.context).toMatchObject(
        assertObjectContext(step.state.context),
      )
      if (raisedError && snapshot.state !== expectedState) {
        throw raisedError
      }
    }
  }
}

describe('statechart model coverage', () => {
  it('replays guarded-case paths through the shared runtime', async () => {
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

    function createFragmentMachine() {
      return createStateMachine<
        'idle' | 'preferred' | 'fallback',
        {
          log: string[]
          mode?: 'preferred' | 'fallback'
        },
        'advance'
      >(
        composeStateMachineConfig(
          {
            id: 'fragment.model.machine',
            initialState: 'idle',
            initialContext: {
              log: [],
            },
            states: {
              idle: {},
              preferred: {},
              fallback: {},
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
    }

    const modelMachine = createMachine({
      types: {} as {
        context: { log: string[]; mode?: 'preferred' | 'fallback' }
        events: {
          type: 'advance'
          input: AdvanceInput
        }
      },
      context: {
        log: [],
      },
      initial: 'idle',
      states: {
        idle: {
          on: {
            advance: [
              {
                guard: ({ event }) => event.input.mode === 'preferred',
                target: 'preferred',
                actions: assign(({ context, event }) => ({
                  mode: 'preferred' as const,
                  log: [
                    ...context.log,
                    'exit-idle',
                    event.input.log,
                    'entry-preferred',
                  ],
                })),
              },
              {
                target: 'fallback',
                actions: assign(({ context, event }) => ({
                  mode: 'fallback' as const,
                  log: [
                    ...context.log,
                    'exit-idle',
                    event.input.log,
                    'entry-fallback',
                  ],
                })),
              },
            ],
          },
        },
        preferred: {},
        fallback: {},
      },
    })

    const paths = [
      ...getPathsFromEvents(modelMachine, [
        {
          type: 'advance',
          input: {
            mode: 'preferred',
            log: 'transition-preferred',
          },
        },
      ]),
      ...getPathsFromEvents(modelMachine, [
        {
          type: 'advance',
          input: {
            mode: 'fallback',
            log: 'transition-fallback',
          },
        },
      ]),
    ]

    await expectGraphPathsToMatchRuntime({
      createSut: () => createFragmentMachine(),
      paths,
    })

    const reachedStates = paths.map((path) => path.state.value)
    expect(reachedStates).toEqual(
      expect.arrayContaining(['preferred', 'fallback']),
    )
  })

  it('replays auth login graph paths through the runtime controller', async () => {
    const email = 'person@example.com'

    const modelMachine = createMachine({
      types: {} as {
        context: {
          email?: string
          url?: string
          retryCount?: number
          retryReason?: string
          retryFromState?: string
          lastAttempt?: number
          lastMessage?: string
        }
        events:
          | {
              type: 'auth.opened'
              input: {
                target: 'ready'
                patch: {
                  email: string
                  url: string
                  lastMessage: string
                }
              }
            }
          | {
              type: 'auth.email.typed'
              input: {
                target: 'typing-email'
                patch: {
                  email: string
                  lastMessage: string
                }
              }
            }
          | {
              type: 'auth.retry.requested'
              input: {
                reason: string
                message: string
                patch: {
                  email: string
                  url: string
                }
              }
            }
          | {
              type: 'context.updated'
              input: {
                patch: {
                  email: string
                  url: string
                }
              }
            }
      },
      context: {
        email,
      },
      initial: 'idle',
      states: {
        idle: {
          on: {
            'auth.opened': {
              target: 'ready',
              actions: assign(({ event }) => ({
                ...event.input.patch,
              })),
            },
            'auth.email.typed': {
              target: 'typing-email',
              actions: assign(({ event }) => ({
                ...event.input.patch,
              })),
            },
            'context.updated': {
              guard: ({ event }) =>
                event.input.patch.url === 'https://auth.openai.com/add-phone',
              target: 'add-phone-required',
              actions: assign(({ event }) => ({
                ...event.input.patch,
                lastMessage:
                  'OpenAI required adding a phone number, which this flow does not support.',
              })),
            },
          },
        },
        ready: {
          on: {
            'auth.email.typed': {
              target: 'typing-email',
              actions: assign(({ event }) => ({
                ...event.input.patch,
              })),
            },
            'auth.retry.requested': {
              target: 'retrying',
              actions: assign(({ context, event }) => {
                const nextAttempt = (context.retryCount ?? 0) + 1
                return {
                  ...event.input.patch,
                  retryCount: nextAttempt,
                  retryReason: event.input.reason,
                  retryFromState: 'ready',
                  lastAttempt: nextAttempt,
                  lastMessage: event.input.message,
                }
              }),
            },
            'context.updated': {
              guard: ({ event }) =>
                event.input.patch.url === 'https://auth.openai.com/add-phone',
              target: 'add-phone-required',
              actions: assign(({ event }) => ({
                ...event.input.patch,
                lastMessage:
                  'OpenAI required adding a phone number, which this flow does not support.',
              })),
            },
          },
        },
        'typing-email': {
          on: {
            'auth.retry.requested': {
              target: 'retrying',
              actions: assign(({ context, event }) => {
                const nextAttempt = (context.retryCount ?? 0) + 1
                return {
                  ...event.input.patch,
                  retryCount: nextAttempt,
                  retryReason: event.input.reason,
                  retryFromState: 'typing-email',
                  lastAttempt: nextAttempt,
                  lastMessage: event.input.message,
                }
              }),
            },
            'context.updated': {
              guard: ({ event }) =>
                event.input.patch.url === 'https://auth.openai.com/add-phone',
              target: 'add-phone-required',
              actions: assign(({ event }) => ({
                ...event.input.patch,
                lastMessage:
                  'OpenAI required adding a phone number, which this flow does not support.',
              })),
            },
          },
        },
        retrying: {},
        'add-phone-required': {},
      },
    })

    const paths = [
      ...getPathsFromEvents(modelMachine, [
        {
          type: 'auth.opened',
          input: {
            target: 'ready',
            patch: {
              email,
              url: 'https://auth.openai.com/u/login',
              lastMessage: 'Authentication surface opened',
            },
          },
        },
      ]),
      ...getPathsFromEvents(modelMachine, [
        {
          type: 'auth.email.typed',
          input: {
            target: 'typing-email',
            patch: {
              email,
              lastMessage: 'Typing login email',
            },
          },
        },
      ]),
      ...getPathsFromEvents(modelMachine, [
        {
          type: 'auth.email.typed',
          input: {
            target: 'typing-email',
            patch: {
              email,
              lastMessage: 'Typing login email',
            },
          },
        },
        {
          type: 'auth.retry.requested',
          input: {
            reason: 'email:retry',
            message: 'Retrying login email submission',
            patch: {
              email,
              url: 'https://auth.openai.com/oauth/authorize',
            },
          },
        },
      ]),
      ...getPathsFromEvents(modelMachine, [
        {
          type: 'context.updated',
          input: {
            patch: {
              email,
              url: 'https://auth.openai.com/add-phone',
            },
          },
        },
      ]),
    ]

    await expectGraphPathsToMatchRuntime({
      createSut: () => createLoginMachine({ options: { email } }),
      startContext: { email },
      paths,
    })

    const reachedStates = paths.map((path) => path.state.value)
    expect(reachedStates).toEqual(
      expect.arrayContaining([
        'ready',
        'typing-email',
        'retrying',
        'add-phone-required',
      ]),
    )
  })
})
