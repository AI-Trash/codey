import { createStore, type StoreApi } from 'zustand/vanilla'

export type MachineStatus = 'idle' | 'running' | 'succeeded' | 'failed'

export interface StateMachineError {
  name: string
  message: string
  stack?: string
  cause?: unknown
}

export interface StateMachineHistoryEntry<
  State extends string,
  Event extends string = string,
> {
  index: number
  at: string
  from: State
  to: State
  event: Event
  status: MachineStatus
  meta?: Record<string, unknown>
}

export interface StateMachineSnapshot<
  State extends string,
  Context extends object,
  Event extends string = string,
> {
  id: string
  status: MachineStatus
  state: State
  context: Context
  currentAction?: string
  error?: StateMachineError
  lastEvent?: Event
  startedAt?: string
  finishedAt?: string
  updatedAt: string
  history: StateMachineHistoryEntry<State, Event>[]
}

type MaybePromise<T> = T | Promise<T>

export type StateMachineContextPatch<Context extends object> =
  | Partial<Context>
  | ((context: Context) => Partial<Context> | Context)

export type StateMachineLifecyclePhase = 'exit' | 'transition' | 'entry'

export interface StateMachineConfig<
  State extends string,
  Context extends object,
  Event extends string = string,
> {
  id: string
  initialState: State
  initialContext: Context
  historyLimit?: number
  states?: Partial<
    Record<State, StateMachineStateConfig<State, Context, Event>>
  >
  on?: Partial<
    Record<
      Event,
      | StateMachineTransitionDefinition<State, Context, Event>
      | StateMachineTransitionDefinition<State, Context, Event>[]
    >
  >
}

export interface StateMachineTransitionOptions<
  Context extends object,
  Event extends string = string,
> {
  event?: Event
  status?: MachineStatus
  patch?: StateMachineContextPatch<Context>
  replaceContext?: Context
  meta?: Record<string, unknown>
  action?: string
  startedAt?: string
  finishedAt?: string
  clearError?: boolean
  preserveCurrentAction?: boolean
}

export interface StateMachineCompletionOptions<
  Context extends object,
  Event extends string = string,
> extends Omit<
  StateMachineTransitionOptions<Context, Event>,
  'status' | 'startedAt' | 'finishedAt'
> {}

export interface StateMachineSendOptions<
  Context extends object,
  Event extends string = string,
> extends Omit<StateMachineTransitionOptions<Context, Event>, 'event'> {}

export interface StateMachineTransitionGuardArgs<
  State extends string,
  Context extends object,
  Event extends string = string,
  Input = unknown,
> {
  context: Context
  event: Event
  input: Input
  from: State
  to: State
  snapshot: StateMachineSnapshot<State, Context, Event>
  transition: StateMachineResolvedTransition<State, Context, Event>
}

export type StateMachineTransitionGuard<
  State extends string,
  Context extends object,
  Event extends string = string,
  Input = unknown,
> = (
  args: StateMachineTransitionGuardArgs<State, Context, Event, Input>,
) => MaybePromise<boolean>

export interface StateMachineActionArgs<
  State extends string,
  Context extends object,
  Event extends string = string,
  Input = unknown,
> {
  context: Context
  event: Event
  input: Input
  from: State
  to: State
  phase: StateMachineLifecyclePhase
  snapshot: StateMachineSnapshot<State, Context, Event>
  transition: StateMachineResolvedTransition<State, Context, Event>
}

export type StateMachineActionResult<Context extends object> =
  | void
  | Partial<Context>
  | Context

export type StateMachineAction<
  State extends string,
  Context extends object,
  Event extends string = string,
  Input = unknown,
> = (
  args: StateMachineActionArgs<State, Context, Event, Input>,
) => MaybePromise<StateMachineActionResult<Context>>

export interface StateMachineTransitionDefinition<
  State extends string,
  Context extends object,
  Event extends string = string,
