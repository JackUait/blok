import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, openStoreSession } from '../../agent/harness';

import type { AgentBatch, AgentResult, AgentSession, OutputBlockData, OutputData } from '../../../../types';

type Session = AgentSession & { output?: () => OutputData };

const sessions: Array<[string, (seed: OutputData) => Session]> = [
  ['json', seed => openJsonSession(seed)],
  ['store', seed => openStoreSession(seed)],
];

const schema = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'st', name: 'Stage', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }, { id: 'o2', label: 'Done', position: 'a1' }] } },
  { id: 'n', name: 'Size', type: 'number', position: 'a2' },
  { id: 'd', name: 'Due', type: 'date', position: 'a3' },
];

const baseView = { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] };

const databaseBlock = (views: Array<Record<string, unknown>> = [baseView], extra: Record<string, unknown> = {}): OutputBlockData => ({
  id: 'db', type: 'database', content: ['r1'],
  data: { title: 'Tasks', schema, views, activeViewId: String(views[0]?.id), ...extra },
});

const seedOf = (block: OutputBlockData = databaseBlock()): OutputData => ({
  blocks: [
    block,
    { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One', st: 'o1' }, position: 'a0' } },
  ],
});

const run = (session: AgentSession, commands: AgentBatch['commands']): Promise<AgentResult> => session.execute({ commands });

const errorOf = (result: AgentResult): { code: string; message: string } | undefined =>
  result.ok ? undefined : { code: result.error.code, message: result.error.message };


const savedOf = async (session: Session, id = 'db'): Promise<Record<string, unknown>> => {
  const read = await session.read({ ids: [id], detail: 'full' });
  const block = read.blocks.find(candidate => candidate.id === id);

  return (block?.data ?? {});
};

const viewOf = async (session: Session, viewId = 'v1'): Promise<Record<string, unknown>> => {
  const views = (await savedOf(session)).views as Array<Record<string, unknown>>;

  return views.find(view => view.id === viewId) ?? {};
};

const schemaOf = async (session: Session): Promise<Array<Record<string, unknown>>> =>
  (await savedOf(session)).schema as Array<Record<string, unknown>>;

const update = (session: Session, changes: Record<string, unknown>, viewId = 'v1'): Promise<AgentResult> =>
  run(session, [{ name: 'database.updateView', args: { id: 'db', viewId, changes } }]);

describe.each(sessions)('database view settings on a %s session', (_name, open) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updateView writes the settings it is given and leaves the rest', async () => {
    const session = open(seedOf(databaseBlock([{ ...baseView, wrapCells: false }])));

    try {
      const result = await update(session, {
        frozenColumnCount: 1,
        showPageIcon: false,
        loadLimit: 25,
        openPagesIn: 'center',
        calculations: [{ id: 'n', fn: 'sum' }],
        properties: [{ id: 't', visible: true }, { id: 'n', visible: true, width: 180, wrap: true }, { id: 'st', visible: false }],
      });

      expect(errorOf(result)).toBeUndefined();
      expect(await viewOf(session)).toMatchObject({
        name: 'Table', type: 'table', wrapCells: false, frozenColumnCount: 1, showPageIcon: false, loadLimit: 25, openPagesIn: 'center',
        calculations: [{ id: 'n', fn: 'sum' }],
        // Kept in step with properties for v1.16.1 readers, as the model does: a table shows an unlisted property.
        visibleProperties: ['n', 'd'],
      });
    } finally {
      await session.close();
    }
  });

  it('null removes a setting; name, sorts and filters cannot be removed', async () => {
    const session = open(seedOf(databaseBlock([{ ...baseView, cardSize: 'large', frozenColumnCount: 2 }])));

    try {
      expect(errorOf(await update(session, { cardSize: null }))).toBeUndefined();
      expect(await viewOf(session)).not.toHaveProperty('cardSize');
      expect((await viewOf(session)).frozenColumnCount).toBe(2);
      expect(errorOf(await update(session, { sorts: null }))?.code).toBe('INVALID_ARGS');
    } finally {
      await session.close();
    }
  });

  it('refuses an unknown key and names the accepted ones', async () => {
    const session = open(seedOf());

    try {
      const error = errorOf(await update(session, { hidden: true }));

      expect(error?.code).toBe('INVALID_ARGS');
      expect(error?.message).toMatch(/unknown field "hidden"/);
      expect(error?.message).toMatch(/filterTree/);
    } finally {
      await session.close();
    }
  });

  it('gives a filter or sort without an id the id every reader derives for it', async () => {
    const session = open(seedOf());

    try {
      await update(session, {
        filters: [{ id: 'f1', propertyId: 'st', operator: 'equals', value: 'o1' }, { propertyId: 'n', operator: 'greater_than', value: 2 }],
        sorts: [{ propertyId: 'd', direction: 'desc' }],
      });

      const view = await viewOf(session);

      expect(view.filters).toEqual([
        { id: 'f1', propertyId: 'st', operator: 'equals', value: 'o1' },
        { id: 'legacy-1', propertyId: 'n', operator: 'greater_than', value: 2 },
      ]);
      expect(view.sorts).toEqual([{ id: 'legacy-0', propertyId: 'd', direction: 'desc' }]);
    } finally {
      await session.close();
    }
  });

  it('mints ids for advanced filter nodes and color rules sent without one', async () => {
    const session = open(seedOf());

    try {
      const result = await update(session, {
        filterTree: {
          conjunction: 'or',
          filterRules: [
            { propertyId: 'st', operator: 'equals', value: 'o1' },
            { conjunction: 'and', filterRules: [{ propertyId: 'n', operator: 'greater_than', value: 1 }] },
          ],
        },
        colorRules: [{ propertyId: 'st', operator: 'equals', value: 'o2', color: 'green' }],
      });

      expect(errorOf(result)).toBeUndefined();
      const view = await viewOf(session) as { filterTree: { id: string; filterRules: Array<{ id: string; filterRules?: Array<{ id: string }> }> }; colorRules: Array<{ id: string }> };

      expect(view.filterTree.id).toEqual(expect.any(String));
      expect(view.filterTree.filterRules.map(node => node.id)).toEqual([expect.any(String), expect.any(String)]);
      expect(view.filterTree.filterRules[1].filterRules?.[0].id).toEqual(expect.any(String));
      expect(view.colorRules[0].id).toEqual(expect.any(String));
    } finally {
      await session.close();
    }
  });

  it('grouping by another property resets its group settings to that type\'s defaults, as the group picker does', async () => {
    const session = open(seedOf(databaseBlock([{ ...baseView, type: 'board', groupBy: 'st', groupSettings: { sort: 'descending' } }])));

    try {
      await update(session, { groupBy: 'n' });
      expect((await viewOf(session)).groupSettings).toEqual({ hideEmptyGroups: true });
      await update(session, { groupBy: 'n', groupSettings: { numberBy: 'range' } });
      expect((await viewOf(session)).groupSettings).toEqual({ numberBy: 'range' });
      await update(session, { groupBy: 'n' });
      expect((await viewOf(session)).groupSettings).toEqual({ numberBy: 'range' });
      await update(session, { subGroupBy: 'st' });
      expect((await viewOf(session)).subGroupSettings).toEqual({ hideEmptyGroups: true });
    } finally {
      await session.close();
    }
  });

  it('a board keeps its grouping', async () => {
    const session = open(seedOf(databaseBlock([{ ...baseView, type: 'board', groupBy: 'st' }])));

    try {
      expect(errorOf(await update(session, { groupBy: null }))?.message).toMatch(/board/);
    } finally {
      await session.close();
    }
  });

  it.each([
    [{ groupBy: 'nope' }, /no property nope/],
    [{ groupBy: 'r' }, /cannot group/],
    [{ calendarBy: 'n' }, /date property/],
    [{ timelineEndBy: 'st' }, /date property/],
    [{ mapBy: 'd' }, /place property/],
    [{ arrowsBy: 'n' }, /relation/],
    [{ filters: [{ propertyId: 'gone', operator: 'equals', value: 1 }] }, /no property gone/],
    [{ sorts: [{ propertyId: 'gone', direction: 'asc' }] }, /no property gone/],
    [{ properties: [{ id: 'gone', visible: true }] }, /no property gone/],
    [{ calculations: [{ id: 'gone', fn: 'sum' }] }, /no property gone/],
    [{ cardPreview: 'property:gone' }, /no property gone/],
    [{ chartMeasure: 'sum:gone' }, /no property gone/],
    [{ filterTree: { conjunction: 'and', filterRules: [{ propertyId: 'gone', operator: 'equals', value: 1 }] } }, /no property gone/],
  ])('refuses a setting that names the wrong property: %j', async (changes, message) => {
    const withRichText = { ...databaseBlock(), data: { ...databaseBlock().data, schema: [...schema, { id: 'r', name: 'Notes', type: 'richText', position: 'a4' }] } };
    const session = open(seedOf(withRichText));

    try {
      const error = errorOf(await update(session, changes));

      expect(error?.code).toBe('PRECONDITION_FAILED');
      expect(error?.message).toMatch(message);
    } finally {
      await session.close();
    }
  });

  it('keeps a properties entry the view already holds for a property this schema lacks (a peer may be ahead)', async () => {
    const session = open(seedOf(databaseBlock([{ ...baseView, properties: [{ id: 'peer', visible: true }] }])));

    try {
      expect(errorOf(await update(session, { properties: [{ id: 'peer', visible: true }, { id: 'n', visible: false }] }))).toBeUndefined();
    } finally {
      await session.close();
    }
  });

  it('refuses a view change on a locked database, and unlocks with setLock', async () => {
    const locked = { ...databaseBlock(), data: { ...databaseBlock().data, schema: schema.map(p => (p.type === 'title' ? { ...p, databaseLocked: true } : p)) } };
    const session = open(seedOf(locked));

    try {
      expect(errorOf(await update(session, { loadLimit: 10 }))?.message).toMatch(/locked/);
      expect(errorOf(await run(session, [{ name: 'database.setLock', args: { id: 'db', locked: false } }]))).toBeUndefined();
      expect((await schemaOf(session))[0]).not.toHaveProperty('databaseLocked');
      expect(errorOf(await update(session, { loadLimit: 10 }))).toBeUndefined();
      expect(errorOf(await run(session, [{ name: 'database.setLock', args: { id: 'db', locked: true } }]))).toBeUndefined();
      expect((await schemaOf(session))[0].databaseLocked).toBe(true);
    } finally {
      await session.close();
    }
  });

  it('setLayout switches a view as the layout menu does', async () => {
    const session = open(seedOf());

    try {
      expect(errorOf(await run(session, [{ name: 'database.setLayout', args: { id: 'db', viewId: 'v1', type: 'board' } }]))).toBeUndefined();
      expect(await viewOf(session)).toMatchObject({ type: 'board', groupBy: 'st' });
      await run(session, [{ name: 'database.setLayout', args: { id: 'db', viewId: 'v1', type: 'timeline' } }]);
      expect(await viewOf(session)).toMatchObject({ type: 'timeline', tableProperties: [] });
      await run(session, [{ name: 'database.setLayout', args: { id: 'db', viewId: 'v1', type: 'map' } }]);
      expect((await viewOf(session)).type).toBe('map');
      expect((await schemaOf(session)).filter(p => p.type === 'place').map(p => p.name)).toEqual(['Place']);
    } finally {
      await session.close();
    }
  });

  it('setLayout refuses a board when nothing can group it', async () => {
    const titleOnly = { ...databaseBlock(), data: { ...databaseBlock().data, schema: [schema[0]] } };
    const session = open(seedOf(titleOnly));

    try {
      expect(errorOf(await run(session, [{ name: 'database.setLayout', args: { id: 'db', viewId: 'v1', type: 'board' } }]))?.code).toBe('PRECONDITION_FAILED');
    } finally {
      await session.close();
    }
  });

  it('a new map view adds a Place property when there is none, as the editor does', async () => {
    const session = open(seedOf());

    try {
      expect(errorOf(await run(session, [{ name: 'database.addView', args: { id: 'db', type: 'map' } }]))).toBeUndefined();
      expect((await schemaOf(session)).filter(p => p.type === 'place').map(p => p.name)).toEqual(['Place']);
      await run(session, [{ name: 'database.addView', args: { id: 'db', type: 'map' } }]);
      expect((await schemaOf(session)).filter(p => p.type === 'place')).toHaveLength(1);
    } finally {
      await session.close();
    }
  });

  it('updateProperty writes the row page layout on the title property', async () => {
    const session = open(seedOf());

    try {
      const result = await run(session, [{
        name: 'database.updateProperty',
        args: {
          id: 'db',
          propertyId: 't',
          settings: {
            pageLayoutGroupIn: 'panel',
            pageLayoutFullWidth: true,
            pageLayoutSections: [{ id: 's1', name: 'Planning' }],
            pageLayoutPlacements: [{ id: 'st', place: 'heading' }, { id: 'n', place: 'section', sectionId: 's1' }],
          },
        },
      }]);

      expect(errorOf(result)).toBeUndefined();
      expect((await schemaOf(session))[0]).toMatchObject({ pageLayoutGroupIn: 'panel', pageLayoutFullWidth: true });
      expect(errorOf(await run(session, [{ name: 'database.updateProperty', args: { id: 'db', propertyId: 't', settings: { pageLayoutGroupIn: null } } }]))).toBeUndefined();
      expect((await schemaOf(session))[0]).not.toHaveProperty('pageLayoutGroupIn');
    } finally {
      await session.close();
    }
  });

  it.each([
    [{ propertyId: 'st', settings: { pageLayoutFullWidth: true } }, /title property/],
    [{ propertyId: 't', settings: { pageLayoutPlacements: [{ id: 'gone', place: 'heading' }] } }, /no property gone/],
    [{ propertyId: 't', settings: { pageLayoutPlacements: [{ id: 'n', place: 'section', sectionId: 'nope' }] } }, /no section nope/],
    [{ propertyId: 't', settings: { pageLayoutTabsId: 'r1' } }, /tabs block/],
  ])('refuses a row page layout that does not fit: %j', async (args, message) => {
    const session = open(seedOf());

    try {
      expect(errorOf(await run(session, [{ name: 'database.updateProperty', args: { id: 'db', ...args } }]))?.message).toMatch(message);
    } finally {
      await session.close();
    }
  });

  it('view actions work on a relation tab view, which carries propertyOrder alphabetical', async () => {
    const session = open(seedOf(databaseBlock([{ ...baseView, propertyOrder: 'alphabetical', properties: [] }])));

    try {
      const result = await run(session, [{ name: 'database.renameView', args: { id: 'db', viewId: 'v1', name: 'Sub-items' } }]);

      expect(errorOf(result)).toBeUndefined();
    } finally {
      await session.close();
    }
  });
});
