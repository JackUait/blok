// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataOf, errorOf, idsOf, property, row, run, seedOf, SESSIONS, valuesOf } from './database-seed';

import type { OutputData } from '../../../types';

const tree = (): OutputData => seedOf([{
  id: 'S',
  schema: [
    property('st', 'title', { defaultTemplateId: 'tpl' }),
    property('par', 'relation', { relation: { targetDatabaseId: 'S', limit: 1, twoWay: true, syncedPropertyId: 'sub', role: 'parentItem' } }),
    property('sub', 'relation', { relation: { targetDatabaseId: 'S', twoWay: true, syncedPropertyId: 'par', role: 'subItems' } }),
    property('dep', 'relation', { relation: { targetDatabaseId: 'S' } }),
  ],
  rows: [
    row('p', { st: 'p', par: [], sub: [{ id: 'c' }], dep: [] }),
    row('c', { st: 'c', par: [{ id: 'p' }], sub: [{ id: 'g' }], dep: [] }),
    row('g', { st: 'g', par: [{ id: 'c' }], sub: [], dep: [] }),
    row('d', { st: 'd', par: [], sub: [], dep: [{ id: 'p' }] }),
    row('tpl', { st: 'Bug', par: [], sub: [], dep: [] }, { template: true }),
  ],
}], [{ id: 'body', type: 'paragraph', data: { text: 'body' }, parent: 'g' }]);

const twoWay = (): OutputData => seedOf([
  {
    id: 'A',
    schema: [property('pt', 'title'), property('rel', 'relation', { relation: { targetDatabaseId: 'B', twoWay: true, syncedPropertyId: 'back' } })],
    rows: [row('a1', { pt: 'a1', rel: [{ id: 'b1' }] })],
  },
  {
    id: 'B',
    schema: [property('bt', 'title'), property('back', 'relation', { relation: { targetDatabaseId: 'A', twoWay: true, syncedPropertyId: 'rel' } })],
    rows: [row('b1', { bt: 'b1', back: [{ id: 'a1' }] })],
  },
]);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(SESSIONS)('database row delete (%s session)', (_label, open) => {
  it('block.delete on a parent row deletes its sub-items with their pages', async () => {
    const session = open(tree());
    const result = await run(session, 'block.delete', { id: 'p' });

    expect(errorOf(result)).toBeUndefined();
    expect(await idsOf(session)).toEqual(['S', 'd', 'tpl']);
    expect(result.ok ? result.results[0] : undefined).toEqual({ removedIds: expect.arrayContaining(['p', 'c', 'g', 'body']), liftedIds: [] });
    await session.close();
  });

  it('block.delete takes the row out of the relations that point at it', async () => {
    const session = open(tree());

    await run(session, 'block.delete', { id: 'g' });
    expect((await valuesOf(session, 'c')).sub).toEqual([]);

    await run(session, 'block.delete', { id: 'p' });
    expect((await valuesOf(session, 'd')).dep).toEqual([]);
    await session.close();
  });

  it('block.delete takes the row out of the other side of a two-way relation', async () => {
    const session = open(twoWay());

    await run(session, 'block.delete', { id: 'b1' });
    expect((await valuesOf(session, 'a1')).rel).toEqual([]);
    await session.close();
  });

  it('deleting the default template clears it as the default', async () => {
    const session = open(tree());

    expect(errorOf(await run(session, 'block.delete', { id: 'tpl' }))).toBeUndefined();
    const schema = (await dataOf(session, 'S'))?.schema as Array<Record<string, unknown>>;

    expect(schema.find(each => each.id === 'st')).not.toHaveProperty('defaultTemplateId');
    expect(await idsOf(session)).not.toContain('tpl');
    await session.close();
  });

  it('database.deleteRow does the same as block.delete', async () => {
    const session = open(twoWay());

    expect(errorOf(await run(session, 'database.deleteRow', { id: 'B', rowId: 'b1' }))).toBeUndefined();
    expect((await valuesOf(session, 'a1')).rel).toEqual([]);
    expect(await idsOf(session)).not.toContain('b1');
    await session.close();
  });
});
