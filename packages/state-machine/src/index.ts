import {
  assign as assignXStateContext,
  createActor,
  createMachine as createXStateMachine,
  type AnyStateMachine,
} from 'xstate'

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

type BivariantCallback<Args extends unknown[], Return> = {
  bivarianceHack(...args: Args): Return
}['bivarianceHack']

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
> = BivariantCallback<
  [StateMachineTransitionGuardArgs<State, Context, Event, Input>],
  MaybePromise<boolean>
>

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
> = BivariantCallback<
  [StateMachineActionArgs<State, Context, Event, Input>],
  MaybePromise<StateMachineActionResult<Context>>
>

export interface StateMachineRaisedErrorArgs<
  State extends string,
  Context extends object,
  Event extends string = string,
> {
  context: Context
  event: Event
  from: State
  to: State
  snapshot: StateMachineSnapshot<State, Context, Event>
  transition: StateMachineResolvedTransition<State, Context, Event>
}

export type StateMachineRaisedErrorFactory<
  State extends string,
  Context extends object,
  Event extends string = string,
> = BivariantCallback<
  [StateMachineRaisedErrorArgs<State, Context, Event>],
  unknown
>

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
  raise?: unknown | StateMachineRaisedErrorFactory<State, Context, Event>
}

export interface StateMachineController<
  State extends string,
  Context extends object,
  Event extends string = string,
