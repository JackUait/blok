import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';
import { buildDatabase, makeDoc, rowSeed } from './structure-harness';
import { generateNKeysBetween } from '../../../../src/shared/database/fractional-index';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    show(): void {}

    hide(): void {}

    destroy(): void {}

    on(): void {}

    off(): void {}

    getElement(): HTMLElement {
      return document.createElement('div');
    }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverMobile: MockPopoverDesktop, PopoverItemType: { Default: 'default', Separator: 'separator', Html: 'html' } };
});

const pairSchema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'parent', name: 'Parent item', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db', limit: 1, twoWay: true, syncedPropertyId: 'subs', role: 'parentItem' } },
  { id: 'subs', name: 'Sub-items', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'parent', role: 'subItems' } },
];

const data = (schema: PropertyDefinition[] = pairSchema, type: 'table' | 'board' | 'list' = 'table'): DatabaseData => ({
  schema: structuredClone(schema),
  views: [{ id: 'v', name: 'View', type, position: 'a0', sorts: [], filters: [], visibleProperties: [], ...(type === 'board' ? { groupBy: 'title' } : {}) }],
  activeViewId: 'v',
});

const tree = (): ReturnType<typeof makeDoc> => makeDoc([
  { id: 'db', name: 'database', parentId: null, data: {} },
  rowSeed('a', 'db', { properties: { title: 'Parent', subs: [{ id: 'b' }] }, position: 'a0' }),
  rowSeed('b', 'db', { properties: { title: 'Child', parent: [{ id: 'a' }], subs: [{ id: 'c' }] }, position: 'a1' }),
  rowSeed('c', 'db', { properties: { title: 'Grandchild', parent: [{ id: 'b' }] }, position: 'a2' }),
  { id: 'c-body', name: 'paragraph', parentId: 'c', data: { text: 'deep' } },
  rowSeed('d', 'db', { properties: { title: 'Alone' }, position: 'a3' }),
]);

const shown = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('[data-blok-database-table-row]')].map((row) => row.getAttribute('data-row-id') ?? '');

