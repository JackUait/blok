import fixture from '../../../fixtures/agent-commands/evals/live-coedit.json';
import { sequence } from '../graders/structure';
import { noMarkdownResidue } from '../graders/behaviour';
import { ackedOnly, agentVisible, attributed, humanPreserved } from '../graders/collab';
import type { EvalTask } from '../types';

export const liveCoedit: EvalTask = {
  ...fixture,
  prompt: 'Add a bullet list summary with two items, "Agree on Friday" and "Send recap", right below the first paragraph.',
  surfaces: ['mcp-live'],
  graders: [
    humanPreserved(),
    agentVisible(),
    attributed(),
    ackedOnly(),
    sequence('summary below p1', ['paragraph', 'list', 'list', 'paragraph']),
    noMarkdownResidue(),
  ],
  budget: { maxTurns: 8, maxOutputTokens: 5000 },
};
