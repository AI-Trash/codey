import { describe, expect, it } from 'vitest'
import { assignContext, createStateMachine } from '../src/state-machine'

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
})
