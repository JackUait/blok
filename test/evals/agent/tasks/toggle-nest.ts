import fixture from '../../../fixtures/agent-commands/evals/toggle-nest.json';
import { shape, text, untouched } from '../graders/structure';
import { logClean } from '../graders/behaviour';
import type { EvalTask } from '../types';

export const toggleNest: EvalTask = {
  ...fixture,
  prompt: 'Put the three question paragraphs into a toggle titled "FAQ", keeping their order.',
  surfaces: ['in-app-browser'],
  graders: [
    shape('faq toggle', { type: 'toggle', children: [{ type: 'paragraph', id: 'q1' }, { type: 'paragraph', id: 'q2' }, { type: 'paragraph', id: 'q3' }] }),
    text('toggle title', { type: 'toggle' }, 'FAQ'),
    untouched(['q1', 'q2', 'q3']),
    logClean(2),
  ],
  budget: { maxTurns: 8, maxOutputTokens: 6000 },
};
