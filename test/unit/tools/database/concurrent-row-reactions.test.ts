import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { DatabaseRowData, RowReactions } from '../../../../src/tools/database/types';
import { rowReactions } from '../../../../src/tools/database/row-reactions';
import type { API, BlockAPI, BlockToolConstructorOptions } from '../../../../types';

/**
 * Two peers reacting to the same feed card. Each write is what the row tool
 * saves, written as one key the way flushBlockDataWrites does.
 */

const createStore = (clientId: number): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());
  const doc = store.blocksMap.doc;

  if (doc === null) {
    throw new Error('DocumentStore has no Y.Doc');
  }
  doc.clientID = clientId;

  return store;
};

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const rowData = (store: DocumentStore): DatabaseRowData =>
  (store.toJSON().find((block) => block.id === 'row1')?.data ?? {}) as DatabaseRowData;

/**
 * The row tool as each peer has it, loaded from that peer's document. Writes
 * what flushBlockDataWrites writes: every top-level key the save emits, one
 * key at a time, and deletes a reaction key the save dropped.
 */
const react = (store: DocumentStore, userId: string, emoji: string, at: number | null): void => {
  const before = rowData(store);
  const tool = new DatabaseRowTool({
    data: before,
    config: {},
    api: {} as API,
    readOnly: false,
    block: { id: 'row1' } as BlockAPI,
  } as BlockToolConstructorOptions<DatabaseRowData>);

  tool.updateReaction({ userId, emoji, at });
  const saved = tool.save(document.createElement('div')) as Record<string, unknown>;

  Object.entries(saved).forEach(([key, value]) => store.updateBlockData('row1', key, value));
  Object.keys(before).filter((key) => !(key in saved)).forEach((key) => store.updateBlockData('row1', key, undefined));
};

const reactionsOf = (store: DocumentStore): RowReactions => rowReactions(rowData(store));

describe('database-row — two peers reacting to one card', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  const start = (reactions: RowReactions = {}): void => {
    const keys = Object.fromEntries(Object.entries(reactions).map(([userId, own]) => [`reactions:${userId}`, own]));

    storeA.fromJSON([{ id: 'row1', type: 'database-row', data: { position: 'a0', properties: { title: 'Post' }, ...keys } }]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storeA = createStore(1);
    storeB = createStore(2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps both reactions when two people react with the same emoji at once', () => {
    start({ u0: { '👍': 1 } });

    react(storeA, 'u1', '👍', 2);
    react(storeB, 'u2', '👍', 3);
    sync(storeA, storeB);

    expect(reactionsOf(storeA)).toEqual({ u0: { '👍': 1 }, u1: { '👍': 2 }, u2: { '👍': 3 } });
    expect(reactionsOf(storeB)).toEqual(reactionsOf(storeA));
  });

  it('keeps both reactions when two people add the same new emoji at once', () => {
    start({ u0: { '👍': 1 } });

    react(storeA, 'u1', '🎉', 2);
    react(storeB, 'u2', '🎉', 3);
    sync(storeA, storeB);

    expect(reactionsOf(storeA)).toEqual({ u0: { '👍': 1 }, u1: { '🎉': 2 }, u2: { '🎉': 3 } });
    expect(reactionsOf(storeB)).toEqual(reactionsOf(storeA));
  });

  it('keeps both reactions when two people give a row its very first reaction at once', () => {
    start();

    react(storeA, 'u1', '👍', 1);
    react(storeB, 'u2', '🎉', 2);
    sync(storeA, storeB);

    expect(reactionsOf(storeA)).toEqual({ u1: { '👍': 1 }, u2: { '🎉': 2 } });
    expect(reactionsOf(storeB)).toEqual(reactionsOf(storeA));
  });

  it('keeps a reaction added while someone else removes theirs', () => {
    start({ u1: { '👍': 1 }, u2: { '👍': 2 } });

    react(storeA, 'u1', '👍', null);
    react(storeB, 'u3', '👍', 3);
    sync(storeA, storeB);

    expect(reactionsOf(storeA)).toEqual({ u2: { '👍': 2 }, u3: { '👍': 3 } });
    expect(reactionsOf(storeB)).toEqual(reactionsOf(storeA));
  });

  it('keeps a reaction added while the last other reaction on the card is removed', () => {
    start({ u1: { '👍': 1 } });

    react(storeA, 'u1', '👍', null);
    react(storeB, 'u2', '🎉', 2);
    sync(storeA, storeB);

    expect(reactionsOf(storeA)).toEqual({ u2: { '🎉': 2 } });
    expect(reactionsOf(storeB)).toEqual(reactionsOf(storeA));
  });
});
