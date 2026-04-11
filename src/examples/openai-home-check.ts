import { runFlow } from '../run-flow';
import { verifyOpenAIHome } from '../flows/openai-home';

void runFlow('openai-home', verifyOpenAIHome);
