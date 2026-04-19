import type { Page } from 'patchright'
import { loadWorkspaceEnv } from '../../utils/env'
import {
  applyFlowOptionDefaults,
  attachFlowArtifactPaths,
  createConsoleFlowProgressReporter,
  printFlowCompletionSummary,
  prepareRuntimeConfig,
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
  const runtimeOptions = {
    ...resolvedOptions,
    progressReporter:
      resolvedOptions.progressReporter ||
      createConsoleFlowProgressReporter(definition.command),
  } as TOptions
  prepareRuntimeConfig(definition.command, resolvedOptions)
  let result!: TResult
  let browserHarPath: string | undefined
  await runWithSession(
    { artifactName: definition.command, context: {} },
    async (session) => {
      browserHarPath = session.harPath
      result = await definition.run(session.page, runtimeOptions)
    },
    { closeOnComplete: !shouldKeepFlowOpen(runtimeOptions) },
  )
  result = attachFlowArtifactPaths(result, {
    harPath: browserHarPath,
  })
  printFlowCompletionSummary(definition.command, result)
  if (shouldKeepFlowOpen(runtimeOptions)) {
    console.error(
      'Flow completed and the browser remains open because --record is enabled. Press Ctrl+C to exit or close the browser window.',
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
