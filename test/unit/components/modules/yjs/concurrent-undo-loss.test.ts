import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * Two peers, one document, one of them pressing undo.
 *
 * Every test here answers the same question: does undo (or redo) destroy
 * something the OTHER person authored, or leave the document in a state
 * neither person asked for? The loss assertion is always the first one.
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

const textOf = (store: DocumentStore, id: string): string =>
  (dataOf(store, id).text as string | undefined) ?? '';

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

describe('concurrent undo — data keys of a block the peer occupies', () => {
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

  /**
   * The block survives because the peer wrote in it. Everything else the block
   * needs to render must survive with it, or the peer is left staring at a
   * broken block.
   */
  it('keeps the image url when the inserting peer undoes and the other peer captioned it', () => {
    storeA.addBlock({ id: 'img',
      type: 'image',
      data: { url: 'https://example.com/a.png',
        caption: '' } });
    sync(storeA, storeB);

    storeB.updateBlockData('img', 'caption', 'Photo by B');
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(dataOf(storeB, 'img').url).toBe('https://example.com/a.png');
    expect(dataOf(storeB, 'img').caption).toBe('Photo by B');
    expect(blockOf(storeB, 'img')?.type).toBe('image');
  });

  it('keeps the heading level when the inserting peer undoes and the other peer typed the heading', () => {
    storeA.addBlock({ id: 'h',
      type: 'header',
      data: { text: '',
        level: 3 } });
    sync(storeA, storeB);

    storeB.updateBlockData('h', 'text', 'Typed by B');
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(dataOf(storeB, 'h').level).toBe(3);
    expect(textOf(storeB, 'h')).toBe('Typed by B');
  });

  /**
   * Turn-into is one action. Undoing it must either put the old tool back or
   * do nothing at all — never leave the new tool's name on the old tool's data.
   */
  it('puts the paragraph back when a conversion is undone and the other peer typed in the block', () => {
    storeB.updateBlockData('b1', 'text', 'First, from B');
    sync(storeA, storeB);

    storeA.replaceBlockContent('b1', 'header', { text: 'First, from B',
      level: 2 });
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(blockOf(storeB, 'b1')?.type).toBe('paragraph');
    expect(textOf(storeB, 'b1')).toBe('First, from B');
  });
});

describe('concurrent undo — undoing a delete the peer wrote into', () => {
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

  /**
   * A deletes a block at the same moment B is typing in it. The delete wins,
   * as CRDT deletes do — but the person who deleted it presses undo straight
   * away, and the block comes back. B's sentence must come back with it.
   */
  it('brings back the peer\'s concurrent typing when the delete is undone', () => {
    storeB.updateBlockData('b2', 'text', 'Second, typed by B');
    storeA.removeBlock('b2');

    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(textOf(storeB, 'b2')).toBe('Second, typed by B');
    expect(idsOf(storeB)).toContain('b2');
  });

  it('brings the deleted block back at all when the peer typed in it concurrently', () => {
    storeB.updateBlockData('b2', 'text', 'Second, typed by B');
    storeA.removeBlock('b2');

    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(idsOf(storeA)).toEqual(idsOf(storeB));
    expect(idsOf(storeA)).toContain('b2');
  });
});

describe('concurrent undo — one action that both deletes and inserts', () => {
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

  /**
   * A replace gesture is one undo entry holding a delete AND an insert. When
   * the peer writes into the inserted block, the insert half cannot be
   * unwound — but the delete half still is, so undo leaves BOTH the block the
   * gesture removed and the block it created.
   */
  it('does not leave both the removed block and its replacement after one undo', () => {
    storeA.removeBlock('b2');
    storeA.addBlock({ id: 'b3',
      type: 'quote',
      data: { text: '' } });
    sync(storeA, storeB);

    storeB.updateBlockData('b3', 'text', 'Quoted by B');
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(idsOf(storeB)).toEqual(['b1', 'b3']);
    expect(textOf(storeB, 'b3')).toBe('Quoted by B');
  });
});

