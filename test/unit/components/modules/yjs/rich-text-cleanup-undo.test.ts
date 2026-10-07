import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * yjs's format cleanup and undo on formatted rich text (`Y.XmlText`), through
 * the real `DocumentStore` write path and the real `UndoHistory` (its
 * `mayUndoDelete` filter included). Every case runs in both client-ID orders,
 * because yjs breaks ties by client ID.
 */

const ORDERS = [
  [1, 2],
  [2, 1],
] as const;

const SENTENCE = 'The quick brown fox jumps';

const createStore = (clientId: number): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());
  const doc = store.blocksMap.doc;

  if (doc !== null) {
    doc.clientID = clientId;
  }

  return store;
};

/** Two peers holding one paragraph `p1`. The load is not an undo step. */
const peers = (ownId: number, peerId: number, text: string): { a: DocumentStore; b: DocumentStore } => {
  const a = createStore(ownId);
  const b = createStore(peerId);

  a.fromJSON([{ id: 'p1', type: 'paragraph', data: { text } }]);
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a, b };
};

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const liveText = (store: DocumentStore, id = 'p1'): Y.XmlText =>
  (store.getBlockById(id)?.get('data') as Y.Map<unknown>).get('text') as Y.XmlText;

const deltaOf = (store: DocumentStore, id = 'p1'): unknown => liveText(store, id).toDelta();

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
    positions: { START: 'start', END: 'end', DEFAULT: 'default' },
  } as unknown as BlokModules['Caret'],
} as unknown as BlokModules);

/**
 * The scenario that makes yjs run a cleanup that changes the doc: this editor
 * bolds "uic" while a peer deletes "quick brown". On receiving the deletion,
 * the bold's format items are left with nothing between them, and yjs deletes
 * them in a transaction with origin `null` (on this editor only).
 */
const BOLD_INSIDE = 'The q<b>uic</b>k brown fox jumps';
const PEER_DELETES = 'The  fox jumps';

