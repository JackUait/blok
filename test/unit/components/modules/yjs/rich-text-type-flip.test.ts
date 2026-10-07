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

/** `knownTypes`: the tools registered on this client (none by default). */
const createStore = (clientId: number, knownTypes: string[] = []): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer({ isKnownType: type => knownTypes.includes(type) }));
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
  ])('converges, reads as text, and heals on the next local write; the peer keystroke typed during the flip is lost (accepted) (clientIDs A=%i B=%i)', (idA, idB) => {
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

describe('a plain HTML Y.Text under a rich field', () => {
  it('writes nothing when a save only respells it (Review Focus 1, format 1)', () => {
    const store = createStore(1);

    store.fromJSON([{ id: 'b1', type: 'custom', data: { text: '<b>x</b>' } }]);
    (store.getBlockById('b1') as Y.Map<unknown>).set('type', 'paragraph');

    const doc = store.blocksMap.doc;
    const counter = { updates: 0 };

    doc?.on('update', () => {
      counter.updates += 1;
    });

    expect(store.updateBlockData('b1', 'text', '<strong>x</strong>')).toBe(false);
    expect(counter.updates).toBe(0);
    expect(storedText(store, 'b1')).not.toBeInstanceOf(Y.XmlText);
  });
});

describe('concurrent custom → paragraph that loses the type race', () => {
  it.each([
    [1, 2],
    [2, 1],
  ])('a registered tool that does not declare the key gets a plain Y.Text back on its next save (clientIDs A=%i B=%i)', (idA, idB) => {
    const a = createStore(idA, ['custom']);
    const b = createStore(idB, ['custom']);

    a.fromJSON([{ id: 'b1', type: 'custom', data: { text: '<b>a</b>' } }]);
    sync(a, b);

    a.replaceBlockContent('b1', 'paragraph', { text: '<b>a</b>' });
    b.replaceBlockContent('b1', 'custom', { text: '<b>a</b>' });
    sync(a, b);

    if (blockOf(a, 'b1')?.type !== 'custom') {
      expect(storedText(a, 'b1')).toBeInstanceOf(Y.XmlText);

      return;
    }

    // The custom block holds A's formatted text. B's next save downgrades it.
    expect(storedText(b, 'b1')).toBeInstanceOf(Y.XmlText);

    b.updateBlockData('b1', 'text', '<b>a</b><div>block</div>');
    sync(a, b);

    for (const store of [a, b]) {
      const text = storedText(store, 'b1');

      expect(text).not.toBeInstanceOf(Y.XmlText);
      expect((text as Y.Text).toJSON()).toBe('<b>a</b><div>block</div>');
    }
  });

  it('runs the custom-wins order at least once', () => {
    const winners = [[1, 2], [2, 1]].map(([idA, idB]) => {
      const a = createStore(idA, ['custom']);
      const b = createStore(idB, ['custom']);

      a.fromJSON([{ id: 'b1', type: 'custom', data: { text: 'x' } }]);
      sync(a, b);
      a.replaceBlockContent('b1', 'paragraph', { text: 'x' });
      b.replaceBlockContent('b1', 'custom', { text: 'x' });
      sync(a, b);

      return blockOf(a, 'b1')?.type;
    });

    expect(winners).toContain('custom');
  });

  it('a save that changes nothing does not downgrade', () => {
    const store = createStore(1, ['custom']);

    store.fromJSON([{ id: 'b1', type: 'paragraph', data: { text: '<b>a</b>' } }]);
    (store.getBlockById('b1') as Y.Map<unknown>).set('type', 'custom');

    expect(store.updateBlockData('b1', 'text', '<strong>a</strong>')).toBe(false);
    expect(storedText(store, 'b1')).toBeInstanceOf(Y.XmlText);
  });

  it('an unregistered tool keeps its formatted text', () => {
    const store = createStore(1);

    store.fromJSON([{ id: 'b1', type: 'paragraph', data: { text: '<b>a</b>' } }]);
    (store.getBlockById('b1') as Y.Map<unknown>).set('type', 'custom');
    store.updateBlockData('b1', 'text', '<b>a</b>!');

    expect(storedText(store, 'b1')).toBeInstanceOf(Y.XmlText);
    expect(textOf(store, 'b1')).toBe('<strong>a</strong>!');
  });
});
