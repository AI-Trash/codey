import { runFlow } from '../run-flow';
import { verifyChatGPTEntry } from '../flows/openai';

void runFlow('chatgpt-entry', verifyChatGPTEntry);
