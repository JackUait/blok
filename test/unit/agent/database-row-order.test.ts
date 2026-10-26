// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataOf, errorOf, property, row, run, seedOf, SESSIONS } from './database-seed';

import type { AgentResult, AgentSession, OutputData } from '../../../types';

type View = { id: string; rowOrder?: Record<string, string> };

const SAVED = { sorts: [], filters: [], visibleProperties: [] };

/** Rows a, b, c at positions aa, ab, ac. `views` replaces the one view; the first is open. */
const seed = (views: Array<Record<string, unknown>>): OutputData => {
  const data = seedOf([{ id: 'S', schema: [property('t', 'title')], rows: [row('a', { t: 'a' }), row('b', { t: 'b' }), row('c', { t: 'c' })] }]);
  const database = data.blocks[0];

  database.data.views = views.map((view, i) => ({ name: 'Table', type: 'table', position: `a${i}`, ...SAVED, ...view }));
  database.data.activeViewId = views[0]?.id;

  return data;
};

const viewsOf = async (session: AgentSession): Promise<View[]> => ((await dataOf(session, 'S'))?.views ?? []) as View[];

/** Every row in a view's manual order: its own key, else its position. */
const manual = async (session: AgentSession, viewId: string): Promise<string[]> => {
  const blocks = (await session.read({ detail: 'full' })).blocks.filter(block => block.parentId === 'S');
  const order = (await viewsOf(session)).find(view => view.id === viewId)?.rowOrder ?? {};
  const keyOf = (id: string): string => order[id] ?? String(blocks.find(block => block.id === id)?.data?.position);

  return blocks.map(block => block.id).sort((x, y) => (keyOf(x) < keyOf(y) ? -1 : 1));
};

const rowIdOf = (result: AgentResult): string => {
  const value = result.ok ? result.results[0] : undefined;

  return typeof value === 'object' && value !== null && 'rowId' in value ? String(value.rowId) : '';
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(SESSIONS)('rows placed in the open view\'s own order (%s session)', (_label, open) => {
  // Keys apart from the positions, so a row placed by position alone lands elsewhere.
  const OWN = { id: 'own', rowOrder: { c: 'Zx', a: 'Zy', b: 'Zz' } };

  it('database.moveRow moves the row in the view\'s own order and keeps its position', async () => {
    const session = open(seed([OWN]));

    expect(errorOf(await run(session, 'database.moveRow', { id: 'S', rowId: 'b', before: 'a' }))).toBeUndefined();
    expect(await manual(session, 'own')).toEqual(['c', 'b', 'a']);
    expect((await dataOf(session, 'b'))?.position).toBe('ab');
    await session.close();
  });

  it('database.addRow after or before a row places it there in the view\'s own order', async () => {
    const session = open(seed([OWN]));
    const below = rowIdOf(await run(session, 'database.addRow', { id: 'S', after: 'a' }));
    const above = rowIdOf(await run(session, 'database.addRow', { id: 'S', before: 'c' }));

    expect(await manual(session, 'own')).toEqual([above, 'c', 'a', below, 'b']);
    await session.close();
  });

  it('database.addRow at the end goes last in every view, own orders too', async () => {
    const session = open(seed([{ id: 'shared' }, { id: 'high', rowOrder: { c: 'b0', a: 'b1', b: 'b2' } }]));
    const added = rowIdOf(await run(session, 'database.addRow', { id: 'S' }));

    expect((await manual(session, 'high')).at(-1)).toBe(added);
    expect((await manual(session, 'shared')).at(-1)).toBe(added);
    await session.close();
  });
});
