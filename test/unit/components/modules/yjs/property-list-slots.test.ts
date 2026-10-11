import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

/**
 * An empty array directly under a block's top-level `properties` map is
 * stored as an empty keyed container, so a database row's person, files or
 * relation list born `[]` merges its first adds by id. The rule follows the
 * key path only, never the property type.
 */
describe('list slots under a block\'s top-level properties map', () => {
  let serializer: YBlockSerializer;
  let store: DocumentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    serializer = new YBlockSerializer();
    store = new DocumentStore(serializer);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const dataMap = (id: string): Y.Map<unknown> => {
    const data = store.getBlockById(id)?.get('data');

    if (!(data instanceof Y.Map)) {
      throw new Error('expected a data map');
    }

    return data;
  };

  const nested = (map: Y.Map<unknown>, ...path: string[]): unknown =>
    path.reduce<unknown>((node, key) => (node instanceof Y.Map ? node.get(key) : undefined), map);

  it('stores an empty list under properties as an empty keyed container and reads it back as []', () => {
    store.fromJSON([{ id: 'r', type: 'database-row', data: { properties: { who: [], tags: ['a'], n: 1 } } }]);

    const who = nested(dataMap('r'), 'properties', 'who');

    expect(serializer.isGridMap(who)).toBe(true);
    expect(nested(dataMap('r'), 'properties', 'tags')).toEqual(['a']);
    expect(store.toJSON()[0].data).toEqual({ properties: { who: [], tags: ['a'], n: 1 } });
  });

  it('gives a properties map added later the same shape', () => {
    store.fromJSON([{ id: 'r', type: 'database-row', data: { position: 'a0' } }]);
    store.updateBlockData('r', 'properties', { who: [] });

    expect(serializer.isGridMap(nested(dataMap('r'), 'properties', 'who'))).toBe(true);
  });

  it('gives a list added to an existing properties map the same shape', () => {
    store.fromJSON([{ id: 'r', type: 'database-row', data: { properties: { n: 1 } } }]);
    store.updateBlockData('r', 'properties', { n: 1, who: [] });

    expect(serializer.isGridMap(nested(dataMap('r'), 'properties', 'who'))).toBe(true);
  });

  it('keeps the container when the list is cleared', () => {
    store.fromJSON([{ id: 'r', type: 'database-row', data: { properties: { who: [{ id: 'u1' }] } } }]);
    store.updateBlockData('r', 'properties', { who: [] });

    expect(serializer.isGridMap(nested(dataMap('r'), 'properties', 'who'))).toBe(true);
    expect(store.toJSON()[0].data).toEqual({ properties: { who: [] } });
  });

  it('leaves an empty array outside the top-level properties map a plain leaf', () => {
    store.fromJSON([{
      id: 'd',
      type: 'database',
      data: {
        other: { x: [] },
        views: [{ id: 'v1', properties: [] }],
        deep: { properties: { x: [] } },
        properties: { inner: { x: [] } },
      },
    }]);

    const data = dataMap('d');
    const views = data.get('views');
    const view = serializer.isGridMap(views) ? nested(views, '__rows', 'v1') : undefined;

    expect(nested(data, 'other', 'x')).toEqual([]);
    expect(view instanceof Y.Map ? view.get('properties') : undefined).toEqual([]);
    expect(nested(data, 'deep', 'properties', 'x')).toEqual([]);
    expect(nested(data, 'properties', 'inner', 'x')).toEqual([]);
  });

  it('keeps a filled multi-select a whole value over a list born empty', () => {
    store.fromJSON([{ id: 'r', type: 'database-row', data: { properties: { tags: [] } } }]);
    store.updateBlockData('r', 'properties', { tags: ['a', 'b'] });

    expect(nested(dataMap('r'), 'properties', 'tags')).toEqual(['a', 'b']);
  });
});
