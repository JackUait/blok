import fixture from '../../../fixtures/agent-commands/evals/two-column-table.json';
import { dataCheck, schemaValid, shape } from '../graders/structure';
import { logClean, noMarkdownResidue } from '../graders/behaviour';
import { validateSaved } from '../../../unit/agent/harness';
import type { EvalTask } from '../types';

export const twoColumnTable: EvalTask = {
  ...fixture,
  prompt: 'Build a two-column comparison of Plan A and Plan B. Each column has a heading and a table of costs with at least three rows.',
  surfaces: ['in-app'],
  graders: [
    shape('two columns', { type: 'column_list', children: [{ type: 'column', children: [{ type: 'header' }, { type: 'table' }] }, { type: 'column', children: [{ type: 'header' }, { type: 'table' }] }] }),
    dataCheck('3+ rows', 'table', (d) => Array.isArray(d.content) && d.content.length >= 3, 'every table has at least 3 rows'),
    noMarkdownResidue(),
    schemaValid(validateSaved),
    logClean(2),
  ],
  budget: { maxTurns: 10, maxOutputTokens: 10000 },
};
