import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const paragraph = (id: string, text: string): { id: string; type: string; data: { text: string } } => ({
  id,
  type: 'paragraph',
  data: { text },
});

/**
 * Exchange diffs computed against each peer's pre-exchange state vector, the
 * way the provider does.
 */
const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

/** The text of one block as a reader sees it. */
const textOf = (store: DocumentStore, id: string): string => {
  const block = store.toJSON().find((candidate) => candidate.id === id);

  return (block?.data as { text?: string } | undefined)?.text ?? '';
};

/**
 * A block's text is the one field two people routinely edit at the same
 * instant, and `save()` hands it over whole. Writing it whole means the
 * later write wins the entire paragraph, so the other person's burst is
 * gone — measured in a real browser as up to every character they typed.
 */
describe('DocumentStore — concurrent edits to one block\'s text', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  beforeEach(() => {
    storeA = createStore();
    storeB = createStore();

    storeA.fromJSON([paragraph('b1', 'Hello world')]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  });

  it('keeps both peers\' typing when they edit different parts of one paragraph', () => {
    storeA.updateBlockData('b1', 'text', 'Hello world AAA');
    storeB.updateBlockData('b1', 'text', 'Hello BBB world');

    sync(storeA, storeB);

    expect(textOf(storeA, 'b1')).toBe('Hello BBB world AAA');
    expect(textOf(storeB, 'b1')).toBe('Hello BBB world AAA');
  });

  it('keeps both peers\' typing when each appends to a different end', () => {
    storeA.updateBlockData('b1', 'text', 'XXXHello world');
    storeB.updateBlockData('b1', 'text', 'Hello worldYYY');

    sync(storeA, storeB);

    expect(textOf(storeA, 'b1')).toBe('XXXHello worldYYY');
    expect(textOf(storeB, 'b1')).toBe('XXXHello worldYYY');
  });

  it('keeps a peer\'s typing when the other only adds inline markup', () => {
    storeA.updateBlockData('b1', 'text', 'Hello <b>world</b>');
    storeB.updateBlockData('b1', 'text', 'Hello world!!!');

    sync(storeA, storeB);

    // Both intents survive: the markup and the exclamation marks.
    expect(textOf(storeA, 'b1')).toContain('<b>');
    expect(textOf(storeA, 'b1')).toContain('!!!');
    expect(textOf(storeB, 'b1')).toBe(textOf(storeA, 'b1'));
  });

  /**
   * The case a single-region prefix/suffix diff gets wrong. Each peer's whole
   * string differs from the base in one span, and those spans OVERLAP, so a
   * one-region diff has each peer delete the other's span and re-insert its
   * own — the shared word lands twice and the rest is dropped. Asserting
   * `toContain('<b>')` would not notice; the text itself is the assertion.
   */
  it('loses no text when two peers format overlapping ranges at once', () => {
    storeA.updateBlockData('b1', 'text', 'The quick brown fox');
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    storeA.updateBlockData('b1', 'text', 'The <b>quick brown</b> fox');
    storeB.updateBlockData('b1', 'text', 'The quick <i>brown fox</i>');

    sync(storeA, storeB);

    const merged = textOf(storeA, 'b1');

    expect(textOf(storeB, 'b1')).toBe(merged);
    // Every word exactly once, and both peers' markup present.
    expect(merged.replace(/<[^>]*>/g, '')).toBe('The quick brown fox');
    expect(merged).toContain('<b>');
    expect(merged).toContain('<i>');
  });

  it('still reads back as a plain string for every consumer of the document', () => {
    storeA.updateBlockData('b1', 'text', 'Hello brave world');

    const block = storeA.toJSON()[0];

    expect(typeof (block.data as { text?: string }).text).toBe('string');
    expect((block.data as { text?: string }).text).toBe('Hello brave world');
  });

  it('writes nothing when the text did not change', () => {
    expect(storeA.updateBlockData('b1', 'text', 'Hello world')).toBe(false);
  });

  /**
   * An emoji is two UTF-16 code units. A diff that compares code units can put
   * an edit boundary BETWEEN them, and the halves then live in separate CRDT
   * items: the character is broken for the peer and, measured, for the writer
   * too. `lib0`'s own diff rolls back off a surrogate boundary for exactly
   * this reason.
   */
  it('does not break an emoji when one is replaced by another', () => {
    const grinning = String.fromCodePoint(0x1F600);
    const grinning2 = String.fromCodePoint(0x1F601);

    storeA.updateBlockData('b1', 'text', `hi ${grinning}`);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    storeA.updateBlockData('b1', 'text', `hi ${grinning2}`);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    expect(textOf(storeA, 'b1')).toBe(`hi ${grinning2}`);
    expect(textOf(storeB, 'b1')).toBe(`hi ${grinning2}`);
    // Spelled out, because a broken pair still has the same length.
    expect([...textOf(storeB, 'b1')]).toHaveLength(4);
  });

  // A NUL aborts the .NET server's read of the document, and the browser is
  // the only guard — every write chokepoint scrubs. See `stripNul`. Built from
  // a code point so no raw NUL byte lives in this file either.
  it('scrubs NUL out of the text however it is written', () => {
    const nul = String.fromCharCode(0);

    storeA.updateBlockData('b1', 'text', `Hello${nul} world`);

    expect(textOf(storeA, 'b1')).toBe('Hello world');

    storeA.updateBlockData('b1', 'text', `Hello world${nul}!`);

    expect(textOf(storeA, 'b1')).toBe('Hello world!');
  });

  it('survives a turn-into, which rewrites the block in place', () => {
    storeA.updateBlockData('b1', 'text', 'Hello brave world');
    storeA.replaceBlockContent('b1', 'header', { text: 'Hello brave world',
      level: 2 });
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    storeA.updateBlockData('b1', 'text', 'Hello brave world AAA');
    storeB.updateBlockData('b1', 'text', 'Hello BBB brave world');

    sync(storeA, storeB);

    expect(textOf(storeA, 'b1')).toBe('Hello BBB brave world AAA');
    expect(textOf(storeB, 'b1')).toBe('Hello BBB brave world AAA');
  });

  /**
   * A block the server seeded carries a plain string, and it stays one.
   * Upgrading it in place would mean `set`ting a fresh Y.Text over the key,
   * and a whole-key set is last-writer-wins — a peer editing the same block
   * at that moment loses its container with everything typed into it. So a
   * seeded block keeps today's behaviour until the server mints the Y.Text,
   * and no new way to lose text is introduced meanwhile.
   */
  it('leaves a server-seeded plain string alone rather than racing to upgrade it', () => {
    const store = new DocumentStore(new YBlockSerializer());
    const raw = new Y.Doc();

    raw.transact(() => {
      const block = new Y.Map<unknown>();

      raw.getMap<Y.Map<unknown>>('blocks').set('b1', block);
      block.set('id', 'b1');
      block.set('type', 'paragraph');
      block.set('data', new Y.Map<unknown>());
      (block.get('data') as Y.Map<unknown>).set('text', 'seeded');
      block.set('contentIds', new Y.Array<string>());
      raw.getArray<string>('root').push(['b1']);
    });
    store.applyRemoteUpdate(Y.encodeStateAsUpdate(raw));

    store.updateBlockData('b1', 'text', 'seeded typed');

    expect(textOf(store, 'b1')).toBe('seeded typed');
    expect((store.getBlockById('b1')?.get('data') as Y.Map<unknown>).get('text'))
      .not.toBeInstanceOf(Y.Text);
  });

  /**
   * The real write path wraps every flush in one `'local'` transaction
   * (`flushBlockDataWrites`), and a nested `doc.transact` discards its origin,
   * so anything written here is tracked whatever origin it asks for. Merging
   * must survive that, and survive the undo it makes possible.
   */
  it('keeps merging when the write is nested inside the flush transaction', () => {
    storeA.transact(() => {
      storeA.updateBlockData('b1', 'text', 'Hello world AAA');
    }, 'local');
    storeB.transact(() => {
      storeB.updateBlockData('b1', 'text', 'Hello BBB world');
    }, 'local');

    sync(storeA, storeB);

    expect(textOf(storeA, 'b1')).toBe('Hello BBB world AAA');
    expect(textOf(storeB, 'b1')).toBe('Hello BBB world AAA');
  });
});
