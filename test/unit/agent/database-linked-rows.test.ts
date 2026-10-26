// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataOf, errorOf, idsOf, property, row, run, SESSIONS, valuesOf } from './database-seed';

import type { AgentResult, AgentSession, OutputData } from '../../../types';

type Block = OutputData['blocks'][number];

const OPTIONS = { config: { options: [{ id: 'red', label: 'Red', position: 'a0' }, { id: 'blue', label: 'Blue', position: 'a1' }] } };
const PAIR = [
  property('par', 'relation', { relation: { targetDatabaseId: 'S', limit: 1, twoWay: true, syncedPropertyId: 'sub', role: 'parentItem' } }),
  property('sub', 'relation', { relation: { targetDatabaseId: 'S', twoWay: true, syncedPropertyId: 'par', role: 'subItems' } }),
];
const SCHEMA = [property('t', 'title'), property('tag', 'select', OPTIONS), ...PAIR];
const VIEW = { id: 'S-v', name: 'Table', type: 'table', position: 'a0' };

const database = (id: string, data: Record<string, unknown>, content: string[], parent?: string): Block =>
  ({ id, type: 'database', data, content, ...(parent === undefined ? {} : { parent }) });
const rowIn = (parent: string, each: ReturnType<typeof row>): Block => ({ ...each, parent, content: [] });

/** A linked view of `source`: its own red-filtered view and a stand-in title, no rows of its own. */
const linked = (id: string, source: Record<string, unknown>, view: Record<string, unknown> = {}, parent?: string): Block => database(id, {
  source,
  schema: [property('t', 'title')],
  views: [{ id: `${id}-v`, name: 'Red', type: 'table', position: 'a0', sorts: [], visibleProperties: [], filters: [{ id: 'f', propertyId: 'tag', operator: 'equals', value: 'red' }], ...view }],
  activeViewId: `${id}-v`,
}, [], parent);

/** Source S (a parent row p with sub-item c, and z), and the linked view L of it. */
const seed = (sourceExtra: Record<string, unknown> = {}, view: Record<string, unknown> = {}): OutputData => ({
  blocks: [
    database('S', { schema: SCHEMA, views: [VIEW], activeViewId: 'S-v', ...sourceExtra }, ['p', 'c', 'z']),
    rowIn('S', row('p', { t: 'p', tag: 'red', par: [], sub: [{ id: 'c' }] })),
    rowIn('S', row('c', { t: 'c', tag: 'red', par: [{ id: 'p' }], sub: [] })),
    rowIn('S', row('z', { t: 'z', tag: 'blue', par: [], sub: [] })),
    linked('L', { databaseId: 'S' }, view),
  ],
});

const rowIdOf = (result: AgentResult): string => {
  const value = result.ok ? result.results[0] : undefined;

  return typeof value === 'object' && value !== null && 'rowId' in value ? String(value.rowId) : '';
};

