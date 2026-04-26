import { describe, expect, it } from 'vitest'
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
  type StateMachineRaisedErrorArgs,
} from '../src/state-machine'

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
