import { runFlow } from '../run-flow';
import { verifyOpenAIHome } from '../flows/openai';

void runFlow('openai-home', verifyOpenAIHome);
