// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMANDS } from '../../../../src/shared/agent/commands';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions';
import { BUILT_IN_INLINE_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions/inline';
import { describeDatabase } from '../../../../src/shared/tool-descriptions/database';
import { RICH_TEXT_PRIMER } from '../../../../src/shared/tool-descriptions/rich-text';
import { COMPUTED_DB } from '../../agent/fixtures/computed-database';
import { openJsonSession } from '../../agent/harness';

import type { OutputData } from '../../../../types';

const seed: OutputData = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello world' }] } }] };

const textOf = async (session: ReturnType<typeof openJsonSession>, id: string): Promise<unknown> =>
  (await session.read({ ids: [id], detail: 'full' })).blocks.find(block => block.id === id)?.data?.text;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what the model is told about inline formats is true', () => {
  it('tells the model that unset removes a mark and "tag:*" clears custom marks', () => {
    const unset = JSON.stringify(COMMANDS['text.format'].argsSchema);

    expect(unset).toContain('tag:*');
    expect(unset).toMatch(/remove a mark/i);
  });

  it('refuses false in text.format set, so the model is pointed at unset instead', async () => {
    const session = openJsonSession(seed);

    try {
      const result = await session.execute({ commands: [{ name: 'text.format', args: { id: 'p', range: { find: 'world' }, set: { bold: false } } }] });

      expect(result.ok).toBe(false);
    } finally {
      await session.close();
    }
  });

  it('does not promise any CSS colour on the marker, because oklch is dropped', async () => {
    const summary = BUILT_IN_INLINE_DESCRIPTIONS.marker().summary;

    expect(summary).not.toMatch(/any CSS colou?r/i);

    const session = openJsonSession(seed);

    try {
      await session.execute({ commands: [{ name: 'text.format', args: { id: 'p', range: { find: 'world' }, set: { color: 'oklch(0.6 0.2 30)' } } }] });

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello world' }]);
    } finally {
      await session.close();
    }
  });
});

