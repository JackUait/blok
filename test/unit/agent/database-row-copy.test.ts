// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataOf, errorOf, idsOf, property, row, run, seedOf, SESSIONS, valuesOf } from './database-seed';

import type { AgentResult, AgentSession, OutputData } from '../../../types';

const PAIR = [
  property('par', 'relation', { relation: { targetDatabaseId: 'S', limit: 1, twoWay: true, syncedPropertyId: 'sub', role: 'parentItem' } }),
  property('sub', 'relation', { relation: { targetDatabaseId: 'S', twoWay: true, syncedPropertyId: 'par', role: 'subItems' } }),
];

const seed = (view?: Record<string, unknown>): OutputData => seedOf([
  {
    id: 'S',
    view,
    schema: [property('st', 'title'), ...PAIR, property('tag', 'select', { config: { options: [{ id: 's-red', label: 'Red', position: 'a0' }] } })],
    rows: [
      row('top', { st: 'top', par: [], sub: [{ id: 'p' }], tag: 's-red' }),
      row('p', { st: 'p', par: [{ id: 'top' }], sub: [{ id: 'c' }], tag: 's-red' }, { icon: '📌' }),
      row('c', { st: 'c', par: [{ id: 'p' }], sub: [] }),
      row('z', { st: 'z', par: [], sub: [] }),
      row('tpl', { st: 'Bug', par: [], sub: [] }, { template: true, title: 'Bug', icon: '🐞' }),
    ],
  },
  {
    id: 'B',
    schema: [property('bt', 'title'), property('color', 'select', { name: 'tag', config: { options: [{ id: 'b-red', label: 'red', position: 'a0' }] } })],
    rows: [row('b1', { bt: 'b1' })],
  },
], [
  { id: 'p-body', type: 'paragraph', data: { text: 'Page body' }, parent: 'p' },
  { id: 'p-note', type: 'database-comment', data: { text: 'a comment', createdAt: 1 }, parent: 'p' },
]);

const resultOf = (result: AgentResult): Record<string, unknown> => {
  const value = result.ok ? result.results[0] : undefined;

  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
};

const newIds = async (session: AgentSession, before: string[]): Promise<string[]> =>
  (await idsOf(session)).filter(id => !before.includes(id));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(SESSIONS)('database row copy and move (%s session)', (_label, open) => {
  it('block.duplicate on a row copies it with its page and sub-items, beside the original', async () => {
    const session = open(seed());
    const before = await idsOf(session);
    const result = await run(session, 'block.duplicate', { id: 'p' });

    expect(errorOf(result)).toBeUndefined();
    const copy = String(resultOf(result).id);

    expect(await dataOf(session, copy)).toMatchObject({ title: 'p', icon: '📌' });
    const values = await valuesOf(session, copy);

    expect(values.par).toEqual([{ id: 'top' }]);
    expect(values.sub).toHaveLength(1);
    const child = (values.sub as Array<{ id: string }>)[0]?.id ?? '';

    expect(await valuesOf(session, child)).toMatchObject({ st: 'c', par: [{ id: copy }] });
    expect((await valuesOf(session, 'top')).sub).toEqual([{ id: 'p' }, { id: copy }]);
    // The page body comes along; the comment thread stays with the original.
    expect((await session.read({ detail: 'full' })).blocks.filter(block => block.parentId === copy).map(block => block.type)).toEqual(['paragraph']);
    expect(await newIds(session, before)).toHaveLength(3);
    await session.close();
  });

  it('a ref on block.duplicate of a row names the copy for later commands', async () => {
    const session = open(seed());
    const result = await session.execute({
      commands: [
        { name: 'block.duplicate', args: { id: 'z' }, ref: 'copy' },
        { name: 'block.update', args: { id: '$copy', data: { icon: '🔁' } } },
      ],
    });

    expect(errorOf(result)).toBeUndefined();
    expect(await dataOf(session, result.ok ? result.refs.copy ?? '' : '')).toMatchObject({ title: 'z', icon: '🔁' });
    await session.close();
  });

  it('database.duplicateRow copies a template as a template', async () => {
    const session = open(seed());
    const result = await run(session, 'database.duplicateRow', { id: 'S', rowId: 'tpl' });

    expect(errorOf(result)).toBeUndefined();
    expect(await dataOf(session, String(resultOf(result).rowId))).toMatchObject({ template: true, title: 'Bug', icon: '🐞' });
    await session.close();
  });

  it('database.moveRowTo moves a row with its sub-items and maps values by name', async () => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.moveRowTo', { id: 'S', rowId: 'p', databaseId: 'B' }))).toBeUndefined();
    const view = await session.read({ detail: 'full' });
    const parentOf = (id: string): string | undefined => view.blocks.find(block => block.id === id)?.parentId;

    expect([parentOf('p'), parentOf('c'), parentOf('p-body')]).toEqual(['B', 'B', 'p']);
    expect(await valuesOf(session, 'p')).toEqual({ bt: 'p', color: 'b-red' });
    expect(await valuesOf(session, 'c')).toEqual({ bt: 'c' });
    await session.close();
  });

  it('database.moveRowTo refuses this database and a block that is no database', async () => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.moveRowTo', { id: 'S', rowId: 'p', databaseId: 'S' }))?.code).toBe('PRECONDITION_FAILED');
    expect(errorOf(await run(session, 'database.moveRowTo', { id: 'S', rowId: 'p', databaseId: 'c' }))?.code).toBe('PRECONDITION_FAILED');
    await session.close();
  });
  it('database.duplicateRow puts the copy and its sub-items right after the original in a view with its own order', async () => {
    // Keys apart from the positions: a copy with no key of its own would sort last.
    const session = open(seed({ sorts: [], filters: [], visibleProperties: [], rowOrder: { z: 'a0', top: 'a1', p: 'a2', c: 'a3' } }));
    const result = await run(session, 'database.duplicateRow', { id: 'S', rowId: 'p' });

    expect(errorOf(result)).toBeUndefined();
    const copy = String(resultOf(result).rowId);
    const child = ((await valuesOf(session, copy)).sub as Array<{ id: string }>)[0]?.id ?? '';
    const order = ((await dataOf(session, 'S'))?.views as Array<{ rowOrder: Record<string, string> }>)[0].rowOrder;

    expect(Object.keys(order).sort((a, b) => (order[a] < order[b] ? -1 : 1))).toEqual(['z', 'top', 'p', copy, child, 'c']);
    await session.close();
  });

  it('database.duplicateRow leaves the views alone when they share one order, or for a template', async () => {
    const shared = open(seed());

    expect(errorOf(await run(shared, 'database.duplicateRow', { id: 'S', rowId: 'z' }))).toBeUndefined();
    expect((await dataOf(shared, 'S'))?.views).toEqual([{ id: 'S-v', name: 'Table', type: 'table', position: 'a0' }]);
    await shared.close();
    const own = open(seed({ rowOrder: { z: 'a0' } }));

    expect(errorOf(await run(own, 'database.duplicateRow', { id: 'S', rowId: 'tpl' }))).toBeUndefined();
    expect((await dataOf(own, 'S'))?.views).toEqual([{ id: 'S-v', name: 'Table', type: 'table', position: 'a0', rowOrder: { z: 'a0' } }]);
    await own.close();
  });
});
