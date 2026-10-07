import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { planRichTextEdit } from '../../../../../src/components/modules/yjs/rich-text-write';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { segmentsToDeltaOps } from '../../../../../src/shared/rich-text/delta';
import type { RichText } from '../../../../../types/rich-text';

/**
 * The rich write path (`DocumentStore.updateBlockData` on a `Y.XmlText`).
 * Peers are real yjs docs; every concurrency case runs in both client-ID
 * orders, because yjs breaks ties by client ID.
 */

type Op = Record<string, unknown>;

interface EditCase {
  name: string;
  current: RichText;
  next: RichText;
  ops: Op[];
  expected: { writes: boolean };
}

const CASES = JSON.parse(readFileSync(
  join(process.cwd(), 'test/unit/server-conformance/fixtures/rich-text-edits/cases.json'),
  'utf8'
)) as EditCase[];

const ORDERS = [
  [1, 2],
  [2, 1],
] as const;

const createStore = (clientId: number): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());
  const doc = store.blocksMap.doc;

  if (doc !== null) {
    doc.clientID = clientId;
  }

  return store;
};

const paragraphStore = (clientId: number, text: unknown): DocumentStore => {
  const store = createStore(clientId);

  store.fromJSON([{ id: 'b1', type: 'paragraph', data: { text } }]);

  return store;
};

const peerOf = (store: DocumentStore, clientId: number): DocumentStore => {
  const peer = createStore(clientId);

  peer.applyRemoteUpdate(store.encodeStateAsUpdate());

  return peer;
};

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const liveText = (store: DocumentStore): Y.XmlText =>
  (store.getBlockById('b1')?.get('data') as Y.Map<unknown>).get('text') as Y.XmlText;

const deltaOf = (store: DocumentStore): unknown => liveText(store).toDelta();

const htmlOf = (store: DocumentStore): unknown =>
  (store.toJSON().find(block => block.id === 'b1')?.data)?.text;

const countUpdates = (store: DocumentStore, write: () => void): number => {
  const doc = store.blocksMap.doc;
  const counter = { updates: 0 };
  const onUpdate = (): void => {
    counter.updates += 1;
  };

  doc?.on('update', onUpdate);
  write();
  doc?.off('update', onUpdate);

  return counter.updates;
};

/** Every content and format call the store makes on a formatted text, args cloned at call time. */
const recordOps = (): Op[] => {
  const ops: Op[] = [];
  const proto = Y.XmlText.prototype;
  const insert = proto.insert;
  const insertEmbed = proto.insertEmbed;
  const remove = proto.delete;
  const format = proto.format;

  vi.spyOn(proto, 'insert').mockImplementation(function (this: Y.XmlText, index, text, attributes) {
    ops.push({ op: 'insert', index, text, attributes: structuredClone(attributes) });
    insert.call(this, index, text, attributes);
  });
  vi.spyOn(proto, 'insertEmbed').mockImplementation(function (this: Y.XmlText, index, embed, attributes) {
    ops.push({ op: 'insertEmbed', index, embed: structuredClone(embed), attributes: structuredClone(attributes) });
    insertEmbed.call(this, index, embed, attributes);
  });
  vi.spyOn(proto, 'delete').mockImplementation(function (this: Y.XmlText, index, length) {
    ops.push({ op: 'delete', index, length });
    remove.call(this, index, length);
  });
  vi.spyOn(proto, 'format').mockImplementation(function (this: Y.XmlText, index, length, attributes) {
    ops.push({ op: 'format', index, length, attributes: structuredClone(attributes) });
    format.call(this, index, length, attributes);
  });

  return ops;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the client issues exactly the shared edit fixtures\' ops', () => {
  it.each(CASES.map(entry => [entry.name, entry] as const))('%s', (_name, entry) => {
    const store = paragraphStore(1, entry.current);
    const seeded = new Y.Doc();
    const reference = new Y.XmlText();

    // The store mints `current` exactly as the fixture seeds it.
    seeded.getMap('m').set('t', reference);
    segmentsToDeltaOps(entry.current).reduce((at, op) => {
      if (typeof op.insert === 'string') {
        reference.insert(at, op.insert, op.attributes);

        return at + op.insert.length;
      }
      reference.insertEmbed(at, op.insert, op.attributes);

      return at + 1;
    }, 0);
    expect(deltaOf(store)).toEqual(reference.toDelta());

    const ops = recordOps();
    const updates = countUpdates(store, () => {
      store.updateBlockData('b1', 'text', entry.next);
    });

    expect(ops).toEqual(entry.ops);
    expect(updates).toBe(entry.expected.writes ? 1 : 0);
  });
});

