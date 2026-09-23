import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { YjsManager } from '../../../src/components/modules/yjs';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import { UndoHistory } from '../../../src/components/modules/yjs/undo-history';
import { TableModel } from '../../../src/tools/table/table-model';
import type { CellContent, TableData } from '../../../src/tools/table/types';
import type { BlokModules } from '../../../src/types-internal/blok-modules';

/**
 * Undo audit, concurrent layer: undo/redo while a peer edits the same
 * document. Setup copied from
 * test/unit/components/modules/yjs/concurrent-undo-loss.test.ts.
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

interface Peer {
  encodeStateAsUpdate(stateVector?: Uint8Array): Uint8Array;
  getStateVector(): Uint8Array;
  applyRemoteUpdate(update: Uint8Array): void;
}

/** Exchange diffs both ways, the way a provider does. */
const sync = (a: Peer, b: Peer): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

interface Readable {
  toJSON(): Array<{ id?: string; type?: string; data?: unknown }>;
}

const dataOf = (store: Readable, id: string): Record<string, unknown> =>
  (store.toJSON().find((block) => block.id === id)?.data ?? {}) as Record<string, unknown>;

const textOf = (store: Readable, id: string): string =>
  (dataOf(store, id).text as string | undefined) ?? '';

const idsOf = (store: Readable): string[] => store.toJSON().map((block) => block.id ?? '');

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

/** Move undo needs the real placement callback, which only YjsManager wires. */
const createYjsManager = (): YjsManager => {
  const eventsDispatcher = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as YjsManager['eventsDispatcher'];

  return new YjsManager({ config: {},
    eventsDispatcher });
};

describe('concurrent undo — a refused entry must not block older ones', () => {
  let manager: YjsManager;
  let peer: DocumentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createYjsManager();
    peer = createStore(2);
    manager.fromJSON([paragraph('b1', 'one'), paragraph('b2', 'two'), paragraph('b3', 'three')]);
    peer.applyRemoteUpdate(manager.encodeStateAsUpdate());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // COL-1. Refusing the move is designed (groupWasDisplacedSince); undo
  // reaches past it and the refused move stays on the stack.
  it('still undoes an older edit after the peer moved a block this editor moved', () => {
    manager.updateBlockData('b1', 'text', 'one edited');
    manager.stopCapturing();
    manager.moveBlock('b3', 0);
    sync(manager, peer);

    peer.moveBlock('b3', 1);
    sync(manager, peer);

    manager.undo();
    manager.undo();
    sync(manager, peer);

    expect(textOf(manager, 'b1')).toBe('one');
    expect(manager.orderedIds()).toEqual(['b1', 'b3', 'b2']);
    expect(manager.toJSON()).toEqual(peer.toJSON());
    expect(manager.canUndo()).toBe(true);
  });

  // COL-3. Same on the redo side.
  it('still redoes a newer edit after the peer moved a block whose move was undone', () => {
    manager.moveBlock('b3', 0);
    manager.stopCapturing();
    manager.updateBlockData('b1', 'text', 'one edited');
    manager.stopCapturing();

    manager.undo();
    manager.undo();
    sync(manager, peer);

    peer.moveBlock('b3', 1);
    sync(manager, peer);

    manager.redo();
    manager.redo();
    sync(manager, peer);

    expect(textOf(manager, 'b1')).toBe('one edited');
    expect(manager.toJSON()).toEqual(peer.toJSON());
  });

  it('undoes an older edit after the peer deleted the block this editor moved', () => {
    manager.updateBlockData('b1', 'text', 'one edited');
    manager.stopCapturing();
    manager.moveBlock('b3', 0);
    sync(manager, peer);
    peer.removeBlock('b3');
    sync(manager, peer);

    manager.undo();
    manager.undo();
    sync(manager, peer);

    expect(textOf(manager, 'b1')).toBe('one');
    expect(manager.orderedIds()).toEqual(['b1', 'b2']);
    expect(manager.toJSON()).toEqual(peer.toJSON());
  });
});

