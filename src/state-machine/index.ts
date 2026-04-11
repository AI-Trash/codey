import { createStore, type StoreApi } from 'zustand/vanilla';

export type MachineStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export interface StateMachineError {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

export interface StateMachineHistoryEntry<State extends string, Event extends string = string> {
  index: number;
  at: string;
  from: State;
  to: State;
  event: Event;
  status: MachineStatus;
  meta?: Record<string, unknown>;
}

export interface StateMachineSnapshot<
  State extends string,
  Context extends object,
  Event extends string = string,
> {
  id: string;
  status: MachineStatus;
  state: State;
  context: Context;
  currentAction?: string;
  error?: StateMachineError;
  lastEvent?: Event;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
  history: StateMachineHistoryEntry<State, Event>[];
}

export interface StateMachineConfig<State extends string, Context extends object> {
  id: string;
  initialState: State;
  initialContext: Context;
  historyLimit?: number;
}

export interface StateMachineTransitionOptions<Context extends object, Event extends string = string> {
  event?: Event;
  status?: MachineStatus;
  patch?: Partial<Context> | ((context: Context) => Partial<Context> | Context);
  meta?: Record<string, unknown>;
  action?: string;
  startedAt?: string;
  finishedAt?: string;
  clearError?: boolean;
  preserveCurrentAction?: boolean;
}

export interface StateMachineCompletionOptions<Context extends object, Event extends string = string>
  extends Omit<StateMachineTransitionOptions<Context, Event>, 'status' | 'startedAt' | 'finishedAt'> {}

export interface StateMachineController<
  State extends string,
  Context extends object,
  Event extends string = string,
> {
  readonly id: string;
  readonly store: StoreApi<StateMachineSnapshot<State, Context, Event>>;
  getSnapshot(): StateMachineSnapshot<State, Context, Event>;
  subscribe(listener: (snapshot: StateMachineSnapshot<State, Context, Event>) => void): () => void;
  reset(context?: Partial<Context>): StateMachineSnapshot<State, Context, Event>;
  start(context?: Partial<Context>, meta?: Record<string, unknown>): StateMachineSnapshot<State, Context, Event>;
  transition(
    nextState: State,
    options?: StateMachineTransitionOptions<Context, Event>,
  ): StateMachineSnapshot<State, Context, Event>;
  patchContext(
    patch: Partial<Context> | ((context: Context) => Partial<Context> | Context),
    options?: Omit<StateMachineTransitionOptions<Context, Event>, 'patch'>,
  ): StateMachineSnapshot<State, Context, Event>;
  beginAction(
    action: string,
    options?: Omit<StateMachineTransitionOptions<Context, Event>, 'action'>,
  ): StateMachineSnapshot<State, Context, Event>;
  endAction(options?: Omit<StateMachineTransitionOptions<Context, Event>, 'action'>): StateMachineSnapshot<State, Context, Event>;
  succeed(
    nextState: State,
    options?: StateMachineCompletionOptions<Context, Event>,
  ): StateMachineSnapshot<State, Context, Event>;
  fail(
    error: unknown,
    nextState: State,
    options?: StateMachineCompletionOptions<Context, Event>,
  ): StateMachineSnapshot<State, Context, Event>;
}

function now(): string {
  return new Date().toISOString();
}

function serializeError(error: unknown): StateMachineError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined,
    };
  }

  return {
    name: 'Error',
    message: typeof error === 'string' ? error : JSON.stringify(error),
  };
}

function resolveContextPatch<Context extends object>(
  current: Context,
  patch?: Partial<Context> | ((context: Context) => Partial<Context> | Context),
): Context {
  if (!patch) return current;
  const nextPatch = typeof patch === 'function' ? patch(current) : patch;
  return { ...current, ...nextPatch } as Context;
}

export function createStateMachine<State extends string, Context extends object, Event extends string = string>(
  config: StateMachineConfig<State, Context>,
): StateMachineController<State, Context, Event> {
  const historyLimit = Math.max(1, config.historyLimit ?? 100);
  const initialContext = { ...config.initialContext };

  const createInitialSnapshot = (): StateMachineSnapshot<State, Context, Event> => ({
    id: config.id,
    status: 'idle',
    state: config.initialState,
    context: { ...initialContext } as Context,
    updatedAt: now(),
    history: [],
  });

  const store = createStore<StateMachineSnapshot<State, Context, Event>>(() => createInitialSnapshot());

  function commit(
    nextState: State,
    options: StateMachineTransitionOptions<Context, Event> = {},
  ): StateMachineSnapshot<State, Context, Event> {
    const previous = store.getState();
    const timestamp = now();
    const nextContext = resolveContextPatch(previous.context, options.patch);
    const nextStatus = options.status ?? previous.status;
    const nextAction = options.preserveCurrentAction === false
      ? undefined
      : options.action !== undefined
        ? options.action
        : previous.currentAction;
    const nextHistoryEntry: StateMachineHistoryEntry<State, Event> = {
      index: previous.history.length + 1,
      at: timestamp,
      from: previous.state,
      to: nextState,
      event: (options.event ?? 'transition') as Event,
      status: nextStatus,
      meta: options.meta,
    };

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
    };

    store.setState(snapshot);
    return snapshot;
  }

  return {
    id: config.id,
    store,
    getSnapshot: () => store.getState(),
    subscribe(listener) {
      return store.subscribe(listener);
    },
    reset(context) {
      const snapshot = createInitialSnapshot();
      const nextSnapshot = context
        ? {
            ...snapshot,
            context: { ...snapshot.context, ...context } as Context,
          }
        : snapshot;
      store.setState(nextSnapshot);
      return nextSnapshot;
    },
    start(context, meta) {
      const timestamp = now();
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
      };
      store.setState(snapshot);
      return snapshot;
    },
    transition(nextState, options) {
      return commit(nextState, {
        ...options,
        status: options?.status ?? 'running',
      });
    },
    patchContext(patch, options) {
      return commit(store.getState().state, {
        ...options,
        patch,
        status: options?.status ?? store.getState().status,
      });
    },
    beginAction(action, options) {
      return commit(store.getState().state, {
        ...options,
        action,
        event: options?.event ?? ('action.started' as Event),
        status: options?.status ?? 'running',
      });
    },
    endAction(options) {
      return commit(store.getState().state, {
        ...options,
        preserveCurrentAction: false,
        event: options?.event ?? ('action.finished' as Event),
        status: options?.status ?? store.getState().status,
      });
    },
    succeed(nextState, options) {
      return commit(nextState, {
        ...options,
        status: 'succeeded',
        finishedAt: now(),
        clearError: true,
      });
    },
    fail(error, nextState, options) {
      const snapshot = commit(nextState, {
        ...options,
        status: 'failed',
        finishedAt: now(),
        clearError: false,
      });
      const failedSnapshot: StateMachineSnapshot<State, Context, Event> = {
        ...snapshot,
        error: serializeError(error),
      };
      store.setState(failedSnapshot);
      return failedSnapshot;
    },
  };
}
