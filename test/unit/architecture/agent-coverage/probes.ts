import type { OutputData } from '../../../../types';

/**
 * A minimal batch per ledger row whose generic command may be refused on that
 * block (a database places its own rows). The law runs each one and wants ok.
 */
export interface RouteProbe {
  seed: OutputData;
  commands: Array<{ name: string; args: Record<string, unknown> }>;
}

const database = (id: string, rows: Array<{ id: string; title: string; template?: boolean }>): OutputData['blocks'] => [
  {
    id,
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [{ id: `${id}-title`, name: 'Title', type: 'title', position: 'a0' }],
      views: [{ id: `${id}-view`, name: 'Table', type: 'table', position: 'a0' }],
      activeViewId: `${id}-view`,
    },
    content: rows.map((row) => row.id),
  },
  ...rows.map((row, i) => ({
    id: row.id,
    type: 'database-row',
    data: {
      properties: { [`${id}-title`]: row.title },
      position: `a${i}`,
      title: row.title,
      ...(row.template === true ? { template: true } : {}),
    },
    parent: id,
  })),
];

const ONE_ROW: OutputData = { blocks: database('db1', [{ id: 'r1', title: 'Write spec' }]) };
const TWO_DATABASES: OutputData = {
  blocks: [...database('db1', [{ id: 'r1', title: 'Write spec' }]), ...database('db2', [])],
};
const ONE_TEMPLATE: OutputData = { blocks: database('db1', [{ id: 't1', title: 'Weekly', template: true }]) };

const duplicateRow: RouteProbe = { seed: ONE_ROW, commands: [{ name: 'block.duplicate', args: { id: 'r1' } }] };

export const ROUTE_PROBES: Record<string, RouteProbe> = {
  'menu:database/database-row-duplicate': duplicateRow,
  'menu:database/database-table-selection-duplicate': duplicateRow,
  'menu:database/database-selection-duplicate': duplicateRow,
  'menu:database/database-row-move-to-*': {
    seed: TWO_DATABASES,
    commands: [{ name: 'database.moveRowTo', args: { id: 'db1', rowId: 'r1', databaseId: 'db2' } }],
  },
  'menu:database/template-*': { seed: ONE_TEMPLATE, commands: [{ name: 'database.duplicateRow', args: { id: 'db1', rowId: 't1' } }] },
};

/**
 * Rows whose route is known not to work on main yet, each with the review
 * finding that proves it. The law checks they still fail, so a fix that lands
 * must drop its entry here.
 */
export const KNOWN_GAPS: Record<string, string> = {};
