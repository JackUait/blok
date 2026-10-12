import fixture from '../../../fixtures/agent-commands/evals/markdown-import.json';
import { marks, sequence, untouched } from '../graders/structure';
import { logClean, noMarkdownResidue } from '../graders/behaviour';
import type { EvalTask } from '../types';

export const markdownImport: EvalTask = {
  ...fixture,
  prompt: 'The second paragraph is a pasted Markdown note. Turn it into proper blocks and remove the raw text.',
  surfaces: ['mcp-stored'],
  graders: [
    noMarkdownResidue(),
    sequence('imported note', ['paragraph', 'header', 'list', 'list', 'paragraph']),
    untouched(['p1']),
    marks('owner bold', { type: 'paragraph', nth: 1 }, 'Owner:', { bold: true }),
    logClean(2),
  ],
  budget: { maxTurns: 8, maxOutputTokens: 6000 },
};
