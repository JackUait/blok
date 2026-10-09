import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { API, BlockAPI } from '../../../types';
import { validateAgainst } from '../../../src/shared/schema/validate';
import { DATABASE_DATA } from '../../../src/shared/tool-descriptions/database';
import { DATABASE_ROW_DATA } from '../../../src/shared/tool-descriptions/database-row';
import { DatabaseTool } from '../../../src/tools/database';
import type { DatabaseData, DatabaseRowData } from '../../../src/tools/database/types';

interface FixtureBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  parent?: string;
}

interface BlockStatesEntry {
  tool: string;
  states: Array<{ label: string; blocks: FixtureBlock[] }>;
}

/** BLOCK_STATES_RAW is a plain literal inside index.html, evaluated the way block-states-spec.test.ts does. */
const loadBlockStates = (): BlockStatesEntry[] => {
  const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
  const start = html.indexOf('const BLOCK_STATES_RAW = [');
  const end = html.indexOf('const BLOCK_STATES_SPEC');

  // Round-trip into this realm: the schema validator only treats objects with THIS realm's
  // Object.prototype as records, so vm-born objects would pass every check unexamined.
  return JSON.parse(JSON.stringify(runInNewContext(`${html.slice(start, end)}; BLOCK_STATES_RAW`))) as BlockStatesEntry[];
};

const databaseFixtures = loadBlockStates().flatMap((entry) => entry.states.flatMap((state) =>
  state.blocks
    .filter((block) => block.type === 'database')
    .map((database) => ({
      name: `${entry.tool} / ${state.label} / ${database.id}`,
      data: database.data as DatabaseData,
      rows: state.blocks.filter((block) => block.parent === database.id && block.type === 'database-row'),
    }))
));

const makeTool = (data: DatabaseData): DatabaseTool => new DatabaseTool({
  data,
  config: {},
  api: { events: { on: vi.fn(), off: vi.fn() } } as unknown as API,
  block: { id: 'fixture', dispatchChange: vi.fn() } as unknown as BlockAPI,
  readOnly: false,
});

describe('playground database fixtures (index.html)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finds the database fixtures', () => {
    expect(databaseFixtures.length).toBeGreaterThan(0);
  });

  it.each(databaseFixtures)('$name: matches the saved database shape', ({ data }) => {
    expect(validateAgainst(DATABASE_DATA, data)).toEqual([]);
  });

  it.each(databaseFixtures)('$name: passes the tool\'s own validate()', ({ data }) => {
    expect(makeTool(data).validate(data)).toBe(true);
  });

  it.each(databaseFixtures)('$name: every row matches the saved row shape', ({ rows }) => {
    for (const row of rows) {
      expect(validateAgainst(DATABASE_ROW_DATA, row.data), row.id).toEqual([]);
    }
  });

  it.each(databaseFixtures)('$name: every select value names an option, so no labelless column appears', ({ data, rows }) => {
    const selects = data.schema.filter((p) => p.type === 'select');
    const pairs = selects.flatMap((property) => rows.map((row) => ({
      at: `${row.id}.${property.id}`,
      value: (row.data as DatabaseRowData).properties[property.id],
      optionIds: (property.config?.options ?? []).map((option) => option.id),
    })));

    for (const { at, value, optionIds } of pairs.filter((pair) => pair.value !== undefined && pair.value !== null)) {
      expect(optionIds, at).toContain(value);
    }
  });
});