describe('what the model is told about find and replace is true', () => {
  it('says plain text keeps the marks where the range starts, and it does', async () => {
    expect(COMMANDS['text.replace'].summary).toMatch(/Plain text takes the marks/);

    const session = openJsonSession({ blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello ' }, { text: 'world', marks: { bold: true } }] } }] });

    try {
      await session.execute({ commands: [{ name: 'text.replace', args: { id: 'p', range: { find: 'world' }, with: 'there' } }] });

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello ' }, { text: 'there', marks: { bold: true } }]);
    } finally {
      await session.close();
    }
  });

  it('says a find folds case unless matchCase, and replace-all is one pass, and both hold', async () => {
    expect(COMMANDS['text.replace'].guidance).toMatch(/case.*fold.*unless matchCase/);
    expect(COMMANDS['text.replace'].guidance).toContain('all: true');

    const session = openJsonSession({ blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Cat cat' }] } }] });

    try {
      await session.execute({ commands: [{ name: 'text.replace', args: { id: 'p', range: { find: 'cat', all: true }, with: 'concat' } }] });

      expect(await textOf(session, 'p')).toEqual([{ text: 'concat concat' }]);
    } finally {
      await session.close();
    }
  });
});

describe('what the model is told about page mentions is true', () => {
  it('says a mention takes the pageId, not the block id, and a block id is refused', async () => {
    expect(RICH_TEXT_PRIMER).toMatch(/pageId in a page block's data, not the block id/);

    const session = openJsonSession({ blocks: [
      { id: 'pl', type: 'page', data: { pageId: 'pg-1' } },
      { id: 'p', type: 'paragraph', data: { text: [{ text: 'See ' }] } },
    ] });

    try {
      const byBlock = await session.execute({ commands: [{ name: 'text.insert', args: { id: 'p', at: 4, text: [{ embed: { page: { id: 'pl' } } }] } }] });
      const byPage = await session.execute({ commands: [{ name: 'text.insert', args: { id: 'p', at: 4, text: [{ embed: { page: { id: 'pg-1' } } }] } }] });

      expect(byBlock.ok).toBe(false);
      expect(byPage).toMatchObject({ ok: true, warnings: [] });
    } finally {
      await session.close();
    }
  });
});

describe('what the model is told about block.convert is true', () => {
  it('says a heading turned into a toggle heading nests the blocks after it, and it does', async () => {
    expect(BUILT_IN_BLOCK_DESCRIPTIONS.header().guidance).toMatch(/turning it on nests the blocks after it/);

    const session = openJsonSession({
      blocks: [
        { id: 'h', type: 'header', data: { text: 'H', level: 2 } },
        { id: 's', type: 'paragraph', data: { text: 'body' } },
      ],
    });

    try {
      await session.execute({ commands: [{ name: 'block.convert', args: { id: 'h', type: 'header', data: { isToggleable: true } } }] });

      expect(session.output().blocks.find(block => block.id === 's')?.parent).toBe('h');
    } finally {
      await session.close();
    }
  });

  it('says a callout gives and takes its text as its first line, and it does', async () => {
    expect(BUILT_IN_BLOCK_DESCRIPTIONS.callout().guidance).toMatch(/first line/);

    const session = openJsonSession({
      blocks: [
        { id: 'c', type: 'callout', data: { emoji: '💡' }, content: ['l'] },
        { id: 'l', type: 'paragraph', data: { text: 'line' }, parent: 'c' },
      ],
    });

    try {
      await session.execute({ commands: [{ name: 'block.convert', args: { id: 'c', type: 'paragraph' } }] });

      expect(session.output().blocks).toEqual([expect.objectContaining({ id: 'c', type: 'paragraph', data: { text: [{ text: 'line' }] } })]);
    } finally {
      await session.close();
    }
  });
});

describe('what the model is told about computed database values is true', () => {
  const guidance = describeDatabase().guidance ?? '';

  it('says a full read of a row has read-only computed values by property id, outside data, and it does', async () => {
    expect(guidance).toMatch(/full read of a row adds computed: the read-only values its cells show, by property id/);

    const session = openJsonSession(COMPUTED_DB);

    try {
      const [row] = (await session.read({ ids: ['r1'] })).blocks;

      expect(row?.computed).toMatchObject({ f: 42 });
      expect(row?.data).not.toHaveProperty('computed');
      const write = await session.execute({ commands: [{ name: 'database.setRowValues', args: { id: 'db', rowId: 'r1', values: { f: 1 } } }] });
      const [after] = (await session.read({ ids: ['r1'] })).blocks;

      // Writing a formula id does not change what the cell shows.
      expect(!write.ok || after?.computed?.f === 42).toBe(true);
    } finally {
      await session.close();
    }
  });

  it('says how times, people and IDs read, and they read that way', async () => {
    expect(guidance).toContain('times as ISO instants, people as [{ "id" }], a unique ID as shown ("T-1")');

    const session = openJsonSession(COMPUTED_DB);

    try {
      const [row] = (await session.read({ ids: ['r1'] })).blocks;

      expect(row?.computed).toMatchObject({ ct: '2026-01-02T03:04:05.000Z', cb: [{ id: 'u1' }], uid: 'T-1' });
    } finally {
      await session.close();
    }
  });

  it('says a value it cannot work out is { unavailable: reason }, and a cross-document rollup is', async () => {
    expect(guidance).toContain('{ "unavailable": reason }');

    const session = openJsonSession(COMPUTED_DB);

    try {
      const [row] = (await session.read({ ids: ['r1'] })).blocks;

      expect(row?.computed?.xru).toEqual({ unavailable: expect.any(String) });
    } finally {
      await session.close();
    }
  });
});

describe('what the model is told about new and copied database rows is true', () => {
  const action = (name: string): { summary: string; guidance?: string } | undefined =>
    describeDatabase().actions?.find(each => each.name === name);
  const database = (view: Record<string, unknown>): OutputData => ({
    blocks: [
      {
        id: 'db', type: 'database', content: ['a', 'b'],
        data: {
          schema: [{ id: 't', name: 'Title', type: 'title', position: 'a0' }, { id: 'done', name: 'Done', type: 'checkbox', position: 'a1' }],
          views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }],
          activeViewId: 'v',
        },
      },
      { id: 'a', type: 'database-row', parent: 'db', data: { position: 'a0', title: 'a', properties: { t: 'a', done: true } } },
      { id: 'b', type: 'database-row', parent: 'db', data: { position: 'a1', title: 'b', properties: { t: 'b', done: true } } },
    ] as OutputData['blocks'],
  });

  it('says addRow fills what the open view filters on, and it does', async () => {
    expect(action('addRow')?.guidance).toMatch(/open view's filters ask for fill in/);
    const session = openJsonSession(database({ filters: [{ id: 'f', propertyId: 'done', operator: 'equals', value: true }] }));

    try {
      const result = await session.execute({ commands: [{ name: 'database.addRow', args: { id: 'db' } }] });
      const rowId = result.ok ? String((result.results[0] as { rowId: string }).rowId) : '';

      expect(session.output().blocks.find(block => block.id === rowId)?.data.properties).toMatchObject({ done: true });
    } finally {
      await session.close();
    }
  });

  it('says moveRow and addRow before or after a row follow the open view\'s own order, and they do', async () => {
    expect(action('moveRow')?.summary).toMatch(/own manual order, only that order changes/);
    expect(action('addRow')?.summary).toMatch(/in the open view's order/);
    const session = openJsonSession(database({ rowOrder: { b: 'Zx', a: 'Zy' } }));

    try {
      await session.execute({ commands: [{ name: 'database.moveRow', args: { id: 'db', rowId: 'a', before: 'b' } }] });
      const result = await session.execute({ commands: [{ name: 'database.addRow', args: { id: 'db', after: 'a' } }] });
      const rowId = result.ok ? String((result.results[0] as { rowId: string }).rowId) : '';
      const order = (session.output().blocks[0]?.data.views as Array<{ rowOrder: Record<string, string> }>)[0].rowOrder;

      expect(Object.keys(order).sort((x, y) => (order[x] < order[y] ? -1 : 1))).toEqual(['a', rowId, 'b']);
      expect(session.output().blocks.find(block => block.id === 'a')?.data.position).toBe('a0');
    } finally {
      await session.close();
    }
  });

  it('says duplicateRow places the copy after the original in a view with its own order, and it does', async () => {
    expect(action('duplicateRow')?.summary).toMatch(/own manual order the copy goes right after it there too/);
    const session = openJsonSession(database({ rowOrder: { b: 'Zx', a: 'Zy' } }));

    try {
      const result = await session.execute({ commands: [{ name: 'database.duplicateRow', args: { id: 'db', rowId: 'b' } }] });
      const copy = result.ok ? String((result.results[0] as { rowId: string }).rowId) : '';
      const order = (session.output().blocks[0]?.data.views as Array<{ rowOrder: Record<string, string> }>)[0].rowOrder;

      expect(Object.keys(order).sort((x, y) => (order[x] < order[y] ? -1 : 1))).toEqual(['b', copy, 'a']);
    } finally {
      await session.close();
    }
  });
});
