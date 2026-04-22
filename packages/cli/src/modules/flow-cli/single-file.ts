import { fileURLToPath } from 'url'
import type { Page } from 'patchright'
import { loadWorkspaceEnv } from '../../utils/env'
import type { CliFlowCommandId } from './flow-registry'
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
import { parseFlowCliArgsForCommand } from './parse-argv'
import { runWithSession } from './run-with-session'
import {
  setObservabilityRuntimeState,
  traceCliOperation,
  withObservabilityContext,
} from '../../utils/observability'
import {
  initializeCliFileLogging,
  writeCliStderrLine,
} from '../../utils/cli-output'
import { resolveWorkspaceRoot } from '../../utils/workspace-root'

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
  return withObservabilityContext(
    {
      command: definition.command,
    },
    () =>
      traceCliOperation(
        'flow.single_file',
        {
          command: definition.command,
        },
        async () => {
          let result!: TResult
          let browserHarPath: string | undefined
          const startedAt = new Date().toISOString()
          setObservabilityRuntimeState({
            command: definition.command,
            status: 'running',
            message: 'Flow started',
            startedAt,
          })
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
            writeCliStderrLine(
              'Flow completed and the browser remains open because --record is enabled. Press Ctrl+C to exit or close the browser window.',
            )
          }
          setObservabilityRuntimeState({
            command: definition.command,
            status: 'passed',
            message: 'Flow completed',
            startedAt,
            completedAt: new Date().toISOString(),
          })
          return result
        },
      ),
  )
}

export function runSingleFileFlowFromCli<
  TOptions extends CommonOptions & { record?: string | boolean } =
    CommonOptions & { record?: string | boolean },
  TResult extends object = object,
>(
  definition: SingleFileFlowDefinition<TOptions, TResult>,
  options: TOptions,
): void {
  initializeCliFileLogging({
    rootDir: resolveWorkspaceRoot(fileURLToPath(import.meta.url)),
    argv: process.argv.slice(2),
  })
  void runSingleFileFlow(definition, options).catch(reportError)
}

export function runSingleFileFlowFromCommandLine<
  TOptions extends CommonOptions & { record?: string | boolean } =
    CommonOptions & { record?: string | boolean },
  TResult extends object = object,
>(
  flowId: CliFlowCommandId,
  definition: SingleFileFlowDefinition<TOptions, TResult>,
): void {
  initializeCliFileLogging({
    rootDir: resolveWorkspaceRoot(fileURLToPath(import.meta.url)),
    argv: process.argv.slice(2),
  })
  runSingleFileFlowFromCli(
    definition,
    parseFlowCliArgsForCommand(flowId, process.argv.slice(2)) as TOptions,
  )
}
