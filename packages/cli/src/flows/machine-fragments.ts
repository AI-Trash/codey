import {
  assignContextFromInput,
  createPatchTransitionMap,
  createRetryTransition,
  createSelfPatchTransitionMap,
  defineStateMachineFragment,
  isStateMachinePatchInput,
  type RetryableStateMachineContext,
  type StateMachineConfig,
  type StateMachineFragment,
  type StateMachinePatchInput,
  type StateMachineTransitionDefinition,
  type UrlTrackingStateMachineContext,
} from '../state-machine'

export interface FlowLifecycleFragmentOptions<
  State extends string,
  Event extends string,
> {
  eventTargets: Partial<Record<Event, State>>
  mutableContextEvents: readonly Event[]
  retryEvent: Event
  retryTarget: State
  defaultRetryMessage: string
  allowTargetOverride?: boolean
}

export function createFlowLifecycleFragment<
  State extends string,
  Context extends object & RetryableStateMachineContext<State>,
  Event extends string,
>(
  options: FlowLifecycleFragmentOptions<State, Event>,
): StateMachineFragment<State, Context, Event> {
  const eventTransitions =
    options.allowTargetOverride === false
      ? createFixedPatchTransitionMap<State, Context, Event>(
          options.eventTargets,
        )
      : createPatchTransitionMap<State, Context, Event>(options.eventTargets)
  const contextTransitions =
    options.allowTargetOverride === false
      ? createFixedSelfPatchTransitionMap<State, Context, Event>([
          ...options.mutableContextEvents,
        ])
      : createSelfPatchTransitionMap<State, Context, Event>([
          ...options.mutableContextEvents,
        ])

  return defineStateMachineFragment<State, Context, Event>({
    on: {
      ...eventTransitions,
      [options.retryEvent]: createRetryTransition<State, Context, Event>({
        target: options.retryTarget,
        defaultMessage: options.defaultRetryMessage,
      }),
      ...contextTransitions,
    } as StateMachineConfig<State, Context, Event>['on'],
  })
}

function createFixedPatchTransition<
  State extends string,
  Context extends object,
  Event extends string,
>(target: State): StateMachineTransitionDefinition<State, Context, Event> {
  return {
    target,
    actions: assignContextFromInput<
      State,
      Context,
      Event,
      StateMachinePatchInput<State, Context>
    >(isStateMachinePatchInput, (_context, { input }) => input.patch ?? {}),
  }
}

function createFixedPatchTransitionMap<
  State extends string,
  Context extends object,
  Event extends string,
>(
  targets: Partial<Record<Event, State>>,
): Partial<
  Record<Event, StateMachineTransitionDefinition<State, Context, Event>>
> {
  const transitions: Partial<
    Record<Event, StateMachineTransitionDefinition<State, Context, Event>>
  > = {}

  for (const [event, target] of Object.entries(targets) as Array<
    [Event, State]
  >) {
    transitions[event] = createFixedPatchTransition<State, Context, Event>(
      target,
    )
  }

  return transitions
}

function createFixedSelfPatchTransitionMap<
  State extends string,
  Context extends object,
  Event extends string,
>(
  events: Event[],
): Partial<
  Record<Event, StateMachineTransitionDefinition<State, Context, Event>>
> {
  const transitions: Partial<
    Record<Event, StateMachineTransitionDefinition<State, Context, Event>>
  > = {}

  for (const event of events) {
    transitions[event] = {
      target: undefined,
      actions: assignContextFromInput<
        State,
        Context,
        Event,
        StateMachinePatchInput<State, Context>
      >(isStateMachinePatchInput, (_context, { input }) => input.patch ?? {}),
    }
  }

  return transitions
}

export interface FlowReadyOutcomeInput<Context extends object> {
  ready: boolean
  patch?: Partial<Context>
  message?: string
  failureMessage?: string
}

export function isFlowReadyOutcomeInput<Context extends object>(
  value: unknown,
): value is FlowReadyOutcomeInput<Context> {
  return Boolean(value && typeof value === 'object' && 'ready' in value)
}

export interface FlowUrlContext
  extends
    UrlTrackingStateMachineContext,
    RetryableStateMachineContext<string> {}
