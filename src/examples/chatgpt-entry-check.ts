import { runFlow } from '../run-flow';
import { verifyChatGPTEntry } from '../flows/chatgpt-entry';

void runFlow('chatgpt-entry', verifyChatGPTEntry);
