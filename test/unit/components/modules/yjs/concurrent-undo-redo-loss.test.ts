import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * Two peers, one document, one of them pressing Ctrl+Z or Ctrl+Shift+Z.
 *
 * Every test asks what disappears — content, or the ability to get content
 * back — that belongs to either person. The loss assertion is always first.
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

/** Exchange diffs both ways, the way a provider does. */
const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const blockOf = (store: DocumentStore, id: string): Record<string, unknown> | undefined =>
  store.toJSON().find((candidate) => candidate.id === id) as Record<string, unknown> | undefined;

const dataOf = (store: DocumentStore, id: string): Record<string, unknown> =>
  (blockOf(store, id)?.data ?? {}) as Record<string, unknown>;

const idsOf = (store: DocumentStore): string[] =>
  store.toJSON().map((block) => block.id ?? '');

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

const createYjsManager = (): YjsManager => {
  const eventsDispatcher = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as YjsManager['eventsDispatcher'];

  return new YjsManager({ config: {},
    eventsDispatcher });
};

/**
 * A block the peer wrote in is spared whole. Its PRIMITIVE data keys are
 * spared with it. Its shared-type keys — a list's items, a table's grid, the
 * text — are not, so the block survives as a husk and everything structured
 * inside it goes, including what the peer put there.
 */
describe('concurrent undo — the structured data of a block the undo spares', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;
  let historyA: UndoHistory;

  beforeEach(() => {
    vi.clearAllMocks();
    storeA = createStore(1);
    storeB = createStore(2);

    storeA.fromJSON([paragraph('b1', 'First')]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    historyA = new UndoHistory(storeA.undoScope, createMockBlok());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the list items when the inserting peer undoes and the other peer restyled the list', () => {
    storeA.addBlock({ id: 'l',
      type: 'list',
      data: { style: 'unordered',
        level: 2,
        items: [{ content: 'one' }, { content: 'two' }] } });
    sync(storeA, storeB);

    storeB.updateBlockData('l', 'style', 'ordered');
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(dataOf(storeB, 'l').items).toEqual([{ content: 'one' }, { content: 'two' }]);
    expect(dataOf(storeB, 'l').level).toBe(2);
    expect(idsOf(storeB)).toContain('l');
  });

  it('keeps the table cell the other peer typed readable when the inserting peer undoes', () => {
    storeA.addBlock({ id: 't',
      type: 'table',
      data: { withHeadings: false,
        content: [['a1', 'a2'], ['a3', 'a4']] } });
    sync(storeA, storeB);

    storeB.updateBlockData('t', 'content', [['a1', 'a2'], ['a3', 'B typed']]);
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(dataOf(storeB, 't').content).toEqual([['a1', 'a2'], ['a3', 'B typed']]);
  });
});

/**
 * Redo is the undo of an undo, so it needs the same protections. It has none
 * of them.
 */
describe('concurrent redo — the action the peer blocks', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;
  let historyA: UndoHistory;

  beforeEach(() => {
    vi.clearAllMocks();
    storeA = createStore(1);
    storeB = createStore(2);

    storeA.fromJSON([paragraph('b1', 'one'), paragraph('b2', 'two')]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    historyA = new UndoHistory(storeA.undoScope, createMockBlok());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The undo side already treats a blocked action as still-pending and puts it
   * back (`keepIfWaiting`). The redo side pops it, performs nothing
   * and throws it away, so the deletion can never be re-applied — not even
   * after the peer's content that blocked it is gone.
   */
  it('keeps the blocked action on the redo stack instead of discarding it', () => {
    storeA.removeBlock('b2');

    historyA.undo();
    sync(storeA, storeB);

    storeB.updateBlockData('b2', 'text', 'two, by B');
    sync(storeA, storeB);

    const [removal] = historyA.undoManager.redoStack;

    historyA.redo();

    expect(historyA.undoManager.redoStack).toEqual([removal]);
    // It cannot apply while B's text is in b2, so no press would do anything.
    expect(historyA.canRedo()).toBe(false);
  });

  /**
   * One gesture that removes a block and inserts its replacement. Undo already
   * refuses to half-apply such an entry — it would leave both the block and its
   * replacement in the document. Redo half-applies it happily.
   */
  it('does not leave both the removed block and its replacement after one redo', () => {
    storeA.transact(() => {
      storeA.removeBlock('b2');
      storeA.addBlock(paragraph('q', 'replacement'));
    }, 'local');

    historyA.undo();
    sync(storeA, storeB);

    storeB.updateBlockData('b2', 'text', 'two, by B');
    sync(storeA, storeB);

    historyA.redo();
    sync(storeA, storeB);

    expect(idsOf(storeB)).not.toEqual(expect.arrayContaining(['q', 'b2']));
  });
});

describe('concurrent redo — replaying a move the peer has since made their own', () => {
  let manager: YjsManager;
  let peer: DocumentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createYjsManager();
    peer = createStore(2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * `undo` refuses to replay a move the peer has overruled since
   * (`groupWasDisplacedSince`). `redo` replays blind, yanking the block out
   * from under them.
   */
  it('does not put the block back where this editor wanted it after the peer moved it', () => {
    manager.fromJSON([paragraph('b1', 'one'), paragraph('b2', 'two'), paragraph('b3', 'three')]);
    peer.applyRemoteUpdate(manager.encodeStateAsUpdate());

    manager.moveBlock('b3', 0);
    peer.applyRemoteUpdate(manager.encodeStateAsUpdate(peer.getStateVector()));

    manager.undo();
    peer.applyRemoteUpdate(manager.encodeStateAsUpdate(peer.getStateVector()));

    peer.moveBlock('b3', 1);
    manager.applyRemoteUpdate(peer.encodeStateAsUpdate(manager.getStateVector()));

    manager.redo();

    expect(manager.toJSON().map((block) => block.id)).toEqual(['b1', 'b3', 'b2']);
  });
});

describe('concurrent undo — a remote insert beside a block this editor moved', () => {
  let manager: YjsManager;
  let peer: DocumentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createYjsManager();
    peer = createStore(2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * `groupWasDisplacedSince` reads displacement off the preceding sibling, so
   * a peer merely INSERTING a block in front of the moved one reads as "the
   * peer moved it". The move is then never undone — and because `undo` returns
   * before it ever reaches the yjs branch, every action taken before the move
   * is unreachable too, for the rest of the session.
   */
  it('still undoes the edits made before the move', () => {
    manager.fromJSON([paragraph('b1', 'one'), paragraph('b2', 'two'), paragraph('b3', 'three')]);
    peer.applyRemoteUpdate(manager.encodeStateAsUpdate());

    manager.updateBlockData('b1', 'text', 'one edited by A');
    manager.stopCapturing();
    manager.moveBlock('b3', 0);
    peer.applyRemoteUpdate(manager.encodeStateAsUpdate(peer.getStateVector()));

    peer.addBlock(paragraph('nb', 'B new'), 0);
    manager.applyRemoteUpdate(peer.encodeStateAsUpdate(manager.getStateVector()));

    manager.undo();
    manager.undo();
    manager.undo();

    const b1 = manager.toJSON().find((block) => block.id === 'b1');

    expect((b1?.data as { text?: string } | undefined)?.text).toBe('one');
  });
});
