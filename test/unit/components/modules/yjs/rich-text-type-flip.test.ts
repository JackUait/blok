import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * A field's class says how it is read (formatted `Y.XmlText` or HTML
 * `Y.Text`), and the block type says which class it should be. A conversion
 * that flips a field between rich and non-rich must re-mint it, and a type
 * race (rt-research/b/e8-discriminator-race.mjs) that leaves an HTML `Y.Text`
 * under a rich field must heal on the next local write.
 */

const createStore = (clientId: number): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());
  const doc = store.blocksMap.doc;

  if (doc !== null) {
    doc.clientID = clientId;
  }

  return store;
};

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const blockOf = (store: DocumentStore, id: string): Record<string, unknown> | undefined =>
  store.toJSON().find((candidate) => candidate.id === id) as Record<string, unknown> | undefined;

const textOf = (store: DocumentStore, id: string): unknown =>
  (blockOf(store, id)?.data as Record<string, unknown> | undefined)?.text;

const storedText = (store: DocumentStore, id: string): unknown =>
  (store.getBlockById(id)?.get('data') as Y.Map<unknown>).get('text');

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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a conversion that flips a field between rich and non-rich re-mints it', () => {
  it('paragraph → a tool whose text is not rich stores the HTML in a plain Y.Text', () => {
    const store = createStore(1);

    store.fromJSON([{ id: 'b1', type: 'paragraph', data: { text: '<b>a</b> &lt; b' } }]);
    store.replaceBlockContent('b1', 'custom', { text: '<b>a</b> &lt; b' });

    const text = storedText(store, 'b1');

    expect(text).toBeInstanceOf(Y.Text);
    expect(text).not.toBeInstanceOf(Y.XmlText);
    expect((text as Y.Text).toJSON()).toBe('<b>a</b> &lt; b');
    expect(textOf(store, 'b1')).toBe('<b>a</b> &lt; b');
  });

  it('a non-rich text → paragraph stores formatted text', () => {
    const store = createStore(1);

    store.fromJSON([{ id: 'b1', type: 'custom', data: { text: '<b>a</b> &lt; b' } }]);
    store.replaceBlockContent('b1', 'paragraph', { text: '<b>a</b> &lt; b' });

    const text = storedText(store, 'b1');

    expect(text).toBeInstanceOf(Y.XmlText);
    expect((text as Y.XmlText).toDelta()).toEqual([
      { insert: 'a', attributes: { bold: true } },
      { insert: ' < b' },
    ]);
  });

  it('rich → rich keeps the same formatted text, edited in place', () => {
    const store = createStore(1);

    store.fromJSON([{ id: 'b1', type: 'paragraph', data: { text: 'hello' } }]);

    const before = storedText(store, 'b1');

    store.replaceBlockContent('b1', 'header', { text: 'hello', level: 2 });

    expect(storedText(store, 'b1')).toBe(before);
  });

  it('undoing paragraph → custom brings back the formatted text with its marks', () => {
    const store = createStore(1);

    store.fromJSON([{ id: 'b1', type: 'paragraph', data: { text: 'one <b>two</b>' } }]);

    const history = new UndoHistory(store.undoScope, createMockBlok());

    store.replaceBlockContent('b1', 'custom', { text: 'one <b>two</b>' });
    history.undo();

    const text = storedText(store, 'b1');

    expect(blockOf(store, 'b1')?.type).toBe('paragraph');
    expect(text).toBeInstanceOf(Y.XmlText);
    expect((text as Y.XmlText).toDelta()).toEqual([
      { insert: 'one ' },
      { insert: 'two', attributes: { bold: true } },
    ]);
  });
});

describe('concurrent paragraph → custom and paragraph → header (e8)', () => {
  it.each([
    [1, 2],
    [2, 1],
  ])('converges, reads as text, and heals on the next local write (clientIDs A=%i B=%i)', (idA, idB) => {
    const a = createStore(idA);
    const b = createStore(idB);

    a.fromJSON([{ id: 'b1', type: 'paragraph', data: { text: '<b>a</b> &lt; b' } }]);
    sync(a, b);

    a.replaceBlockContent('b1', 'custom', { text: '<b>a</b> &lt; b' });
    b.replaceBlockContent('b1', 'header', { text: '<b>a</b> &lt; b!', level: 2 });
    sync(a, b);

    expect(blockOf(a, 'b1')).toEqual(blockOf(b, 'b1'));

    const type = blockOf(a, 'b1')?.type;

    // Whichever type won, the field is read by its class: never literal tags.
    expect(textOf(a, 'b1')).toBe('<b>a</b> &lt; b');

    if (type !== 'header') {
      expect(storedText(a, 'b1')).not.toBeInstanceOf(Y.XmlText);

      return;
    }

    // The header holds the custom peer's HTML Y.Text. B's next save upgrades it.
    expect(storedText(b, 'b1')).not.toBeInstanceOf(Y.XmlText);

    b.updateBlockData('b1', 'text', '<b>a</b> &lt; b?');
    sync(a, b);

    for (const store of [a, b]) {
      const text = storedText(store, 'b1');

      expect(text).toBeInstanceOf(Y.XmlText);
      expect((text as Y.XmlText).toDelta()).toEqual([
        { insert: 'a', attributes: { bold: true } },
        { insert: ' < b?' },
      ]);
    }
  });

  it('runs the header-wins order at least once', () => {
    const winners = [[1, 2], [2, 1]].map(([idA, idB]) => {
      const a = createStore(idA);
      const b = createStore(idB);

      a.fromJSON([{ id: 'b1', type: 'paragraph', data: { text: 'x' } }]);
      sync(a, b);
      a.replaceBlockContent('b1', 'custom', { text: 'x' });
      b.replaceBlockContent('b1', 'header', { text: 'x', level: 2 });
      sync(a, b);

      return blockOf(a, 'b1')?.type;
    });

    expect(winners).toContain('header');
  });

  it.each([
    [1, 2],
    [2, 1],
  ])('two peers upgrading the same HTML Y.Text at once converge on one formatted text (clientIDs %i/%i)', (idA, idB) => {
    const a = createStore(idA);
    const b = createStore(idB);

    a.fromJSON([{ id: 'b1', type: 'custom', data: { text: 'x' } }]);
    sync(a, b);

    // The shape a type race leaves (see the e8 cases above), built directly.
    (a.getBlockById('b1') as Y.Map<unknown>).set('type', 'header');
    sync(a, b);
    expect(storedText(a, 'b1')).not.toBeInstanceOf(Y.XmlText);

    a.updateBlockData('b1', 'text', 'x <i>from a</i>');
    b.updateBlockData('b1', 'text', 'x <b>from b</b>');
    sync(a, b);

    expect(storedText(a, 'b1')).toBeInstanceOf(Y.XmlText);
    expect(storedText(b, 'b1')).toBeInstanceOf(Y.XmlText);
    expect(textOf(a, 'b1')).toBe(textOf(b, 'b1'));
  });
});
