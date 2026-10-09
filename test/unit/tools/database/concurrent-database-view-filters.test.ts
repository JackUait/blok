import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
import { addFilterGroup, addFilterRule, countFilterRules } from '../../../../src/tools/database/filter-tree';
import { withGroupFlags } from '../../../../src/tools/database/view-data';
import type { ColorRule, DatabaseViewConfig, FilterGroup, FilterRule, PropertyDefinition } from '../../../../src/tools/database/types';

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

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-num', name: 'Amount', type: 'number', position: 'a1' },
];

const viewsOf = (store: DocumentStore): DatabaseViewConfig[] =>
  ((store.toJSON().find((block) => block.id === 'db1')?.data ?? {}).views ?? []) as DatabaseViewConfig[];

const bornView = (): DatabaseViewConfig => {
  const model = new DatabaseModel({ schema, views: [], activeViewId: '' }, { defaultViewType: 'table', idSeed: 'db1' });

  return model.getViews()[0];
};

const edit = (store: DocumentStore, change: (view: DatabaseViewConfig) => Partial<DatabaseViewConfig>): void => {
  store.updateBlockData('db1', 'views', viewsOf(store).map((view) => ({ ...view, ...change(view) })));
};

const seed = (view: DatabaseViewConfig): [DocumentStore, DocumentStore] => {
  const storeA = createStore();
  const storeB = createStore();

  pinClientId(storeA, 1);
  pinClientId(storeB, 2);
  storeA.fromJSON([{ id: 'db1', type: 'database', data: { title: 'Tasks', schema, views: [view], activeViewId: view.id } }]);
  storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

  return [storeA, storeB];
};

const tree = (view: DatabaseViewConfig): FilterGroup => {
  if (view.filterTree === undefined) {
    throw new Error('view has no filter tree');
  }

  return view.filterTree;
};

const rule = (id: string, value: number): FilterRule =>
  ({ id, propertyId: 'p-num', operator: 'greater_than', value });

describe('database view filters — two peers editing one view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('births a view with an empty advanced filter and color rules', () => {
    const view = bornView();

    expect(view.filterTree).toEqual({ id: `${view.id}-filters`, conjunction: 'and', filterRules: [] });
    expect(view.colorRules).toEqual([]);
    expect(view).not.toHaveProperty('groupStates');
  });

  it('keeps both rules when two people add the first rule to the same group', () => {
    const [storeA, storeB] = seed(bornView());

    edit(storeA, (view) => ({ filterTree: addFilterRule(tree(view), tree(view).id, rule('ra', 1)) }));
    edit(storeB, (view) => ({ filterTree: addFilterRule(tree(view), tree(view).id, rule('rb', 2)) }));
    sync(storeA, storeB);

    expect(tree(viewsOf(storeA)[0]).filterRules.map((r) => r.id).sort()).toEqual(['ra', 'rb']);
    expect(viewsOf(storeB)[0]).toEqual(viewsOf(storeA)[0]);
  });

  it('keeps both rules when two people add to the same nested group', () => {
    const [storeA, storeB] = seed(bornView());
    const nested: FilterGroup = { id: 'g2', conjunction: 'or', filterRules: [] };

    edit(storeA, (view) => ({ filterTree: addFilterGroup(tree(view), tree(view).id, nested) }));
    sync(storeA, storeB);
    edit(storeA, (view) => ({ filterTree: addFilterRule(tree(view), 'g2', rule('ra', 1)) }));
    edit(storeB, (view) => ({ filterTree: addFilterRule(tree(view), 'g2', rule('rb', 2)) }));
    sync(storeA, storeB);

    expect(countFilterRules(tree(viewsOf(storeA)[0]))).toBe(2);
    expect(viewsOf(storeB)[0]).toEqual(viewsOf(storeA)[0]);
  });

  it('keeps both color rules added at the same moment', () => {
    const [storeA, storeB] = seed(bornView());
    const color = (id: string): ColorRule => ({ id, propertyId: 'p-num', operator: 'is_not_empty', value: null, color: 'green' });

    edit(storeA, (view) => ({ colorRules: [...(view.colorRules ?? []), color('ca')] }));
    edit(storeB, (view) => ({ colorRules: [...(view.colorRules ?? []), color('cb')] }));
    sync(storeA, storeB);

    expect((viewsOf(storeA)[0].colorRules ?? []).map((r) => r.id).sort()).toEqual(['ca', 'cb']);
  });

  it('keeps both hidden groups when two people hide different groups', () => {
    const [storeA, storeB] = seed(bornView());

    edit(storeA, (view) => withGroupFlags(view, ['k1'], { hidden: true }));
    edit(storeB, (view) => withGroupFlags(view, ['k2'], { hidden: true }));
    sync(storeA, storeB);

    expect((viewsOf(storeA)[0].hiddenGroups ?? []).map((group) => group.id).sort()).toEqual(['k1', 'k2']);
  });

  it('keeps both group settings set at the same moment', () => {
    const [storeA, storeB] = seed(bornView());

    edit(storeA, (view) => ({ groupSettings: { ...view.groupSettings, hideEmptyGroups: true } }));
    edit(storeB, (view) => ({ groupSettings: { ...view.groupSettings, dateBy: 'week' } }));
    edit(storeA, (view) => ({ subGroupSettings: { ...view.subGroupSettings, sort: 'descending' } }));
    edit(storeB, (view) => ({ subGroupSettings: { ...view.subGroupSettings, textBy: 'alphabet' } }));
    sync(storeA, storeB);

    expect(viewsOf(storeA)[0].groupSettings).toEqual({ hideEmptyGroups: true, dateBy: 'week' });
    expect(viewsOf(storeA)[0].subGroupSettings).toEqual({ sort: 'descending', textBy: 'alphabet' });
    expect(viewsOf(storeB)[0]).toEqual(viewsOf(storeA)[0]);
  });

  it('keeps both simple filters added at the same moment', () => {
    const [storeA, storeB] = seed(bornView());

    edit(storeA, (view) => ({ filters: [...view.filters, { id: 'fa', propertyId: 'p-num', operator: 'is_empty', value: null }] }));
    edit(storeB, (view) => ({ filters: [...view.filters, { id: 'fb', propertyId: 'p-title', operator: 'is_empty', value: null }] }));
    sync(storeA, storeB);

    expect(viewsOf(storeA)[0].filters.map((f) => f.id).sort()).toEqual(['fa', 'fb']);
  });
});
