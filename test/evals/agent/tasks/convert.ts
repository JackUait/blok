import fixture from '../../../fixtures/agent-commands/evals/convert.json';
import { shape, text, untouched } from '../graders/structure';
import { noMarkdownResidue } from '../graders/behaviour';
import type { EvalTask } from '../types';

export const convert: EvalTask = {
  ...fixture,
  prompt: 'Make every line that starts with "TODO" a checklist item, and drop the "TODO" prefix.',
  surfaces: ['mcp-stored'],
  graders: [
    shape('p1 checklist', { type: 'list', id: 'p1', data: { style: 'checklist' } }),
    shape('p3 checklist', { type: 'list', id: 'p3', data: { style: 'checklist' } }),
    text('p1', { id: 'p1' }, 'call Ana'),
    text('p3', { id: 'p3' }, 'send invoice'),
    untouched(['p1', 'p3']),
    noMarkdownResidue(),
  ],
  budget: { maxTurns: 8, maxOutputTokens: 6000 },
};
