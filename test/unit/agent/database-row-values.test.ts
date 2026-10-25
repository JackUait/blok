// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataOf, errorOf, property, row, run, seedOf, SESSIONS, valuesOf } from './database-seed';

import type { OutputData } from '../../../types';

const options = (...ids: string[]): Record<string, unknown> => ({ config: { options: ids.map((id, i) => ({ id, label: id, position: `a${i}` })) } });

const READ_ONLY = ['formula', 'rollup', 'button', 'createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy', 'uniqueId'];

const seed = (): OutputData => seedOf([{
  id: 'V',
  schema: [
    property('vt', 'title'),
    property('tx', 'text'),
    property('n', 'number'),
    property('s', 'select', options('s1')),
    property('m', 'multiSelect', options('m1', 'm2')),
    property('st', 'status', options('st1')),
    property('d', 'date'),
    property('cb', 'checkbox'),
    property('u', 'url'),
    property('pe', 'person'),
    property('f', 'files'),
    property('rel', 'relation', { relation: { targetDatabaseId: 'V' } }),
    property('pl', 'place'),
    property('ve', 'verification'),
    ...READ_ONLY.map(type => property(type, type)),
  ],
  rows: [
    row('r', { vt: 'r', m: ['m1'], pe: [], f: [], rel: [], d: '2026-01-01' }, { reminders: { d: { remind: 'on_day_of_event' } } }),
    row('o', { vt: 'o', m: [], pe: [], f: [], rel: [] }),
    row('tpl', { vt: 'T', m: [], pe: [], f: [], rel: [] }, { template: true }),
  ],
}]);

const set = (values: Record<string, unknown>, rowId = 'r'): Record<string, unknown> => ({ id: 'V', rowId, values });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(SESSIONS)('database row values (%s session)', (_label, open) => {
  it.each(READ_ONLY)('refuses a write to a %s property, which no cell editor writes', async (type) => {
    const session = open(seed());
    const error = errorOf(await run(session, 'database.setRowValues', set({ [type]: 'forged' })));

    expect(error?.code).toBe('PRECONDITION_FAILED');
    expect(error?.message).toContain(type);
    expect(await valuesOf(session, 'r')).not.toHaveProperty(type);
    await session.close();
  });

  it('refuses a property and options this database does not have', async () => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.setRowValues', set({ zz: 'x' })))?.code).toBe('PRECONDITION_FAILED');
    expect(errorOf(await run(session, 'database.setRowValues', set({ s: 'nope' })))?.code).toBe('PRECONDITION_FAILED');
    expect(errorOf(await run(session, 'database.setRowValues', set({ m: ['m1', 'nope'] })))?.code).toBe('PRECONDITION_FAILED');
    expect(errorOf(await run(session, 'database.setRowValues', set({ st: 'nope' })))?.code).toBe('PRECONDITION_FAILED');
    expect(errorOf(await run(session, 'database.setRowValues', set({ rel: [{ id: 'ghost' }] })))?.code).toBe('PRECONDITION_FAILED');
    await session.close();
  });

  it.each([
    ['n', 'not a number'], ['cb', 'yes'], ['u', 42], ['d', 'tomorrow lol'], ['tx', 7], ['vt', null],
    ['pe', 'u1'], ['f', [{ id: 'f1' }]], ['m', 'm1'], ['pl', 'Paris'], ['ve', { state: 'maybe' }],
  ])('refuses %s = %j, a value its cell editor never writes', async (propertyId, value) => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.setRowValues', set({ [propertyId]: value })))?.code).toBe('INVALID_ARGS');
    await session.close();
  });

  it('stores the values the cell editors write', async () => {
    const session = open(seed());
    const values = {
      tx: 'hi', n: 3, s: 's1', m: ['m2'], st: 'st1', d: '2026-02-03T10:00', cb: true, u: 'https://example.com',
      pe: [{ id: 'u1' }], f: [{ id: 'f1', name: 'a.png', url: 'https://example.com/a.png' }], rel: [{ id: 'o' }],
      pl: { name: 'Paris', lat: 48.8, lon: 2.3 }, ve: { state: 'verified', verifiedBy: 'u1' },
    };

    expect(errorOf(await run(session, 'database.setRowValues', set(values)))).toBeUndefined();
    expect(await valuesOf(session, 'r')).toMatchObject(values);
    await session.close();
  });

  it('null empties a person, files or relation list to [], as the editor stores it, and clears other values', async () => {
    const session = open(seed());

    await run(session, 'database.setRowValues', set({ pe: null, f: null, rel: null, m: null, s: null, n: null }));
    expect(await valuesOf(session, 'r')).toMatchObject({ pe: [], f: [], rel: [], m: null, s: null, n: null });
    await session.close();
  });

  it('clearing a date takes its reminder along', async () => {
    const session = open(seed());

    await run(session, 'database.setRowValues', set({ d: null }));
    expect(await dataOf(session, 'r')).not.toHaveProperty('reminders');
    await session.close();
  });

  it('a template keeps @today and @me, which fill in when a row is made', async () => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.setRowValues', set({ d: '@today', pe: [{ id: '@me' }] }, 'tpl')))).toBeUndefined();
    expect(await valuesOf(session, 'tpl')).toMatchObject({ d: '@today', pe: [{ id: '@me' }] });
    expect(errorOf(await run(session, 'database.setRowValues', set({ d: '@today' })))?.code).toBe('INVALID_ARGS');
    await session.close();
  });

  it('addRow checks its values the same way', async () => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.addRow', { id: 'V', values: { formula: 'x' } }))?.code).toBe('PRECONDITION_FAILED');
    expect(errorOf(await run(session, 'database.addRow', { id: 'V', values: { n: 'x' } }))?.code).toBe('INVALID_ARGS');
    await session.close();
  });
});
