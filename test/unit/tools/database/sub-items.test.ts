import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { descendantsOf, nestRows, parentMap, relationPair, scopeSubItems } from '../../../../src/tools/database/sub-items';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'parent', name: 'Parent item', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db', limit: 1, twoWay: true, syncedPropertyId: 'subs', role: 'parentItem' } },
  { id: 'subs', name: 'Sub-items', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'parent', role: 'subItems' } },
];

const row = (id: string, parent?: string): DatabaseRow => ({ id, position: id, properties: parent === undefined ? {} : { parent: [{ id: parent }] } });

// a ─ b ─ c ; d alone
const rows = [row('a'), row('b', 'a'), row('c', 'b'), row('d')];

const view = (patch: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig =>
  ({ id: 'v', name: 'T', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...patch });

describe('sub-items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finds the pair by role, only on a self-relation', () => {
    expect(relationPair(schema, 'db', 'parentItem', 'subItems')).toEqual({ forward: 'parent', backward: 'subs' });
    expect(relationPair(schema, 'other', 'parentItem', 'subItems')).toBeUndefined();
  });

  it('maps each row to an existing parent, and breaks a loop two peers made', () => {
    const looped = [row('x', 'y'), row('y', 'x'), row('z', 'gone')];
    const map = parentMap(looped, 'parent');

    expect(map.get('z')).toBeUndefined();
    // One side of the loop keeps its parent, the other becomes a top-level item.
    expect([map.get('x'), map.get('y')].filter((p) => p !== undefined)).toHaveLength(1);
    expect(parentMap(rows, 'parent').get('c')).toBe('b');
  });

  it('lists every descendant once', () => {
    const looped = [row('x', 'y'), row('y', 'x')];

    expect(descendantsOf('a', rows, 'parent')).toEqual(['b', 'c']);
    expect(descendantsOf('x', looped, 'parent').length).toBeLessThanOrEqual(1);
  });

  it('scopes the rows a view shows', () => {
    const map = parentMap(rows, 'parent');
    const ids = (v: DatabaseViewConfig): string[] => scopeSubItems(rows, v, map).map((r) => r.id);

    expect(ids(view())).toEqual(['a', 'd']);
    expect(ids(view({ subItemsFilter: 'parentsAndSubItems' }))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(view({ subItemsFilter: 'subItems' }))).toEqual(['b', 'c']);
    // A board shows sub-items as a card property: parents only.
    expect(ids(view({ type: 'board', subItemsFilter: 'parentsAndSubItems' }))).toEqual(['a', 'd']);
    expect(ids(view({ type: 'board', subItemsDisplay: 'flattened', subItemsFilter: 'parentsAndSubItems' }))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('counts a chart and shows a feed with parents only, unless flattened', () => {
    const map = parentMap(rows, 'parent');
    const ids = (v: DatabaseViewConfig): string[] => scopeSubItems(rows, v, map).map((r) => r.id);

    expect(ids(view({ type: 'chart', subItemsFilter: 'parentsAndSubItems' }))).toEqual(['a', 'd']);
    expect(ids(view({ type: 'feed' }))).toEqual(['a', 'd']);
    expect(ids(view({ type: 'chart', subItemsDisplay: 'flattened', subItemsFilter: 'parentsAndSubItems' }))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('nests expanded children under their parent with a depth', () => {
    const map = parentMap(rows, 'parent');
    const nested = nestRows([rows[0], rows[3]], rows, map, view(), new Set(['a', 'b']));

    expect(nested.map((n) => [n.row.id, n.depth, n.hasChildren])).toEqual([['a', 0, true], ['b', 1, true], ['c', 2, false], ['d', 0, false]]);
  });

  it('keeps a collapsed parent closed', () => {
    const map = parentMap(rows, 'parent');

    expect(nestRows([rows[0], rows[3]], rows, map, view(), new Set()).map((n) => n.row.id)).toEqual(['a', 'd']);
  });

  it('shows a matching child at the top level when its parent is filtered out', () => {
    const map = parentMap(rows, 'parent');
    const shown = [rows[2], rows[3]];

    expect(nestRows(shown, rows, map, view({ subItemsFilter: 'parentsAndSubItems' }), new Set()).map((n) => [n.row.id, n.depth])).toEqual([['c', 0], ['d', 0]]);
  });
});