const blockOf = async (session: AgentSession, id: string): Promise<{ parent?: string; content: string[] } | undefined> => {
  const blocks = (await session.read({ detail: 'full' })).blocks;
  const found = blocks.find(block => block.id === id);

  return found === undefined ? undefined : { parent: found.parentId, content: blocks.filter(block => block.parentId === id).map(block => block.id) };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(SESSIONS)('row commands on a linked view go to its source, as in the editor (%s session)', (_label, open) => {
  it('database.addRow puts the row in the source database, with the linked view\'s filter values', async () => {
    const session = open(seed());
    const result = await run(session, 'database.addRow', { id: 'L' });

    expect(errorOf(result)).toBeUndefined();
    const rowId = rowIdOf(result);

    expect((await blockOf(session, rowId))?.parent).toBe('S');
    expect(await valuesOf(session, rowId)).toMatchObject({ tag: 'red', par: [], sub: [] });
    expect((await blockOf(session, 'L'))?.content).toEqual([]);
    await session.close();
  });

  it('database.addRow takes the source\'s properties and checks values against them', async () => {
    const session = open(seed());
    const result = await run(session, 'database.addRow', { id: 'L', values: { t: 'New', tag: 'blue' } });

    expect(errorOf(result)).toBeUndefined();
    expect(await dataOf(session, rowIdOf(result))).toMatchObject({ title: 'New', properties: { t: 'New', tag: 'blue' } });
    expect(errorOf(await run(session, 'database.addRow', { id: 'L', values: { tag: 'gone' } }))?.code).toBe('PRECONDITION_FAILED');
    await session.close();
  });

  it('database.addRow next to a row keeps the order on the linked view\'s own view, not the source\'s', async () => {
    const session = open(seed({}, { rowOrder: { p: 'a0', c: 'a1', z: 'a2' } }));
    const result = await run(session, 'database.addRow', { id: 'L', after: 'p' });

    expect(errorOf(result)).toBeUndefined();
    const rowId = rowIdOf(result);
    const view = ((await dataOf(session, 'L'))?.views as Array<{ rowOrder?: Record<string, string> }>)[0];

    expect(view.rowOrder?.[rowId] > 'a0' && view.rowOrder?.[rowId] < 'a1').toBe(true);
    expect((await dataOf(session, 'S'))?.views).toEqual([VIEW]);
    await session.close();
  });

  it('database.setRowValues edits a source row and its two-way side', async () => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.setRowValues', { id: 'L', rowId: 'z', values: { par: [{ id: 'p' }] } }))).toBeUndefined();
    expect(await valuesOf(session, 'z')).toMatchObject({ par: [{ id: 'p' }] });
    expect(await valuesOf(session, 'p')).toMatchObject({ sub: [{ id: 'c' }, { id: 'z' }] });
    await session.close();
  });

  it('database.deleteRow deletes a source row with its sub-items', async () => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.deleteRow', { id: 'L', rowId: 'p' }))).toBeUndefined();
    expect(await idsOf(session)).toEqual(['S', 'z', 'L']);
    await session.close();
  });

  it('database.duplicateRow copies a source row and its sub-items into the source', async () => {
    const session = open(seed());
    const result = await run(session, 'database.duplicateRow', { id: 'L', rowId: 'p' });

    expect(errorOf(result)).toBeUndefined();
    const copy = rowIdOf(result);
    const source = await blockOf(session, 'S');

    expect(source?.content).toHaveLength(5);
    expect(source?.content).toContain(copy);
    expect((await valuesOf(session, copy)).sub).toHaveLength(1);
    await session.close();
  });

  it('database.moveRow moves a source row and pins it in the linked view\'s other views', async () => {
    const data = seed();
    const view = data.blocks.find(block => block.id === 'L')?.data as { views: Array<Record<string, unknown>> };

    view.views.push({ id: 'L-v2', name: 'Other', type: 'table', position: 'a1', sorts: [], filters: [], visibleProperties: [] });
    const session = open(data);

    expect(errorOf(await run(session, 'database.moveRow', { id: 'L', rowId: 'z', before: 'p' }))).toBeUndefined();
    expect(String((await dataOf(session, 'z'))?.position) < 'ap').toBe(true);
    const other = ((await dataOf(session, 'L'))?.views as Array<{ id: string; rowOrder?: Record<string, string> }>).find(each => each.id === 'L-v2');

    expect(other?.rowOrder?.z).toBe('az');
    expect((await dataOf(session, 'S'))?.views).toEqual([VIEW]);
    await session.close();
  });

  it('database.applyTemplate applies a template of the source', async () => {
    const data = seed();

    data.blocks.find(block => block.id === 'S')?.content?.push('tpl');
    data.blocks.push(rowIn('S', row('tpl', { t: 'Bug', tag: 'blue' }, { template: true, title: 'Bug' })));
    const session = open(data);

    expect(errorOf(await run(session, 'database.applyTemplate', { id: 'L', rowId: 'z', templateId: 'tpl' }))).toBeUndefined();
    expect(await valuesOf(session, 'z')).toMatchObject({ t: 'z', tag: 'blue' });
    await session.close();
  });

  it('database.moveRowTo moves a source row to another database, never to the source itself', async () => {
    const data = seed();

    data.blocks.push(database('D', { schema: [property('t', 'title')], views: [{ ...VIEW, id: 'D-v' }], activeViewId: 'D-v' }, []));
    const session = open(data);

    expect(errorOf(await run(session, 'database.moveRowTo', { id: 'L', rowId: 'z', databaseId: 'S' }))?.code).toBe('PRECONDITION_FAILED');
    expect(errorOf(await run(session, 'database.moveRowTo', { id: 'L', rowId: 'z', databaseId: 'D' }))).toBeUndefined();
    expect((await blockOf(session, 'z'))?.parent).toBe('D');
    await session.close();
  });

  it('a locked source still takes rows, as in the editor, and nothing its lock protects changes', async () => {
    const data = seed({ automations: [] });
    const source = data.blocks.find(block => block.id === 'S')?.data as { schema: Array<Record<string, unknown>> };

    source.schema[0] = { ...source.schema[0], databaseLocked: true };
    const session = open(data);
    const before = await dataOf(session, 'S');
    const result = await run(session, 'database.addRow', { id: 'L', after: 'p' });

    expect(errorOf(result)).toBeUndefined();
    expect((await blockOf(session, rowIdOf(result)))?.parent).toBe('S');
    const after = await dataOf(session, 'S');

    for (const field of ['schema', 'views', 'automations', 'source', 'hideDataSourceTitles', 'starter']) {
      expect(after?.[field]).toEqual(before?.[field]);
    }
    await session.close();
  });
});

