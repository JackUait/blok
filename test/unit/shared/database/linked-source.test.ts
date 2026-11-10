// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mintDatabaseRefIds, remapDatabaseRefs } from '../../../../src/shared/database/linked-source';

const database = (id: string, targetDatabaseId: string, extra: Record<string, unknown> = {}): { id: string; type: string; data: Record<string, unknown> } => ({
  id,
  type: 'database',
  data: {
    schema: [
      { id: 't', name: 'Name', type: 'title', position: 'a0' },
      { id: 'rel', name: 'Rel', type: 'relation', position: 'a1', relation: { targetDatabaseId, ...extra } },
    ],
    views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', rowOrder: { r1: 'a1', r2: 'a0', far: 'a2' } }],
  },
});

const row = (id: string, properties: Record<string, unknown>): { id: string; type: string; data: Record<string, unknown> } => ({
  id,
  type: 'database-row',
  data: { position: 'a0', properties },
});

const counter = (): (() => string) => {
  const state = { next: 0 };

  return () => {
    state.next += 1;

    return `new-${state.next}`;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('copying a database re-points relations and manual order at the copy', () => {
  it('mints ids for the copied database and rows that relations and row order name', () => {
    const ids = mintDatabaseRefIds([
      database('db', 'db'),
      row('r1', { rel: [{ id: 'r2' }] }),
      row('r2', {}),
    ], counter());

    expect([...ids.keys()].sort()).toEqual(['db', 'r1', 'r2']);
  });

  it('rewrites a copied relation target, and keeps one that was not copied or lives in another document', () => {
    const ids = new Map([['db', 'db2'], ['other', 'other2']]);
    const own = remapDatabaseRefs('database', database('db', 'db').data, ids);
    const outside = remapDatabaseRefs('database', database('db', 'kept').data, ids);
    const remote = remapDatabaseRefs('database', database('db', 'other', { targetDocumentId: 'doc' }).data, ids);

    expect((own.schema as Array<{ relation?: unknown }>)[1].relation).toEqual({ targetDatabaseId: 'db2' });
    expect((outside.schema as Array<{ relation?: unknown }>)[1].relation).toEqual({ targetDatabaseId: 'kept' });
    expect((remote.schema as Array<{ relation?: unknown }>)[1].relation).toEqual({ targetDatabaseId: 'other', targetDocumentId: 'doc' });
  });

  it('renames copied rows in a view\'s row order and keeps rows that were not copied', () => {
    const data = database('db', 'db').data;
    const next = remapDatabaseRefs('database', data, new Map([['r1', 'n1'], ['r2', 'n2']]));

    expect((next.views as Array<{ rowOrder?: unknown }>)[0].rowOrder).toEqual({ n1: 'a1', n2: 'a0', far: 'a2' });
    expect((data.views as Array<{ rowOrder?: unknown }>)[0].rowOrder).toEqual({ r1: 'a1', r2: 'a0', far: 'a2' });
  });

  it('re-points a row\'s related rows that were copied, and leaves other values alone', () => {
    const data = row('r1', { rel: [{ id: 'r2' }, { id: 'far' }], who: [{ id: 'user-1' }], t: 'r2' }).data;
    const next = remapDatabaseRefs('database-row', data, new Map([['r2', 'n2']]));

    expect(next.properties).toEqual({ rel: [{ id: 'n2' }, { id: 'far' }], who: [{ id: 'user-1' }], t: 'r2' });
    expect(data.properties).toEqual({ rel: [{ id: 'r2' }, { id: 'far' }], who: [{ id: 'user-1' }], t: 'r2' });
  });
});