> {
  readonly id: string
  readonly store: StateMachineStore<StateMachineSnapshot<State, Context, Event>>
  readonly statechart: AnyStateMachine
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

export interface StateMachineStore<Snapshot> {
  getState(): Snapshot
  subscribe(listener: (snapshot: Snapshot) => void): () => void
}

export interface StateMachineEffectArgs<
  State extends string,
  Context extends object,
  Event extends string = string,
> {
  machine: StateMachineController<State, Context, Event>
  snapshot: StateMachineSnapshot<State, Context, Event>
}

export type StateMachineEffectResult<
  State extends string,
  Context extends object,
  Event extends string = string,
> =
  | void
  | {
      event: Event
      input?: unknown
      options?: StateMachineSendOptions<Context, Event>
    }
  | {
      status: 'succeed'
      state: State
      options?: StateMachineCompletionOptions<Context, Event>
    }
  | {
      status: 'fail'
      state: State
      error: unknown
      options?: StateMachineCompletionOptions<Context, Event>
    }

export type StateMachineEffect<
  State extends string,
  Context extends object,
  Event extends string = string,
> = (
  args: StateMachineEffectArgs<State, Context, Event>,
) => MaybePromise<StateMachineEffectResult<State, Context, Event>>

export async function runStateMachineEffects<
  State extends string,
  Context extends object,
  Event extends string = string,
>(
  machine: StateMachineController<State, Context, Event>,
  effects: Partial<Record<State, StateMachineEffect<State, Context, Event>>>,
  options: {
    maxSteps?: number
  } = {},
): Promise<StateMachineSnapshot<State, Context, Event>> {
  const maxSteps = Math.max(1, options.maxSteps ?? 100)

  for (let step = 0; step < maxSteps; step += 1) {
    const snapshot = machine.getSnapshot()
    if (snapshot.status !== 'running') {
      return snapshot
    }

    const effect = effects[snapshot.state]
    if (!effect) {
      return snapshot
    }

    const result = await effect({
      machine,
      snapshot,
    })
    if (!result) {
      return machine.getSnapshot()
    }

    if ('status' in result) {
      return result.status === 'succeed'
        ? machine.succeed(result.state, result.options)
        : machine.fail(result.error, result.state, result.options)
    }

    await machine.send(result.event, result.input, result.options)
  }

  throw new Error(
    `Machine "${machine.id}" did not settle after ${maxSteps} effect step(s).`,
  )
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

function resolveRaisedError<
  State extends string,
  Context extends object,
  Event extends string,
>(
  raised: unknown | StateMachineRaisedErrorFactory<State, Context, Event>,
  args: StateMachineRaisedErrorArgs<State, Context, Event>,
): unknown {
  const error =
    typeof raised === 'function'
      ? (raised as StateMachineRaisedErrorFactory<State, Context, Event>)(args)
      : raised

  return typeof error === 'string' ? new Error(error) : error
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

interface WritableStateMachineStore<
  Snapshot,
> extends StateMachineStore<Snapshot> {
  setState(snapshot: Snapshot): void
}

function createStateMachineStore<Snapshot>(
  initialSnapshot: Snapshot,
): WritableStateMachineStore<Snapshot> {
  let current = initialSnapshot
  const listeners = new Set<(snapshot: Snapshot) => void>()

  return {
    getState: () => current,
    setState(snapshot) {
      current = snapshot
      for (const listener of listeners) {
        listener(current)
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const STATE_MACHINE_DYNAMIC_TARGET = Symbol('state-machine.dynamic-target')
const STATE_MACHINE_DEFAULT_TARGET = Symbol('state-machine.default-target')

type StateMachineDynamicTargetKind = 'patch' | 'self-patch'

type StateMachineInternalTransitionDefinition<
  State extends string,
  Context extends object,
  Event extends string = string,
> = StateMachineTransitionDefinition<State, Context, Event> & {
  [STATE_MACHINE_DYNAMIC_TARGET]?: StateMachineDynamicTargetKind
  [STATE_MACHINE_DEFAULT_TARGET]?: State
}

interface StateMachineRuntimeEvent<
  Context extends object,
  Event extends string = string,
> {
  type: Event
  input?: unknown
  options?: StateMachineSendOptions<Context, Event>
}

function isThenable<T>(value: MaybePromise<T>): value is Promise<T> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'then' in value &&
    typeof (value as Promise<T>).then === 'function',
  )
}

function expectSynchronousResult<T>(
  value: MaybePromise<T>,
  kind: 'guard' | 'action' | 'target',
): T {
  if (isThenable(value)) {
    throw new Error(
      `XState-backed state machines require synchronous ${kind} functions.`,
    )
  }

  return value
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

  const store = createStateMachineStore<
    StateMachineSnapshot<State, Context, Event>
  >(createInitialSnapshot())

  function createResolvedTransition(
    event: Event,
    target: State,
    source: 'state' | 'global',
    priority: number,
    order: number,
    definition: StateMachineInternalTransitionDefinition<State, Context, Event>,
  ): StateMachineResolvedTransition<State, Context, Event> {
    return {
      event,
      target,
      source,
      priority,
      order,
      action: definition.action,
      meta: definition.meta,
      reenter: definition.reenter,
      definition,
    }
  }

  function getTransitionCandidates(
    state: State,
    event: Event,
  ): Array<{
    definition: StateMachineInternalTransitionDefinition<State, Context, Event>
    event: Event
    source: 'state' | 'global'
    order: number
    priority: number
  }> {
    const stateConfig = config.states?.[state]
    const scopedTransitions = normalizeTransitionDefinitions(
      stateConfig?.on?.[event],
    ).map((definition, index) => ({
      definition: definition as StateMachineInternalTransitionDefinition<
        State,
        Context,
        Event
      >,
      event,
      source: 'state' as const,
      order: index,
      priority: definition.priority ?? 0,
    }))
    const globalBaseOrder = scopedTransitions.length
    const globalTransitions = normalizeTransitionDefinitions(
      config.on?.[event],
    ).map((definition, index) => ({
      definition: definition as StateMachineInternalTransitionDefinition<
        State,
        Context,
        Event
      >,
      event,
      source: 'global' as const,
      order: globalBaseOrder + index,
      priority: definition.priority ?? 0,
    }))

    return [...scopedTransitions, ...globalTransitions].sort((left, right) => {
      if (left.priority !== right.priority) {
        return right.priority - left.priority
      }
      return left.order - right.order
    })
  }

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

  async function resolveTransitionTarget<Input = unknown>(
    definition: StateMachineInternalTransitionDefinition<State, Context, Event>,
    event: Event,
    input: Input,
    currentState: State,
    source: 'state' | 'global',
    priority: number,
    order: number,
    snapshot: StateMachineSnapshot<State, Context, Event>,
  ): Promise<State> {
    if (typeof definition.target !== 'function') {
      return definition.target ?? currentState
    }

    const provisional = definition.target({
      context: snapshot.context,
      event,
      input,
      from: currentState,
      to: currentState,
      snapshot,
      transition: createResolvedTransition(
        event,
        currentState,
        source,
        priority,
        order,
        definition,
      ),
    })

    return await provisional
  }

  async function resolveTransition<Input = unknown>(
    event: Event,
    input?: Input,
  ): Promise<
    StateMachineResolvedTransition<State, Context, Event> | undefined
  > {
    const snapshot = store.getState()
    const currentState = snapshot.state
    const candidates = getTransitionCandidates(currentState, event)

    for (const candidate of candidates) {
      const provisionalTarget = await resolveTransitionTarget(
        candidate.definition,
        event,
        input,
        currentState,
        candidate.source,
        candidate.priority,
        candidate.order,
        snapshot,
      )

      const resolved = createResolvedTransition(
        event,
        provisionalTarget,
        candidate.source,
        candidate.priority,
        candidate.order,
        candidate.definition,
      )

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

  function collectKnownStates(): Set<State> {
    const knownStates = new Set<State>([config.initialState])

    const collectFromDefinitions = (
      definitions?:
        | StateMachineTransitionDefinition<State, Context, Event>
        | StateMachineTransitionDefinition<State, Context, Event>[],
    ) => {
      for (const definition of normalizeTransitionDefinitions(
        definitions,
      ) as Array<
        StateMachineInternalTransitionDefinition<State, Context, Event>
      >) {
        if (typeof definition.target === 'string') {
          knownStates.add(definition.target)
        }
        if (definition[STATE_MACHINE_DEFAULT_TARGET]) {
          knownStates.add(definition[STATE_MACHINE_DEFAULT_TARGET] as State)
        }
      }
    }

    for (const state of Object.keys(config.states ?? {}) as State[]) {
      knownStates.add(state)
      const stateConfig = config.states?.[state]
      if (!stateConfig?.on) continue
      for (const event of Object.keys(stateConfig.on) as Event[]) {
        collectFromDefinitions(stateConfig.on[event])
      }
    }

    for (const event of Object.keys(config.on ?? {}) as Event[]) {
      collectFromDefinitions(config.on?.[event])
    }

    return knownStates
  }

  const knownStates = collectKnownStates()

  function createRuntimeSnapshot(state: State, context: Context) {
    return {
      status: 'active' as const,
      value: state,
      historyValue: {},
      context,
      children: {},
    }
  }

  function getRuntimeInputTarget(
    runtimeEvent: StateMachineRuntimeEvent<Context, Event>,
  ): State | undefined {
    if (!isStateMachinePatchInput<State, Context>(runtimeEvent.input)) {
      return undefined
    }

    return runtimeEvent.input.target
  }

  function compileXStateAction<Input = unknown>(
    action: StateMachineAction<State, Context, Event, Input>,
    resolved: StateMachineResolvedTransition<State, Context, Event>,
    phase: StateMachineLifecyclePhase,
  ) {
    return assignXStateContext(
      ({
        context,
        event: runtimeEvent,
      }: {
        context: Context
        event: StateMachineRuntimeEvent<Context, Event>
      }) => {
        const result = action({
          context,
          event: runtimeEvent.type,
          input: runtimeEvent.input as Input,
          from: store.getState().state,
          to: resolved.target,
          phase,
          snapshot: store.getState(),
          transition: resolved,
        })
        const patch = expectSynchronousResult(result, 'action')
        return patch ? patch : {}
      },
    )
  }

  function compileXStateGuard(
    guard:
      | StateMachineTransitionGuard<State, Context, Event>
      | StateMachineTransitionGuard<State, Context, Event>[],
    resolved: StateMachineResolvedTransition<State, Context, Event>,
    inputTarget?: State,
  ) {
    return ({
      context,
      event: runtimeEvent,
    }: {
      context: Context
      event: StateMachineRuntimeEvent<Context, Event>
    }) => {
      if (
        inputTarget !== undefined &&
        getRuntimeInputTarget(runtimeEvent) !== inputTarget
      ) {
        return false
      }

      for (const candidate of normalizeArray(guard)) {
        const passed = candidate({
          context,
          event: runtimeEvent.type,
          input: runtimeEvent.input,
          from: store.getState().state,
          to: resolved.target,
          snapshot: store.getState(),
          transition: resolved,
        })
        if (!expectSynchronousResult(passed, 'guard')) {
          return false
        }
      }

      return true
    }
  }

  function createPrepatchedContextAction() {
    return assignXStateContext(
      ({
        context,
        event: runtimeEvent,
      }: {
        context: Context
        event: StateMachineRuntimeEvent<Context, Event>
      }) => {
        if (runtimeEvent.options?.replaceContext) {
          return runtimeEvent.options.replaceContext
        }

        if (!runtimeEvent.options?.patch) {
          return {}
        }

        return resolveContextPatch(context, runtimeEvent.options.patch)
      },
    )
  }

  function compileTransitionConfigs(
    currentState: State,
    candidate: ReturnType<typeof getTransitionCandidates>[number],
  ): Record<string, unknown>[] {
    const definition = candidate.definition
    const defaultTarget =
      definition[STATE_MACHINE_DYNAMIC_TARGET] === 'self-patch'
        ? currentState
        : ((definition[STATE_MACHINE_DEFAULT_TARGET] ?? currentState) as State)

    const compileConfig = (target: State, inputTarget?: State) => {
      const resolved = createResolvedTransition(
        candidate.event,
        target,
        candidate.source,
        candidate.priority,
        candidate.order,
        definition,
      )
      const reenter = resolved.reenter === true || target !== currentState
      const currentStateConfig = config.states?.[currentState]
      const nextStateConfig = config.states?.[target]
      const actions: unknown[] = [createPrepatchedContextAction()]

      if (reenter) {
        actions.push(
          ...normalizeArray(currentStateConfig?.exitActions).map((action) =>
            compileXStateAction(action, resolved, 'exit'),
          ),
        )
      }

      actions.push(
        ...normalizeArray(definition.actions).map((action) =>
          compileXStateAction(action, resolved, 'transition'),
        ),
      )

      if (reenter) {
        actions.push(
          ...normalizeArray(nextStateConfig?.entryActions).map((action) =>
            compileXStateAction(action, resolved, 'entry'),
          ),
        )
      }

      const xstateGuard =
        definition.guard || inputTarget !== undefined
          ? compileXStateGuard(definition.guard ?? [], resolved, inputTarget)
          : undefined

      return {
        target,
        reenter: definition.reenter === true,
        guard: xstateGuard,
        actions,
        meta: definition.meta,
      }
    }

    if (!definition[STATE_MACHINE_DYNAMIC_TARGET]) {
      if (typeof definition.target === 'function') {
        throw new Error(
          `Machine "${config.id}" uses an unsupported dynamic target for event "${candidate.event}".`,
        )
      }

      return [compileConfig((definition.target ?? currentState) as State)]
    }

    const expandedTargets = [...knownStates].filter(
      (target) => target !== defaultTarget,
    )

    return [
      ...expandedTargets.map((target) => compileConfig(target, target)),
      compileConfig(defaultTarget),
    ]
  }

  const configuredStates = Object.values(config.states ?? {}) as Array<
    StateMachineStateConfig<State, Context, Event> | undefined
  >
  const eventNames = new Set<Event>([
    ...(Object.keys(config.on ?? {}) as Event[]),
    ...configuredStates.flatMap(
      (stateConfig) => Object.keys(stateConfig?.on ?? {}) as Event[],
    ),
  ])

  const statechartConfig = {
    id: config.id,
    types: {} as {
      context: Context
      events: StateMachineRuntimeEvent<Context, Event>
      input: Context
    },
    context: ({ input }: { input: Context }) =>
      ({ ...initialContext, ...input }) as Context,
    initial: config.initialState,
    states: Object.fromEntries(
      [...knownStates].map((state) => {
        const on = Object.fromEntries(
          [...eventNames]
            .map((event) => {
              const candidates = getTransitionCandidates(state, event)
              if (candidates.length === 0) {
                return undefined
              }

              return [
                event,
                candidates.flatMap((candidate) =>
                  compileTransitionConfigs(state, candidate),
                ),
              ]
            })
            .filter((entry): entry is [Event, Record<string, unknown>[]] =>
              Boolean(entry),
            ),
        )

        return [state, Object.keys(on).length > 0 ? { on } : {}]
      }),
    ),
  }

  const statechart = createXStateMachine(statechartConfig as never)

  let runtime = knownStates.has(config.initialState)
    ? createActor(statechart, {
        snapshot: createRuntimeSnapshot(config.initialState, {
          ...initialContext,
        } as Context) as never,
      } as never)
    : undefined
  runtime?.start()

  function replaceRuntime(state: State, context: Context): void {
    runtime?.stop()
    if (!knownStates.has(state)) {
      runtime = undefined
      return
    }

    runtime = createActor(statechart, {
      snapshot: createRuntimeSnapshot(state, context) as never,
    } as never)
    runtime.start()
  }

  function requireRuntimeActor(): NonNullable<typeof runtime> {
    if (!runtime) {
      throw new Error(
        `Machine "${config.id}" is currently in state "${store.getState().state}", which is not present in the compiled XState graph.`,
      )
    }

    return runtime
  }

  const controller: StateMachineController<State, Context, Event> = {
    id: config.id,
    store,
    statechart,
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
      replaceRuntime(nextSnapshot.state, nextSnapshot.context)
      store.setState(nextSnapshot)
      return nextSnapshot
    },
    start(context, meta) {
      const timestamp = now()
      const nextContext = { ...initialContext, ...context } as Context
      const snapshot: StateMachineSnapshot<State, Context, Event> = {
        id: config.id,
        status: 'running',
        state: config.initialState,
        context: nextContext,
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
      replaceRuntime(config.initialState, nextContext)
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
      const actor = requireRuntimeActor()

      if (!knownStates.has(selected.target)) {
        throw new Error(
          `Machine "${config.id}" resolved event "${event}" to unknown target state "${selected.target}".`,
        )
      }

      actor.send({
        type: event,
        input,
        options,
      })
      const runtimeSnapshot = actor.getSnapshot()

      const committedSnapshot = commit(selected.target, {
        ...options,
        event,
        status: nextStatus,
        action: options.action ?? selected.action,
        replaceContext: runtimeSnapshot.context as Context,
        meta: mergedMeta,
      })

      if (reenter && nextStateConfig?.raise) {
        throw resolveRaisedError(nextStateConfig.raise, {
          context: committedSnapshot.context,
          event,
          from: snapshot.state,
          to: selected.target,
          snapshot: committedSnapshot,
          transition: selected,
        })
      }

      return committedSnapshot
    },
    succeed(nextState, options) {
      const snapshot = commit(nextState, {
        ...options,
        status: 'succeeded',
        finishedAt: now(),
        clearError: true,
      })
      replaceRuntime(snapshot.state, snapshot.context)
      return snapshot
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
      replaceRuntime(failedSnapshot.state, failedSnapshot.context)
      store.setState(failedSnapshot)
      return failedSnapshot
    },
  }

  return controller
}

export interface StateMachineFragment<
  State extends string,
  Context extends object,
  Event extends string = string,
> {
  on?: StateMachineConfig<State, Context, Event>['on']
  states?: StateMachineConfig<State, Context, Event>['states']
}

export function declareStateMachineStates<
  State extends string,
  Context extends object,
  Event extends string = string,
>(
  states: readonly State[],
): NonNullable<StateMachineConfig<State, Context, Event>['states']> {
  return Object.fromEntries(states.map((state) => [state, {}])) as NonNullable<
    StateMachineConfig<State, Context, Event>['states']
  >
}

export function defineStateMachineFragment<
  State extends string,
  Context extends object,
  Event extends string = string,
>(
  fragment: StateMachineFragment<State, Context, Event>,
): StateMachineFragment<State, Context, Event> {
  return fragment
}

function mergeDefinitionCollections<T>(left?: T | T[], right?: T | T[]) {
  const merged = [...normalizeArray(left), ...normalizeArray(right)]
  if (merged.length === 0) {
    return undefined
  }

  return merged.length === 1 ? merged[0] : merged
}

function mergeTransitionMaps<
  State extends string,
  Context extends object,
  Event extends string,
>(
  left?: StateMachineConfig<State, Context, Event>['on'],
  right?: StateMachineConfig<State, Context, Event>['on'],
): StateMachineConfig<State, Context, Event>['on'] {
  if (!left) return right ? { ...right } : undefined
  if (!right) return { ...left }

  const merged: NonNullable<StateMachineConfig<State, Context, Event>['on']> = {
    ...left,
  }

  for (const [event, definition] of Object.entries(right) as Array<
    [
      Event,
      (
        | StateMachineTransitionDefinition<State, Context, Event>
        | StateMachineTransitionDefinition<State, Context, Event>[]
      ),
    ]
  >) {
    merged[event] = mergeDefinitionCollections(merged[event], definition)
  }

  return merged
}

function mergeStateConfigs<
  State extends string,
  Context extends object,
  Event extends string,
>(
  left?: StateMachineStateConfig<State, Context, Event>,
  right?: StateMachineStateConfig<State, Context, Event>,
): StateMachineStateConfig<State, Context, Event> | undefined {
  if (!left) return right ? { ...right } : undefined
  if (!right) return { ...left }

  return {
    ...left,
    ...right,
    on: mergeTransitionMaps(left.on, right.on),
    entryActions: mergeDefinitionCollections(
      left.entryActions,
      right.entryActions,
    ),
    exitActions: mergeDefinitionCollections(
      left.exitActions,
      right.exitActions,
    ),
  }
}

function mergeStates<
  State extends string,
  Context extends object,
  Event extends string,
>(
  left?: StateMachineConfig<State, Context, Event>['states'],
  right?: StateMachineConfig<State, Context, Event>['states'],
): StateMachineConfig<State, Context, Event>['states'] {
  if (!left) return right ? { ...right } : undefined
  if (!right) return { ...left }

  const merged: NonNullable<
    StateMachineConfig<State, Context, Event>['states']
  > = {
    ...left,
  }

  for (const [state, definition] of Object.entries(right) as Array<
    [State, StateMachineStateConfig<State, Context, Event>]
  >) {
    merged[state] = mergeStateConfigs(merged[state], definition)
  }

  return merged
}

export function composeStateMachineConfig<
  State extends string,
  Context extends object,
  Event extends string = string,
>(
  baseConfig: StateMachineConfig<State, Context, Event>,
  ...fragments: Array<StateMachineFragment<State, Context, Event>>
): StateMachineConfig<State, Context, Event> {
  let nextConfig: StateMachineConfig<State, Context, Event> = {
    ...baseConfig,
    on: baseConfig.on ? { ...baseConfig.on } : undefined,
    states: baseConfig.states ? { ...baseConfig.states } : undefined,
  }

  for (const fragment of fragments) {
    nextConfig = {
      ...nextConfig,
      on: mergeTransitionMaps(nextConfig.on, fragment.on),
      states: mergeStates(nextConfig.states, fragment.states),
    }
  }

  return nextConfig
}

export interface StateMachinePatchInput<
  State extends string,
  Context extends object,
> {
  target?: State
  patch?: Partial<Context>
}

export function isStateMachinePatchInput<
  State extends string,
  Context extends object,
>(value: unknown): value is StateMachinePatchInput<State, Context> {
  if (!value || typeof value !== 'object') {
    return false
  }

  return 'patch' in value || 'target' in value
}

export function assignContextFromInput<
  State extends string,
  Context extends object,
  Event extends string = string,
  Input = unknown,
>(
  isInput: (value: unknown) => value is Input,
  patch: (
    context: Context,
    args: StateMachineActionArgs<State, Context, Event, Input>,
  ) => Partial<Context> | Context,
  fallback: Partial<Context> | Context = {},
): StateMachineAction<State, Context, Event> {
  return assignContext<State, Context, Event>((context, args) => {
    if (!isInput(args.input)) {
      return fallback
    }

    return patch(context, {
      ...args,
      input: args.input,
    } as StateMachineActionArgs<State, Context, Event, Input>)
  })
}

export function createPatchTransition<
  State extends string,
  Context extends object,
  Event extends string = string,
  Input extends StateMachinePatchInput<State, Context> = StateMachinePatchInput<
    State,
    Context
  >,
>(
  defaultTarget: State,
  options: {
    isInput?: (value: unknown) => value is Input
  } = {},
): StateMachineTransitionDefinition<State, Context, Event> {
  const matchesInput = (options.isInput ??
    isStateMachinePatchInput<State, Context>) as (
    value: unknown,
  ) => value is Input

  const transition: StateMachineInternalTransitionDefinition<
    State,
    Context,
    Event
  > = {
    target: ({ input }) =>
      matchesInput(input) ? (input.target ?? defaultTarget) : defaultTarget,
    actions: assignContextFromInput<
      State,
      Context,
      Event,
      StateMachinePatchInput<State, Context>
    >(matchesInput, (_context, { input }) => input.patch ?? {}),
  }

  transition[STATE_MACHINE_DYNAMIC_TARGET] = 'patch'
  transition[STATE_MACHINE_DEFAULT_TARGET] = defaultTarget
  return transition
}

export function createSelfPatchTransition<
  State extends string,
  Context extends object,
  Event extends string = string,
  Input extends StateMachinePatchInput<State, Context> = StateMachinePatchInput<
    State,
    Context
  >,
>(
  options: {
    isInput?: (value: unknown) => value is Input
  } = {},
): StateMachineTransitionDefinition<State, Context, Event> {
  const matchesInput = (options.isInput ??
    isStateMachinePatchInput<State, Context>) as (
    value: unknown,
  ) => value is Input

  const transition: StateMachineInternalTransitionDefinition<
    State,
    Context,
    Event
  > = {
    target: ({ from, input }) =>
      matchesInput(input) ? (input.target ?? from) : from,
    actions: assignContextFromInput<
      State,
      Context,
      Event,
      StateMachinePatchInput<State, Context>
    >(matchesInput, (_context, { input }) => input.patch ?? {}),
  }

  transition[STATE_MACHINE_DYNAMIC_TARGET] = 'self-patch'
  return transition
}

export function createPatchTransitionMap<
  State extends string,
  Context extends object,
  Event extends string = string,
  Input extends StateMachinePatchInput<State, Context> = StateMachinePatchInput<
    State,
    Context
  >,
>(
  targets: Partial<Record<Event, State>>,
  options: {
    isInput?: (value: unknown) => value is Input
  } = {},
): Partial<
  Record<Event, StateMachineTransitionDefinition<State, Context, Event>>
> {
  const transitions: Partial<
    Record<Event, StateMachineTransitionDefinition<State, Context, Event>>
  > = {}

  for (const [event, target] of Object.entries(targets) as Array<
    [Event, State]
  >) {
    transitions[event] = createPatchTransition<State, Context, Event, Input>(
      target,
      options,
    )
  }

  return transitions
}

export function createSelfPatchTransitionMap<
  State extends string,
  Context extends object,
  Event extends string = string,
  Input extends StateMachinePatchInput<State, Context> = StateMachinePatchInput<
    State,
    Context
  >,
>(
  events: Event[],
  options: {
    isInput?: (value: unknown) => value is Input
  } = {},
): Partial<
  Record<Event, StateMachineTransitionDefinition<State, Context, Event>>
> {
  const transitions: Partial<
    Record<Event, StateMachineTransitionDefinition<State, Context, Event>>
  > = {}

  for (const event of events) {
    transitions[event] = createSelfPatchTransition<
      State,
      Context,
      Event,
      Input
    >(options)
  }

  return transitions
}

export interface UrlTrackingStateMachineContext {
  url?: string
  lastMessage?: string
}

function getRecordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  return (value as Record<string, unknown>)[key]
}

function getRecordStringValue(value: unknown, key: string): string | undefined {
  const candidate = getRecordValue(value, key)
  return typeof candidate === 'string' ? candidate : undefined
}

export function resolveStateMachineUrlCandidate<
  Context extends UrlTrackingStateMachineContext,
>(input: unknown, context: Context): string | undefined {
  return (
    getRecordStringValue(input, 'url') ??
    getRecordStringValue(getRecordValue(input, 'patch'), 'url') ??
    context.url
  )
}

function normalizeStateMachineUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return trimmed
  }

  try {
    const parsed = new URL(trimmed)
    const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/'
    return `${parsed.origin}${normalizedPath}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export function matchesStateMachineUrlCandidate(
  candidate: string | undefined,
  expectedUrl: string,
): boolean {
  if (!candidate) {
    return false
  }

  return (
    normalizeStateMachineUrl(candidate) ===
    normalizeStateMachineUrl(expectedUrl)
  )
}

export const OPENAI_ADD_PHONE_URL = 'https://auth.openai.com/add-phone'
export const OPENAI_ADD_PHONE_ERROR_MESSAGE =
  'OpenAI required adding a phone number, which this flow does not support.'

export function isOpenAIAddPhoneRequiredError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''

  return (
    message.includes(OPENAI_ADD_PHONE_ERROR_MESSAGE) ||
    message.includes(OPENAI_ADD_PHONE_URL)
  )
}

export function createUrlGuardFailureFragment<
  State extends string,
  Context extends object & UrlTrackingStateMachineContext,
  Event extends string = string,
>(options: {
  events: readonly Event[]
  target: State
  url: string
  message: string
  priority?: number
  error?: string | Error | StateMachineRaisedErrorFactory<State, Context, Event>
}): StateMachineFragment<State, Context, Event> {
  const on = options.events.reduce<
    Partial<
      Record<Event, StateMachineTransitionDefinition<State, Context, Event>>
    >
  >((transitions, event) => {
    transitions[event] = {
      priority: options.priority ?? 1000,
      target: options.target,
      guard: ({ input, context }) =>
        matchesStateMachineUrlCandidate(
          resolveStateMachineUrlCandidate(input, context),
          options.url,
        ),
      actions: assignContext<State, Context, Event>((context, { input }) => {
        const url = resolveStateMachineUrlCandidate(input, context)
        return {
          ...(url ? { url } : {}),
          lastMessage: options.message,
        } as Partial<Context>
      }),
    }
    return transitions
  }, {})

  return defineStateMachineFragment<State, Context, Event>({
    on,
    states: {
      [options.target]: {
        raise: (args: StateMachineRaisedErrorArgs<State, Context, Event>) =>
          resolveRaisedError(
            options.error ??
              (args.context.lastMessage as string | undefined) ??
              options.message,
            args,
          ),
      },
    } as StateMachineConfig<State, Context, Event>['states'],
  })
}

export function createOpenAIAddPhoneFailureFragment<
  State extends string,
  Context extends object & UrlTrackingStateMachineContext,
  Event extends string = string,
>(options: {
  events: readonly Event[]
  target: State
  priority?: number
  message?: string
}): StateMachineFragment<State, Context, Event> {
  return createUrlGuardFailureFragment<State, Context, Event>({
    events: options.events,
    target: options.target,
    url: OPENAI_ADD_PHONE_URL,
    priority: options.priority,
    message: options.message ?? OPENAI_ADD_PHONE_ERROR_MESSAGE,
  })
}

export interface RetryableStateMachineContext<State extends string> {
  retryCount?: number
  retryReason?: string
  retryFromState?: State
  lastAttempt?: number
  lastMessage?: string
}

export interface StateMachineRetryInput<Context extends object> {
  patch?: Partial<Context>
  reason?: string
  message?: string
}

export function isStateMachineRetryInput<Context extends object>(
  value: unknown,
): value is StateMachineRetryInput<Context> {
  return Boolean(value && typeof value === 'object')
}

export function createRetryTransition<
  State extends string,
  Context extends object & RetryableStateMachineContext<State>,
  Event extends string = string,
  Input extends StateMachineRetryInput<Context> =
    StateMachineRetryInput<Context>,
>(options: {
  target: State
  defaultMessage: string
  priority?: number
  isInput?: (value: unknown) => value is Input
}): StateMachineTransitionDefinition<State, Context, Event> {
  const matchesInput = (options.isInput ??
    isStateMachineRetryInput<Context>) as (value: unknown) => value is Input

  return {
    priority: options.priority ?? 100,
    target: options.target,
    actions: assignContext<State, Context, Event, Input>(
      (context, { input, from }) => {
        const retryInput = matchesInput(input) ? input : undefined
        const nextAttempt = (context.retryCount ?? 0) + 1
        return {
          ...retryInput?.patch,
          retryCount: nextAttempt,
          retryReason: retryInput?.reason ?? context.retryReason,
          retryFromState: from,
          lastAttempt: nextAttempt,
          lastMessage: retryInput?.message ?? options.defaultMessage,
        } as Partial<Context>
      },
    ),
  }
}

export interface StateMachineGuardedCaseDefinition<
  State extends string,
  Context extends object,
  Event extends string = string,
  Input = unknown,
> extends Omit<
  StateMachineTransitionDefinition<State, Context, Event>,
  'guard'
> {
  when?: (args: { context: Context; input: Input }) => MaybePromise<boolean>
  guard?:
    | StateMachineTransitionGuard<State, Context, Event, Input>
    | Array<StateMachineTransitionGuard<State, Context, Event, Input>>
}

export function createGuardedCaseTransitions<
  State extends string,
  Context extends object,
  Event extends string = string,
  Input = unknown,
>(options: {
  isInput: (value: unknown) => value is Input
  cases: Array<StateMachineGuardedCaseDefinition<State, Context, Event, Input>>
}): StateMachineTransitionDefinition<State, Context, Event>[] {
  return options.cases.map(({ when, guard, ...definition }) => ({
    ...definition,
    guard: (args) => {
      if (!options.isInput(args.input)) {
        return false
      }

      const typedArgs = {
        ...args,
        input: args.input,
      } as StateMachineTransitionGuardArgs<State, Context, Event, Input>

      if (
        when &&
        !expectSynchronousResult(
          when({ context: typedArgs.context, input: typedArgs.input }),
          'guard',
        )
      ) {
        return false
      }

      for (const candidate of normalizeArray(guard)) {
        if (!expectSynchronousResult(candidate(typedArgs), 'guard')) {
          return false
        }
      }

      return true
    },
  }))
}
