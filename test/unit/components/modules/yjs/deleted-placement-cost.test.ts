import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

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
});
