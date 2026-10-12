import fixture from '../../../fixtures/agent-commands/evals/page-title-icon.json';
import { unchanged } from '../graders/structure';
import { pageFields, usedAction } from '../graders/behaviour';
import type { EvalTask } from '../types';

export const pageTitleIcon: EvalTask = {
  ...fixture,
  prompt: 'Rename this page to "Q3 plan" and give it a 📅 icon.',
  surfaces: ['in-app', 'mcp-stored'],
  graders: [
    pageFields({ title: 'Q3 plan', icon: { type: 'emoji', value: '📅' } }),
    unchanged(),
    usedAction('doc.setTitle'),
    usedAction('doc.setIcon'),
  ],
  budget: { maxTurns: 6, maxOutputTokens: 3000 },
};
