import {
  createPatchTransitionMap,
  createRetryTransition,
  createSelfPatchTransitionMap,
  defineStateMachineFragment,
  type RetryableStateMachineContext,
  type StateMachineConfig,
  type StateMachineFragment,
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
}

export function createFlowLifecycleFragment<
  State extends string,
  Context extends object & RetryableStateMachineContext<State>,
  Event extends string,
>(
  options: FlowLifecycleFragmentOptions<State, Event>,
): StateMachineFragment<State, Context, Event> {
  return defineStateMachineFragment<State, Context, Event>({
    on: {
      ...createPatchTransitionMap<State, Context, Event>(options.eventTargets),
      [options.retryEvent]: createRetryTransition<State, Context, Event>({
        target: options.retryTarget,
        defaultMessage: options.defaultRetryMessage,
      }),
      ...createSelfPatchTransitionMap<State, Context, Event>([
        ...options.mutableContextEvents,
      ]),
    } as StateMachineConfig<State, Context, Event>['on'],
  })
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
