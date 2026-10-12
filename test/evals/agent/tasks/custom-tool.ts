import fixture from '../../../fixtures/agent-commands/evals/custom-tool.json';
import { shape } from '../graders/structure';
import { usedAction } from '../graders/behaviour';
import type { EvalTask } from '../types';

export const customTool: EvalTask = {
  ...fixture,
  prompt: 'Add a rating block set to 4.',
  surfaces: ['in-app-browser'],
  tools: 'rating-fixture',
  graders: [
    shape('rating 4', { type: 'rating', data: { value: 4 } }),
    usedAction('rating.setValue'),
  ],
  budget: { maxTurns: 6, maxOutputTokens: 3000 },
};
