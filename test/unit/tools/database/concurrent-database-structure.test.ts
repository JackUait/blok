import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import type { ButtonAction, DatabaseRow, DatabaseViewConfig, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';
import { parentMap, relationPair } from '../../../../src/tools/database/sub-items';

/**
 * Concurrent edits to the Phase 6 structure fields: button actions, sub-item
 * and dependency settings, templates and linked databases.
 */

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

const dataOf = (store: DocumentStore, id: string): Record<string, unknown> =>
  (store.toJSON().find((block) => block.id === id)?.data ?? {});



const title: PropertyDefinition = { id: 'title', name: 'Name', type: 'title', position: 'a0' };
const view: DatabaseViewConfig = { id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] };

describe('database structure — two peers', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  const start = (blocks: Array<Record<string, unknown>>): void => {
    storeA.fromJSON(blocks as never);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  };

  const schemaOf = (store: DocumentStore): PropertyDefinition[] => (dataOf(store, 'db').schema ?? []) as PropertyDefinition[];

  beforeEach(() => {
    vi.clearAllMocks();
    storeA = createStore();
    storeB = createStore();
    pinClientId(storeA, 1);
    pinClientId(storeB, 2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps both actions when two peers add the first action of a new button at once', () => {
    const button: PropertyDefinition = { id: 'btn', name: 'Act', type: 'button', position: 'a1', button: { buttonActions: [] } };

    start([{ id: 'db', type: 'database', data: { schema: [title, button], views: [view], activeViewId: 'v' } }]);

    const add = (store: DocumentStore, action: ButtonAction): void => {
      store.updateBlockData('db', 'schema', [title, { ...button, button: { buttonActions: [action] } }]);
    };

    add(storeA, { id: 'x1', type: 'openPage' });
    add(storeB, { id: 'x2', type: 'callback', name: 'hook' });
    sync(storeA, storeB);

    const actions = (store: DocumentStore): string[] =>
      (schemaOf(store).find((p) => p.id === 'btn')?.button?.buttonActions ?? []).map((a) => a.id).sort();

    expect(actions(storeA)).toEqual(['x1', 'x2']);
    expect(actions(storeB)).toEqual(['x1', 'x2']);
  });

  it('keeps a label change and an added action made at once', () => {
    const button: PropertyDefinition = { id: 'btn', name: 'Act', type: 'button', position: 'a1', button: { label: 'Go', buttonActions: [{ id: 'x1', type: 'openPage' }] } };

    start([{ id: 'db', type: 'database', data: { schema: [title, button], views: [view], activeViewId: 'v' } }]);

    storeA.updateBlockData('db', 'schema', [title, { ...button, button: { label: 'Run', buttonActions: [{ id: 'x1', type: 'openPage' }] } }]);
    storeB.updateBlockData('db', 'schema', [title, { ...button, button: { label: 'Go', buttonActions: [{ id: 'x1', type: 'openPage' }, { id: 'x2', type: 'openPage', url: 'https://a.io' }] } }]);
    sync(storeA, storeB);

    const merged = schemaOf(storeA).find((p) => p.id === 'btn')?.button;

    expect(merged?.label).toBe('Run');
    expect(merged?.buttonActions?.map((a) => a.id)).toEqual(['x1', 'x2']);
    expect(schemaOf(storeB)).toEqual(schemaOf(storeA));
  });

  it('keeps a default template set while a peer locks the database', () => {
    start([{ id: 'db', type: 'database', data: { schema: [title], views: [view], activeViewId: 'v' } }]);

    storeA.updateBlockData('db', 'schema', [{ ...title, defaultTemplateId: 'tpl' }]);
    storeB.updateBlockData('db', 'schema', [{ ...title, databaseLocked: true }]);
    sync(storeA, storeB);

    expect(schemaOf(storeA)[0]).toMatchObject({ defaultTemplateId: 'tpl', databaseLocked: true });
    expect(schemaOf(storeB)).toEqual(schemaOf(storeA));
  });

  it('keeps a template rename and a new repeat schedule made at once', () => {
    start([
      { id: 'db', type: 'database', data: { schema: [title], views: [view], activeViewId: 'v' }, content: ['tpl'] },
      { id: 'tpl', type: 'database-row', parent: 'db', data: { position: 'a0', title: 'Standup', properties: { title: 'Standup' }, template: true } },
    ]);

    storeA.updateBlockData('tpl', 'title', 'Daily standup');
    storeB.updateBlockData('tpl', 'repeat', { frequency: 'daily', start: '2026-10-12T09:00:00.000Z' });
    sync(storeA, storeB);

    for (const store of [storeA, storeB]) {
      expect(dataOf(store, 'tpl')).toMatchObject({ title: 'Daily standup', template: true, repeat: { frequency: 'daily' } });
    }
  });

  it('keeps one lastRunAt when two clients run the same due template', () => {
    const repeat = { frequency: 'daily', start: '2026-10-01T09:00:00.000Z' };

    start([
      { id: 'db', type: 'database', data: { schema: [title], views: [view], activeViewId: 'v' }, content: ['tpl'] },
      { id: 'tpl', type: 'database-row', parent: 'db', data: { position: 'a0', properties: { title: 'Standup' }, template: true, repeat } },
    ]);

    storeA.updateBlockData('tpl', 'repeat', { ...repeat, lastRunAt: '2026-10-09T09:00:00.000Z' });
    storeB.updateBlockData('tpl', 'repeat', { ...repeat, lastRunAt: '2026-10-09T09:00:00.000Z' });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'tpl').repeat).toEqual({ ...repeat, lastRunAt: '2026-10-09T09:00:00.000Z' });
    expect(dataOf(storeB, 'tpl').repeat).toEqual(dataOf(storeA, 'tpl').repeat);
  });

  it('keeps a sub-item display and a filter scope set at once on one view', () => {
    start([{ id: 'db', type: 'database', data: { schema: [title], views: [view], activeViewId: 'v' } }]);

    storeA.updateBlockData('db', 'views', [{ ...view, subItemsDisplay: 'flattened' }]);
    storeB.updateBlockData('db', 'views', [{ ...view, subItemsFilter: 'subItems' }]);
    sync(storeA, storeB);

    const merged = (dataOf(storeA, 'db').views as DatabaseViewConfig[])[0];

    expect(merged).toMatchObject({ subItemsDisplay: 'flattened', subItemsFilter: 'subItems' });
    expect(dataOf(storeB, 'db').views).toEqual(dataOf(storeA, 'db').views);
  });

  it('keeps a date shifting rule and "Avoid weekends" set at once', () => {
    const blockedBy: PropertyDefinition = { id: 'bb', name: 'Blocked by', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db', role: 'blockedBy' }, dependency: { shift: 'none' } };

    start([{ id: 'db', type: 'database', data: { schema: [title, blockedBy], views: [view], activeViewId: 'v' } }]);

    storeA.updateBlockData('db', 'schema', [title, { ...blockedBy, dependency: { shift: 'maintain' } }]);
    storeB.updateBlockData('db', 'schema', [title, { ...blockedBy, dependency: { shift: 'none', avoidWeekends: true } }]);
    sync(storeA, storeB);

    expect(schemaOf(storeA)[1].dependency).toEqual({ shift: 'maintain', avoidWeekends: true });
    expect(schemaOf(storeB)).toEqual(schemaOf(storeA));
  });

  it('two peers turning sub-items on at once agree on one pair', () => {
    start([{ id: 'db', type: 'database', data: { schema: [title], views: [view], activeViewId: 'v' } }]);
    const pairOf = (suffix: string, position: string): PropertyDefinition[] => [
      { id: `p${suffix}`, name: 'Parent item', type: 'relation', position: `${position}0`, relation: { targetDatabaseId: 'db', limit: 1, twoWay: true, syncedPropertyId: `s${suffix}`, role: 'parentItem' } },
      { id: `s${suffix}`, name: 'Sub-items', type: 'relation', position: `${position}1`, relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: `p${suffix}`, role: 'subItems' } },
    ];

    storeA.updateBlockData('db', 'schema', [title, ...pairOf('A', 'b')]);
    storeB.updateBlockData('db', 'schema', [title, ...pairOf('B', 'c')]);
    sync(storeA, storeB);

    expect(relationPair(schemaOf(storeA), 'db', 'parentItem', 'subItems')).toEqual(relationPair(schemaOf(storeB), 'db', 'parentItem', 'subItems'));
    expect(relationPair(schemaOf(storeA), 'db', 'parentItem', 'subItems')).toBeDefined();
  });

  it('two peers moving one row under different parents settle on the same parent', () => {
    const rowOf = (id: string, parent?: string): Record<string, unknown> =>
      ({ id, type: 'database-row', parent: 'db', data: { position: id, properties: parent === undefined ? {} : { parent: [{ id: parent }] } } });

    start([
      { id: 'db', type: 'database', data: { schema: [title], views: [view], activeViewId: 'v' }, content: ['a', 'b', 'x'] },
      rowOf('a'), rowOf('b'), rowOf('x', 'a'),
    ]);

    storeA.updateBlockData('x', 'properties', { parent: [{ id: 'b' }] });
    storeB.updateBlockData('x', 'properties', { parent: [{ id: 'a' }, { id: 'c' }] });
    sync(storeA, storeB);

    const rowsOf = (store: DocumentStore): DatabaseRow[] => store.toJSON()
      .filter((block) => block.type === 'database-row')
      .map((block) => ({ id: String(block.id), position: String(block.id), properties: (block.data as { properties: Record<string, PropertyValue> }).properties }));

    expect(parentMap(rowsOf(storeA), 'parent').get('x')).toBe(parentMap(rowsOf(storeB), 'parent').get('x'));
  });

  it('keeps a linked database source and a view edit made at once', () => {
    start([{ id: 'linked', type: 'database', data: { schema: [title], views: [view], activeViewId: 'v', source: { databaseId: 'db' } } }]);

    storeA.updateBlockData('linked', 'views', [{ ...view, name: 'Mine' }]);
    storeB.updateBlockData('linked', 'title', 'Linked tasks');
    sync(storeA, storeB);

    expect(dataOf(storeA, 'linked')).toMatchObject({ source: { databaseId: 'db' }, title: 'Linked tasks' });
    expect(dataOf(storeB, 'linked')).toEqual(dataOf(storeA, 'linked'));
  });
});