describe('a save that only respells the HTML writes nothing (Review Focus 1)', () => {
  it.each([
    ['<b> vs <strong>', 'a <b>bold</b> c', 'a <strong>bold</strong> c'],
    ['<i> vs <em>', 'a <i>it</i>', 'a <em>it</em>'],
    ['&nbsp; vs the character it names', 'a&nbsp;b', 'a\u00a0b'],
    ['link attribute order', '<a href="https://x.y" target="_blank" rel="noopener">l</a>', '<a rel="noopener" target="_blank" href="https://x.y">l</a>'],
    ['a placeholder <br>', 'tail', 'tail<br>'],
    ['nested marks in the other order', '<b><i>x</i></b>', '<i><b>x</b></i>'],
  ])('%s', (_name, stored, saved) => {
    const store = paragraphStore(1, stored);

    expect(countUpdates(store, () => store.updateBlockData('b1', 'text', saved))).toBe(0);
  });

  it('segments that spell an off mark as false', () => {
    const store = paragraphStore(1, [{ text: 'x', marks: { italic: true } }]);

    expect(countUpdates(store, () => store.updateBlockData('b1', 'text', [{ text: 'x', marks: { italic: true, bold: false } }]))).toBe(0);
  });

  it('a peer re-saving a respelling does not ping-pong', () => {
    const a = paragraphStore(1, 'one <b>two</b>');
    const b = peerOf(a, 2);

    expect(countUpdates(b, () => b.updateBlockData('b1', 'text', 'one <strong>two</strong>'))).toBe(0);
    expect(countUpdates(a, () => a.updateBlockData('b1', 'text', htmlOf(b)))).toBe(0);
  });
});

describe('two peers typing in one bold run, and typing after a link (Review Focus 2)', () => {
  it.each(ORDERS)('both bursts survive inside one bold run (clientIDs %i/%i)', (idA, idB) => {
    const a = paragraphStore(idA, 'hello <b>world</b>');
    const b = peerOf(a, idB);

    a.updateBlockData('b1', 'text', 'hello <b>woXXrld</b>');
    b.updateBlockData('b1', 'text', 'hello <b>worlYYd</b>');
    sync(a, b);

    expect(deltaOf(a)).toEqual([
      { insert: 'hello ' },
      { insert: 'woXXrlYYd', attributes: { bold: true } },
    ]);
    expect(deltaOf(b)).toEqual(deltaOf(a));
  });

  it.each(ORDERS)('text typed right after a link is not linked, while a peer edits the link (clientIDs %i/%i)', (idA, idB) => {
    const a = paragraphStore(idA, 'see <a href="https://a.example">go</a>');
    const b = peerOf(a, idB);

    a.updateBlockData('b1', 'text', 'see <a href="https://a.example">go</a> now');
    b.updateBlockData('b1', 'text', 'see <a href="https://a.example">gXo</a>');
    sync(a, b);

    expect(deltaOf(a)).toEqual([
      { insert: 'see ' },
      { insert: 'gXo', attributes: { link: { href: 'https://a.example' } } },
      { insert: ' now' },
    ]);
    expect(deltaOf(b)).toEqual(deltaOf(a));
  });

  it.each(ORDERS)('two peers typing at the end of a link both stay unlinked (clientIDs %i/%i)', (idA, idB) => {
    const a = paragraphStore(idA, '<a href="https://a.example">go</a>');
    const b = peerOf(a, idB);

    a.updateBlockData('b1', 'text', '<a href="https://a.example">go</a>A');
    b.updateBlockData('b1', 'text', '<a href="https://a.example">go</a>B');
    sync(a, b);

    const delta = deltaOf(a) as Array<{ insert: string; attributes?: unknown }>;

    expect(delta[0]).toEqual({ insert: 'go', attributes: { link: { href: 'https://a.example' } } });
    expect(delta.slice(1).map(op => op.attributes)).toEqual([undefined]);
    expect(delta.slice(1).map(op => op.insert).join('')).toHaveLength(2);
    expect(deltaOf(b)).toEqual(deltaOf(a));
  });
});

