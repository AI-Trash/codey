import type { Page } from 'patchright';
import { pathToFileURL } from 'url';
import { createStateMachine } from '../state-machine';
import {
  type ChatGPTAuthFlowContext,
  type ChatGPTAuthFlowEvent,
  type ChatGPTAuthFlowMachine,
  type ChatGPTAuthFlowState,
  loginChatGPTWithStoredPasskey as loginChatGPTWithStoredPasskeyShared,
  type ChatGPTLoginPasskeyFlowResult,
} from '../modules/chatgpt/shared';
import type { FlowOptions } from '../modules/flow-cli/helpers';
import { runSingleFileFlowFromCli, type SingleFileFlowDefinition } from '../modules/flow-cli/single-file';
import { parseFlowCliArgs } from '../modules/flow-cli/parse-argv';

export function createChatGPTLoginPasskeyMachine(): ChatGPTAuthFlowMachine<ChatGPTLoginPasskeyFlowResult> {
  return createStateMachine<ChatGPTAuthFlowState, ChatGPTAuthFlowContext<ChatGPTLoginPasskeyFlowResult>, ChatGPTAuthFlowEvent>({
    id: 'flow.chatgpt.login-passkey',
    initialState: 'idle',
    initialContext: {
      kind: 'chatgpt-login-passkey',
    },
    historyLimit: 200,
  });
}

export async function loginChatGPTWithStoredPasskey(
  page: Page,
  options: FlowOptions = {},
): Promise<ChatGPTLoginPasskeyFlowResult> {
  return loginChatGPTWithStoredPasskeyShared(page, {
    identityId: options.identityId,
    email: options.email,
    machine: createChatGPTLoginPasskeyMachine(),
  });
}

export const chatgptLoginPasskeyFlow: SingleFileFlowDefinition<FlowOptions, ChatGPTLoginPasskeyFlowResult> = {
  command: 'flow:chatgpt-login-passkey',
  run: loginChatGPTWithStoredPasskey,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSingleFileFlowFromCli(chatgptLoginPasskeyFlow, parseFlowCliArgs(process.argv.slice(2)));
}
