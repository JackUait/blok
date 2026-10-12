import { convert } from './convert';
import { customTool } from './custom-tool';
import { formatRange } from './format-range';
import { liveCoedit } from './live-coedit';
import { liveLifecycle } from './live-lifecycle';
import { markdownImport } from './markdown-import';
import { markdownRegression } from './markdown-regression';
import { moveIntoColumn } from './move-into-column';
import { pageTitleIcon } from './page-title-icon';
import { readAndAnswer } from './read-and-answer';
import { storedLifecycle } from './stored-lifecycle';
import { tableOps } from './table-ops';
import { toggleNest } from './toggle-nest';
import { twoColumnTable } from './two-column-table';
import type { EvalTask } from '../types';

// database-status waits on database.create (02); see the lane report.
export const ALL_TASKS: EvalTask[] = [
  markdownRegression,
  markdownImport,
  twoColumnTable,
  formatRange,
  toggleNest,
  tableOps,
  convert,
  moveIntoColumn,
  readAndAnswer,
  customTool,
  liveCoedit,
  storedLifecycle,
  pageTitleIcon,
  liveLifecycle,
];
