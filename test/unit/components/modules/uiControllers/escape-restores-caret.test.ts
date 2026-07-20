/**
 * Regression coverage for BUG #19 — pressing Escape after Cmd+A twice (select
 * ALL blocks) must clear the highlight AND return a text caret. Before the fix
 * the Escape handler called clearSelection with the default restoreSelection
 * (false), and selectAllBlocks had already removed the native range, so the user
 * was left with no caret at all.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { KeyboardController } from '../../../../../src/components/modules/uiControllers/controllers/keyboard';
import type { Block } from '../../../../../src/components/block';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { SelectionUtils } from '../../../../../src/components/selection/index';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';

const createBlockStub = (id: string): Block => ({
  id,
  name: 'paragraph',
  holder: document.createElement('div'),
} as unknown as Block);

type Mocks = {
  clearSelection: ReturnType<typeof vi.fn>;
  setToBlock: ReturnType<typeof vi.fn>;
  block: Block;
};

const createController = (mocks: Mocks): KeyboardController => {
  const controller = new KeyboardController({
    config: {},
    eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as KeyboardController['eventsDispatcher'],
    someToolbarOpened: () => false,
  });

  const blok = {
    BlockSelection: {
      navigationModeEnabled: false,
      anyBlockSelected: true,
      allBlocksSelected: true,
      selectedBlocks: [mocks.block],
      clearSelection: mocks.clearSelection,
      disableNavigationMode: vi.fn(),
    },
    Toolbar: {
      toolbox: { opened: false, close: vi.fn() },
      close: vi.fn(),
    },
    InlineToolbar: {
      opened: false,
      hasNestedPopoverOpen: false,
      close: vi.fn(),
      closeNestedPopover: vi.fn(),
    },
    Caret: {
      setToBlock: mocks.setToBlock,
      positions: { START: 'start', END: 'end', DEFAULT: 'default' },
    },
    BlockManager: { currentBlock: undefined },
    DragManager: { isDragging: false },
  } as unknown as BlokModules;

  controller.state = blok;

  return controller;
};

describe('Escape from all-blocks selection restores the caret (BUG #19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(PopoverRegistry.instance, 'hasOpenPopovers').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears selection with restoreSelection=true and focuses a selected block', () => {
    // No native range survives select-all-blocks, so the restore is a no-op and
    // the caret must fall back to a previously selected block.
    vi.spyOn(SelectionUtils, 'isSelectionExists', 'get').mockReturnValue(false);

    const clearSelection = vi.fn();
    const setToBlock = vi.fn();
    const block = createBlockStub('block-1');

    const controller = createController({ clearSelection, setToBlock, block });
    const event = new KeyboardEvent('keydown', { key: 'Escape' });

    (controller as unknown as { handleEscape: (e: KeyboardEvent) => void }).handleEscape(event);

    expect(clearSelection).toHaveBeenCalledWith(event, true);
    expect(setToBlock).toHaveBeenCalledWith(block, 'end');
  });
});
