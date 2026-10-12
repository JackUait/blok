import fixture from '../../../fixtures/agent-commands/evals/move-into-column.json';
import { dataCheck, shape, untouched } from '../graders/structure';
import type { EvalTask } from '../types';

export const moveIntoColumn: EvalTask = {
  ...fixture,
  prompt: 'Move the image into the right column, below its text.',
  surfaces: ['in-app'],
  graders: [
    shape('image in right column', { type: 'column', id: 'c2', children: [{ type: 'paragraph' }, { type: 'image', id: 'img' }] }),
    dataCheck('image data kept', 'image', (d) => d.url === 'https://example.com/a.png', 'url unchanged'),
    untouched(['img']),
  ],
  budget: { maxTurns: 6, maxOutputTokens: 4000 },
};