describe('concurrent undo — shared text and capture windows', () => {
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

  // COL-2. Refusing a half-undoable replace is designed
  // (wouldResurrectBesideASparedBlock); undo reaches past it.
  it('still undoes an older edit after a replace the peer wrote into was refused', () => {
    storeA.updateBlockData('b1', 'text', 'First edit');
    historyA.stopCapturing();

    storeA.removeBlock('b2');
    storeA.addBlock({ id: 'b3',
      type: 'quote',
      data: { text: '' } });
    sync(storeA, storeB);

    storeB.updateBlockData('b3', 'text', 'Quoted by B');
    sync(storeA, storeB);

    historyA.undo();
    historyA.undo();
    sync(storeA, storeB);

    expect(textOf(storeA, 'b1')).toBe('First');
    expect(idsOf(storeA)).toEqual(['b1', 'b3']);
    expect(storeA.toJSON()).toEqual(storeB.toJSON());
  });

  it('undoes the whole local burst when a peer edit lands inside the capture window', () => {
    storeA.updateBlockData('b1', 'text', 'First a');
    sync(storeA, storeB);
    storeB.updateBlockData('b1', 'text', 'XFirst a');
    sync(storeA, storeB);
    storeA.updateBlockData('b1', 'text', 'XFirst ab');

    historyA.undo();
    sync(storeA, storeB);

    expect(textOf(storeA, 'b1')).toBe('XFirst');
    expect(storeA.toJSON()).toEqual(storeB.toJSON());
  });

  it('redoes onto text the peer changed between the undo and the redo', () => {
    storeA.updateBlockData('b1', 'text', 'First edit');
    historyA.stopCapturing();
    historyA.undo();
    sync(storeA, storeB);
    storeB.updateBlockData('b1', 'text', 'BFirst');
    sync(storeA, storeB);

    historyA.redo();
    sync(storeA, storeB);

    expect(textOf(storeA, 'b1')).toBe('BFirst edit');
    expect(storeA.toJSON()).toEqual(storeB.toJSON());
  });

  it('puts the paragraph back with the peer\'s text when the peer typed AFTER the convert', () => {
    storeA.replaceBlockContent('b1', 'header', { text: 'First',
      level: 2 });
    sync(storeA, storeB);
    storeB.updateBlockData('b1', 'text', 'First by B');
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    const block = storeA.toJSON().find((candidate) => candidate.id === 'b1');

    expect({ type: block?.type,
      data: block?.data }).toEqual({ type: 'paragraph',
      data: { text: 'First by B' } });
    expect(storeA.toJSON()).toEqual(storeB.toJSON());
  });

  it('converges under random interleavings of edits, undos, redos and syncs', () => {
    const failures: string[] = [];
    const seed = { value: 7 };
    const rand = (): number => {
      seed.value = (seed.value * 1103515245 + 12345) % 2147483648;

      return seed.value / 2147483648;
    };

    for (let run = 0; run < 200; run++) {
      const a = createStore(1);
      const b = createStore(2);

      a.fromJSON([paragraph('b1', 'First'), paragraph('b2', 'Second')]);
      b.applyRemoteUpdate(a.encodeStateAsUpdate());

      const hA = new UndoHistory(a.undoScope, createMockBlok());
      const hB = new UndoHistory(b.undoScope, createMockBlok());
      const ops: Array<[string, () => void]> = [
        ['A edit b1', () => {
          a.updateBlockData('b1', 'text', `${textOf(a, 'b1')} a`);
          hA.stopCapturing();
        }],
        ['B edit b1', () => {
          b.updateBlockData('b1', 'text', `b ${textOf(b, 'b1')}`);
          hB.stopCapturing();
        }],
        ['A add', () => {
          a.addBlock(paragraph(`a${run}-${idsOf(a).length}`, ''));
          hA.stopCapturing();
        }],
        ['B remove b2', () => {
          if (idsOf(b).includes('b2')) {
            b.removeBlock('b2');
            hB.stopCapturing();
          }
        }],
        ['A undo', () => hA.undo()],
        ['B undo', () => hB.undo()],
        ['A redo', () => hA.redo()],
        ['B redo', () => hB.redo()],
        ['sync', () => sync(a, b)],
      ];
      const trace: string[] = [];

      for (let step = 0; step < 10; step++) {
        const [name, op] = ops[Math.floor(rand() * ops.length)];

        trace.push(name);
        op();
      }
      sync(a, b);

      if (JSON.stringify(a.toJSON()) !== JSON.stringify(b.toJSON())) {
        failures.push(trace.join(' > '));
      }
    }

    expect(failures).toEqual([]);
  });
});

/** Cell (r, c) holds block `r<r>c<c>` and carries column id `c<c>`, row id `r<r>`. */
const grid = (rows: number, cols: number): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({ blocks: [`r${r}c${c}`], id: `c${c}`, rowId: `r${r}` }))),
});

const content = (store: Readable): CellContent[][] =>
  new TableModel(store.toJSON().find((block) => block.id === 'T')?.data ?? {})
    .snapshot().content as CellContent[][];

const rawContent = (store: Readable): unknown => dataOf(store, 'T').content;

/** Drive the real TableModel and write what Table.save() writes. */
const edit = (store: DocumentStore, operation: (model: TableModel) => void): void => {
  const model = new TableModel(store.toJSON().find((block) => block.id === 'T')?.data ?? {});

  operation(model);
  store.updateBlockData('T', 'content', model.snapshot().content);
};

const blocksGrid = (store: Readable): string[][] =>
  content(store).map(row => row.map(cell => cell.blocks.join('+')));

