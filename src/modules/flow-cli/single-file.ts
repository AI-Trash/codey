import type { Page } from 'patchright';
import { loadWorkspaceEnv } from '../../utils/env';
import { prepareRuntimeConfig, redactForOutput, reportError, type CommonOptions } from './helpers';
import { runWithSession } from './run-with-session';

export interface SingleFileFlowDefinition<
  TOptions extends CommonOptions = CommonOptions,
  TResult extends object = object,
> {
  command: string;
  run(page: Page, options: TOptions): Promise<TResult>;
}

export async function runSingleFileFlow<
  TOptions extends CommonOptions = CommonOptions,
  TResult extends object = object,
>(
  definition: SingleFileFlowDefinition<TOptions, TResult>,
  options: TOptions,
): Promise<TResult> {
  loadWorkspaceEnv();
  const config = prepareRuntimeConfig(definition.command, options);
  let result!: TResult;
  await runWithSession({ context: {} }, async (session) => {
    result = await definition.run(session.page, options);
  });
  console.log(JSON.stringify({ command: definition.command, config: redactForOutput(config), result }, null, 2));
  return result;
}

export function runSingleFileFlowFromCli<
  TOptions extends CommonOptions = CommonOptions,
  TResult extends object = object,
>(
  definition: SingleFileFlowDefinition<TOptions, TResult>,
  options: TOptions,
): void {
  void runSingleFileFlow(definition, options).catch(reportError);
}
