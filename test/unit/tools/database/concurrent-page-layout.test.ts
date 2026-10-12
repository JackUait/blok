import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
import { addSection, moveToSection, pageLayoutOf, pin, removeFromLayout, resetPageLayout, resolvePageLayout } from '../../../../src/tools/database/page-layout';
import type { PageLayoutOp } from '../../../../src/tools/database/page-layout';
import type { PropertyDefinition } from '../../../../src/tools/database/types';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const pinClientId = (store: DocumentStore, clientId: number): void => {
  const doc = store.blocksMap.doc;

  if (doc === null) {
    throw new Error('DocumentStore has no Y.Doc');
  }
  doc.clientID = clientId;
};

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const SCHEMA: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-status', name: 'Status', type: 'select', position: 'a1', config: { options: [] } },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a2' },
  { id: 'p-owner', name: 'Owner', type: 'text', position: 'a3' },
];

const VIEW = { id: 'v1', name: 'Table', type: 'table' as const, position: 'a0', sorts: [], filters: [], visibleProperties: [] };

const schemaOf = (store: DocumentStore): PropertyDefinition[] =>
  ((store.toJSON().find((block) => block.id === 'db1')?.data ?? {}).schema ?? []) as PropertyDefinition[];

/** A peer as the database block saves: rebuild the model from the doc, edit, write the whole schema. */
const editLayout = (store: DocumentStore, ...ops: PageLayoutOp[]): void => {
  const model = new DatabaseModel({ schema: schemaOf(store), views: [VIEW], activeViewId: 'v1' });

  model.setPageLayout(ops.reduce((layout, op) => op(layout), model.getPageLayout()));
  store.updateBlockData('db1', 'schema', model.snapshot().schema);
};

const bear = (store: DocumentStore): void => {
  const model = new DatabaseModel({ schema: schemaOf(store), views: [VIEW], activeViewId: 'v1' });

  expect(model.bearPageLayout()).toBe(true);
  store.updateBlockData('db1', 'schema', model.snapshot().schema);
};

const seed = (clientA = 1, clientB = 2): [DocumentStore, DocumentStore] => {
  const storeA = createStore();
  const storeB = createStore();

  pinClientId(storeA, clientA);
  pinClientId(storeB, clientB);
  storeA.fromJSON([{ id: 'db1', type: 'database', data: { title: 'Tasks', schema: SCHEMA, views: [VIEW], activeViewId: 'v1' } }]);
  storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

  return [storeA, storeB];
};

const resolvedOf = (store: DocumentStore): ReturnType<typeof resolvePageLayout> => {
  const schema = schemaOf(store);

  return resolvePageLayout(pageLayoutOf(schema.find((p) => p.type === 'title')), schema.filter((p) => p.type !== 'title'));
};

describe('page layout — stored on the title property', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the layout on the title property, never in config or at the top level', () => {
    const model = new DatabaseModel({ schema: SCHEMA, views: [VIEW], activeViewId: 'v1' });

    model.setPageLayout(pin('p-due')(model.getPageLayout()));
    const saved = model.snapshot();

    expect(saved.schema.find((p) => p.type === 'title')).toMatchObject({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }] });
    expect(Object.keys(saved)).toEqual(['schema', 'views', 'activeViewId']);
    expect(saved.schema.find((p) => p.type === 'title')?.config).toBeUndefined();
  });

  it('survives an old client renaming the title property', () => {
    const model = new DatabaseModel({ schema: SCHEMA, views: [VIEW], activeViewId: 'v1' });

    model.setPageLayout(pin('p-due')(model.getPageLayout()));
    // v1.16.1's updateProperty sets name/config on the object in place and saves structuredClone(schema).
    const old = structuredClone(model.snapshot().schema);
    const title = old.find((p) => p.type === 'title');

    if (title === undefined) throw new Error('no title');
    title.name = 'Task';
    const reloaded = new DatabaseModel({ schema: old, views: [VIEW], activeViewId: 'v1' });

    expect(reloaded.getPageLayout().placements).toEqual([{ id: 'p-due', place: 'heading' }]);
  });

  it('bears the empty lists once and only once', () => {
    const model = new DatabaseModel({ schema: SCHEMA, views: [VIEW], activeViewId: 'v1' });

    expect(model.bearPageLayout()).toBe(true);
    expect(model.bearPageLayout()).toBe(false);
    expect(model.getSchema().find((p) => p.type === 'title')).toMatchObject({ pageLayoutPlacements: [], pageLayoutSections: [] });
  });

  it('removes the default scalars on reset', () => {
    const model = new DatabaseModel({ schema: SCHEMA, views: [VIEW], activeViewId: 'v1' });

    model.setPageLayout({ ...model.getPageLayout(), structure: 'tabbed', groupIn: 'panel' });
    model.setPageLayout(pageLayoutOf(undefined));
    const title = model.getSchema().find((p) => p.type === 'title');

    expect(title).not.toHaveProperty('pageLayoutStructure');
    expect(title).not.toHaveProperty('pageLayoutGroupIn');
  });
});