describe('concurrent edits converge', () => {
  it.each(ORDERS)('an embed inserted while a peer types (clientIDs %i/%i)', (idA, idB) => {
    const a = paragraphStore(idA, [{ text: 'alpha beta' }]);
    const b = peerOf(a, idB);

    a.updateBlockData('b1', 'text', [{ text: 'alpha ' }, { embed: { equation: { expression: 'x' } } }, { text: 'beta' }]);
    b.updateBlockData('b1', 'text', [{ text: 'alpha betaZ' }]);
    sync(a, b);

    expect(deltaOf(a)).toEqual([
      { insert: 'alpha ' },
      { insert: { equation: { expression: 'x' } } },
      { insert: 'betaZ' },
    ]);
    expect(deltaOf(b)).toEqual(deltaOf(a));
  });

  it.each(ORDERS)('an embed changed while a peer types next to it (clientIDs %i/%i)', (idA, idB) => {
    const a = paragraphStore(idA, [{ text: 'a' }, { embed: { equation: { expression: 'x' } } }, { text: 'b' }]);
    const b = peerOf(a, idB);

    a.updateBlockData('b1', 'text', [{ text: 'a' }, { embed: { equation: { expression: 'y' } } }, { text: 'b' }]);
    b.updateBlockData('b1', 'text', [{ text: 'a' }, { embed: { equation: { expression: 'x' } } }, { text: 'bQ' }]);
    sync(a, b);

    expect(deltaOf(a)).toEqual([
      { insert: 'a' },
      { insert: { equation: { expression: 'y' } } },
      { insert: 'bQ' },
    ]);
    expect(deltaOf(b)).toEqual(deltaOf(a));
  });

  it.each(ORDERS)('a paste over a phrase while a peer types elsewhere (clientIDs %i/%i)', (idA, idB) => {
    const a = paragraphStore(idA, 'The quick brown fox jumps over the lazy dog');
    const b = peerOf(a, idB);

    a.updateBlockData('b1', 'text', 'The <b>completely different animal</b> jumps over the lazy dog');
    b.updateBlockData('b1', 'text', 'The quick brown fox jumps over the lazy dog!');
    sync(a, b);

    expect(deltaOf(a)).toEqual([
      { insert: 'The ' },
      { insert: 'completely different animal', attributes: { bold: true } },
      { insert: ' jumps over the lazy dog!' },
    ]);
    expect(deltaOf(b)).toEqual(deltaOf(a));
  });

  it.each(ORDERS)('a paste over a phrase while a peer types inside it (clientIDs %i/%i)', (idA, idB) => {
    const a = paragraphStore(idA, 'The quick brown fox jumps');
    const b = peerOf(a, idB);

    a.updateBlockData('b1', 'text', 'The <i>slow red hen</i> jumps');
    b.updateBlockData('b1', 'text', 'The quick brXown fox jumps');
    sync(a, b);

    const text = (deltaOf(a) as Array<{ insert: string }>).map(op => op.insert).join('');

    // The peer's keystroke survives and lands inside the replaced phrase,
    // never in front of it.
    expect(text).toContain('X');
    expect(text.startsWith('The ')).toBe(true);
    expect(text.endsWith(' jumps')).toBe(true);
    expect(deltaOf(b)).toEqual(deltaOf(a));
  });
});

describe('narrow writes', () => {
  it('one keystroke in a long paragraph is one one-character insert', () => {
    const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const store = paragraphStore(1, `${words} <b>bold</b> end`);
    const ops = recordOps();

    store.updateBlockData('b1', 'text', `${words.replace('word200', 'word2X00')} <b>bold</b> end`);

    expect(ops).toEqual([{ op: 'insert', index: words.indexOf('word200') + 5, text: 'X', attributes: {} }]);
  });

  it('a keystroke inside markup-shaped text is one one-character insert', () => {
    const store = paragraphStore(1, [{ text: 'x <b> y &lt; z' }]);
    const ops = recordOps();

    store.updateBlockData('b1', 'text', [{ text: 'x <bQ> y &lQt; z' }]);

    expect(ops).toEqual([
      { op: 'insert', index: 10, text: 'Q', attributes: {} },
      { op: 'insert', index: 4, text: 'Q', attributes: {} },
    ]);
  });

  it('a keystroke in a bold run is one insert carrying the run\'s marks', () => {
    const store = paragraphStore(1, 'a <b>bold</b> b');
    const ops = recordOps();

    store.updateBlockData('b1', 'text', 'a <b>boXld</b> b');

    expect(ops).toEqual([{ op: 'insert', index: 4, text: 'X', attributes: { bold: true } }]);
  });
});

describe('an item no segment can name', () => {
  it('still takes one index, and is replaced rather than paired with an embed', () => {
    const live = [{ insert: 'a' }, { insert: new Y.Map() }, { insert: 'b' }];

    expect(planRichTextEdit(live, [{ text: 'a' }, { embed: { html: '<hr>' } }, { text: 'b' }])).toEqual([
      { op: 'insertEmbed', index: 1, embed: { html: '<hr>' }, attributes: {} },
      { op: 'delete', index: 2, length: 1 },
    ]);
    expect(planRichTextEdit(live, [{ text: 'abc' }])).toEqual([
      { op: 'insert', index: 3, text: 'c', attributes: {} },
      { op: 'delete', index: 1, length: 1 },
    ]);
  });
});