describe.each(SESSIONS)('a linked view whose source this runtime cannot reach refuses row commands (%s session)', (_label, open) => {
  const refusing: Array<[string, (data: OutputData) => void]> = [
    ['a source in another document', (data) => {
      data.blocks.push(linked('X', { databaseId: 'S', documentId: 'other-doc' }));
    }],
    ['a deleted source', (data) => {
      data.blocks.push(linked('X', { databaseId: 'gone' }));
    }],
    ['a source that is not a database', (data) => {
      data.blocks.push({ id: 'para', type: 'paragraph', data: { text: 'Hi' } }, linked('X', { databaseId: 'para' }));
    }],
    ['a source that is a row', (data) => {
      data.blocks.push(linked('X', { databaseId: 'z' }));
    }],
    ['a source that is another linked view', (data) => {
      data.blocks.push(linked('X', { databaseId: 'L' }));
    }],
    ['a view linked to itself', (data) => {
      data.blocks.push(linked('X', { databaseId: 'X' }));
    }],
  ];
  const COMMANDS: Array<[string, Record<string, unknown>]> = [
    ['database.addRow', {}],
    ['database.setRowValues', { rowId: 'z', values: { t: 'x' } }],
    ['database.deleteRow', { rowId: 'z' }],
    ['database.duplicateRow', { rowId: 'z' }],
    ['database.moveRow', { rowId: 'z', before: 'p' }],
  ];

  it.each(refusing)('%s: every row command is refused and nothing changes', async (_name, add) => {
    const data = seed();

    add(data);
    const session = open(data);
    const before = await session.read({ detail: 'full' });

    for (const [name, args] of COMMANDS) {
      const error = errorOf(await run(session, name, { id: 'X', ...args }));

      expect(error?.code, name).toBe('PRECONDITION_FAILED');
    }
    expect((await session.read({ detail: 'full' })).blocks).toEqual(before.blocks);
    await session.close();
  });

  it('the refusal for another document says a person cannot add rows there either', async () => {
    const data = seed();

    data.blocks.push(linked('X', { databaseId: 'S', documentId: 'other-doc' }));
    const session = open(data);

    expect(errorOf(await run(session, 'database.addRow', { id: 'X' }))?.message).toMatch(/another document/);
    await session.close();
  });
});

/**
 * D's row pages show a tabs layout; its second tab holds L2, a linked view of S
 * filtered to rows that relate to "This page" through S.back (two-way with D.fwd).
 */