describe('yjs format cleanup on rich text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(ORDERS)('is sent once and the exchange settles (ids %i/%i)', (ownId, peerId) => {
    const { a, b } = peers(ownId, peerId, SENTENCE);
    const outbox = new Map<DocumentStore, Uint8Array[]>([[a, []], [b, []]]);
    const nullOriginSends: string[] = [];

    for (const [name, store] of [['a', a], ['b', b]] as const) {
      store.onUpdate((update, origin) => {
        outbox.get(store)?.push(update);

        if (origin === null) {
          nullOriginSends.push(name);
        }
      });
    }

    a.updateBlockData('p1', 'text', BOLD_INSIDE);
    b.updateBlockData('p1', 'text', PEER_DELETES);

    // Relay like a provider until nothing is left to send.
    let rounds = 0;

    while ((outbox.get(a)?.length ?? 0) + (outbox.get(b)?.length ?? 0) > 0 && rounds < 10) {
      rounds++;
      for (const [from, to] of [[a, b], [b, a]] as const) {
        const pending = outbox.get(from)?.splice(0) ?? [];

        pending.forEach((update) => to.applyRemoteUpdate(update));
      }
    }

    expect(nullOriginSends).toEqual(['a']);
    expect(rounds).toBeLessThan(10);
    expect(new YBlockSerializer().readRichText(liveText(a))).toEqual([{ text: 'The  fox jumps' }]);
    expect(deltaOf(b)).toEqual(deltaOf(a));
  });

  it.each(ORDERS)('changes no segments (ids %i/%i)', (ownId, peerId) => {
    const { a, b } = peers(ownId, peerId, SENTENCE);
    const serializer = new YBlockSerializer();
    const seen: Array<{ origin: string; segments: unknown }> = [];

    a.updateBlockData('p1', 'text', BOLD_INSIDE);
    b.updateBlockData('p1', 'text', PEER_DELETES);
    a.blocksMap.doc?.on('afterTransaction', (transaction: Y.Transaction) => {
      if (transaction.changed.size > 0) {
        seen.push({
          origin: transaction.origin === null ? 'null' : 'remote',
          segments: serializer.readRichText(liveText(a)),
        });
      }
    });
    a.applyRemoteUpdate(b.encodeStateAsUpdate(a.getStateVector()));

    expect(seen.map((entry) => entry.origin)).toEqual(['remote', 'null']);
    expect(seen[1].segments).toEqual(seen[0].segments);
  });

  const SCENARIOS: Array<[string, string, string, string]> = [
    ['overlapping bold', SENTENCE, 'The <b>quick brown</b> fox jumps', 'The quick <b>brown fox</b> jumps'],
    ['bold vs unbold', `<b>${SENTENCE}</b>`, '<b>The </b>quick brown<b> fox jumps</b>', '<b>The quick </b>brown fox<b> jumps</b>'],
    ['delete a bold run vs type inside it', 'The <b>quick</b> fox', 'The  fox', 'The <b>quXick</b> fox'],
    ['overlapping links', SENTENCE, 'The <a href="https://a.b">quick brown</a> fox jumps', 'The quick <a href="https://c.d">brown fox</a> jumps'],
    ['delete vs format inside', SENTENCE, PEER_DELETES, BOLD_INSIDE],
    ['bold vs italic', SENTENCE, 'The <b>quick brown</b> fox jumps', 'The quick <i>brown fox</i> jumps'],
  ];

  // Reading `YTextEvent.delta` in an observer makes yjs delete redundant
  // format items in a null-origin transaction. Blok maps that cleanup to 'local' and
  // does not rerender, so those deletions must never change segments.
  it.each(ORDERS)('null-origin format deletions never change segments (ids %i/%i)', (ownId, peerId) => {
    const serializer = new YBlockSerializer();
    let changingNullTransactions = 0;
    let deltaOps = 0;

    const run = (start: string, mine: string, theirs: string, readDelta: boolean): unknown[] => {
      const { a, b } = peers(ownId, peerId, start);

      if (readDelta) {
        for (const store of [a, b]) {
          store.blocksMap.observeDeep((events) => events.forEach((event) => {
            if (event instanceof Y.YTextEvent) {
              deltaOps += event.delta.length;
            }
          }));
          store.blocksMap.doc?.on('afterTransaction', (transaction: Y.Transaction) => {
            if (transaction.origin === null && transaction.deleteSet.clients.size > 0) {
              changingNullTransactions++;
            }
          });
        }
      }

      a.updateBlockData('p1', 'text', mine);
      b.updateBlockData('p1', 'text', theirs);
      sync(a, b);
      sync(a, b);

      return [serializer.readRichText(liveText(a)), serializer.readRichText(liveText(b))];
    };

    for (const [name, start, mine, theirs] of SCENARIOS) {
      const plain = run(start, mine, theirs, false);

      expect(plain[1], name).toEqual(plain[0]);
      expect(run(start, mine, theirs, true), name).toEqual(plain);
    }
    // Guard: the delta reads really produced deleting cleanups.
    expect(deltaOps).toBeGreaterThan(0);
    expect(changingNullTransactions).toBeGreaterThan(0);
  });

  it.each(ORDERS)('adds no undo step (ids %i/%i)', (ownId, peerId) => {
    const { a, b } = peers(ownId, peerId, SENTENCE);
    const history = new UndoHistory(a.undoScope, createMockBlok());

    a.updateBlockData('p1', 'text', `${SENTENCE} today`);
    history.stopCapturing();
    a.updateBlockData('p1', 'text', `${BOLD_INSIDE} today`);
    history.stopCapturing();

    const stepsBefore = history.undoManager.undoStack.length;

    b.updateBlockData('p1', 'text', PEER_DELETES);
    sync(a, b);

    expect(history.undoManager.undoStack.length).toBe(stepsBefore);

    // The first press takes the bold step. Its text is gone (the peer deleted
    // it), so nothing visible changes; the second press takes " today".
    history.undo();
    expect(deltaOf(a)).toEqual([{ insert: 'The  fox jumps today' }]);
    history.undo();
    expect(deltaOf(a)).toEqual([{ insert: 'The  fox jumps' }]);
  });
});