> {
  target?:
    | State
    | ((
        args: StateMachineTransitionGuardArgs<State, Context, Event, unknown>,
      ) => MaybePromise<State>)
  guard?:
    | StateMachineTransitionGuard<State, Context, Event>
    | Array<StateMachineTransitionGuard<State, Context, Event>>
  actions?:
    | StateMachineAction<State, Context, Event>
    | Array<StateMachineAction<State, Context, Event>>
  priority?: number
  meta?: Record<string, unknown>
  action?: string
  reenter?: boolean
}

export interface StateMachineResolvedTransition<
  State extends string,
  Context extends object,
  Event extends string = string,
> {
  event: Event
  target: State
  source: 'state' | 'global'
  priority: number
  order: number
  action?: string
  meta?: Record<string, unknown>
  reenter?: boolean
  definition: StateMachineTransitionDefinition<State, Context, Event>
}

export interface StateMachineStateConfig<
  State extends string,
  Context extends object,
  Event extends string = string,
> {
  on?: Partial<
    Record<
      Event,
      | StateMachineTransitionDefinition<State, Context, Event>
      | StateMachineTransitionDefinition<State, Context, Event>[]
    >
  >
  entryActions?:
    | StateMachineAction<State, Context, Event>
    | Array<StateMachineAction<State, Context, Event>>
  exitActions?:
    | StateMachineAction<State, Context, Event>
    | Array<StateMachineAction<State, Context, Event>>
}

export interface StateMachineController<
  State extends string,
  Context extends object,
  Event extends string = string,
> {
  readonly id: string
  readonly store: StoreApi<StateMachineSnapshot<State, Context, Event>>
  getSnapshot(): StateMachineSnapshot<State, Context, Event>
  subscribe(
    listener: (snapshot: StateMachineSnapshot<State, Context, Event>) => void,
  ): () => void
  reset(context?: Partial<Context>): StateMachineSnapshot<State, Context, Event>
  start(
    context?: Partial<Context>,
    meta?: Record<string, unknown>,
  ): StateMachineSnapshot<State, Context, Event>
  can<Input = unknown>(event: Event, input?: Input): Promise<boolean>
  selectTransition<Input = unknown>(
    event: Event,
    input?: Input,
  ): Promise<StateMachineResolvedTransition<State, Context, Event> | undefined>
  send<Input = unknown>(
    event: Event,
    input?: Input,
    options?: StateMachineSendOptions<Context, Event>,
  ): Promise<StateMachineSnapshot<State, Context, Event>>
  succeed(
    nextState: State,
    options?: StateMachineCompletionOptions<Context, Event>,
  ): StateMachineSnapshot<State, Context, Event>
  fail(
    error: unknown,
    nextState: State,
    options?: StateMachineCompletionOptions<Context, Event>,
  ): StateMachineSnapshot<State, Context, Event>
}

function now(): string {
  return new Date().toISOString()
}

function serializeError(error: unknown): StateMachineError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause:
        'cause' in error
          ? (error as Error & { cause?: unknown }).cause
          : undefined,
    }
  }

  return {
    name: 'Error',
    message: typeof error === 'string' ? error : JSON.stringify(error),
  }
}

function resolveContextPatch<Context extends object>(
  current: Context,
  patch?: StateMachineContextPatch<Context>,
): Context {
  if (!patch) return current
  const nextPatch = typeof patch === 'function' ? patch(current) : patch
  return { ...current, ...nextPatch } as Context
}

function normalizeArray<T>(value?: T | T[]): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function normalizeTransitionDefinitions<
  State extends string,
  Context extends object,
  Event extends string,
>(
  value?:
    | StateMachineTransitionDefinition<State, Context, Event>
    | StateMachineTransitionDefinition<State, Context, Event>[],
): StateMachineTransitionDefinition<State, Context, Event>[] {
  return normalizeArray(value)
}

export interface GuardedBranchArgs<
  Context,
  Input,
  Branch extends string = string,
> {
  context: Context
  input: Input
  branch: Branch
  failures: GuardedBranchFailure<Branch>[]
}

export type GuardedBranchGuard<
  Context,
  Input,
  Branch extends string = string,
