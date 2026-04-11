import type { Page } from 'patchright';
import { pathToFileURL } from 'url';
import { createStateMachine } from '../state-machine';
import {
  type ChatGPTAuthFlowContext,
  type ChatGPTAuthFlowEvent,
  registerChatGPTWithExchange as registerChatGPTWithExchangeShared,
  type ChatGPTAuthFlowMachine,
  type ChatGPTAuthFlowState,
  type ChatGPTRegistrationFlowResult,
} from '../modules/chatgpt/shared';
import {
  parseBooleanFlag,
  parseNumberFlag,
  type FlowOptions,
} from '../modules/flow-cli/helpers';
import { runSingleFileFlowFromCli, type SingleFileFlowDefinition } from '../modules/flow-cli/single-file';
import { parseFlowCliArgs } from '../modules/flow-cli/parse-argv';

export function createChatGPTRegistrationMachine(): ChatGPTAuthFlowMachine<ChatGPTRegistrationFlowResult> {
  return createStateMachine<ChatGPTAuthFlowState, ChatGPTAuthFlowContext<ChatGPTRegistrationFlowResult>, ChatGPTAuthFlowEvent>({
    id: 'flow.chatgpt.registration',
    initialState: 'idle',
    initialContext: {
      kind: 'chatgpt-registration',
    },
    historyLimit: 200,
  });
}

export async function registerChatGPTWithExchange(
  page: Page,
  options: FlowOptions = {},
): Promise<ChatGPTRegistrationFlowResult> {
  return registerChatGPTWithExchangeShared(page, {
    password: options.password,
    verificationTimeoutMs: parseNumberFlag(options.verificationTimeoutMs, 180000) ?? 180000,
    pollIntervalMs: parseNumberFlag(options.pollIntervalMs, 5000) ?? 5000,
    createPasskey: parseBooleanFlag(options.createPasskey, true) ?? true,
    sameSessionPasskeyCheck: parseBooleanFlag(options.sameSessionPasskeyCheck, false) ?? false,
    machine: createChatGPTRegistrationMachine(),
  });
}

export const chatgptRegisterExchangeFlow: SingleFileFlowDefinition<FlowOptions, ChatGPTRegistrationFlowResult> = {
  command: 'flow:chatgpt-register-exchange',
  run: registerChatGPTWithExchange,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSingleFileFlowFromCli(chatgptRegisterExchangeFlow, parseFlowCliArgs(process.argv.slice(2)));
}
