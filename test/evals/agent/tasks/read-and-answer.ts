import fixture from '../../../fixtures/agent-commands/evals/read-and-answer.json';
import { unchanged } from '../graders/structure';
import { answerIds } from '../graders/behaviour';
import type { EvalTask } from '../types';

export const readAndAnswer: EvalTask = {
  ...fixture,
  prompt: 'Which headings mention "budget"? Reply with their block ids.',
  surfaces: ['mcp-stored'],
  graders: [
    answerIds(['h1', 'h3']),
    unchanged(),
  ],
  budget: { maxTurns: 6, maxOutputTokens: 3000 },
};
