import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { GRID_ROWS_KEY, YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import type { DatabaseViewConfig, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';
import { withPropertySetting } from '../../../../src/tools/database/view-settings';

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

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-where', name: 'Where', type: 'place', position: 'a1' },
  { id: 'p-check', name: 'Verified', type: 'verification', position: 'a2' },
  { id: 'p-sum', name: 'Summary', type: 'text', position: 'a3' },
];

const formView: DatabaseViewConfig = {
  id: 'v1',
  name: 'Form',
  type: 'form',
  position: 'a0',
  sorts: [],
  filters: [],
  visibleProperties: [],
  properties: schema.map((p) => ({ id: p.id, visible: true })),
  form: {},
};

const viewsOf = (store: DocumentStore): DatabaseViewConfig[] => (dataOf(store, 'db1').views ?? []) as DatabaseViewConfig[];
const schemaOf = (store: DocumentStore): PropertyDefinition[] => (dataOf(store, 'db1').schema ?? []) as PropertyDefinition[];

/** Each peer writes the whole list, the way the database block saves. */
const editView = (store: DocumentStore, change: (view: DatabaseViewConfig) => Partial<DatabaseViewConfig>): void => {
  store.updateBlockData('db1', 'views', viewsOf(store).map((view) => ({ ...view, ...change(view) })));
};
const editProperty = (store: DocumentStore, id: string, change: Partial<PropertyDefinition>): void => {
  store.updateBlockData('db1', 'schema', schemaOf(store).map((p) => (p.id === id ? { ...p, ...change } : p)));
};

const seed = (): [DocumentStore, DocumentStore] => {
  const storeA = createStore();
  const storeB = createStore();

  pinClientId(storeA, 1);
  pinClientId(storeB, 2);
  storeA.fromJSON([
    { id: 'db1', type: 'database', data: { title: 'Intake', schema, views: [formView], activeViewId: 'v1' } },
    { id: 'row1', type: 'database-row', parent: 'db1', data: { position: 'a0', title: 'Row', properties: { 'p-title': 'Row' } } },
  ]);
  storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

  return [storeA, storeB];
};

const seedLegacyAtomicAutomationList = (
  storeA: DocumentStore,
  storeB: DocumentStore,
  list: 'definitions' | 'triggers' | 'actions'
): void => {
  const legacy = new Y.Doc();

  try {
    legacy.clientID = 3;
    Y.applyUpdate(legacy, storeA.encodeStateAsUpdate());
    const block = legacy.getMap<Y.Map<unknown>>('blocks').get('db1');
    const data = block?.get('data');
    const automations = data instanceof Y.Map ? data.get('automations') : undefined;

    if (!(automations instanceof Y.Map)) {
      throw new Error('Legacy fixture has no automations map');
    }

    let candidate: unknown = automations;

    if (list !== 'definitions') {
      const definitions = automations.get('definitions');
      const rows = definitions instanceof Y.Map ? definitions.get(GRID_ROWS_KEY) : undefined;

      candidate = rows instanceof Y.Map ? rows.get('auto-1') : undefined;
    }

    if (!(candidate instanceof Y.Map)) {
      throw new Error('Legacy fixture has no saved definition');
    }
    const target = candidate;

    // Raw Yjs keeps this seed atomic when new serializers mint wrappers.
    legacy.transact(() => target.set(list, []));
    const toA = Y.encodeStateAsUpdate(legacy, storeA.getStateVector());
    const toB = Y.encodeStateAsUpdate(legacy, storeB.getStateVector());

    storeA.applyRemoteUpdate(toA);
    storeB.applyRemoteUpdate(toB);
  } finally {
    legacy.destroy();
  }
};

describe('Tier 3 fields — two peers at once', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps both saved definitions first added to an empty automation list', () => {
    const [storeA, storeB] = seed();
    const first = {
      id: 'auto-a', name: 'First', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', triggers: [], actions: [],
    };
    const second = { ...first, id: 'auto-b', name: 'Second' };

    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [] });
    sync(storeA, storeB);
    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [first] });
    storeB.updateBlockData('db1', 'automations', { version: 1, definitions: [second] });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({
      version: 1, definitions: expect.arrayContaining([first, second]),
    });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
  });

  it('keeps both triggers first added to an empty list on one saved definition', () => {
    const [storeA, storeB] = seed();
    const definition = {
      id: 'auto-1', name: 'Draft', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', triggers: [], actions: [],
    };
    const first = { id: 'trigger-a', type: 'pageAdded' };
    const second = { id: 'trigger-b', type: 'propertyEdited', propertyId: 'p-sum' };

    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [definition] });
    sync(storeA, storeB);
    storeA.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, triggers: [first] }],
    });
    storeB.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, triggers: [second] }],
    });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({
      version: 1, definitions: [{ ...definition, triggers: expect.arrayContaining([first, second]) }],
    });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
  });

  it('keeps both actions first added to an empty list on one saved definition', () => {
    const [storeA, storeB] = seed();
    const definition = {
      id: 'auto-1', name: 'Draft', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', triggers: [], actions: [],
    };
    const first = {
      id: 'action-a', type: 'editProperty', target: 'triggerRow', propertyId: 'p-sum', value: 'first',
    };
    const second = {
      id: 'action-b', type: 'editProperty', target: 'triggerRow', propertyId: 'p-title', value: 'second',
    };

    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [definition] });
    sync(storeA, storeB);
    storeA.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, actions: [first] }],
    });
    storeB.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, actions: [second] }],
    });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({
      version: 1, definitions: [{ ...definition, actions: expect.arrayContaining([first, second]) }],
    });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
  });

  it('keeps a concurrent saved definition when another peer clears its keyed list', () => {
    const [storeA, storeB] = seed();
    const retired = {
      id: 'auto-old', name: 'Old', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', triggers: [], actions: [],
    };
    const added = { ...retired, id: 'auto-new', name: 'New' };

    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [retired] });
    sync(storeA, storeB);
    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [] });
    storeB.updateBlockData('db1', 'automations', { version: 1, definitions: [retired, added] });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({ version: 1, definitions: [added] });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
  });

  it('keeps a concurrent trigger when another peer clears its keyed list', () => {
    const [storeA, storeB] = seed();
    const definition = {
      id: 'auto-1', name: 'Draft', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', triggers: [], actions: [],
    };
    const retired = { id: 'trigger-old', type: 'pageAdded' };
    const added = { id: 'trigger-new', type: 'propertyEdited', propertyId: 'p-sum' };

    storeA.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, triggers: [retired] }],
    });
    sync(storeA, storeB);
    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [definition] });
    storeB.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, triggers: [retired, added] }],
    });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({
      version: 1, definitions: [{ ...definition, triggers: [added] }],
    });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
  });

  it('keeps a concurrent action when another peer clears its keyed list', () => {
    const [storeA, storeB] = seed();
    const definition = {
      id: 'auto-1', name: 'Draft', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', triggers: [], actions: [],
    };
    const retired = {
      id: 'action-old', type: 'editProperty', target: 'triggerRow', propertyId: 'p-sum', value: 'old',
    };
    const added = {
      id: 'action-new', type: 'editProperty', target: 'triggerRow', propertyId: 'p-title', value: '<b>new</b>',
    };

    storeA.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, actions: [retired] }],
    });
    sync(storeA, storeB);
    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [definition] });
    storeB.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, actions: [retired, added] }],
    });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({
      version: 1, definitions: [{ ...definition, actions: [added] }],
    });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
  });

  it('keeps both saved definitions readded after peers share a cleared keyed list', () => {
    const [storeA, storeB] = seed();
    const retired = {
      id: 'auto-old', name: 'Old', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', triggers: [], actions: [],
    };
    const first = { ...retired, id: 'auto-a', name: 'First' };
    const second = { ...retired, id: 'auto-b', name: 'Second' };

    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [retired] });
    sync(storeA, storeB);
    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [] });
    sync(storeA, storeB);
    const clearedA = dataOf(storeA, 'db1').automations;
    const clearedB = dataOf(storeB, 'db1').automations;

    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [first] });
    storeB.updateBlockData('db1', 'automations', { version: 1, definitions: [second] });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({
      version: 1, definitions: expect.arrayContaining([first, second]),
    });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
    expect(dataOf(storeA, 'db1').automations).toHaveProperty(['definitions', 'length'], 2);
    expect(clearedA).toEqual({ version: 1, definitions: [] });
    expect(clearedB).toEqual(clearedA);
  });

  it('keeps both triggers readded after peers share a cleared keyed list', () => {
    const [storeA, storeB] = seed();
    const definition = {
      id: 'auto-1', name: 'Draft', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', triggers: [], actions: [],
    };
    const retired = { id: 'trigger-old', type: 'pageAdded' };
    const first = { id: 'trigger-a', type: 'pageAdded' };
    const second = { id: 'trigger-b', type: 'propertyEdited', propertyId: 'p-sum' };

    storeA.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, triggers: [retired] }],
    });
    sync(storeA, storeB);
    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [definition] });
    sync(storeA, storeB);
    const clearedA = dataOf(storeA, 'db1').automations;
    const clearedB = dataOf(storeB, 'db1').automations;

    storeA.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, triggers: [first] }],
    });
    storeB.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, triggers: [second] }],
    });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({
      version: 1, definitions: [{ ...definition, triggers: expect.arrayContaining([first, second]) }],
    });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
    expect(dataOf(storeA, 'db1').automations).toHaveProperty(['definitions', 0, 'triggers', 'length'], 2);
    expect(clearedA).toEqual({ version: 1, definitions: [definition] });
    expect(clearedB).toEqual(clearedA);
  });

  it('keeps both actions readded after peers share a cleared keyed list', () => {
    const [storeA, storeB] = seed();
    const definition = {
      id: 'auto-1', name: 'Draft', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', triggers: [], actions: [],
    };
    const retired = {
      id: 'action-old', type: 'editProperty', target: 'triggerRow', propertyId: 'p-sum', value: 'old',
    };
    const first = {
      id: 'action-a', type: 'editProperty', target: 'triggerRow', propertyId: 'p-sum', value: '<b>first</b>',
    };
    const second = {
      id: 'action-b', type: 'editProperty', target: 'triggerRow', propertyId: 'p-title', value: '<i>second</i>',
    };

    storeA.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, actions: [retired] }],
    });
    sync(storeA, storeB);
    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [definition] });
    sync(storeA, storeB);
    const clearedA = dataOf(storeA, 'db1').automations;
    const clearedB = dataOf(storeB, 'db1').automations;

    storeA.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, actions: [first] }],
    });
    storeB.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, actions: [second] }],
    });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({
      version: 1, definitions: [{ ...definition, actions: expect.arrayContaining([first, second]) }],
    });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
    expect(dataOf(storeA, 'db1').automations).toHaveProperty(['definitions', 0, 'actions', 'length'], 2);
    expect(clearedA).toEqual({ version: 1, definitions: [definition] });
    expect(clearedB).toEqual(clearedA);
  });

  it('keeps both saved definitions when peers first create an absent automations object', () => {
    const [storeA, storeB] = seed();
    const first = {
      id: 'auto-a', name: 'First', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', triggers: [], actions: [],
    };
    const second = { ...first, id: 'auto-b', name: 'Second' };
    const beforeA = dataOf(storeA, 'db1');
    const beforeB = dataOf(storeB, 'db1');

    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [first] });
    storeB.updateBlockData('db1', 'automations', { version: 1, definitions: [second] });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({
      version: 1, definitions: expect.arrayContaining([first, second]),
    });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
    expect(dataOf(storeA, 'db1').automations).toHaveProperty(['definitions', 'length'], 2);
    expect(beforeA).not.toHaveProperty('automations');
    expect(beforeB).not.toHaveProperty('automations');
  });

  it('keeps both triggers when peers first create an absent key on an existing definition', () => {
    const [storeA, storeB] = seed();
    const definition = {
      id: 'auto-1', name: 'Draft', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', actions: [],
    };
    const first = { id: 'trigger-a', type: 'pageAdded' };
    const second = { id: 'trigger-b', type: 'propertyEdited', propertyId: 'p-sum' };

    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [definition] });
    sync(storeA, storeB);
    const beforeA = dataOf(storeA, 'db1').automations;
    const beforeB = dataOf(storeB, 'db1').automations;

    storeA.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, triggers: [first] }],
    });
    storeB.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, triggers: [second] }],
    });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({
      version: 1, definitions: [{ ...definition, triggers: expect.arrayContaining([first, second]) }],
    });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
    expect(dataOf(storeA, 'db1').automations).toHaveProperty(['definitions', 0, 'triggers', 'length'], 2);
    expect(beforeA).not.toHaveProperty(['definitions', 0, 'triggers']);
    expect(beforeB).not.toHaveProperty(['definitions', 0, 'triggers']);
  });

  it('keeps both actions when peers first create an absent key on an existing definition', () => {
    const [storeA, storeB] = seed();
    const definition = {
      id: 'auto-1', name: 'Draft', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', triggers: [],
    };
    const first = {
      id: 'action-a', type: 'editProperty', target: 'triggerRow', propertyId: 'p-sum', value: '<b>first</b>',
    };
    const second = {
      id: 'action-b', type: 'editProperty', target: 'triggerRow', propertyId: 'p-title', value: '<i>second</i>',
    };

    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [definition] });
    sync(storeA, storeB);
    const beforeA = dataOf(storeA, 'db1').automations;
    const beforeB = dataOf(storeB, 'db1').automations;

    storeA.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, actions: [first] }],
    });
    storeB.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, actions: [second] }],
    });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({
      version: 1, definitions: [{ ...definition, actions: expect.arrayContaining([first, second]) }],
    });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
    expect(dataOf(storeA, 'db1').automations).toHaveProperty(['definitions', 0, 'actions', 'length'], 2);
    expect(beforeA).not.toHaveProperty(['definitions', 0, 'actions']);
    expect(beforeB).not.toHaveProperty(['definitions', 0, 'actions']);
  });

  it('keeps both saved definitions first added to one shared legacy atomic empty list', () => {
    const [storeA, storeB] = seed();
    const first = {
      id: 'auto-a', name: 'First', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', triggers: [], actions: [],
    };
    const second = { ...first, id: 'auto-b', name: 'Second' };

    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [] });
    seedLegacyAtomicAutomationList(storeA, storeB, 'definitions');
    const seededA = dataOf(storeA, 'db1').automations;
    const seededB = dataOf(storeB, 'db1').automations;

    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [first] });
    storeB.updateBlockData('db1', 'automations', { version: 1, definitions: [second] });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({
      version: 1, definitions: expect.arrayContaining([first, second]),
    });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
    expect(dataOf(storeA, 'db1').automations).toHaveProperty(['definitions', 'length'], 2);
    expect(seededA).toEqual({ version: 1, definitions: [] });
    expect(seededB).toEqual(seededA);
  });

  it('keeps both triggers first added to one shared legacy atomic empty list', () => {
    const [storeA, storeB] = seed();
    const definition = {
      id: 'auto-1', name: 'Draft', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', triggers: [], actions: [],
    };
    const first = { id: 'trigger-a', type: 'pageAdded' };
    const second = { id: 'trigger-b', type: 'propertyEdited', propertyId: 'p-sum' };

    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [definition] });
    seedLegacyAtomicAutomationList(storeA, storeB, 'triggers');
    const seededA = dataOf(storeA, 'db1').automations;
    const seededB = dataOf(storeB, 'db1').automations;

    storeA.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, triggers: [first] }],
    });
    storeB.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, triggers: [second] }],
    });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({
      version: 1, definitions: [{ ...definition, triggers: expect.arrayContaining([first, second]) }],
    });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
    expect(dataOf(storeA, 'db1').automations).toHaveProperty(['definitions', 0, 'triggers', 'length'], 2);
    expect(seededA).toEqual({ version: 1, definitions: [definition] });
    expect(seededB).toEqual(seededA);
  });

  it('keeps both actions first added to one shared legacy atomic empty list', () => {
    const [storeA, storeB] = seed();
    const definition = {
      id: 'auto-1', name: 'Draft', status: 'paused', scope: { type: 'database' },
      triggerMode: 'any', triggers: [], actions: [],
    };
    const first = {
      id: 'action-a', type: 'editProperty', target: 'triggerRow', propertyId: 'p-sum', value: '<b>first</b>',
    };
    const second = {
      id: 'action-b', type: 'editProperty', target: 'triggerRow', propertyId: 'p-title', value: '<i>second</i>',
    };

    storeA.updateBlockData('db1', 'automations', { version: 1, definitions: [definition] });
    seedLegacyAtomicAutomationList(storeA, storeB, 'actions');
    const seededA = dataOf(storeA, 'db1').automations;
    const seededB = dataOf(storeB, 'db1').automations;

    storeA.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, actions: [first] }],
    });
    storeB.updateBlockData('db1', 'automations', {
      version: 1, definitions: [{ ...definition, actions: [second] }],
    });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'db1').automations).toEqual({
      version: 1, definitions: [{ ...definition, actions: expect.arrayContaining([first, second]) }],
    });
    expect(dataOf(storeB, 'db1').automations).toEqual(dataOf(storeA, 'db1').automations);
    expect(dataOf(storeA, 'db1').automations).toHaveProperty(['definitions', 0, 'actions', 'length'], 2);
    expect(seededA).toEqual({ version: 1, definitions: [definition] });
    expect(seededB).toEqual(seededA);
  });

  it('keeps both Required marks set on different questions', () => {
    const [storeA, storeB] = seed();

    editView(storeA, (view) => ({ properties: withPropertySetting(view, schema, 'p-where', { required: true }) }));
    editView(storeB, (view) => ({ properties: withPropertySetting(view, schema, 'p-sum', { required: true, description: 'Two lines' }) }));
    sync(storeA, storeB);

    for (const store of [storeA, storeB]) {
      const entries = viewsOf(store)[0].properties ?? [];

      expect(entries.find((e) => e.id === 'p-where')?.required).toBe(true);
      expect(entries.find((e) => e.id === 'p-sum')).toMatchObject({ required: true, description: 'Two lines' });
    }
  });

  it('keeps a form setting and a map setting written on one view at once', () => {
    const [storeA, storeB] = seed();

    editView(storeA, (view) => ({ form: { ...view.form, submitLabel: 'Send' } }));
    editView(storeB, () => ({ mapBy: 'p-where' }));
    sync(storeA, storeB);

    for (const store of [storeA, storeB]) {
      expect(viewsOf(store)[0].form?.submitLabel).toBe('Send');
      expect(viewsOf(store)[0].mapBy).toBe('p-where');
    }
  });

  it('keeps two different form settings written at once', () => {
    const [storeA, storeB] = seed();

    editView(storeA, (view) => ({ form: { ...view.form, closed: true } }));
    editView(storeB, (view) => ({ form: { ...view.form, confirmation: 'Thanks' } }));
    sync(storeA, storeB);

    for (const store of [storeA, storeB]) {
      expect(viewsOf(store)[0].form).toEqual({ closed: true, confirmation: 'Thanks' });
    }
  });

  it('keeps a calendar sync slot and a data source slot written on one view at once', () => {
    const [storeA, storeB] = seed();

    editView(storeA, () => ({ calendarSync: { enabled: true, calendarId: 'team' } }));
    editView(storeB, () => ({ dataSourceId: 'db2' }));
    sync(storeA, storeB);

    for (const store of [storeA, storeB]) {
      expect(viewsOf(store)[0]).toMatchObject({ calendarSync: { enabled: true, calendarId: 'team' }, dataSourceId: 'db2' });
    }
  });

  it('keeps a widget and a row two peers add to an existing dashboard', () => {
    const [storeA, storeB] = seed();

    editView(storeA, () => ({ dashboard: { rows: [{ id: 'r1', widgets: [] }] } }));
    sync(storeA, storeB);
    editView(storeA, (view) => ({ dashboard: { rows: (view.dashboard?.rows ?? []).map((row) => ({ ...row, widgets: [...row.widgets, { id: 'wa', viewId: 'v1', width: 6 }] })) } }));
    editView(storeB, (view) => ({ dashboard: { rows: [...(view.dashboard?.rows ?? []), { id: 'r2', widgets: [{ id: 'wb', viewId: 'v1', width: 12 }] }] } }));
    sync(storeA, storeB);
    const expected = {
      rows: [
        { id: 'r1', widgets: [{ id: 'wa', viewId: 'v1', width: 6 }] },
        { id: 'r2', widgets: [{ id: 'wb', viewId: 'v1', width: 12 }] },
      ],
    };

    expect(viewsOf(storeA)[0].dashboard).toEqual(expected);
    expect(viewsOf(storeB)[0].dashboard).toEqual(expected);
  });

  it('keeps an autofill setting and a rename of another property', () => {
    const [storeA, storeB] = seed();

    editProperty(storeA, 'p-sum', { autofill: { mode: 'summary', onCreate: true } });
    editProperty(storeB, 'p-where', { name: 'Office' });
    sync(storeA, storeB);

    for (const store of [storeA, storeB]) {
      expect(schemaOf(store).find((p) => p.id === 'p-sum')?.autofill).toEqual({ mode: 'summary', onCreate: true });
      expect(schemaOf(store).find((p) => p.id === 'p-where')?.name).toBe('Office');
    }
  });

  it('keeps a place and a verification written on one row at once', () => {
    const [storeA, storeB] = seed();
    const write = (store: DocumentStore, change: Record<string, PropertyValue>): void => {
      const properties = (dataOf(store, 'row1').properties ?? {}) as Record<string, PropertyValue>;

      store.updateBlockData('row1', 'properties', { ...properties, ...change });
    };

    write(storeA, { 'p-where': { address: '1 Main St', lat: 1, lon: 2 } });
    write(storeB, { 'p-check': { state: 'verified', verifiedBy: 'u2' } });
    sync(storeA, storeB);

    for (const store of [storeA, storeB]) {
      expect(dataOf(store, 'row1').properties).toMatchObject({
        'p-where': { address: '1 Main St', lat: 1, lon: 2 },
        'p-check': { state: 'verified', verifiedBy: 'u2' },
      });
    }
  });

  it('two people setting one place converge on one whole place, never a mix', () => {
    const [storeA, storeB] = seed();
    const write = (store: DocumentStore, place: PropertyValue): void => {
      const properties = (dataOf(store, 'row1').properties ?? {}) as Record<string, PropertyValue>;

      store.updateBlockData('row1', 'properties', { ...properties, 'p-where': place });
    };

    write(storeA, { address: 'Paris', lat: 48.8, lon: 2.3 });
    write(storeB, { address: 'Berlin', lat: 52.5, lon: 13.4 });
    sync(storeA, storeB);

    const a = (dataOf(storeA, 'row1').properties as Record<string, PropertyValue>)['p-where'];
    const b = (dataOf(storeB, 'row1').properties as Record<string, PropertyValue>)['p-where'];

    expect(a).toEqual(b);
    expect([{ address: 'Paris', lat: 48.8, lon: 2.3 }, { address: 'Berlin', lat: 52.5, lon: 13.4 }]).toContainEqual(a);
  });
});
