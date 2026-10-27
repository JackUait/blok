// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { idsOf, run, SESSIONS } from './database-seed';

import type { OutputData } from '../../../types';

type Seeded = Record<string, unknown> & { id: string; type: string };

/** A database a person locked, with one row, under `parent`. */
const lockedDb = (id: string, parent?: string): Seeded[] => [
  {
    id, type: 'database', ...(parent !== undefined && { parent }), content: [`${id}-row`],
    data: {
      schema: [{ id: `${id}-t`, name: 'Name', type: 'title', position: 'a0', databaseLocked: true }],
      views: [{ id: `${id}-v`, name: 'Table', type: 'table', position: 'a0' }],
      activeViewId: `${id}-v`,
    },
  },
  { id: `${id}-row`, type: 'database-row', parent: id, content: [], data: { properties: { [`${id}-t`]: 'Row' }, position: 'a0' } },
];

const paragraph = (id: string, parent?: string): Seeded =>
  ({ id, type: 'paragraph', ...(parent !== undefined && { parent }), content: [], data: { text: id } });

/** An unlocked database whose row "r" holds the locked database in its page body. */
const rowHolding = (): OutputData => ({ blocks: [
  {
    id: 'D', type: 'database', content: ['r', 'r2'],
    data: {
      schema: [
        { id: 'dt', name: 'Name', type: 'title', position: 'a0' },
        { id: 'tag', name: 'Tag', type: 'select', position: 'a1', config: { options: [{ id: 'red', label: 'Red', position: 'a0' }, { id: 'blue', label: 'Blue', position: 'a1' }] } },
      ],
      views: [{ id: 'D-v', name: 'Table', type: 'table', position: 'a0' }],
      activeViewId: 'D-v',
    },
  },
  { id: 'r', type: 'database-row', parent: 'D', content: ['L'], data: { properties: { dt: 'r', tag: 'red' }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'D', content: [], data: { properties: { dt: 'r2', tag: 'blue' }, position: 'a1' } },
  ...lockedDb('L', 'r'),
] as unknown as OutputData['blocks'] });

const columnsHolding = (): OutputData => ({ blocks: [
  { id: 'cl', type: 'column_list', content: ['c1', 'c2', 'c3'], data: {} },
  { id: 'c1', type: 'column', parent: 'cl', content: ['L'], data: {} },
  { id: 'c2', type: 'column', parent: 'cl', content: ['p2'], data: {} },
  { id: 'c3', type: 'column', parent: 'cl', content: ['p3'], data: {} },
  ...lockedDb('L', 'c1'),
  paragraph('p2', 'c2'),
  paragraph('p3', 'c3'),
] as unknown as OutputData['blocks'] });

const tabsHolding = (): OutputData => ({ blocks: [
  { id: 'T', type: 'tabs', content: ['t1', 't2'], data: {} },
  { id: 't1', type: 'tab', parent: 'T', content: ['L'], data: { title: 'One' } },
  { id: 't2', type: 'tab', parent: 'T', content: ['p2'], data: { title: 'Two' } },
  ...lockedDb('L', 't1'),
  paragraph('p2', 't2'),
] as unknown as OutputData['blocks'] });

const cell = (id: string, row: string, blocks: string[]): Record<string, unknown> => ({ id, rowId: row, blocks });

/** A 2x2 table whose top-left cell holds the locked database. */
const tableHolding = (): OutputData => ({ blocks: [
  {
    id: 'TB', type: 'table', content: ['L', 'b', 'c', 'd'],
    data: {
      withHeadings: false, withHeadingColumn: false,
      content: [[cell('k1', 'r1', ['L']), cell('k2', 'r1', ['b'])], [cell('k1', 'r2', ['c']), cell('k2', 'r2', ['d'])]],
    },
  },
  ...lockedDb('L', 'TB'),
  paragraph('b', 'TB'),
  paragraph('c', 'TB'),
  paragraph('d', 'TB'),
] as unknown as OutputData['blocks'] });

/** Every agent path that removes blocks, each aimed at a subtree that holds a locked database. */
const REMOVALS: Array<{ path: string; seed: () => OutputData; command: string; args: Record<string, unknown> }> = [
  { path: 'block.delete of a row whose page holds it', seed: rowHolding, command: 'block.delete', args: { id: 'r' } },
  { path: 'database.deleteRow of that row', seed: rowHolding, command: 'database.deleteRow', args: { id: 'D', rowId: 'r' } },
  { path: 'database.deleteOption with rows: delete', seed: rowHolding, command: 'database.deleteOption', args: { id: 'D', propertyId: 'tag', optionId: 'red', rows: 'delete' } },
  { path: 'block.delete of the holding database', seed: rowHolding, command: 'block.delete', args: { id: 'D' } },
  { path: 'column_list.removeColumn', seed: columnsHolding, command: 'column_list.removeColumn', args: { id: 'cl', index: 0 } },
  { path: 'block.delete of the column list', seed: columnsHolding, command: 'block.delete', args: { id: 'cl' } },
  { path: 'tabs.deleteTab', seed: tabsHolding, command: 'tabs.deleteTab', args: { id: 'T', tabId: 't1' } },
  { path: 'table.deleteRows', seed: tableHolding, command: 'table.deleteRows', args: { id: 'TB', at: 0 } },
  { path: 'table.deleteColumns', seed: tableHolding, command: 'table.deleteColumns', args: { id: 'TB', at: 0 } },
  { path: 'table.clearCells', seed: tableHolding, command: 'table.clearCells', args: { id: 'TB', range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0 } } },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(SESSIONS)('an agent never removes a locked database (%s session)', (_label, open) => {
  it.each(REMOVALS)('$path is refused, and nothing is removed', async ({ seed, command, args }) => {
    const session = open(seed());
    const before = await idsOf(session);

    try {
      const result = await run(session, command, args);

      expect(result.ok ? undefined : result.error).toMatchObject({ code: 'PRECONDITION_FAILED', details: { reason: 'locked', blockIds: ['L'] } });
      expect(await idsOf(session)).toEqual(before);
    } finally {
      await session.close();
    }
  });

  it('still removes a row whose page holds no locked database', async () => {
    const session = open(rowHolding());

    try {
      expect(await run(session, 'block.delete', { id: 'r2' })).toMatchObject({ ok: true });
      expect(await idsOf(session)).not.toContain('r2');
    } finally {
      await session.close();
    }
  });
});

// Every place the planner or a tool action removes a block. A new one must get a REMOVALS case above.
const REMOVAL_SITES: Record<string, string[]> = {
  'src/shared/agent/plan-block.ts': ['planDelete', 'emptied column after a move'],
  'src/shared/agent/plan-convert.ts': ['the merged first line of a convert'],
  'src/shared/agent/tool-action-context.ts': ['ctx.remove itself'],
  'src/shared/tool-actions/columns.ts': ['column_list.removeColumn', 'collapse to the last column'],
  'src/shared/tool-actions/database-comments.ts': ['database.deleteComment'],
  'src/shared/tool-actions/database.ts': ['database.deleteOption', 'database.deleteRow'],
  'src/shared/tool-actions/table.ts': ['table.deleteRows', 'table.deleteColumns', 'table.clearCells'],
  'src/shared/tool-actions/tabs.ts': ['tabs.deleteTab'],
};

const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  if (entry.isDirectory()) {
    return sourceFiles(join(dir, entry.name));
  }

  return entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [];
});

describe('every agent removal is listed', () => {
  it('names each file that removes blocks, so a new path cannot skip the lock check unseen', () => {
    const removes = /ctx\.remove\(|op: 'remove'/;
    const found = sourceFiles('src/shared')
      .filter(file => !file.endsWith('json-applier.ts') && removes.test(readFileSync(file, 'utf8')))
      .sort();

    expect(found).toEqual(Object.keys(REMOVAL_SITES).sort());
  });
});
