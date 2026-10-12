import fixture from '../../../fixtures/agent-commands/evals/markdown-regression.json';
import { marks, schemaValid, sequence, text } from '../graders/structure';
import { logClean, noMarkdownResidue } from '../graders/behaviour';
import { validateSaved } from '../../../unit/agent/harness';
import type { EvalTask } from '../types';

export const markdownRegression: EvalTask = {
  ...fixture,
  prompt: 'Add a section titled "Plan": a bold intro "We ship in three steps.", three bullets "Write the spec", "Build it" and "Ship it", and a code sample with npm run build.',
  surfaces: ['in-app', 'mcp-stored'],
  graders: [
    noMarkdownResidue(),
    sequence('plan section', ['header', 'paragraph', 'list', 'list', 'list', 'code']),
    text('heading', { type: 'header' }, 'Plan'),
    marks('bold intro', { type: 'paragraph', nth: 1 }, 'We ship in three steps.', { bold: true }),
    schemaValid(validateSaved),
    logClean(2),
  ],
  budget: { maxTurns: 8, maxOutputTokens: 8000 },
};
