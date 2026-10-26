// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { readPropertyValue } from '../../../src/shared/database/value-helpers';
import { Database, DatabaseRow, Paragraph } from '../../../src/tools';
import { COMPUTED_DB, COMPUTED_DB_EXPECTED } from './fixtures/computed-database';

import type { DatabaseSource } from '../../../src/shared/database/computed-properties';
import type { Agent, API, OutputData } from '../../../types';
import type { ViewBlock } from '../../../types/agent';

interface TestEditor { isReady: Promise<unknown>; destroy: () => void; agent: Agent; blocks: API['blocks'] }

const editors: TestEditor[] = [];

const boot = async (data: OutputData): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    data,
    user: { id: 'human-1' },
    tools: { paragraph: { class: Paragraph }, database: { class: Database }, 'database-row': { class: DatabaseRow } },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

/** The values the database tool itself shows in its cells, in the read's shape. */
const toolValues = (editor: TestEditor, databaseId: string): Record<string, Record<string, unknown>> => {
  const received: DatabaseSource[] = [];

  editor.blocks.getById(databaseId)?.call('readRelationSource', { receive: (source: DatabaseSource) => received.push(source) });
  const source = received[0];

  if (source === undefined) throw new Error(`No relation source for ${databaseId}`);

  return Object.fromEntries(source.rows.map(row => [row.id, Object.fromEntries(source.schema
    .filter(p => ['formula', 'rollup', 'relation', 'uniqueId', 'createdTime', 'createdBy', 'lastEditedTime', 'lastEditedBy'].includes(p.type))
    .map((p) => {
      const value = readPropertyValue(row, p) ?? null;

      if (p.type === 'uniqueId') return [p.id, typeof value === 'number' && p.uniqueId?.prefix !== undefined ? `${p.uniqueId.prefix}-${value}` : value];

      return [p.id, value];
    }))]));
};

const rowsOf = (blocks: ViewBlock[]): Record<string, ViewBlock> =>
  Object.fromEntries(blocks.filter(block => block.type === 'database-row').map(block => [block.id, block]));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the editor agent reads the computed values its database cells show', () => {
  it('matches the database tool value for value, and the shared fixture', async () => {
    const editor = await boot(COMPUTED_DB);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    try {
      const rows = rowsOf((await turn.read({ detail: 'full' })).blocks);
      const tool = { ...toolValues(editor, 'db'), ...toolValues(editor, 'db2') };

      for (const id of ['r1', 'r2', 'r3', 's1']) {
        const read = rows[id]?.computed ?? {};
        const computable = Object.fromEntries(Object.entries(read).filter(([, value]) =>
          !(typeof value === 'object' && value !== null && 'unavailable' in value)));
        const shown = Object.fromEntries(Object.keys(computable).map(key => [key, tool[id]?.[key]]));

        expect(computable, id).toEqual(shown);
        expect(read, id).toMatchObject(COMPUTED_DB_EXPECTED[id] ?? {});
      }
      // A marked value is one the tool shows nothing for.
      expect(tool.r1?.xru).toBeNull();
      expect(tool.r1?.bad).toBeNull();
      expect(rows.r1?.computed?.bad).toEqual({ unavailable: expect.stringMatching(/^The formula has an error:/) });
    } finally {
      turn.end();
    }
  });
});