describe('concurrent undo — redo replayed onto text the peer changed meanwhile', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;
  let historyA: UndoHistory;

  beforeEach(() => {
    vi.clearAllMocks();
    storeA = createStore(1);
    storeB = createStore(2);

    storeA.fromJSON([paragraph('b1', 'Hello world')]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    historyA = new UndoHistory(storeA.undoScope, createMockBlok());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the peer\'s characters when a deletion is redone over the region they typed in', () => {
    storeA.updateBlockData('b1', 'text', 'Hello ');
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);
    expect(textOf(storeA, 'b1')).toBe('Hello world');

    storeB.updateBlockData('b1', 'text', 'Hello wBBBorld');
    sync(storeA, storeB);

    historyA.redo();
    sync(storeA, storeB);

    expect(textOf(storeB, 'b1')).toContain('BBB');
    expect(textOf(storeA, 'b1')).toBe(textOf(storeB, 'b1'));
  });

  it('keeps the peer\'s new block when an insert is redone after a remote insert landed', () => {
    storeA.addBlock(paragraph('a2', 'From A'));
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    storeB.addBlock(paragraph('b2', 'From B'));
    sync(storeA, storeB);

    historyA.redo();
    sync(storeA, storeB);

    expect(idsOf(storeB)).toContain('b2');
    expect(textOf(storeB, 'b2')).toBe('From B');
    expect(idsOf(storeA)).toEqual(idsOf(storeB));
  });
});