const rowPageSeed = (): OutputData => ({
  blocks: [
    database('D', {
      schema: [
        property('dt', 'title', { pageLayoutTabsId: 'T' }),
        property('fwd', 'relation', { relation: { targetDatabaseId: 'S', twoWay: true, syncedPropertyId: 'back' } }),
      ],
      views: [{ ...VIEW, id: 'D-v' }],
      activeViewId: 'D-v',
    }, ['r1', 'r2', 'T']),
    rowIn('D', row('r1', { dt: 'r1', fwd: [] })),
    rowIn('D', row('r2', { dt: 'r2', fwd: [] })),
    { id: 'T', type: 'tabs', parent: 'D', data: {}, content: ['tab1', 'tab2'] },
    { id: 'tab1', type: 'tab', parent: 'T', data: { title: 'Content' }, content: [] },
    { id: 'tab2', type: 'tab', parent: 'T', data: { title: 'Tasks' }, content: ['L2'] },
    linked('L2', { databaseId: 'S' }, { filters: [{ id: 'tp', propertyId: 'back', operator: 'contains', value: ['this_page'] }] }, 'tab2'),
    database('S', {
      schema: [property('t', 'title'), property('back', 'relation', { relation: { targetDatabaseId: 'D', twoWay: true, syncedPropertyId: 'fwd' } })],
      views: [VIEW],
      activeViewId: 'S-v',
    }, ['s1']),
    rowIn('S', row('s1', { t: 's1', back: [] })),
    linked('L3', { databaseId: 'S' }, { filters: [{ id: 'tp', propertyId: 'back', operator: 'contains', value: ['this_page'] }] }),
  ],
});

describe.each(SESSIONS)('a linked view on a row page links its new row to that page (%s session)', (_label, open) => {
  it('database.addRow with page relates the new row to the row page, both ways, as New on the page does', async () => {
    const session = open(rowPageSeed());
    const result = await run(session, 'database.addRow', { id: 'L2', page: 'r1' });

    expect(errorOf(result)).toBeUndefined();
    const rowId = rowIdOf(result);

    expect((await blockOf(session, rowId))?.parent).toBe('S');
    expect(await valuesOf(session, rowId)).toMatchObject({ back: [{ id: 'r1' }] });
    expect(await valuesOf(session, 'r1')).toMatchObject({ fwd: [{ id: rowId }] });
    expect(await valuesOf(session, 'r2')).toMatchObject({ fwd: [] });
    await session.close();
  });

  it('a view on row pages with a "This page" filter needs page, so the row is not orphaned', async () => {
    const session = open(rowPageSeed());
    const before = await idsOf(session);

    expect(errorOf(await run(session, 'database.addRow', { id: 'L2' }))?.code).toBe('INVALID_ARGS');
    expect(await idsOf(session)).toEqual(before);
    await session.close();
  });

  it('page must be a row of the database whose row pages show the view', async () => {
    const session = open(rowPageSeed());

    expect(errorOf(await run(session, 'database.addRow', { id: 'L2', page: 's1' }))?.code).toBe('PRECONDITION_FAILED');
    expect(errorOf(await run(session, 'database.addRow', { id: 'L2', page: 'T' }))?.code).toBe('PRECONDITION_FAILED');
    await session.close();
  });

  it('a "This page" filter on a view not on a row page: no page to link, the row is still added, as in the editor', async () => {
    const session = open(rowPageSeed());
    const result = await run(session, 'database.addRow', { id: 'L3' });

    expect(errorOf(result)).toBeUndefined();
    expect(await valuesOf(session, rowIdOf(result))).toMatchObject({ back: [] });
    expect(await valuesOf(session, 'r1')).toMatchObject({ fwd: [] });
    await session.close();
  });

  it('page on a view not on a row page is refused', async () => {
    const session = open(rowPageSeed());
    const before = await idsOf(session);

    expect(errorOf(await run(session, 'database.addRow', { id: 'L3', page: 'r1' }))?.code).toBe('PRECONDITION_FAILED');
    expect(errorOf(await run(session, 'database.addRow', { id: 'S', page: 'r1' }))?.code).toBe('PRECONDITION_FAILED');
    expect(await idsOf(session)).toEqual(before);
    await session.close();
  });
});
