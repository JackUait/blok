// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataOf, errorOf, property, row, run, seedOf, SESSIONS, valuesOf } from './database-seed';

import type { OutputData } from '../../../types';

const twoWay = (): OutputData => seedOf([
  {
    id: 'A',
    schema: [property('pt', 'title'), property('rel', 'relation', { relation: { targetDatabaseId: 'B', twoWay: true, syncedPropertyId: 'back' } })],
    rows: [row('a1', { pt: 'a1', rel: [] }), row('a2', { pt: 'a2', rel: [] })],
  },
  {
    id: 'B',
    schema: [property('bt', 'title'), property('back', 'relation', { relation: { targetDatabaseId: 'A', twoWay: true, syncedPropertyId: 'rel' } })],
    rows: [row('b1', { bt: 'b1', back: [] }), row('b2', { bt: 'b2', back: [] })],
  },
]);

const subItems = (): OutputData => seedOf([{
  id: 'S',
  schema: [
    property('st', 'title'),
    property('par', 'relation', { relation: { targetDatabaseId: 'S', limit: 1, twoWay: true, syncedPropertyId: 'sub', role: 'parentItem' } }),
    property('sub', 'relation', { relation: { targetDatabaseId: 'S', twoWay: true, syncedPropertyId: 'par', role: 'subItems' } }),
  ],
  rows: [row('c', { st: 'c', par: [], sub: [] }), row('p', { st: 'p', par: [], sub: [] }), row('q', { st: 'q', par: [], sub: [] })],
}]);

const oneWay = (): OutputData => seedOf([
  { id: 'A', schema: [property('pt', 'title'), property('rel', 'relation', { relation: { targetDatabaseId: 'B' } })], rows: [row('a1', { pt: 'a1', rel: [{ id: 'b1' }] })] },
  { id: 'B', schema: [property('bt', 'title')], rows: [row('b1', { bt: 'b1' }), row('b2', { bt: 'b2' })] },
]);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(SESSIONS)('database relations (%s session)', (_label, open) => {
  it('a two-way relation written on one row shows on the rows it names', async () => {
    const session = open(twoWay());

    expect(errorOf(await run(session, 'database.setRowValues', { id: 'A', rowId: 'a1', values: { rel: [{ id: 'b1' }, { id: 'b2' }] } }))).toBeUndefined();
    expect((await valuesOf(session, 'b1')).back).toEqual([{ id: 'a1' }]);
    expect((await valuesOf(session, 'b2')).back).toEqual([{ id: 'a1' }]);

    await run(session, 'database.setRowValues', { id: 'A', rowId: 'a1', values: { rel: [{ id: 'b2' }] } });
    expect((await valuesOf(session, 'b1')).back).toEqual([]);
    expect((await valuesOf(session, 'b2')).back).toEqual([{ id: 'a1' }]);
    await session.close();
  });

  it('a one-page Parent item keeps the last page and both sides agree', async () => {
    const session = open(subItems());

    await run(session, 'database.setRowValues', { id: 'S', rowId: 'c', values: { par: [{ id: 'p' }, { id: 'q' }] } });
    expect((await valuesOf(session, 'c')).par).toEqual([{ id: 'q' }]);
    expect((await valuesOf(session, 'p')).sub).toEqual([]);
    expect((await valuesOf(session, 'q')).sub).toEqual([{ id: 'c' }]);

    await run(session, 'database.setRowValues', { id: 'S', rowId: 'c', values: { par: [{ id: 'q' }, { id: 'p' }] } });
    expect((await valuesOf(session, 'c')).par).toEqual([{ id: 'p' }]);
    expect((await valuesOf(session, 'q')).sub).toEqual([]);
    expect((await valuesOf(session, 'p')).sub).toEqual([{ id: 'c' }]);
    await session.close();
  });

  it('turning two-way on adds the other side, links the pair and fills it from this side', async () => {
    const session = open(oneWay());

    expect(errorOf(await run(session, 'database.updateProperty', {
      id: 'A', propertyId: 'rel', settings: { relation: { targetDatabaseId: 'B', twoWay: true } },
    }))).toBeUndefined();

    const a = (await dataOf(session, 'A'))?.schema as Array<Record<string, unknown>>;
    const b = (await dataOf(session, 'B'))?.schema as Array<Record<string, unknown>>;
    const mirror = b.find(each => each.type === 'relation');

    expect(mirror).toMatchObject({ name: 'Related to rel', relation: { targetDatabaseId: 'A', twoWay: true, syncedPropertyId: 'rel' } });
    expect(a.find(each => each.id === 'rel')?.relation).toEqual({ targetDatabaseId: 'B', twoWay: true, syncedPropertyId: mirror?.id });
    expect((await valuesOf(session, 'b1'))[String(mirror?.id)]).toEqual([{ id: 'a1' }]);
    expect((await valuesOf(session, 'b2'))[String(mirror?.id)]).toEqual([]);
    await session.close();
  });

  it('turning two-way on a relation to its own database adds the mirror there', async () => {
    const session = open(seedOf([{
      id: 'S',
      schema: [property('st', 'title'), property('dep', 'relation', { relation: { targetDatabaseId: 'S' } })],
      rows: [row('x', { st: 'x', dep: [{ id: 'y' }] }), row('y', { st: 'y', dep: [] })],
    }]));

    await run(session, 'database.updateProperty', { id: 'S', propertyId: 'dep', settings: { relation: { targetDatabaseId: 'S', twoWay: true } } });
    const schema = (await dataOf(session, 'S'))?.schema as Array<Record<string, unknown>>;
    const mirror = schema.find(each => each.type === 'relation' && each.id !== 'dep');

    expect(mirror?.relation).toEqual({ targetDatabaseId: 'S', twoWay: true, syncedPropertyId: 'dep' });
    expect((await valuesOf(session, 'y'))[String(mirror?.id)]).toEqual([{ id: 'x' }]);
    await session.close();
  });
});