describe('concurrent undo — both peers press undo at the same instant', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;
  let historyA: UndoHistory;
  let historyB: UndoHistory;

  beforeEach(() => {
    vi.clearAllMocks();
    storeA = createStore(1);
    storeB = createStore(2);

    storeA.fromJSON([paragraph('b1', 'Shared')]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    historyA = new UndoHistory(storeA.undoScope, createMockBlok());
    historyB = new UndoHistory(storeB.undoScope, createMockBlok());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes only each peer\'s own typing when both undo before the diffs are exchanged', () => {
    storeA.updateBlockData('b1', 'text', 'Shared AAA');
    storeB.updateBlockData('b1', 'text', 'Shared BBB');
    sync(storeA, storeB);

    historyA.undo();
    historyB.undo();
    sync(storeA, storeB);

    expect(textOf(storeA, 'b1')).toBe('Shared');
    expect(textOf(storeB, 'b1')).toBe('Shared');
  });

  it('keeps each peer\'s own new block when both undo their own insert at once', () => {
    storeA.addBlock(paragraph('a2', 'From A'));
    storeB.addBlock(paragraph('b2', 'From B'));
    sync(storeA, storeB);

    storeA.updateBlockData('b2', 'text', 'From B, plus A');
    storeB.updateBlockData('a2', 'text', 'From A, plus B');
    sync(storeA, storeB);

    historyA.undo();
    historyB.undo();
    sync(storeA, storeB);

    expect(storeA.toJSON()).toEqual(storeB.toJSON());
    expect(idsOf(storeA)).toContain('a2');
    expect(idsOf(storeA)).toContain('b2');
  });
});

describe('concurrent undo — the skipped action', () => {
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

  /**
   * One press must unwind ONE action. When the newest two cannot be unwound,
   * yjs keeps popping — so a single press can reach an action the user made
   * long before and never meant to touch.
   */
  it('unwinds one action per press, not every blocked action plus an older one', () => {
    storeA.updateBlockData('b1', 'text', 'First edit');
    historyA.stopCapturing();

    storeA.addBlock(paragraph('x1', ''));
    historyA.stopCapturing();

    storeA.addBlock(paragraph('x2', ''));
    sync(storeA, storeB);

    storeB.updateBlockData('x1', 'text', 'B in x1');
    storeB.updateBlockData('x2', 'text', 'B in x2');
    sync(storeA, storeB);

    historyA.undo();

    expect(textOf(storeA, 'b1')).toBe('First edit');
  });
});

describe('concurrent undo — undoing a move the peer moved away', () => {
  let manager: YjsManager;
  let peer: DocumentStore;

  const createYjsManager = (): YjsManager => {
    const eventsDispatcher = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as YjsManager['eventsDispatcher'];

    return new YjsManager({
      config: {},
      eventsDispatcher,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createYjsManager();
    peer = createStore(2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const syncPeerFromManager = (): void => {
    peer.applyRemoteUpdate(manager.encodeStateAsUpdate());
  };

  const applyPeerChangesToManager = (): void => {
    manager.applyRemoteUpdate(peer.encodeStateAsUpdate(manager.getStateVector()));
  };

  it('keeps the peer\'s text in the moved block when the mover undoes the move', () => {
    manager.fromJSON([paragraph('b1', 'one'), paragraph('b2', 'two'), paragraph('b3', 'three')]);
    syncPeerFromManager();

    manager.moveBlock('b3', 0);

    peer.updateBlockData('b3', 'text', 'three, typed by B');
    applyPeerChangesToManager();

    manager.undo();

    const moved = manager.toJSON().find((block) => block.id === 'b3');

    expect((moved?.data as { text?: string } | undefined)?.text).toBe('three, typed by B');
    expect(manager.toJSON().map((block) => block.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('does not put the block back where it was after the peer moved it somewhere else', () => {
    manager.fromJSON([paragraph('b1', 'one'), paragraph('b2', 'two'), paragraph('b3', 'three')]);
    syncPeerFromManager();

    manager.moveBlock('b3', 0);
    applyPeerChangesToManager();
    peer.applyRemoteUpdate(manager.encodeStateAsUpdate(peer.getStateVector()));

    peer.moveBlock('b3', 1);
    applyPeerChangesToManager();
    expect(manager.toJSON().map((block) => block.id)).toEqual(['b1', 'b3', 'b2']);

    manager.undo();

    expect(manager.toJSON().map((block) => block.id)).toEqual(['b1', 'b3', 'b2']);
  });
});

describe('concurrent undo — what happens to the action that could not be unwound', () => {
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

  /**
   * Nothing of the blocked action was applied, so it is still an action the
   * person took and may want back. Dropping it from the stack means they can
   * never unwind it — not even after the peer's content is gone.
   */
  it('keeps the blocked action on the undo stack instead of discarding it', () => {
    storeA.updateBlockData('b1', 'text', 'First edit');
    historyA.stopCapturing();

    storeA.addBlock(paragraph('x1', ''));
    sync(storeA, storeB);

    storeB.updateBlockData('x1', 'text', 'B in x1');
    sync(storeA, storeB);

    historyA.undo();

    expect(historyA.canUndo()).toBe(true);
  });
});

describe('concurrent undo — a repair write that must not be undoable', () => {
  let manager: YjsManager;

  const createYjsManager = (): YjsManager => {
    const eventsDispatcher = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as YjsManager['eventsDispatcher'];

    return new YjsManager({ config: {},
      eventsDispatcher });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createYjsManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves an untracked repair write alone when the tracked edit before it is undone', () => {
    manager.fromJSON([paragraph('b1', 'First')]);

    manager.updateBlockData('b1', 'text', 'First edit');
    manager.transactWithoutCapture(() => {
      manager.updateBlockData('b1', 'align', 'center');
    });

    manager.undo();

    const data = manager.toJSON().find((block) => block.id === 'b1')?.data as Record<string, unknown>;

    expect(data.align).toBe('center');
    expect(data.text).toBe('First');
  });
});

describe('concurrent undo — after a lineage reset', () => {
  let manager: YjsManager;
  let peer: DocumentStore;

  const createYjsManager = (): YjsManager => {
    const eventsDispatcher = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as YjsManager['eventsDispatcher'];

    return new YjsManager({ config: {},
      eventsDispatcher });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createYjsManager();
    peer = createStore(2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A reconnect swaps the whole document. The stack items recorded against the
   * old one name structs that no longer exist, so a press afterwards must not
   * reach into the fresh document the peer is now writing in.
   */
  it('does not touch the resynced document when undo is pressed after a reset', () => {
    manager.fromJSON([paragraph('b1', 'First')]);
    manager.addBlock(paragraph('b2', 'Second'));

    peer.applyRemoteUpdate(manager.encodeStateAsUpdate());
    peer.updateBlockData('b2', 'text', 'Second, typed by B');

    manager.resetForRelineage();
    manager.applyRemoteUpdate(peer.encodeStateAsUpdate());

    const before = manager.toJSON();

    manager.undo();

    expect(manager.toJSON()).toEqual(before);
  });
});
