import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions';
import { DATABASE_DATA, describeDatabase } from '../../../../src/shared/tool-descriptions/database';
import { DATABASE_ROW_DATA, describeDatabaseRow } from '../../../../src/shared/tool-descriptions/database-row';
import { describeTable, TABLE_DATA } from '../../../../src/shared/tool-descriptions/table';
import { Database, DatabaseRow, Table } from '../../../../src/tools';
import { blokDocumentSchema } from '../../../../src/view/document-schema';
import type { BlokSchema, BlockToolDescription, DescribeBlockTool } from '../../../../types/tools/tool-description';

type ContainerName = 'table' | 'database' | 'database-row';

const CONTAINER_CLASSES: Array<{ name: ContainerName; toolClass: unknown }> = [
  { name: 'table', toolClass: Table },
  { name: 'database', toolClass: Database },
  { name: 'database-row', toolClass: DatabaseRow },
];

const hasDescribe = (tool: unknown): tool is { describe: DescribeBlockTool } =>
  typeof tool === 'function' && 'describe' in tool && typeof tool.describe === 'function';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('container self-description discovery', () => {
  it.each(CONTAINER_CLASSES)('$name: is discoverable in the shared registry', ({ name }) => {
    expect(typeof BUILT_IN_BLOCK_DESCRIPTIONS[name]).toBe('function');
  });

  it.each(CONTAINER_CLASSES)('$name: exposes a description through its public tool class', ({ toolClass }) => {
    expect(hasDescribe(toolClass)).toBe(true);
  });

  it('covers every published $defs entry', () => {
    expect(Object.keys(BUILT_IN_BLOCK_DESCRIPTIONS).sort())
      .toEqual(Object.keys(blokDocumentSchema.$defs).sort());
  });

  it('guards the container fields only their actions may change', () => {
    const describeTable = BUILT_IN_BLOCK_DESCRIPTIONS.table;
    const describeDatabase = BUILT_IN_BLOCK_DESCRIPTIONS.database;

    expect(typeof describeTable).toBe('function');
    expect(typeof describeDatabase).toBe('function');

    if (typeof describeTable !== 'function' || typeof describeDatabase !== 'function') {
      throw new Error('Table and database must expose descriptions.');
    }

    expect(describeTable({}).guardedFields).toEqual({ content: 'table.*' });
    expect(describeDatabase({}).guardedFields).toEqual({ schema: 'database.*', views: 'database.*' });
  });
});

