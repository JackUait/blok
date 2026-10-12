import fixture from '../../../fixtures/agent-commands/evals/format-range.json';
import { marks, text, untouched } from '../graders/structure';
import { noMarkdownResidue } from '../graders/behaviour';
import type { EvalTask } from '../types';

export const formatRange: EvalTask = {
  ...fixture,
  prompt: 'In the second paragraph, make "quarterly" bold and link "report" to https://example.com.',
  surfaces: ['mcp-stored'],
  graders: [
    marks('bold', { id: 'p2' }, 'quarterly', { bold: true }),
    marks('link', { id: 'p2' }, 'report', { link: { href: 'https://example.com' } }),
    text('text kept', { id: 'p2' }, 'See the quarterly report for details.'),
    untouched(['p2']),
    noMarkdownResidue(),
  ],
  budget: { maxTurns: 6, maxOutputTokens: 4000 },
};