describe('undo of formatting on rich text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('undo removes a bold toggle and redo restores it', () => {
    const store = createStore(1);
    const history = new UndoHistory(store.undoScope, createMockBlok());

    store.fromJSON([{ id: 'p1', type: 'paragraph', data: { text: 'Hello brave world' } }]);
    store.updateBlockData('p1', 'text', 'Hello <b>brave</b> world');
    history.stopCapturing();

    history.undo();
    expect(deltaOf(store)).toEqual([{ insert: 'Hello brave world' }]);

    history.redo();
    expect(deltaOf(store)).toEqual([
      { insert: 'Hello ' },
      { insert: 'brave', attributes: { bold: true } },
      { insert: ' world' },
    ]);
  });

  // A peer's characters make the block "peer-occupied", which is what makes
  // `mayUndoDelete` spare things. Format items must still be undoable there.
  it.each(ORDERS)('undo and redo a bold toggle in a paragraph a peer typed in (ids %i/%i)', (ownId, peerId) => {
    const { a, b } = peers(ownId, peerId, 'Hello world');
    const history = new UndoHistory(a.undoScope, createMockBlok());

    b.updateBlockData('p1', 'text', 'Hello brave world');
    sync(a, b);
    a.updateBlockData('p1', 'text', 'Hello <b>brave</b> world');
    history.stopCapturing();
    sync(a, b);

    history.undo();
    sync(a, b);
    expect(deltaOf(a)).toEqual([{ insert: 'Hello brave world' }]);
    expect(deltaOf(b)).toEqual(deltaOf(a));

    history.redo();
    sync(a, b);
    expect(deltaOf(a)).toEqual([
      { insert: 'Hello ' },
      { insert: 'brave', attributes: { bold: true } },
      { insert: ' world' },
    ]);
    expect(deltaOf(b)).toEqual(deltaOf(a));
  });

  it.each(ORDERS)('undo of my bold gives back the peer\'s overlapping bold (ids %i/%i)', (ownId, peerId) => {
    const { a, b } = peers(ownId, peerId, SENTENCE);
    const history = new UndoHistory(a.undoScope, createMockBlok());

    a.updateBlockData('p1', 'text', 'The <b>quick brown</b> fox jumps');
    history.stopCapturing();
    b.updateBlockData('p1', 'text', 'The quick <b>brown fox</b> jumps');
    sync(a, b);

    history.undo();
    sync(a, b);

    expect(deltaOf(a)).toEqual([
      { insert: 'The quick ' },
      { insert: 'brown fox', attributes: { bold: true } },
      { insert: ' jumps' },
    ]);
    expect(deltaOf(b)).toEqual(deltaOf(a));
  });
});

describe('rich text known losses (accepted limitations)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(ORDERS)('KNOWN LOSS: overlapping same-key formatting keeps one side (ids %i/%i)', (ownId, peerId) => {
    const { a, b } = peers(ownId, peerId, SENTENCE);

    a.updateBlockData('p1', 'text', 'The <b>quick brown</b> fox jumps');
    b.updateBlockData('p1', 'text', 'The quick <b>brown fox</b> jumps');
    sync(a, b);

    // The peer bolded "brown fox"; " fox" comes out plain.
    expect(deltaOf(a)).toEqual([
      { insert: 'The ' },
      { insert: 'quick ', attributes: { bold: true } },
      { insert: 'brown', attributes: { bold: true } },
      { insert: ' fox' },
      { insert: ' jumps' },
    ]);
    expect(deltaOf(b)).toEqual(deltaOf(a));
  });

  it.each(ORDERS)('KNOWN LOSS: undoing a deletion drops a peer\'s concurrent format on that range (ids %i/%i)', (ownId, peerId) => {
    const { a, b } = peers(ownId, peerId, 'The quick fox');
    const history = new UndoHistory(a.undoScope, createMockBlok());

    a.updateBlockData('p1', 'text', 'The  fox');
    history.stopCapturing();
    b.updateBlockData('p1', 'text', 'The q<b>uic</b>k fox');
    sync(a, b);

    history.undo();
    sync(a, b);

    // The word comes back, but the peer's bold on "uic" does not.
    expect(new YBlockSerializer().readRichText(liveText(a))).toEqual([{ text: 'The quick fox' }]);
    expect(deltaOf(b)).toEqual(deltaOf(a));
  });

  it.each(ORDERS)('ACCEPTED: undoing a block\'s creation unbolds a peer\'s character typed in its bold run (ids %i/%i)', (ownId, peerId) => {
    const a = createStore(ownId);
    const b = createStore(peerId);

    a.fromJSON([{ id: 'p0', type: 'paragraph', data: { text: 'x' } }]);
    b.applyRemoteUpdate(a.encodeStateAsUpdate());

    const history = new UndoHistory(a.undoScope, createMockBlok());

    a.addBlock({ id: 'p1', type: 'paragraph', data: { text: 'Say <b>hello</b> now' } });
    history.stopCapturing();
    sync(a, b);
    b.updateBlockData('p1', 'text', 'Say <b>helXlo</b> now');
    sync(a, b);

    history.undo();
    sync(a, b);

    // Undo policy, same as format 1: a spared born block still loses this editor's text items (undo-history.ts:524-529).
    expect(deltaOf(a)).toEqual([{ insert: 'X' }]);
    expect(deltaOf(b)).toEqual(deltaOf(a));
  });
});
