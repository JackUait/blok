import fixture from '../../../fixtures/agent-commands/evals/stored-lifecycle.json';
import { text } from '../graders/structure';
import { toolSequence } from '../graders/behaviour';
import { ackedOnly } from '../graders/collab';
import type { EvalTask } from '../types';

export const storedLifecycle: EvalTask = {
  ...fixture,
  prompt: 'Open the document "doc-x", add a closing paragraph "Thanks for reading.", and save it.',
  surfaces: ['mcp-stored'],
  graders: [
    toolSequence(['blok_open', 'blok_execute', 'blok_close']),
    text('closing', { type: 'paragraph', nth: 1 }, 'Thanks for reading.'),
    ackedOnly(),
  ],
  budget: { maxTurns: 8, maxOutputTokens: 4000 },
};