const CONTAINER_DESCRIPTIONS: Array<{
  name: ContainerName;
  toolClass: unknown;
  describeTool: (config?: Record<string, unknown>) => BlockToolDescription;
  data: BlokSchema;
  expected: {
    summary?: string;
    guidance: string;
    summaryFields: string[];
    guardedFields?: Record<string, string>;
  };
}> = [
  {
    name: 'table',
    toolClass: Table,
    describeTool: describeTable,
    data: TABLE_DATA,
    expected: {
      summary: 'A grid. Each cell holds child blocks; content maps cells to those block ids.',
      guidance: 'Create tables with table.create, never block.insert. Change rows, columns, merges and cell styles with the table.* actions; content cannot be written directly. To edit text in a cell, edit the cell\'s child block.',
      summaryFields: ['withHeadings', 'withHeadingColumn'],
      guardedFields: { content: 'table.*' },
    },
  },
  {
    name: 'database',
    toolClass: Database,
    describeTool: describeDatabase,
    data: DATABASE_DATA,
    expected: {
      summary: 'A database: a schema of properties and saved views. Rows are child database-row blocks.',
      guidance: 'Add rows with database.addRow and change their values with database.setRowValues. Change views, properties and select options with the database.* actions; schema and views cannot be written directly.',
      summaryFields: ['title', 'activeViewId'],
      guardedFields: { schema: 'database.*', views: 'database.*' },
    },
  },
  {
    name: 'database-row',
    toolClass: DatabaseRow,
    describeTool: describeDatabaseRow,
    data: DATABASE_ROW_DATA,
    expected: {
      summary: 'One row of a database. An optional pageId points to its separate body document.',
      guidance: 'Write row values with database.setRowValues on the parent database: the title mirrors the title property.',
      summaryFields: ['title'],
    },
  },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const VALID_SAVED_SHAPES: Array<{ name: ContainerName; scenario: string; data: Record<string, unknown> }> = [
  {
    name: 'table',
    scenario: 'a cell with no child blocks',
    data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: [] }]] },
  },
  {
    name: 'table',
    scenario: 'saved cell references, styles, merge geometry and column sizing',
    data: {
      withHeadings: true,
      withHeadingColumn: true,
      stretched: true,
      content: [[
        {
          blocks: ['cell-a', 'cell-b'],
          id: 'col-a',
          rowId: 'row-a',
          text: '<b>Ship it</b>',
          color: 'yellow',
          textColor: 'red',
          placement: 'middle-center',
          colspan: 2,
          rowspan: 1,
        },
        { blocks: [], id: 'col-b', rowId: 'row-a', mergedInto: [0, 0] },
      ]],
      colWidths: [120, 180],
      initialColWidth: 150,
      textSize: 'comfortable',
    },
  },
  {
    name: 'table',
    scenario: 'legacy plain-text cells',
    data: { withHeadings: false, withHeadingColumn: false, content: [['Legacy cell']] },
  },
  {
    name: 'database',
    scenario: 'a title, typed properties, select options and saved views',
    data: {
      title: 'Tasks',
      activeViewId: 'view-table',
      schema: [
        { id: 'name', name: 'Name', type: 'title', position: 'a0' },
        {
          id: 'status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: {
            options: [
              { id: 'todo', label: 'To do', color: 'gray', position: 'a0' },
              { id: 'done', label: 'Done', position: 'a1' },
            ],
          },
        },
        { id: 'details', name: 'Details', type: 'richText', position: 'a2' },
      ],
      views: [
        {
          id: 'view-table',
          name: 'All',
          type: 'table',
          position: 'a0',
          sorts: [{ propertyId: 'name', direction: 'asc' }],
          filters: [{ propertyId: 'status', operator: 'is', value: 'todo' }],
          visibleProperties: ['name', 'status'],
        },
        {
          id: 'view-board',
          name: 'Board',
          type: 'board',
          position: 'a1',
          groupBy: 'status',
          sorts: [],
          filters: [],
          visibleProperties: ['name'],
        },
      ],
    },
  },
  {
    name: 'database',
    scenario: 'a table view with per-property settings, calculations and layout options',
    data: {
      activeViewId: 'view-table',
      schema: [
        { id: 'name', name: 'Name', type: 'title', position: 'a0' },
        { id: 'due', name: 'Due', type: 'date', position: 'a1' },
      ],
      views: [{
        id: 'view-table',
        name: 'Table',
        type: 'table',
        position: 'a0',
        sorts: [],
        filters: [],
        visibleProperties: ['due'],
        properties: [{ id: 'name', visible: true, width: 280, wrap: false }, { id: 'due' }],
        wrapCells: true,
        frozenColumnCount: 1,
        showVerticalLines: false,
        loadLimit: 25,
        calculations: [{ id: 'due', fn: 'earliest_date' }],
        openPagesIn: 'center',
      }],
    },
  },
  {
    name: 'database-row',
    scenario: 'a legacy row with no top-level title or pageId',
    data: {
      properties: {
        name: 'Legacy row',
        details: { blocks: [{ type: 'paragraph', data: { text: 'Legacy body' } }] },
      },
      position: 'a0',
    },
  },
  {
    name: 'database-row',
    scenario: 'a mirrored title and optional separate page pointer',
    data: {
      properties: {
        name: 'Ship it',
        count: 3,
        complete: false,
        labels: ['todo', 'next'],
        empty: null,
      },
      position: 'a1',
      title: 'Ship it',
      pageId: 'row-page',
    },
  },
];

const INVALID_SAVED_SHAPES: Array<{ name: ContainerName; scenario: string; data: Record<string, unknown> }> = [
  {
    name: 'table',
    scenario: 'a cell without block references',
    data: { withHeadings: false, withHeadingColumn: false, content: [[{ id: 'col-a' }]] },
  },
  {
    name: 'table',
    scenario: 'a zero merge span',
    data: {
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: [], rowspan: 0 }]],
    },
  },
  {
    name: 'table',
    scenario: 'unsaved block seeds in a cell',
    data: {
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: [], blockData: [{ tool: 'paragraph', data: { text: [] } }] }]],
    },
  },
  {
    name: 'database',
    scenario: 'an empty view list',
    data: {
      schema: [{ id: 'name', name: 'Name', type: 'title', position: 'a0' }],
      views: [],
      activeViewId: 'missing',
    },
  },
  {
    name: 'database',
    scenario: 'an unsupported property type',
    data: {
      schema: [{ id: 'name', name: 'Name', type: 'unsupported', position: 'a0' }],
      views: [{
        id: 'view-table', name: 'All', type: 'table', position: 'a0',
        sorts: [], filters: [], visibleProperties: ['name'],
      }],
      activeViewId: 'view-table',
    },
  },
  {
    name: 'database',
    scenario: 'a missing activeViewId',
    data: {
      schema: [{ id: 'name', name: 'Name', type: 'title', position: 'a0' }],
      views: [{
        id: 'view-table', name: 'All', type: 'table', position: 'a0',
        sorts: [], filters: [], visibleProperties: ['name'],
      }],
    },
  },
  {
    name: 'database',
    scenario: 'a load limit Notion does not offer',
    data: {
      schema: [{ id: 'name', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'view-table', name: 'All', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], loadLimit: 30 }],
      activeViewId: 'view-table',
    },
  },
  {
    name: 'database',
    scenario: 'an unknown calculation',
    data: {
      schema: [{ id: 'name', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'view-table', name: 'All', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], calculations: [{ id: 'name', fn: 'mode' }] }],
      activeViewId: 'view-table',
    },
  },
  {
    name: 'database',
    scenario: 'a property setting without an id',
    data: {
      schema: [{ id: 'name', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'view-table', name: 'All', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], properties: [{ visible: true }] }],
      activeViewId: 'view-table',
    },
  },
  {
    name: 'database',
    scenario: 'an unknown place to open pages',
    data: {
      schema: [{ id: 'name', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'view-table', name: 'All', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], openPagesIn: 'tab' }],
      activeViewId: 'view-table',
    },
  },
  {
    name: 'database',
    scenario: 'a negative frozen column count',
    data: {
      schema: [{ id: 'name', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'view-table', name: 'All', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], frozenColumnCount: -1 }],
      activeViewId: 'view-table',
    },
  },
  {
    name: 'database-row',
    scenario: 'an empty pageId',
    data: { properties: { name: 'Ship it' }, position: 'a0', pageId: '' },
  },
  {
    name: 'database-row',
    scenario: 'a missing position',
    data: { properties: { name: 'Ship it' } },
  },
];

