/**
 * Regression coverage for BUG #9 — after Cmd/Ctrl+D the caret must land in the
 * NEW copy ready to edit. Before the fix `duplicateBlocksInPlace` left the
 * duplicates block-selected (via DragOperations.applyDuplicates) and only
 * repositioned the toolbar, so the user ended block-selected, not editing.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { DragController as DragManager } from '../../../../../src/components/modules/drag/DragController';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../src/components/block';
import * as tooltip from '../../../../../src/components/utils/tooltip';
import * as announcer from '../../../../../src/components/utils/announcer';

vi.mock(
  '../../../../../src/components/modules/drag/utils/ColumnDropAnimation',
  () => ({
    animateColumnWidths: vi.fn(),
    captureSiblingTops: vi.fn().mockReturnValue([]),
    playSiblingShift: vi.fn(),
    settleDragPreview: vi.fn(),
    finishColumnDropAnimations: vi.fn(),
  })
);

const createBlockStub = (id: string): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  let isSelected = false;
  const block = {
    id,
    name: 'paragraph',
    holder,
    stretched: false,
    contentIds: [] as string[],
    parentId: null as string | null,
    call: vi.fn(),
    save: vi.fn().mockResolvedValue({ data: { text: id }, tunes: {} }),
  };

  Object.defineProperty(block, 'selected', {
    configurable: true,
    enumerable: true,
    get: () => isSelected,
    set: (value: boolean) => {
      isSelected = value;
    },
  });

  return block as unknown as Block;
};

type CaretMock = {
  setToBlock: Mock;
  positions: { START: string; END: string; DEFAULT: string };
};

type DupSetup = {
  dragManager: DragManager;
  blocks: Block[];
  caret: CaretMock;
  clearSelection: Mock;
  selectBlock: Mock;
  moveAndOpen: Mock;
  blockSelection: { selectedBlocks: Block[]; clearSelection: Mock; selectBlock: Mock };
};

const createSetup = (dups: Block | Block[]): DupSetup => {
  const dupQueue = Array.isArray(dups) ? [...dups] : [dups];
  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-blok-editor', '');

  const blocks = [createBlockStub('block-1'), createBlockStub('block-2')];
  const allBlocks = [...blocks, ...dupQueue];

  // Hand out one fresh copy per insert() call so a multi-block selection yields
  // distinct duplicated blocks (single-block setups still get their one dup).
  let insertCount = 0;
  const blockManager = {
    blocks,
    getBlockIndex: vi.fn((block: Block) => allBlocks.indexOf(block)),
    getBlockByIndex: vi.fn((index: number) => blocks[index]),
    getBlockById: vi.fn((id: string) => allBlocks.find((b) => b.id === id)),
    move: vi.fn(),
    insert: vi.fn(() => dupQueue[insertCount++] ?? dupQueue[dupQueue.length - 1]),
    setBlockParent: vi.fn(),
    setBlockIndent: vi.fn(),
  };

  const clearSelection = vi.fn();
  const selectBlock = vi.fn();
  const blockSelection = {
    selectedBlocks: [] as Block[],
    clearSelection,
    selectBlock,
  };

  const moveAndOpen = vi.fn();
  const toolbar = {
    close: vi.fn(),
    moveAndOpen,
    skipNextSettingsToggle: vi.fn(),
  };

  const caret: CaretMock = {
    setToBlock: vi.fn(),
    positions: { START: 'start', END: 'end', DEFAULT: 'default' },
  };

  const ui = {
    nodes: { wrapper, redactor: document.createElement('div'), holder: document.createElement('div') },
    contentRect: { left: 0 },
  };

  const i18n = { t: vi.fn((key: string) => key), has: vi.fn(() => false) };

  const yjsManager = {
    transact: vi.fn((cb: () => void) => cb()),
    transactMoves: vi.fn((cb: () => void) => cb()),
  };

  const state = {
    BlockManager: blockManager as unknown as BlokModules['BlockManager'],
    BlockSelection: blockSelection as unknown as BlokModules['BlockSelection'],
    Toolbar: toolbar as unknown as BlokModules['Toolbar'],
    Caret: caret as unknown as BlokModules['Caret'],
    UI: ui as unknown as BlokModules['UI'],
    I18n: i18n as unknown as BlokModules['I18n'],
    YjsManager: yjsManager as unknown as BlokModules['YjsManager'],
  } as BlokModules;

  const dragManager = new DragManager({
    config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  dragManager.state = state;
  void dragManager.prepare();

  return { dragManager, blocks, caret, clearSelection, selectBlock, moveAndOpen, blockSelection };
};

describe('duplicateBlocksInPlace caret placement (BUG #9)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tooltip, 'hide').mockImplementation(() => undefined);
    vi.spyOn(announcer, 'announce').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('places the caret into the duplicated copy instead of block-selecting it', async () => {
    const dup = createBlockStub('dup-1');
    const { dragManager, blocks, caret, clearSelection } = createSetup(dup);

    await dragManager.duplicateBlocksInPlace(blocks[0]);

    // The lingering block selection from applyDuplicates is cleared, and a text
    // caret lands at the end of the new copy ready to edit (Notion parity).
    expect(clearSelection).toHaveBeenCalled();
    expect(caret.setToBlock).toHaveBeenCalledWith(dup, caret.positions.END);
  });

  it('briefly highlights the duplicated copy as just-added (blue arrival pulse)', async () => {
    const dup = createBlockStub('dup-1');
    const { dragManager, blocks } = createSetup(dup);

    expect(dup.holder.classList.contains('blok-block--target')).toBe(false);

    await dragManager.duplicateBlocksInPlace(blocks[0]);

    // Notion parity: a freshly duplicated block gets the same blue "just added"
    // arrival pulse as a hash-navigated block (the `blok-block--target` class,
    // whose keyframes tween `var(--blok-selection)`), signalling what just
    // appeared. Placing the caret alone (BUG #9) gave no visible cue.
    expect(dup.holder.classList.contains('blok-block--target')).toBe(true);
  });

  it('keeps the duplicated blocks block-selected when the source was a block selection', async () => {
    const dup1 = createBlockStub('dup-1');
    const dup2 = createBlockStub('dup-2');
    const { dragManager, blocks, caret, selectBlock, blockSelection } = createSetup([dup1, dup2]);

    // Source: a multi-block BLOCK selection (both blocks selected).
    for (const block of blocks) {
      block.selected = true;
    }
    blockSelection.selectedBlocks = blocks;

    await dragManager.duplicateBlocksInPlace(blocks[0]);

    // Notion parity: duplicating a block selection keeps the NEW copies selected
    // (so the duplicate move can be repeated), rather than collapsing to a caret.
    expect(selectBlock).toHaveBeenCalledWith(dup1);
    expect(selectBlock).toHaveBeenCalledWith(dup2);
    expect(caret.setToBlock).not.toHaveBeenCalled();
  });
});
