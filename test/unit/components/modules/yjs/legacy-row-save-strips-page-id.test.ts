import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { DatabaseRowTool } from '../../../../../src/tools/database-row';

/**
 * What a v1.15.2 client does to a moved database row, which the current
 * client must recover from (see docs/maintainers/offline-row-bodies.md).
 *
 * Modelled, not run: v1.15.2's row tool saves only `properties` and
 * `position`, and its full-save flush writes each saved key and then calls
 * `pruneBlockData(id, keep)` with no `seen` set. The current store's prune
 * without `seen` is that same code path.
 */
describe('a v1.15.2 save of a moved database row', () => {
  let oldClient: DocumentStore;
  let newClient: DocumentStore;

  const exchange = (): void => {
    const fromOld = oldClient.encodeStateAsUpdate(newClient.getStateVector());
    const fromNew = newClient.encodeStateAsUpdate(oldClient.getStateVector());

    newClient.applyRemoteUpdate(fromOld);
    oldClient.applyRemoteUpdate(fromNew);
  };

  const rowOf = (store: DocumentStore): Record<string, unknown> | undefined =>
    store.toJSON().find(block => block.id === 'row-1')?.data;

  /** v1.15.2 flush: write each saved key, then prune every other key. */
  const flushV1152Save = (store: DocumentStore, saved: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(saved)) {
      store.updateBlockData('row-1', key, value);
    }
    store.pruneBlockData('row-1', new Set(Object.keys(saved)));
  };

  beforeEach(() => {
    oldClient = new DocumentStore(new YBlockSerializer());
    newClient = new DocumentStore(new YBlockSerializer());
    newClient.addBlock({
      id: 'row-1',
      type: 'database-row',
      data: {
        properties: { 'prop-title': 'Row', 'prop-body': { blocks: [] } },
        position: 'a0',
        pageId: 'page-1',
      },
    });
    exchange();
  });

  afterEach(() => {
    oldClient.destroy();
    newClient.destroy();
  });

  it('removes pageId for every client when an old client changes the row', () => {
    flushV1152Save(oldClient, { properties: { 'prop-title': 'Renamed', 'prop-body': { blocks: [] } }, position: 'a0' });
    exchange();

    expect(rowOf(newClient)).not.toHaveProperty('pageId');
    expect(rowOf(oldClient)).not.toHaveProperty('pageId');
    expect(rowOf(newClient)?.properties).toMatchObject({ 'prop-title': 'Renamed' });
  });

  it('keeps pageId and a future key when the current row tool saves the row', () => {
    newClient.updateBlockData('row-1', 'futureKey', 'kept');
    const stored = rowOf(newClient);

    if (stored === undefined) throw new Error('row is missing');
    const tool = new DatabaseRowTool({
      data: { properties: { 'prop-title': 'Row' }, position: 'a0', ...stored },
      config: {},
      api: {} as never,
      readOnly: false,
      block: { id: 'row-1' } as never,
    });

    tool.updateProperties({ 'prop-title': 'Renamed' });
    flushV1152Save(newClient, { ...tool.save(document.createElement('div')) });
    exchange();

    expect(rowOf(oldClient)?.pageId).toBe('page-1');
    expect(rowOf(oldClient)?.futureKey).toBe('kept');
  });
});
