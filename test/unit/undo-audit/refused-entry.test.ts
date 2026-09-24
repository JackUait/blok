import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { YjsManager } from '../../../src/components/modules/yjs';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import { UndoHistory } from '../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../src/types-internal/blok-modules';

/**
 * A refused entry (a replace whose new block a peer wrote into) must never
 * cost the history an action or change its order.
 */

const createStore = (clientId: number): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());
  const doc = store.blocksMap.doc;

  if (doc !== null) {
    doc.clientID = clientId;
  }

  return store;
};

const paragraph = (id: string, text: string): { id: string; type: string; data: { text: string } } => ({
  id,
  type: 'paragraph',
  data: { text },
});

interface Peer {
  encodeStateAsUpdate(stateVector?: Uint8Array): Uint8Array;
  getStateVector(): Uint8Array;
  applyRemoteUpdate(update: Uint8Array): void;
}

/** Exchange diffs both ways, the way a provider does. */
const sync = (a: Peer, b: Peer): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

interface Readable {
  toJSON(): Array<{ id?: string; type?: string; data?: unknown }>;
}

const dataOf = (store: Readable, id: string): Record<string, unknown> =>
  (store.toJSON().find((block) => block.id === id)?.data ?? {}) as Record<string, unknown>;

const textOf = (store: Readable, id: string): string =>
  (dataOf(store, id).text as string | undefined) ?? '';

const idsOf = (store: Readable): string[] => store.toJSON().map((block) => block.id ?? '');

const createMockBlok = (): BlokModules => ({
  BlockManager: {
    currentBlock: undefined,
    getBlockById: vi.fn(),
    getBlockByChildNode: vi.fn(),
    blocks: [],
  } as unknown as BlokModules['BlockManager'],
  Caret: {
    setToBlock: vi.fn(),
    setToInput: vi.fn(),
    positions: { START: 'start',
      END: 'end',
      DEFAULT: 'default' },
  } as unknown as BlokModules['Caret'],
} as unknown as BlokModules);

describe('a refused replace keeps every other step', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;
  let historyA: UndoHistory;

  beforeEach(() => {
    vi.clearAllMocks();
    storeA = createStore(1);
    storeB = createStore(2);
    storeA.fromJSON([paragraph('b1', 'First'), paragraph('b2', 'Second')]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
    historyA = new UndoHistory(storeA.undoScope, createMockBlok());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redo does not replay the typing in a block whose replace is refused', () => {
    // S1: replace b2 by b3. S2: type in b3.
    storeA.removeBlock('b2');
    storeA.addBlock({ id: 'b3', type: 'quote', data: { text: '' } });
    historyA.stopCapturing();
    storeA.updateBlockData('b3', 'text', 'A typed');
    historyA.stopCapturing();
    sync(storeA, storeB);

    historyA.undo();
    historyA.undo();
    sync(storeA, storeB);
    expect(idsOf(storeA)).toEqual(['b1', 'b2']);

    storeB.updateBlockData('b2', 'text', 'Second by B');
    sync(storeA, storeB);

    historyA.redo();
    sync(storeA, storeB);

    expect(historyA.undoManager.redoStack).toHaveLength(2);
    expect(historyA.undoManager.undoStack).toHaveLength(0);
    expect(idsOf(storeA)).toEqual(['b1', 'b2']);
  });

  it('undo under a refused replace does not undo an older step and drop the one between', () => {
    storeA.updateBlockData('b1', 'text', 'First edit'); // S0
    historyA.stopCapturing();
    storeA.updateBlockData('b2', 'text', 'Second edit'); // S1
    historyA.stopCapturing();
    storeA.removeBlock('b2'); // S2: replace b2 by b3
    storeA.addBlock({ id: 'b3', type: 'quote', data: { text: '' } });
    historyA.stopCapturing();
    sync(storeA, storeB);
    storeB.updateBlockData('b3', 'text', 'Quoted by B');
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(textOf(storeA, 'b1')).toBe('First edit');
    expect(historyA.undoManager.undoStack).toHaveLength(3);
    expect(historyA.undoManager.redoStack).toHaveLength(0);
    expect(storeA.toJSON()).toEqual(storeB.toJSON());
  });
});

describe('a refused replace over a move', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('undo reaching past the replace undoes the move before the older edit', () => {
    const manager = new YjsManager({ config: {},
      eventsDispatcher: { on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn() } as unknown as YjsManager['eventsDispatcher'] });
    const peer = createStore(2);

    manager.fromJSON([paragraph('b1', 'one'), paragraph('b2', 'two'), paragraph('b3', 'three')]);
    peer.applyRemoteUpdate(manager.encodeStateAsUpdate());

    manager.updateBlockData('b1', 'text', 'one edited'); // S0
    manager.stopCapturing();
    manager.moveBlock('b3', 0); // M
    manager.stopCapturing();
    manager.removeBlock('b2'); // R: replace b2 by b4
    manager.addBlock({ id: 'b4', type: 'quote', data: { text: '' } });
    manager.stopCapturing();
    sync(manager, peer);
    peer.updateBlockData('b4', 'text', 'Quoted by B');
    sync(manager, peer);

    manager.undo();
    sync(manager, peer);

    expect(textOf(manager, 'b1')).toBe('one edited');
    expect(manager.orderedIds().indexOf('b3')).toBeGreaterThan(manager.orderedIds().indexOf('b1'));
    expect(manager.toJSON()).toEqual(peer.toJSON());
  });
});
