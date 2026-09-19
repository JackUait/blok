import { describe, it, expect, beforeEach, vi } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

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

const textOf = (store: DocumentStore, id: string): string => {
  const block = store.toJSON().find((candidate) => candidate.id === id);

  return (block?.data as { text?: string } | undefined)?.text ?? '';
};

const hasBlock = (store: DocumentStore, id: string): boolean =>
  store.toJSON().some((candidate) => candidate.id === id);

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
 * Undo must unwind what the undoing person did, not what a peer did inside
 * it. A block insert whose block a peer has since written in cannot be
 * removed without destroying that writing.
 */
describe('UndoHistory — undo does not delete a peer\'s content', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;
  let historyA: UndoHistory;

  beforeEach(() => {
    storeA = createStore();
    storeB = createStore();

    storeA.fromJSON([paragraph('b1', 'First')]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    historyA = new UndoHistory(storeA.undoScope, createMockBlok());
  });

  it('keeps a block a peer typed into when the inserting peer undoes', () => {
    storeA.addBlock(paragraph('b2', ''));
    sync(storeA, storeB);

    storeB.updateBlockData('b2', 'text', 'Typed by B');
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(textOf(storeA, 'b2')).toBe('Typed by B');
    expect(textOf(storeB, 'b2')).toBe('Typed by B');
    expect(hasBlock(storeA, 'b2')).toBe(true);
    expect(hasBlock(storeB, 'b2')).toBe(true);
  });

  it('leaves the kept block usable, carrying what the peer added', () => {
    storeA.addBlock(paragraph('b2', 'A wrote this'));
    sync(storeA, storeB);

    storeB.updateBlockData('b2', 'text', 'A wrote this plus B');
    sync(storeA, storeB);

    historyA.undo();

    const kept = storeA.toJSON().find((block) => block.id === 'b2');

    // The undoing peer's own characters go; the peer's addition and the block
    // itself stay, with the identity a tool needs to render it.
    expect((kept?.data as { text?: string } | undefined)?.text).toBe(' plus B');
    expect(kept?.type).toBe('paragraph');
    expect(kept?.id).toBe('b2');
  });

  it('still removes the blocks the peer did not touch', () => {
    storeA.addBlock(paragraph('b2', ''));
    storeA.addBlock(paragraph('b3', ''));
    sync(storeA, storeB);

    storeB.updateBlockData('b3', 'text', 'Typed by B');
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(hasBlock(storeA, 'b2')).toBe(false);
    expect(hasBlock(storeA, 'b3')).toBe(true);
    expect(textOf(storeA, 'b3')).toBe('Typed by B');
  });

  it('keeps a container whose child a peer typed into', () => {
    storeA.addBlock({ id: 'parent', type: 'toggle', data: { text: 'Toggle' } });
    storeA.addBlock({ id: 'child', type: 'paragraph', data: { text: '' }, parent: 'parent' });
    sync(storeA, storeB);

    storeB.updateBlockData('child', 'text', 'Typed by B');
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(hasBlock(storeA, 'child')).toBe(true);
    expect(textOf(storeA, 'child')).toBe('Typed by B');
    // Kept too, or the child would hang off a parent that no longer exists.
    expect(hasBlock(storeA, 'parent')).toBe(true);
  });

  it('removes the whole block when no peer contributed to it', () => {
    storeA.addBlock(paragraph('b2', 'Only A'));
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(hasBlock(storeA, 'b2')).toBe(false);
    expect(hasBlock(storeB, 'b2')).toBe(false);
  });

  it('still undoes the undoing peer\'s own typing in a shared paragraph', () => {
    storeB.updateBlockData('b1', 'text', 'First, from B');
    sync(storeA, storeB);

    storeA.updateBlockData('b1', 'text', 'First, from B and A');
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    // A's own words go, B's stay: sparing the peer's content must not freeze
    // undo inside every block a peer has ever typed in.
    expect(textOf(storeA, 'b1')).toBe('First, from B');
    expect(textOf(storeB, 'b1')).toBe('First, from B');
  });

  it('leaves both peers on the same document after the undo, and after a redo', () => {
    storeA.updateBlockData('b1', 'text', 'First, edited by A');
    historyA.stopCapturing();

    storeA.addBlock(paragraph('b2', ''));
    sync(storeA, storeB);

    storeB.updateBlockData('b2', 'text', 'Typed by B');
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(storeA.toJSON()).toEqual(storeB.toJSON());
    expect(textOf(storeA, 'b2')).toBe('Typed by B');

    historyA.redo();
    sync(storeA, storeB);

    expect(storeA.toJSON()).toEqual(storeB.toJSON());
    expect(textOf(storeA, 'b2')).toBe('Typed by B');
  });

  /**
   * Nothing of the blocked action can be applied, so yjs's own loop moves on to
   * the previous one — the same skip it already performs for an insertion a peer
   * has deleted. The press is not swallowed, and the peer's writing survives.
   */
  it('unwinds the previous action instead when the newest one cannot be unwound', () => {
    storeA.updateBlockData('b1', 'text', 'First, edited by A');
    historyA.stopCapturing();

    storeA.addBlock(paragraph('b2', ''));
    sync(storeA, storeB);

    storeB.updateBlockData('b2', 'text', 'Typed by B');
    sync(storeA, storeB);

    historyA.undo();

    expect(textOf(storeA, 'b2')).toBe('Typed by B');
    expect(textOf(storeA, 'b1')).toBe('First');

    historyA.redo();

    expect(textOf(storeA, 'b1')).toBe('First, edited by A');
    expect(textOf(storeA, 'b2')).toBe('Typed by B');
  });
});