> = (args: GuardedBranchArgs<Context, Input, Branch>) => MaybePromise<boolean>

export interface GuardedBranchDefinition<
  Context,
  Input,
  Result,
  Branch extends string = string,
> {
  branch: Branch
  priority?: number
  guard?:
    | GuardedBranchGuard<Context, Input, Branch>
    | Array<GuardedBranchGuard<Context, Input, Branch>>
  run: (args: GuardedBranchArgs<Context, Input, Branch>) => MaybePromise<Result>
}

export interface GuardedBranchFailure<Branch extends string = string> {
  branch: Branch
  error: GuardedBranchError<Branch>
}

export interface RunGuardedBranchesOptions<
  Context,
  Input,
  Branch extends string = string,
> {
  context: Context
  input: Input
  onFallback?: (failure: GuardedBranchFailure<Branch>) => MaybePromise<void>
}

export class GuardedBranchError<Branch extends string = string> extends Error {
  readonly branch: Branch
  readonly recoverable: boolean
  override readonly cause?: unknown

  constructor(
    branch: Branch,
    message: string,
    options: {
      recoverable?: boolean
      cause?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'GuardedBranchError'
    this.branch = branch
    this.recoverable = options.recoverable ?? true
    this.cause = options.cause
  }
}

export async function runGuardedBranches<
  Context,
  Input,
  Result,
  Branch extends string = string,
>(
  branches: Array<GuardedBranchDefinition<Context, Input, Result, Branch>>,
  options: RunGuardedBranchesOptions<Context, Input, Branch>,
): Promise<{
  branch: Branch
  result: Result
  failures: GuardedBranchFailure<Branch>[]
}> {
  const failures: GuardedBranchFailure<Branch>[] = []
  const orderedBranches = [...branches].sort((left, right) => {
    if ((left.priority ?? 0) !== (right.priority ?? 0)) {
      return (right.priority ?? 0) - (left.priority ?? 0)
    }
    return branches.indexOf(left) - branches.indexOf(right)
  })

  for (const definition of orderedBranches) {
    const args: GuardedBranchArgs<Context, Input, Branch> = {
      context: options.context,
      input: options.input,
      branch: definition.branch,
      failures,
    }

    let matched = true
    for (const guard of normalizeArray(definition.guard)) {
      if (!(await guard(args))) {
        matched = false
        break
      }
    }
    if (!matched) continue

    try {
      return {
        branch: definition.branch,
        result: await definition.run(args),
        failures,
      }
    } catch (error) {
      if (
        !(error instanceof GuardedBranchError) ||
        error.branch !== definition.branch ||
        !error.recoverable
      ) {
        throw error
      }

      const failure: GuardedBranchFailure<Branch> = {
        branch: definition.branch,
        error,
      }
      failures.push(failure)
      await options.onFallback?.(failure)
    }
  }

  const lastFailure = failures.at(-1)
  if (lastFailure) {
    throw lastFailure.error
  }

  throw new Error('No guarded branch matched the current input.')
}

export function assignContext<
  State extends string,
  Context extends object,
  Event extends string = string,
  Input = unknown,
>(
  patch:
    | Partial<Context>
    | ((
        context: Context,
        args: StateMachineActionArgs<State, Context, Event, Input>,
      ) => Partial<Context> | Context),
): StateMachineAction<State, Context, Event, Input> {
  return (args) =>
    typeof patch === 'function' ? patch(args.context, args) : patch
}

export function createStateMachine<
  State extends string,
  Context extends object,
  Event extends string = string,
>(
  config: StateMachineConfig<State, Context, Event>,
): StateMachineController<State, Context, Event> {
  const historyLimit = Math.max(1, config.historyLimit ?? 100)
  const initialContext = { ...config.initialContext }

  const createInitialSnapshot = (): StateMachineSnapshot<
    State,
    Context,
    Event
  > => ({
    id: config.id,
    status: 'idle',
    state: config.initialState,
    context: { ...initialContext } as Context,
    updatedAt: now(),
    history: [],
  })

  const store = createStore<StateMachineSnapshot<State, Context, Event>>(() =>
    createInitialSnapshot(),
  )

  function commit(
    nextState: State,
    options: StateMachineTransitionOptions<Context, Event> = {},
  ): StateMachineSnapshot<State, Context, Event> {
    const previous = store.getState()
    const timestamp = now()
    const nextContext =
      options.replaceContext ??
      resolveContextPatch(previous.context, options.patch)
    const nextStatus = options.status ?? previous.status
    const nextAction =
      options.preserveCurrentAction === false
        ? undefined
        : options.action !== undefined
          ? options.action
          : previous.currentAction
    const nextHistoryIndex = (previous.history.at(-1)?.index ?? 0) + 1
    const nextHistoryEntry: StateMachineHistoryEntry<State, Event> = {
      index: nextHistoryIndex,
      at: timestamp,
      from: previous.state,
      to: nextState,
      event: (options.event ?? 'transition') as Event,
      status: nextStatus,
      meta: options.meta,
    }

    const snapshot: StateMachineSnapshot<State, Context, Event> = {
      ...previous,
      status: nextStatus,
      state: nextState,
      context: nextContext,
      currentAction: nextAction,
      error: options.clearError === false ? previous.error : undefined,
      lastEvent: nextHistoryEntry.event,
      startedAt: options.startedAt ?? previous.startedAt,
      finishedAt: options.finishedAt ?? previous.finishedAt,
      updatedAt: timestamp,
      history: [...previous.history, nextHistoryEntry].slice(-historyLimit),
    }

    store.setState(snapshot)
    return snapshot
  }

  async function resolveTransition<Input = unknown>(
    event: Event,
    input?: Input,
  ): Promise<
    StateMachineResolvedTransition<State, Context, Event> | undefined
  > {
    const snapshot = store.getState()
    const currentState = snapshot.state
    const stateConfig = config.states?.[currentState]
    const scopedTransitions = normalizeTransitionDefinitions(
      stateConfig?.on?.[event],
    ).map((definition, index) => ({
      definition,
      event,
      source: 'state' as const,
      order: index,
      priority: definition.priority ?? 0,
    }))
    const globalBaseOrder = scopedTransitions.length
    const globalTransitions = normalizeTransitionDefinitions(
      config.on?.[event],
    ).map((definition, index) => ({
      definition,
      event,
      source: 'global' as const,
      order: globalBaseOrder + index,
      priority: definition.priority ?? 0,
    }))

    const candidates = [...scopedTransitions, ...globalTransitions].sort(
      (left, right) => {
        if (left.priority !== right.priority) {
          return right.priority - left.priority
        }
        return left.order - right.order
      },
    )

    for (const candidate of candidates) {
      const provisionalTarget =
        typeof candidate.definition.target === 'function'
          ? await candidate.definition.target({
              context: snapshot.context,
              event,
              input,
              from: currentState,
              to: currentState,
              snapshot,
              transition: {
                event,
                target: currentState,
                source: candidate.source,
                priority: candidate.priority,
                order: candidate.order,
                action: candidate.definition.action,
                meta: candidate.definition.meta,
                reenter: candidate.definition.reenter,
                definition: candidate.definition,
              },
            })
          : (candidate.definition.target ?? currentState)

      const resolved: StateMachineResolvedTransition<State, Context, Event> = {
        event,
        target: provisionalTarget,
        source: candidate.source,
        priority: candidate.priority,
        order: candidate.order,
        action: candidate.definition.action,
        meta: candidate.definition.meta,
        reenter: candidate.definition.reenter,
        definition: candidate.definition,
      }

      let passed = true
      for (const guard of normalizeArray(candidate.definition.guard)) {
        const matched = await guard({
          context: snapshot.context,
          event,
          input,
          from: currentState,
          to: resolved.target,
          snapshot,
          transition: resolved,
        })
        if (!matched) {
          passed = false
          break
        }
      }

      if (passed) {
        return resolved
      }
    }

    return undefined
  }

  async function runLifecycleActions<Input = unknown>(
    currentContext: Context,
    actions: Array<StateMachineAction<State, Context, Event, Input>>,
    args: Omit<StateMachineActionArgs<State, Context, Event, Input>, 'context'>,
  ): Promise<Context> {
    let nextContext = currentContext
    for (const action of actions) {
      const result = await action({
        ...args,
        context: nextContext,
      })
      if (result) {
        nextContext = resolveContextPatch(nextContext, result)
      }
    }
    return nextContext
  }

  const controller: StateMachineController<State, Context, Event> = {
    id: config.id,
    store,
    getSnapshot: () => store.getState(),
    subscribe(listener) {
      return store.subscribe(listener)
    },
    reset(context) {
      const snapshot = createInitialSnapshot()
      const nextSnapshot = context
        ? {
            ...snapshot,
            context: { ...snapshot.context, ...context } as Context,
          }
        : snapshot
      store.setState(nextSnapshot)
      return nextSnapshot
    },
    start(context, meta) {
      const timestamp = now()
      const snapshot: StateMachineSnapshot<State, Context, Event> = {
        id: config.id,
        status: 'running',
        state: config.initialState,
        context: { ...initialContext, ...context } as Context,
        updatedAt: timestamp,
        startedAt: timestamp,
        history: [
          {
            index: 1,
            at: timestamp,
            from: config.initialState,
            to: config.initialState,
            event: 'machine.started' as Event,
            status: 'running',
            meta,
          },
        ],
        lastEvent: 'machine.started' as Event,
      }
      store.setState(snapshot)
      return snapshot
    },
    async can(event, input) {
      return Boolean(await resolveTransition(event, input))
    },
    async selectTransition(event, input) {
      return resolveTransition(event, input)
    },
    async send(event, input, options = {}) {
      const snapshot = store.getState()
      const selected = await resolveTransition(event, input)
      if (!selected) {
        return snapshot
      }

      const currentStateConfig = config.states?.[snapshot.state]
      const nextStateConfig = config.states?.[selected.target]
      const reenter =
        selected.reenter === true || selected.target !== snapshot.state
      const nextStatus =
        options.status ??
        (snapshot.status === 'idle' ? 'running' : snapshot.status)
      const mergedMeta = {
        transitionSource: selected.source,
        transitionPriority: selected.priority,
        ...selected.meta,
        ...options.meta,
      }

      let nextContext =
        options.replaceContext ??
        resolveContextPatch(snapshot.context, options.patch)

      const lifecycleArgs = {
        event,
        input,
        from: snapshot.state,
        to: selected.target,
        snapshot,
        transition: selected,
      }

      if (reenter) {
        nextContext = await runLifecycleActions(
          nextContext,
          normalizeArray(currentStateConfig?.exitActions),
          {
            ...lifecycleArgs,
            phase: 'exit',
          },
        )
      }

      nextContext = await runLifecycleActions(
        nextContext,
        normalizeArray(selected.definition.actions),
        {
          ...lifecycleArgs,
          phase: 'transition',
        },
      )

      if (reenter) {
        nextContext = await runLifecycleActions(
          nextContext,
          normalizeArray(nextStateConfig?.entryActions),
          {
            ...lifecycleArgs,
            phase: 'entry',
          },
        )
      }

      return commit(selected.target, {
        ...options,
        event,
        status: nextStatus,
        action: options.action ?? selected.action,
        replaceContext: nextContext,
        meta: mergedMeta,
      })
    },
    succeed(nextState, options) {
      return commit(nextState, {
        ...options,
        status: 'succeeded',
        finishedAt: now(),
        clearError: true,
      })
    },
    fail(error, nextState, options) {
      const snapshot = commit(nextState, {
        ...options,
        status: 'failed',
        finishedAt: now(),
        clearError: false,
      })
      const failedSnapshot: StateMachineSnapshot<State, Context, Event> = {
        ...snapshot,
        error: serializeError(error),
      }
      store.setState(failedSnapshot)
      return failedSnapshot
    },
  }

  return controller
}
