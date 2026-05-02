import type { AndroidDriver, AndroidSession } from '../core/android'
import {
  composeStateMachineConfig,
  createStateMachine,
  declareStateMachineStates,
  type StateMachineController,
  type StateMachineSnapshot,
} from '../state-machine'
import type { FlowOptions } from '../modules/flow-cli/helpers'
import { attachStateMachineProgressReporter } from '../modules/flow-cli/helpers'
import { createFlowLifecycleFragment } from './machine-fragments'

export type AndroidHealthcheckFlowKind = 'android-healthcheck'

export type AndroidHealthcheckFlowState =
  | 'idle'
  | 'connecting'
  | 'probing'
  | 'completed'
  | 'failed'

export type AndroidHealthcheckFlowEvent =
  | 'machine.started'
  | 'android.session.connected'
  | 'android.device.probing'
  | 'android.retry.requested'
  | 'android.completed'
  | 'android.failed'
  | 'context.updated'

export interface AndroidHealthcheckDeviceSummary {
  automationName?: string
  deviceName?: string
  platformVersion?: string
  udid?: string
  currentPackage?: string
  currentActivity?: string
  contexts?: string[]
}

export interface AndroidHealthcheckFlowContext<Result = unknown> {
  kind: AndroidHealthcheckFlowKind
  appiumSessionId?: string
  capabilities?: Record<string, unknown>
  device?: AndroidHealthcheckDeviceSummary
  lastMessage?: string
  result?: Result
}

export type AndroidHealthcheckFlowMachine<Result = unknown> =
  StateMachineController<
    AndroidHealthcheckFlowState,
    AndroidHealthcheckFlowContext<Result>,
    AndroidHealthcheckFlowEvent
  >

export type AndroidHealthcheckFlowSnapshot<Result = unknown> =
  StateMachineSnapshot<
    AndroidHealthcheckFlowState,
    AndroidHealthcheckFlowContext<Result>,
    AndroidHealthcheckFlowEvent
  >

export interface AndroidHealthcheckFlowResult {
  pageName: 'android-healthcheck'
  connected: boolean
  appiumSessionId?: string
  capabilities: Record<string, unknown>
  device: AndroidHealthcheckDeviceSummary
  machine: AndroidHealthcheckFlowSnapshot<AndroidHealthcheckFlowResult>
}

const androidHealthcheckStates = [
  'idle',
  'connecting',
  'probing',
  'completed',
  'failed',
] as const satisfies readonly AndroidHealthcheckFlowState[]

const androidHealthcheckEventTargets = {
  'android.session.connected': 'connecting',
  'android.device.probing': 'probing',
} as const satisfies Partial<
  Record<AndroidHealthcheckFlowEvent, AndroidHealthcheckFlowState>
>

export function createAndroidHealthcheckMachine(): AndroidHealthcheckFlowMachine<AndroidHealthcheckFlowResult> {
  return createStateMachine<
    AndroidHealthcheckFlowState,
    AndroidHealthcheckFlowContext<AndroidHealthcheckFlowResult>,
    AndroidHealthcheckFlowEvent
  >(
    composeStateMachineConfig(
      {
        id: 'flow.android.healthcheck',
        initialState: 'idle',
        initialContext: {
          kind: 'android-healthcheck',
        },
        historyLimit: 100,
        states: declareStateMachineStates<
          AndroidHealthcheckFlowState,
          AndroidHealthcheckFlowContext<AndroidHealthcheckFlowResult>,
          AndroidHealthcheckFlowEvent
        >(androidHealthcheckStates),
      },
      createFlowLifecycleFragment<
        AndroidHealthcheckFlowState,
        AndroidHealthcheckFlowContext<AndroidHealthcheckFlowResult>,
        AndroidHealthcheckFlowEvent
      >({
        eventTargets: androidHealthcheckEventTargets,
        mutableContextEvents: ['context.updated'],
        retryEvent: 'android.retry.requested',
        retryTarget: 'probing',
        defaultRetryMessage: 'Retrying Android healthcheck',
        allowTargetOverride: false,
      }),
    ),
  )
}

function readStringCapability(
  capabilities: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = capabilities[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function callOptionalDriverCommand<T>(
  driver: AndroidDriver,
  command: string,
): Promise<T | undefined> {
  const fn = (driver as unknown as Record<string, unknown>)[command]
  if (typeof fn !== 'function') {
    return undefined
  }

  try {
    return (await fn.call(driver)) as T
  } catch {
    return undefined
  }
}

async function probeAndroidDevice(
  session: AndroidSession,
): Promise<AndroidHealthcheckDeviceSummary> {
  const [currentPackage, currentActivity, contexts] = await Promise.all([
    callOptionalDriverCommand<string>(session.driver, 'getCurrentPackage'),
    callOptionalDriverCommand<string>(session.driver, 'getCurrentActivity'),
    callOptionalDriverCommand<string[]>(session.driver, 'getContexts'),
  ])

  return {
    automationName: readStringCapability(
      session.capabilities,
      'appium:automationName',
    ),
    deviceName: readStringCapability(session.capabilities, 'appium:deviceName'),
    platformVersion: readStringCapability(
      session.capabilities,
      'appium:platformVersion',
    ),
    udid: readStringCapability(session.capabilities, 'appium:udid'),
    currentPackage,
    currentActivity,
    contexts,
  }
}

export async function runAndroidHealthcheck(
  session: AndroidSession,
  options: FlowOptions = {},
): Promise<AndroidHealthcheckFlowResult> {
  const machine = createAndroidHealthcheckMachine()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )

  try {
    machine.start(
      {
        appiumSessionId: session.appiumSessionId,
        capabilities: session.capabilities,
        lastMessage: 'Opening Appium Android session',
      },
      {
        source: 'runAndroidHealthcheck',
      },
    )

    await machine.send('android.session.connected', {
      patch: {
        appiumSessionId: session.appiumSessionId,
        capabilities: session.capabilities,
        lastMessage: 'Appium Android session connected',
      },
    })
    await machine.send('android.device.probing', {
      patch: {
        lastMessage: 'Reading Android device session details',
      },
    })

    const device = await probeAndroidDevice(session)
    const result = {
      pageName: 'android-healthcheck' as const,
      connected: true,
      appiumSessionId: session.appiumSessionId,
      capabilities: session.capabilities,
      device,
      machine:
        undefined as unknown as AndroidHealthcheckFlowSnapshot<AndroidHealthcheckFlowResult>,
    }
    const snapshot = machine.succeed('completed', {
      event: 'android.completed',
      patch: {
        appiumSessionId: session.appiumSessionId,
        capabilities: session.capabilities,
        device,
        result,
        lastMessage: 'Android healthcheck completed',
      },
    })
    result.machine = snapshot
    return result
  } catch (error) {
    machine.fail(error, 'failed', {
      event: 'android.failed',
      patch: {
        appiumSessionId: session.appiumSessionId,
        capabilities: session.capabilities,
        lastMessage: 'Android healthcheck failed',
      },
    })
    throw error
  } finally {
    detachProgress()
  }
}
