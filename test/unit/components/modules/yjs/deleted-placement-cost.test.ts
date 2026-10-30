import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as YModule from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

const scan = vi.hoisted(() => ({ visits: 0 }));

// Counts the deleted structs UndoHistory's own scans walk. Yjs calls its
// internal binding, so its own bookkeeping is not counted.
vi.mock('yjs', async (importOriginal) => {
  const actual = await importOriginal<typeof YModule>();

  return {
    ...actual,
    iterateDeletedStructs: (...[transaction, deleteSet, visit]: Parameters<typeof actual.iterateDeletedStructs>) =>
      actual.iterateDeletedStructs(transaction, deleteSet, (struct) => {
        scan.visits++;
        visit(struct);
      }),
  };
});

const createMockBlok = (): BlokModules => ({
  BlockManager: {
    currentBlock: undefined,
    getBlockById: vi.fn(),
    getBlockByChildNode: vi.fn(),
    blocks: [],
  },
  Caret: {
    setToBlock: vi.fn(),
    setToInput: vi.fn(),
    positions: { START: 'start',
      END: 'end',
      DEFAULT: 'default' },
  },
} as unknown as BlokModules);

describe('delete-placement tracking cost', () => {
  let store: DocumentStore;
  let history: UndoHistory;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new DocumentStore(new YBlockSerializer());
    store.fromJSON([{ id: 'b1',
      type: 'paragraph',
      data: { text: '' } }]);
    history = new UndoHistory(store.undoScope, createMockBlok());
  });

  afterEach(() => {
    history.destroy();
    vi.restoreAllMocks();
  });

  it('opens no extra transaction for a keystroke that deletes no block', () => {
    const doc = store.blocksMap.doc;
    let transactions = 0;
    const count = (): void => {
      transactions++;
    };

    doc?.on('afterTransaction', count);

    const keystrokes = 50;

    for (let i = 1; i <= keystrokes; i++) {
      store.updateBlockData('b1', 'text', 'x'.repeat(i));
    }
    doc?.off('afterTransaction', count);

    expect(history.undoManager.undoStack).toHaveLength(1);
    expect(transactions).toBe(keystrokes);
  });

  it('still puts a deleted block back where it was', () => {
    store.addBlock({ id: 'b2',
      type: 'paragraph',
      data: { text: 'two' } });
    store.addBlock({ id: 'b3',
      type: 'paragraph',
      data: { text: 'three' } });
    history.stopCapturing();
    store.updateBlockData('b2', 'text', 'two!');
    store.removeBlock('b2');
    history.undo();

    expect(store.toJSON().map((block) => block.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('scans each delete once while one undo step keeps growing', () => {
    const visitsFor = (pairs: number): number => {
      history.stopCapturing();
      scan.visits = 0;

      for (let i = 0; i < pairs; i++) {
        store.addBlock({ id: `row-${pairs}-${i}`,
          type: 'paragraph',
          data: { text: '' } });
        store.removeBlock(`row-${pairs}-${i}`);
      }

      return scan.visits;
    };

    const small = visitsFor(20);
    const big = visitsFor(80);

    // Four times the deletes: linear work grows ~4x, a rescan of the whole step ~16x.
    expect(big).toBeLessThan(small * 6);
    expect(history.undoManager.undoStack).toHaveLength(2);
  });
});
