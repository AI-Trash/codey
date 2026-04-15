import type { Page } from 'patchright'
import { loadWorkspaceEnv } from '../../utils/env'
import {
  applyFlowOptionDefaults,
  prepareRuntimeConfig,
  redactForOutput,
  reportError,
  type CommonOptions,
  shouldKeepFlowOpen,
} from './helpers'
import { runWithSession } from './run-with-session'

export interface SingleFileFlowDefinition<
  TOptions extends CommonOptions & { record?: string | boolean } =
    CommonOptions & { record?: string | boolean },
  TResult extends object = object,
> {
  command: string
  defaultOptions?: Partial<TOptions>
  run(page: Page, options: TOptions): Promise<TResult>
}

export async function runSingleFileFlow<
  TOptions extends CommonOptions & { record?: string | boolean } =
    CommonOptions & { record?: string | boolean },
  TResult extends object = object,
>(
  definition: SingleFileFlowDefinition<TOptions, TResult>,
  options: TOptions,
): Promise<TResult> {
  loadWorkspaceEnv()
  const resolvedOptions = applyFlowOptionDefaults(
    options,
    definition.defaultOptions,
  )
  const config = prepareRuntimeConfig(definition.command, resolvedOptions)
  let result!: TResult
  let harPath: string | undefined
  await runWithSession(
    { artifactName: definition.command, context: {} },
    async (session) => {
      harPath = session.harPath
      result = await definition.run(session.page, resolvedOptions)
    },
    { closeOnComplete: !shouldKeepFlowOpen(resolvedOptions) },
  )
  console.log(
    JSON.stringify(
      {
        command: definition.command,
        config: redactForOutput(config),
        ...(harPath ? { harPath } : {}),
        result,
      },
      null,
      2,
    ),
  )
  if (shouldKeepFlowOpen(resolvedOptions)) {
    console.error(
      `Flow completed and the browser remains open because --record is enabled.${harPath ? ' HAR will be finalized when the session closes.' : ''} Press Ctrl+C to exit or close the browser window.`,
    )
  }
  return result
}

export function runSingleFileFlowFromCli<
  TOptions extends CommonOptions & { record?: string | boolean } =
    CommonOptions & { record?: string | boolean },
  TResult extends object = object,
>(
  definition: SingleFileFlowDefinition<TOptions, TResult>,
  options: TOptions,
): void {
  void runSingleFileFlow(definition, options).catch(reportError)
}