const toggle = (el: HTMLElement, rowId: string): HTMLElement | null =>
  el.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-blok-database-subitem-toggle]`);

describe('DatabaseTool — sub-items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('turns sub-items on with a "Parent item" / "Sub-items" self-relation pair', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
    const { tool } = buildDatabase(doc, 'db', data([pairSchema[0]]));

    tool.setSubItemsEnabled(true);

    const schema = tool.save(document.createElement('div')).schema;
    const parent = schema.find((p) => p.relation?.role === 'parentItem');
    const subs = schema.find((p) => p.relation?.role === 'subItems');

    expect(parent).toMatchObject({ type: 'relation', relation: { targetDatabaseId: 'db', limit: 1, twoWay: true, syncedPropertyId: subs?.id } });
    expect(subs).toMatchObject({ type: 'relation', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: parent?.id } });
  });

  it('turning sub-items off keeps both relations and drops their roles', () => {
    const doc = tree();
    const { tool } = buildDatabase(doc, 'db', data());

    tool.setSubItemsEnabled(false);

    const schema = tool.save(document.createElement('div')).schema;

    expect(schema.filter((p) => p.type === 'relation')).toHaveLength(2);
    expect(schema.some((p) => p.relation?.role !== undefined)).toBe(false);
  });

  it('shows parents only, nested in a toggle that opens to the sub-items', () => {
    const doc = tree();
    const { el } = buildDatabase(doc, 'db', data());

    expect(shown(el)).toEqual(['a', 'd']);
    toggle(el, 'a')?.click();
    expect(shown(el)).toEqual(['a', 'b', 'd']);
    expect(el.querySelector('[data-blok-database-table-row][data-row-id="b"]')?.getAttribute('data-subitem-depth')).toBe('1');
    toggle(el, 'b')?.click();
    expect(shown(el)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('the toggle adds a sub-item to an open parent, both sides in one undo step', () => {
    const doc = tree();
    const { el } = buildDatabase(doc, 'db', data());

    toggle(el, 'd')?.click();
    doc.transact.mockClear();
    el.querySelector<HTMLElement>('[data-blok-database-add-subitem][data-parent-id="d"] button')?.click();

    expect(doc.transact).toHaveBeenCalled();
    const made = doc.childrenOf('db').find((id) => !['a', 'b', 'c', 'd'].includes(id)) ?? '';

    expect(doc.row(made).properties.parent).toEqual([{ id: 'd' }]);
    expect(doc.row('d').properties.subs).toEqual([{ id: made }]);
    expect(shown(el)).toEqual(['a', 'd', made]);
  });

  it('deleting a parent deletes its sub-items', () => {
    const doc = tree();
    const { tool } = buildDatabase(doc, 'db', data());

    (tool as unknown as { deleteTableRows: (ids: string[]) => void }).deleteTableRows(['a']);

    expect(doc.deleted).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(doc.deleted).not.toContain('d');
  });

  it('duplicating a parent duplicates its sub-items under the copy', () => {
    const doc = tree();
    const { tool } = buildDatabase(doc, 'db', data());

    doc.transact.mockClear();
    (tool as unknown as { duplicateTableRow: (id: string) => void }).duplicateTableRow('a');

    expect(doc.transact).toHaveBeenCalledTimes(1);
    const copies = doc.childrenOf('db').filter((id) => !['a', 'b', 'c', 'd'].includes(id));

    expect(copies).toHaveLength(3);
    const [copyA, copyB, copyC] = copies;

    expect(doc.row(copyA).properties.subs).toEqual([{ id: copyB }]);
    expect(doc.row(copyB).properties.parent).toEqual([{ id: copyA }]);
    expect(doc.row(copyC).properties.parent).toEqual([{ id: copyB }]);
    expect(doc.childrenOf(copyC).map((id) => doc.blocks.get(id)?.data)).toEqual([{ text: 'deep' }]);
    // The originals keep their tree.
    expect(doc.row('a').properties.subs).toEqual([{ id: 'b' }]);
  });

  describe('duplicating a parent with many sub-items keeps the copies\' keys short', () => {
    const kids = Array.from({ length: 40 }, (_, i) => `k${i}`);
    const kidKeys = generateNKeysBetween('a2', null, kids.length);
    const wide = (): ReturnType<typeof makeDoc> => makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('top', 'db', { properties: { title: 'Top', subs: kids.map((id) => ({ id })) }, position: 'a1' }),
      rowSeed('next', 'db', { properties: { title: 'Next' }, position: 'a2' }),
      ...kids.map((id, i) => rowSeed(id, 'db', { properties: { title: id, parent: [{ id: 'top' }] }, position: kidKeys[i] })),
    ]);
    const copiesOf = (doc: ReturnType<typeof makeDoc>): string[] =>
      doc.childrenOf('db').filter((id) => !['top', 'next', ...kids].includes(id));

    it('in the shared order', () => {
      const doc = wide();
      const { tool } = buildDatabase(doc, 'db', data());

      (tool as unknown as { duplicateTableRow: (id: string) => void }).duplicateTableRow('top');
      const keys = copiesOf(doc).map((id) => String(doc.row(id).position));

      expect(keys).toHaveLength(41);
      expect(keys.every((key) => key > 'a1' && key < 'a2')).toBe(true);
      expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(9);
    });

    it('in a view with its own order', () => {
      const doc = wide();
      const withOrder: DatabaseData = { ...data(), views: data().views.map((view) => ({ ...view, rowOrder: { top: 'a1', next: 'a2' } })) };
      const { tool } = buildDatabase(doc, 'db', withOrder);

      (tool as unknown as { duplicateTableRow: (id: string) => void }).duplicateTableRow('top');
      const order = (tool as unknown as { model: { getViews: () => Array<{ rowOrder?: Record<string, string> }> } }).model.getViews()[0].rowOrder ?? {};
      const keys = copiesOf(doc).map((id) => order[id]);

      expect(keys).toHaveLength(41);
      expect(keys.every((key) => key !== undefined && key > 'a1' && key < 'a2')).toBe(true);
      expect(Math.max(...keys.map((key) => key?.length ?? 0))).toBeLessThanOrEqual(9);
    });
  });

  it('duplicating a sub-item lists the copy under the same parent', () => {
    const doc = tree();
    const { tool } = buildDatabase(doc, 'db', data());

    (tool as unknown as { duplicateTableRow: (id: string) => void }).duplicateTableRow('b');

    const copies = doc.childrenOf('db').filter((id) => !['a', 'b', 'c', 'd'].includes(id));

    expect(doc.row(copies[0]).properties.parent).toEqual([{ id: 'a' }]);
    expect(doc.row('a').properties.subs).toEqual([{ id: 'b' }, { id: copies[0] }]);
  });

  it('a one-page Parent item keeps the other side to the parent it kept', () => {
    const doc = tree();
    const { tool } = buildDatabase(doc, 'db', data());

    (tool as unknown as { commitTableCell: (rowId: string, propertyId: string, value: unknown) => void })
      .commitTableCell('c', 'parent', [{ id: 'b' }, { id: 'd' }]);

    expect(doc.row('c').properties.parent).toEqual([{ id: 'd' }]);
    expect(doc.row('b').properties.subs).toEqual([]);
    expect(doc.row('d').properties.subs).toEqual([{ id: 'c' }]);
  });

  it('a one-page Parent item given two pages at once mirrors only the one it kept', () => {
    const doc = tree();
    const { tool } = buildDatabase(doc, 'db', data());

    (tool as unknown as { commitTableCell: (rowId: string, propertyId: string, value: unknown) => void })
      .commitTableCell('d', 'parent', [{ id: 'a' }, { id: 'b' }]);

    expect(doc.row('d').properties.parent).toEqual([{ id: 'b' }]);
    expect(doc.row('a').properties.subs).toEqual([{ id: 'b' }]);
    expect(doc.row('b').properties.subs).toEqual([{ id: 'c' }, { id: 'd' }]);
  });

  it('a list shows the whole tree, each sub-item one step in', () => {
    const doc = tree();
    const { el } = buildDatabase(doc, 'db', data(pairSchema, 'list'));
    const rows = [...el.querySelectorAll('[data-blok-database-list-row]')].map((r) => [r.getAttribute('data-row-id'), r.getAttribute('data-subitem-depth')]);

    expect(rows).toEqual([['a', null], ['b', '1'], ['c', '2'], ['d', null]]);
  });

  it('a feed shows parents only and never a template', () => {
    const seeded = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('a', 'db', { properties: { title: 'Parent' }, position: 'a0' }),
      rowSeed('b', 'db', { properties: { title: 'Child', parent: [{ id: 'a' }] }, position: 'a1' }),
      rowSeed('tpl', 'db', { properties: { title: 'Template' }, position: 'a2', template: true }),
    ]);
    const { el } = buildDatabase(seeded, 'db', { ...data(pairSchema), views: [{ id: 'v', name: 'Feed', type: 'feed', position: 'a0', sorts: [], filters: [], visibleProperties: [] }] });

    expect([...el.querySelectorAll('[data-blok-database-feed-card]')].map((c) => c.getAttribute('data-row-id'))).toEqual(['a']);
  });

  it('a board shows parents only', () => {
    const doc = tree();
    const { el } = buildDatabase(doc, 'db', data(pairSchema, 'board'));
    const cards = [...el.querySelectorAll('[data-blok-database-card][data-row-id], [data-blok-database-card] [data-row-id]')].map((c) => c.getAttribute('data-row-id'));

    expect(new Set(cards)).toEqual(new Set(['a', 'd']));
  });
});