describe('concurrent undo — a table the peer restructured', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;
  let historyA: UndoHistory;

  beforeEach(() => {
    vi.clearAllMocks();
    storeA = createStore(1);
    storeB = createStore(2);
    storeA.fromJSON([{ id: 'T',
      type: 'table',
      data: grid(2, 2) }]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
    historyA = new UndoHistory(storeA.undoScope, createMockBlok());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // COL-4. B's add-column pads A's new row with an empty cell. Padding is not
  // content, so undo of "add row" still removes the row.
  it('removes the row this editor added when the peer only padded it with an empty column cell', () => {
    edit(storeA, (model) => {
      model.addRow(2);
      model.addBlockToCell(2, 0, 'a-new0');
      model.addBlockToCell(2, 1, 'a-new1');
    });
    sync(storeA, storeB);
    edit(storeB, (model) => {
      model.addColumn(2);
      [0, 1].forEach((row) => model.addBlockToCell(row, 2, `b-col-r${row}`));
    });
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(blocksGrid(storeA)).toEqual([['r0c0', 'r0c1', 'b-col-r0'], ['r1c0', 'r1c1', 'b-col-r1']]);
    expect(rawContent(storeA)).toEqual(rawContent(storeB));
  });

  // COL-5. Mirror of COL-4: B's add-row pads A's new column with an empty
  // cell. Undo of "add column" removes that padding with the column.
  it('removes the column this editor added when the peer only padded it with an empty row cell', () => {
    edit(storeA, (model) => {
      model.addColumn(2);
      [0, 1].forEach((row) => model.addBlockToCell(row, 2, `a-col-r${row}`));
    });
    sync(storeA, storeB);
    edit(storeB, (model) => {
      model.addRow(2);
    });
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(blocksGrid(storeA).map((row) => row.length)).toEqual([2, 2, 2]);
    expect(rawContent(storeA)).toEqual(rawContent(storeB));
  });

  it('keeps the row this editor added when the peer put content in it', () => {
    edit(storeA, (model) => {
      model.addRow(2);
      model.addBlockToCell(2, 0, 'a-new0');
      model.addBlockToCell(2, 1, 'a-new1');
    });
    sync(storeA, storeB);
    edit(storeB, (model) => {
      model.addColumn(2);
      [0, 1, 2].forEach((row) => model.addBlockToCell(row, 2, `b-col-r${row}`));
    });
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(blocksGrid(storeA).map((row) => row[2])).toEqual(['b-col-r0', 'b-col-r1', 'b-col-r2']);
    expect(rawContent(storeA)).toEqual(rawContent(storeB));
  });

  it('keeps a padded column cell the peer put content in, and redo brings the column back', () => {
    edit(storeA, (model) => {
      model.addColumn(2);
      [0, 1].forEach((row) => model.addBlockToCell(row, 2, `a-col-r${row}`));
    });
    sync(storeA, storeB);
    edit(storeB, (model) => {
      model.addRow(2);
      model.addBlockToCell(2, 2, 'b-typed');
    });
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(blocksGrid(storeA)[2]).toContain('b-typed');

    historyA.redo();
    sync(storeA, storeB);

    expect(blocksGrid(storeA).slice(0, 2).map((row) => row[2])).toEqual(['a-col-r0', 'a-col-r1']);
    expect(rawContent(storeA)).toEqual(rawContent(storeB));
  });

  it('redo brings back the column whose padding the undo removed', () => {
    edit(storeA, (model) => {
      model.addColumn(2);
      [0, 1].forEach((row) => model.addBlockToCell(row, 2, `a-col-r${row}`));
    });
    sync(storeA, storeB);
    edit(storeB, (model) => {
      model.addRow(2);
    });
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);
    historyA.redo();
    sync(storeA, storeB);

    expect(blocksGrid(storeA)).toEqual([['r0c0', 'r0c1', 'a-col-r0'], ['r1c0', 'r1c1', 'a-col-r1'], ['', '', '']]);
    expect(rawContent(storeA)).toEqual(rawContent(storeB));
  });

  it('brings back a deleted row while keeping the peer\'s edit in another row', () => {
    edit(storeA, (model) => model.deleteRow(0));
    sync(storeA, storeB);
    edit(storeB, (model) => model.addBlockToCell(0, 0, 'b-typed'));
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(blocksGrid(storeA)).toEqual([['r0c0', 'r0c1'], ['r1c0+b-typed', 'r1c1']]);
    expect(rawContent(storeA)).toEqual(rawContent(storeB));
  });

  it('undoes a column move without breaking the row the peer added meanwhile', () => {
    edit(storeA, (model) => model.moveColumn(0, 1));
    sync(storeA, storeB);
    edit(storeB, (model) => {
      model.addRow(2);
      [0, 1].forEach((column) => model.addBlockToCell(2, column, `b-row-c${column}`));
    });
    sync(storeA, storeB);

    historyA.undo();
    sync(storeA, storeB);

    expect(content(storeA).map((row) => row.map((cell) => cell.id))).toEqual([['c0', 'c1'], ['c0', 'c1'], ['c0', 'c1']]);
    expect(rawContent(storeA)).toEqual(rawContent(storeB));
  });
});
