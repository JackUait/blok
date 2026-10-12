import fixture from '../../../fixtures/agent-commands/evals/table-ops.json';
import { dataCheck } from '../graders/structure';
import { logClean, usedAction } from '../graders/behaviour';
import type { EvalTask } from '../types';

// Merge origins carry colspan (src/tools/table/types.ts).
const mergedOrigin = (content: unknown): boolean => {
  const row: unknown = Array.isArray(content) ? content[1] : undefined;
  const cell: unknown = Array.isArray(row) ? row[0] : undefined;

  return cell !== null && typeof cell === 'object' && 'colspan' in cell && cell.colspan === 2;
};

export const tableOps: EvalTask = {
  ...fixture,
  prompt: 'In the table, turn on the header row, merge the first two cells of row 2, and delete the last column.',
  surfaces: ['in-app-browser'],
  graders: [
    usedAction('table.mergeCells'),
    usedAction('table.deleteColumns'),
    dataCheck('heading row', 'table', (d) => d.withHeadings === true, 'heading row on'),
    dataCheck('two columns', 'table', (d) => Array.isArray(d.content) && d.content.every((row) => Array.isArray(row) && row.length === 2), 'last column gone'),
    dataCheck('merged', 'table', (d) => mergedOrigin(d.content), 'row 2 cells 1-2 merged'),
    logClean(2),
  ],
  budget: { maxTurns: 10, maxOutputTokens: 8000 },
};