describe('page layout — two peers editing it', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps both first placements when two people edit a born layout at the same moment', () => {
    const [storeA, storeB] = seed();

    bear(storeA);
    sync(storeA, storeB);
    editLayout(storeA, pin('p-due'));
    editLayout(storeB, addSection('s1', 'People', []), moveToSection('p-owner', 's1'));
    sync(storeA, storeB);

    const onA = resolvedOf(storeA);

    expect(onA.heading.map((p) => p.id)).toEqual(['p-due']);
    expect(onA.sections.map((s) => [s.section.name, s.properties.map((p) => p.id)])).toEqual([['People', ['p-owner']]]);
    expect(resolvedOf(storeB)).toEqual(onA);
  });

  it('keeps both pins when two people pin different properties at the same moment', () => {
    const [storeA, storeB] = seed();

    bear(storeA);
    sync(storeA, storeB);
    editLayout(storeA, pin('p-due'));
    editLayout(storeB, pin('p-status'));
    sync(storeA, storeB);

    expect(resolvedOf(storeA).heading.map((p) => p.id).sort()).toEqual(['p-due', 'p-status']);
    expect(resolvedOf(storeB)).toEqual(resolvedOf(storeA));
  });

  it('keeps both sections when two people add one at the same moment', () => {
    const [storeA, storeB] = seed();

    bear(storeA);
    sync(storeA, storeB);
    editLayout(storeA, addSection('sa', 'Dates', []));
    editLayout(storeB, addSection('sb', 'People', []));
    sync(storeA, storeB);

    expect(resolvedOf(storeA).sections.map((s) => s.section.name).sort()).toEqual(['Dates', 'People']);
  });

  it('keeps both pins after the list was emptied again by an unpin and a reset', () => {
    const [storeA, storeB] = seed();

    bear(storeA);
    sync(storeA, storeB);
    editLayout(storeA, pin('p-owner'));
    sync(storeA, storeB);
    editLayout(storeA, removeFromLayout('p-owner'));
    sync(storeA, storeB);
    editLayout(storeA, pin('p-due'));
    editLayout(storeB, pin('p-status'));
    sync(storeA, storeB);

    expect(resolvedOf(storeA).heading.map((p) => p.id).sort()).toEqual(['p-due', 'p-status']);
    editLayout(storeA, resetPageLayout());
    sync(storeA, storeB);
    editLayout(storeA, pin('p-owner'));
    editLayout(storeB, pin('p-due'));
    sync(storeA, storeB);

    expect(resolvedOf(storeA).heading.map((p) => p.id).sort()).toEqual(['p-due', 'p-owner']);
    expect(resolvedOf(storeB)).toEqual(resolvedOf(storeA));
  });

  it('keeps a peer pin made while this person was drafting, when the draft is applied', () => {
    const [storeA, storeB] = seed();

    bear(storeA);
    sync(storeA, storeB);
    // A starts a draft before B's pin arrives; applying replays A's edits on the newest layout.
    const draft: PageLayoutOp[] = [pin('p-due')];

    editLayout(storeB, pin('p-status'));
    sync(storeA, storeB);
    editLayout(storeA, ...draft);
    sync(storeA, storeB);

    expect(resolvedOf(storeA).heading.map((p) => p.id)).toEqual(['p-status', 'p-due']);
  });

  it.each([
    ['the section writer has the lower client id', 1, 2],
    ['the section writer has the higher client id', 2, 1],
  ])('keeps a peer\'s pin made while the first section was being added (%s)', (_, clientA, clientB) => {
    const [storeA, storeB] = seed(clientA, clientB);
    const groupIds = SCHEMA.filter((p) => p.type !== 'title').map((p) => p.id);

    bear(storeA);
    sync(storeA, storeB);
    editLayout(storeA, addSection('s1', 'New section', groupIds));
    editLayout(storeB, pin('p-due'));
    sync(storeA, storeB);

    const onA = resolvedOf(storeA);

    expect(onA.heading.map((p) => p.id)).toEqual(['p-due']);
    expect(onA.sections.map((s) => [s.section.id, s.properties.map((p) => p.id)])).toEqual([['s1', ['p-status', 'p-owner']]]);
    expect(resolvedOf(storeB)).toEqual(onA);
  });

  it('keeps a peer\'s pin made while the first section sat in a draft, when the draft is applied', () => {
    const [storeA, storeB] = seed();
    const groupIds = SCHEMA.filter((p) => p.type !== 'title').map((p) => p.id);
    const draft: PageLayoutOp[] = [addSection('s1', 'New section', groupIds)];

    bear(storeA);
    sync(storeA, storeB);
    editLayout(storeB, pin('p-due'));
    sync(storeA, storeB);
    editLayout(storeA, ...draft);
    sync(storeA, storeB);

    expect(resolvedOf(storeA).heading.map((p) => p.id)).toEqual(['p-due']);
    expect(resolvedOf(storeA).sections.map((s) => s.properties.map((p) => p.id))).toEqual([['p-status', 'p-owner']]);
  });
});