describe('container self-description schema and metadata', () => {
  it.each(CONTAINER_DESCRIPTIONS)('$name: reuses the pinned saved schema without key-order drift', ({
    name, describeTool, data,
  }) => {
    const snapshot = readFileSync(resolve(__dirname, '../../view/__snapshots__/document-schema.json'), 'utf8');

    expect(createHash('sha256').update(snapshot).digest('hex'))
      .toBe('75967d073500f1ba38d499d6798622265804c3531b735a7177f2d5b795df6d81');

    const published: unknown = JSON.parse(snapshot);

    if (!isRecord(published) || !isRecord(published.$defs)) {
      throw new Error('Published schema must expose $defs.');
    }

    expect(data).toEqual(published.$defs[name]);
    expect(JSON.stringify(data)).toBe(JSON.stringify(published.$defs[name]));
    expect(describeTool().data).toBe(data);
    expect(blokDocumentSchema.$defs[name]).toBe(data);
  });

  it.each(CONTAINER_DESCRIPTIONS)('$name: exposes the same factory through registry and class', ({
    name, toolClass, describeTool,
  }) => {
    expect(BUILT_IN_BLOCK_DESCRIPTIONS[name]).toBe(describeTool);
    expect(hasDescribe(toolClass)).toBe(true);

    if (!hasDescribe(toolClass)) {
      throw new Error(`${name} must expose describe.`);
    }

    expect(toolClass.describe).toBe(describeTool);
    expect(toolClass.describe({})).toEqual(describeTool({}));
  });

  it.each(CONTAINER_DESCRIPTIONS)('$name: advertises the specified guards, summaries and action guidance', ({
    describeTool, expected,
  }) => {
    const description = describeTool();

    expect(description.guardedFields).toEqual(expected.guardedFields);
    expect(description.summaryFields).toEqual(expected.summaryFields);
    expect(description.guidance).toBe(expected.guidance);

    if (expected.summary !== undefined) {
      expect(description.summary).toBe(expected.summary);
    }
  });

  it.each(CONTAINER_DESCRIPTIONS)('$name: ignores config without changing it', ({ describeTool }) => {
    const config = Object.freeze({
      rows: 2,
      cols: 4,
      withHeadings: true,
      withHeadingColumn: true,
      stretched: true,
      restrictedTools: Object.freeze(['image']),
      rowPages: Object.freeze({ hostMarker: 'unchanged' }),
      unknown: Object.freeze({ enabled: true }),
    });
    const before = JSON.stringify(config);

    expect(describeTool(config)).toEqual(describeTool());
    expect(JSON.stringify(config)).toBe(before);
  });

  it.each(VALID_SAVED_SHAPES)('$name: accepts $scenario', ({ name, data }) => {
    const describeTool = BUILT_IN_BLOCK_DESCRIPTIONS[name];

    if (typeof describeTool !== 'function') {
      throw new Error(`${name} must be discoverable.`);
    }

    expect(validateAgainst(describeTool({}).data, data)).toEqual([]);
  });

  it.each(INVALID_SAVED_SHAPES)('$name: rejects $scenario', ({ name, data }) => {
    const describeTool = BUILT_IN_BLOCK_DESCRIPTIONS[name];

    if (typeof describeTool !== 'function') {
      throw new Error(`${name} must be discoverable.`);
    }

    expect(validateAgainst(describeTool({}).data, data).length).toBeGreaterThan(0);
  });
});
