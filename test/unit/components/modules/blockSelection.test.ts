import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlockSelection } from '../../../../src/components/modules/blockSelection';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../types';
import { SelectionUtils } from '../../../../src/components/selection';
import { Shortcuts } from '../../../../src/components/utils/shortcuts';
import * as utils from '../../../../src/components/utils';
import type { SanitizerConfig } from '../../../../types/configs';
import type { Block } from '../../../../src/components/block';

type ModuleOverrides = Partial<BlokModules>;

type SelectionSpy = {
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  clearSaved: ReturnType<typeof vi.fn>;
};

type BlockSelectionSetup = {
  blockSelection: BlockSelection;
  modules: BlokModules;
  blocks: Block[];
  selectionSpy: SelectionSpy;
  redactor: HTMLDivElement;
};

const createBlockStub = (options?: { html?: string; inputs?: HTMLElement[]; initiallySelected?: boolean }): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-testid', 'blok-element');
  holder.innerHTML = options?.html ?? '<p>Sample text</p>';

  /**
   * Mock scrollIntoView for test environment
   */
  holder.scrollIntoView = vi.fn();

  const inputs = options?.inputs ?? [ document.createElement('div') ];
  let isSelected = options?.initiallySelected ?? false;

  const blockStub = {
    holder,
    inputs,
    id: 'test-id',
    name: 'paragraph',
    save: vi.fn().mockResolvedValue({
      id: 'test',
      tool: 'paragraph',
      data: { text: 'Sample text' },
      tunes: {},
      time: 0,
    }),
    // Mock preservedData and preservedTunes for clipboard operations
    preservedData: { text: 'Sample text' },
    preservedTunes: {},
  };

  Object.defineProperty(blockStub, 'selected', {
    configurable: true,
    enumerable: true,
    get(): boolean {
      return isSelected;
    },
    set(nextState: boolean) {
      isSelected = nextState;
      holder.setAttribute('data-blok-selected', nextState ? 'true' : 'false');
    },
  });

  return blockStub as unknown as Block;
};

const createBlockSelection = (overrides: ModuleOverrides = {}): BlockSelectionSetup => {
  const redactor = document.createElement('div');
  const blocks = [
    createBlockStub(),
    createBlockStub(),
    createBlockStub(),
  ];

  const blockManager = {
    blocks,
    currentBlock: blocks[0],
    getBlockByIndex: vi.fn((index: number) => blocks[index]),
    getBlock: vi.fn((element: HTMLElement) => blocks.find((block) => block.holder === element) ?? null),
    removeSelectedBlocks: vi.fn(() => 0),
    insertDefaultBlockAtIndex: vi.fn(),
    deleteSelectedBlocksAndInsertReplacement: vi.fn(),
  };

  const defaults: ModuleOverrides = {
    BlockManager: blockManager as unknown as BlokModules['BlockManager'],
    Caret: {
      setToBlock: vi.fn(),
      insertContentAtCaretPosition: vi.fn(),
    } as unknown as BlokModules['Caret'],
    RectangleSelection: {
      clearSelection: vi.fn(),
      isRectActivated: vi.fn(() => false),
    } as unknown as BlokModules['RectangleSelection'],
    CrossBlockSelection: {
      clear: vi.fn(),
    } as unknown as BlokModules['CrossBlockSelection'],
    InlineToolbar: {
      close: vi.fn(),
    } as unknown as BlokModules['InlineToolbar'],
    Toolbar: {
      close: vi.fn(),
      moveAndOpenForMultipleBlocks: vi.fn(),
    } as unknown as BlokModules['Toolbar'],
    ReadOnly: {
      isEnabled: false,
    } as unknown as BlokModules['ReadOnly'],
    UI: {
      nodes: {
        redactor,
      },
    } as unknown as BlokModules['UI'],
    Paste: {
      MIME_TYPE: 'application/x-blok',
    } as unknown as BlokModules['Paste'],
  };

  const mergedState = { ...defaults,
    ...overrides } as BlokModules;
  const blockSelection = new BlockSelection({
    config: { sanitizer: {} } as BlokConfig,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  blockSelection.state = mergedState;

  const selectionSpy: SelectionSpy = {
    save: vi.fn(),
    restore: vi.fn(),
    clearSaved: vi.fn(),
  };

  (blockSelection as unknown as { selection: SelectionUtils }).selection = selectionSpy as unknown as SelectionUtils;

  return {
    blockSelection,
    modules: mergedState,
    blocks,
    selectionSpy,
    redactor,
  };
};

describe('BlockSelection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('allBlocksSelected', () => {
    it('returns true only when every block is selected', () => {
      const { blockSelection, blocks } = createBlockSelection();

      for (const currentBlock of blocks) {
        currentBlock.selected = true;
      }

      expect(blockSelection.allBlocksSelected).toBe(true);

      blocks[1].selected = false;

      expect(blockSelection.allBlocksSelected).toBe(false);
    });

    it('setter selects every block and clears cache', () => {
      const { blockSelection, blocks } = createBlockSelection();

      const cacheAware = blockSelection as unknown as { anyBlockSelectedCache: boolean | null };

      // Warm the cache with false
      expect(blockSelection.anyBlockSelected).toBe(false);
      expect(cacheAware.anyBlockSelectedCache).toBe(false);

      blockSelection.allBlocksSelected = true;

      expect(blocks.every((block) => block.selected)).toBe(true);
      expect(cacheAware.anyBlockSelectedCache).toBeNull();
    });
  });

  describe('anyBlockSelected', () => {
    it('reuses cached value until cache is cleared', () => {
      const { blockSelection, blocks } = createBlockSelection();

      expect(blockSelection.anyBlockSelected).toBe(false);

      blocks[0].selected = true;

      expect(blockSelection.anyBlockSelected).toBe(false);

      blockSelection.clearCache();

      expect(blockSelection.anyBlockSelected).toBe(true);
    });
  });

  describe('selectedBlocks', () => {
    it('returns only the blocks marked as selected', () => {
      const { blockSelection, blocks } = createBlockSelection();

      blocks[0].selected = true;
      blocks[2].selected = true;

      expect(blockSelection.selectedBlocks).toEqual([blocks[0], blocks[2]]);
    });
  });

  describe('selectBlock', () => {
    it('saves selection, clears native selection and selects block', () => {
      const { blockSelection, blocks, modules, selectionSpy } = createBlockSelection();
      const removeAllRanges = vi.fn();

      vi.spyOn(SelectionUtils, 'get').mockReturnValue({
        removeAllRanges,
      } as unknown as Selection);

      const inlineToolbarClose = modules.InlineToolbar.close as ReturnType<typeof vi.fn>;

      blockSelection.selectBlock(blocks[0]);

      expect(selectionSpy.save).toHaveBeenCalledTimes(1);
      expect(removeAllRanges).toHaveBeenCalledTimes(1);
      expect(blocks[0].selected).toBe(true);
      expect(inlineToolbarClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('unSelectBlockByIndex', () => {
    it('unselects the block by explicit index', () => {
      const { blockSelection, blocks, modules } = createBlockSelection();
      const blockManager = modules.BlockManager as unknown as {
        getBlockByIndex: (index: number) => Block | undefined;
      };

      blocks[2].selected = true;
      blockSelection.unSelectBlockByIndex(2);

      expect(blocks[2].selected).toBe(false);
      expect(blockManager.getBlockByIndex).toHaveBeenCalledWith(2);
    });

    it('falls back to current block when index is not provided', () => {
      const { blockSelection, blocks, modules } = createBlockSelection();
      const blockManager = modules.BlockManager as unknown as { currentBlock: Block | null };

      blockManager.currentBlock = blocks[1];
      blocks[1].selected = true;
      blockSelection.unSelectBlockByIndex(undefined);

      expect(blocks[1].selected).toBe(false);
    });
  });

  describe('unselectBlock', () => {
    it('clears selection on provided block and resets cache', () => {
      const { blockSelection, blocks } = createBlockSelection();
      const cacheAware = blockSelection as unknown as { anyBlockSelectedCache: boolean | null };

      cacheAware.anyBlockSelectedCache = true;
      blocks[1].selected = true;

      blockSelection.unselectBlock(blocks[1]);

      expect(blocks[1].selected).toBe(false);
      expect(cacheAware.anyBlockSelectedCache).toBeNull();
    });
  });

  describe('selectBlockByIndex', () => {
    it('selects block returned by block manager', () => {
      const { blockSelection, blocks } = createBlockSelection();

      blocks[2].selected = false;

      blockSelection.selectBlockByIndex(2);

      expect(blocks[2].selected).toBe(true);
    });

    it('ignores unknown block indexes', () => {
      const { blockSelection, modules } = createBlockSelection();
      const blockManager = modules.BlockManager as unknown as {
        getBlockByIndex: (index: number) => Block | undefined;
      };

      (blockManager.getBlockByIndex as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);

      expect(() => blockSelection.selectBlockByIndex(99)).not.toThrow();
    });
  });

  describe('clearSelection', () => {
    it('clears selected blocks on pointer interaction', () => {
      const { blockSelection, blocks, modules } = createBlockSelection();
      const rectangleSelection = modules.RectangleSelection as unknown as {
        clearSelection: () => void;
        isRectActivated: () => boolean;
      };
      const crossBlockSelection = modules.CrossBlockSelection as unknown as {
        clear: (reason?: Event) => void;
      };

      blocks[0].selected = true;
      blocks[1].selected = true;

      const event = new MouseEvent('click');

      blockSelection.clearSelection(event);

      expect(blocks[0].selected).toBe(false);
      expect(blocks[1].selected).toBe(false);
      expect(crossBlockSelection.clear).toHaveBeenCalledWith(event);
      expect(rectangleSelection.clearSelection).not.toHaveBeenCalled();
    });

    it('restores previous selection when requested', () => {
      const { blockSelection, selectionSpy } = createBlockSelection();
      const selectionAccessor = blockSelection as unknown as {
        needToSelectAll: boolean;
        readyToBlockSelection: boolean;
      };

      selectionAccessor.needToSelectAll = true;
      selectionAccessor.readyToBlockSelection = true;

      blockSelection.clearSelection(undefined, true);

      expect(selectionSpy.restore).toHaveBeenCalledTimes(1);
      expect(selectionAccessor.needToSelectAll).toBe(false);
      expect(selectionAccessor.readyToBlockSelection).toBe(false);
    });

    it('replaces selected blocks with printable keys when applicable', () => {
      const { blockSelection, blocks } = createBlockSelection();
      const replacerHost = blockSelection as unknown as {
        replaceSelectedBlocksWithPrintableKey: (event: KeyboardEvent) => void;
      };
      const replaceSpy = vi.spyOn(replacerHost, 'replaceSelectedBlocksWithPrintableKey');

      blocks[0].selected = true;

      vi.spyOn(utils, 'isPrintableKey').mockReturnValue(true);
      vi.spyOn(SelectionUtils, 'isSelectionExists', 'get').mockReturnValue(false);

      const event = new KeyboardEvent('keydown', { key: 'x' });

      Object.defineProperty(event, 'keyCode', { value: 88 });

      blockSelection.clearSelection(event);

      expect(replaceSpy).toHaveBeenCalledWith(event);
    });

    it('clears selected blocks even when rectangle selection is active', () => {
      const isRectActivatedMock = vi.fn(() => true);
      const rectangleClearSelectionMock = vi.fn();

      const { blockSelection, blocks } = createBlockSelection({
        RectangleSelection: {
          clearSelection: rectangleClearSelectionMock,
          isRectActivated: isRectActivatedMock,
        } as unknown as BlokModules['RectangleSelection'],
      });

      blocks[0].selected = true;
      blocks[1].selected = true;

      blockSelection.clearSelection();

      expect(blocks[0].selected).toBe(false);
      expect(blocks[1].selected).toBe(false);
      expect(rectangleClearSelectionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('copySelectedBlocks', () => {
    it('serializes selected blocks and writes clipboard data', async () => {
      const { blockSelection, blocks, modules } = createBlockSelection();
      const clipboardData = {
        setData: vi.fn(),
      };
      const clipboardEvent = {
        preventDefault: vi.fn(),
        clipboardData,
      } as unknown as ClipboardEvent;

      const firstBlock = blocks[0];
      const secondBlock = blocks[1];

      firstBlock.holder.innerHTML = '<p>First</p>';
      secondBlock.holder.innerHTML = '<p>Second</p>';
      firstBlock.selected = true;
      secondBlock.selected = true;

      await blockSelection.copySelectedBlocks(clipboardEvent);

      expect(clipboardEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', 'First\n\nSecond');
      expect(clipboardData.setData).toHaveBeenCalledWith('text/html', '<p>First</p><p>Second</p>');
      expect(clipboardData.setData).toHaveBeenCalledWith(
        (modules.Paste as unknown as { MIME_TYPE: string }).MIME_TYPE,
        expect.stringContaining('"tool":"paragraph"')
      );
      // copySelectedBlocks now uses preservedData instead of calling async block.save()
      // This ensures clipboard operations are synchronous for browser compatibility
      expect(firstBlock.save).not.toHaveBeenCalled();
      expect(secondBlock.save).not.toHaveBeenCalled();
    });
  });

  describe('sanitizerConfig', () => {
    it('provides default tag white-list when no overrides supplied', () => {
      const { blockSelection } = createBlockSelection();
      const config = (blockSelection as unknown as { sanitizerConfig: SanitizerConfig }).sanitizerConfig;

      expect(config).toMatchObject({
        p: {},
        img: {
          src: true,
          width: true,
          height: true,
        },
        a: { href: true },
      });
    });

    it('merges provided sanitizer overrides with defaults', () => {
      const { blockSelection } = createBlockSelection();
      const override: SanitizerConfig = {
        a: { rel: 'nofollow' },
      };
      const internals = blockSelection as unknown as { config: BlokConfig };

      internals.config = {
        ...internals.config,
        sanitizer: override,
      };

      const config = (blockSelection as unknown as { sanitizerConfig: SanitizerConfig }).sanitizerConfig;

      expect(config.a).toMatchObject({
        href: true,
        rel: 'nofollow',
      });
    });
  });

  describe('toggleReadOnly', () => {
    it('removes native selection and unselects blocks', () => {
      const { blockSelection, blocks } = createBlockSelection();
      const selectionMock = {
        removeAllRanges: vi.fn(),
      };

      for (const currentBlock of blocks) {
        currentBlock.selected = true;
      }

      vi.spyOn(SelectionUtils, 'get').mockReturnValue(selectionMock as unknown as Selection);

      blockSelection.toggleReadOnly();

      expect(selectionMock.removeAllRanges).toHaveBeenCalledTimes(1);
      expect(blocks.every((block) => !block.selected)).toBe(true);
    });
  });

  describe('handleCommandA', () => {
    it('selects all blocks on second invocation for single-input tools', () => {
      const { blockSelection, blocks } = createBlockSelection();
      const internal = blockSelection as unknown as { needToSelectAll: boolean };
      const selectAllSpy = vi.spyOn(blockSelection as unknown as { selectAllBlocks: () => void }, 'selectAllBlocks');
      const event = {
        target: blocks[0].holder,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      (blockSelection as unknown as { selection: SelectionUtils }).selection = {
        save: vi.fn(),
        restore: vi.fn(),
        clearSaved: vi.fn(),
      } as unknown as SelectionUtils;

      const handler = blockSelection as unknown as { handleCommandA: (keyboardEvent: KeyboardEvent) => void };

      handler.handleCommandA(event);
      expect(internal.needToSelectAll).toBe(true);
      expect(selectAllSpy).not.toHaveBeenCalled();

      handler.handleCommandA(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(selectAllSpy).toHaveBeenCalledTimes(1);
      expect(internal.needToSelectAll).toBe(false);
    });

    it('selects current block when tool exposes multiple inputs', () => {
      const multiInput = document.createElement('div');
      const { blockSelection, blocks } = createBlockSelection();
      const blockManager = (blockSelection as unknown as { Blok: BlokModules }).Blok.BlockManager;
      const targetBlock = blocks[0];

      (targetBlock as unknown as { inputs: HTMLElement[] }).inputs = [multiInput, document.createElement('div')];
      const selectBlockSpy = vi.spyOn(blockSelection, 'selectBlock');
      const handler = blockSelection as unknown as { handleCommandA: (keyboardEvent: KeyboardEvent) => void };

      const event = {
        target: targetBlock.holder,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      (blockManager.getBlock as (element: HTMLElement) => Block | null).call(blockManager, targetBlock.holder);

      handler.handleCommandA(event);
      expect(selectBlockSpy).not.toHaveBeenCalled();

      handler.handleCommandA(event);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(selectBlockSpy).toHaveBeenCalledWith(targetBlock);
    });

    it('defers to native input selection before enabling block selection', () => {
      const { blockSelection, modules } = createBlockSelection();
      const rectangleSelection = modules.RectangleSelection as unknown as { clearSelection: ReturnType<typeof vi.fn> };
      const handler = blockSelection as unknown as {
        handleCommandA: (event: KeyboardEvent) => void;
        readyToBlockSelection: boolean;
      };
      const event = {
        target: document.createElement('input'),
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      handler.handleCommandA(event);

      expect(rectangleSelection.clearSelection).toHaveBeenCalledTimes(1);
      expect(handler.readyToBlockSelection).toBe(true);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('replaceSelectedBlocksWithPrintableKey', () => {
    it('inserts new block and types printable character', () => {
      const { blockSelection, modules } = createBlockSelection();
      const blockManager = modules.BlockManager as unknown as {
        deleteSelectedBlocksAndInsertReplacement: ReturnType<typeof vi.fn>;
      };
      const caret = modules.Caret as unknown as {
        setToBlock: ReturnType<typeof vi.fn>;
        insertContentAtCaretPosition: ReturnType<typeof vi.fn>;
      };
      const insertedBlock = createBlockStub();
      const delaySpy = vi.spyOn(utils, 'delay').mockImplementation((fn) => {
        return () => fn();
      });

      blockManager.deleteSelectedBlocksAndInsertReplacement = vi.fn().mockReturnValue(insertedBlock);

      const host = blockSelection as unknown as {
        replaceSelectedBlocksWithPrintableKey: (event: KeyboardEvent) => void;
      };

      host.replaceSelectedBlocksWithPrintableKey({ key: 'x' } as KeyboardEvent);

      expect(blockManager.deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
      expect(caret.setToBlock).toHaveBeenCalledWith(insertedBlock);
      expect(caret.insertContentAtCaretPosition).toHaveBeenCalledWith('x');
      expect(delaySpy).toHaveBeenCalledTimes(1);
    });

    it('inserts empty string for non-printable keys', () => {
      const { blockSelection, modules } = createBlockSelection();
      const blockManager = modules.BlockManager as unknown as {
        deleteSelectedBlocksAndInsertReplacement: ReturnType<typeof vi.fn>;
      };
      const caret = modules.Caret as unknown as {
        setToBlock: ReturnType<typeof vi.fn>;
        insertContentAtCaretPosition: ReturnType<typeof vi.fn>;
      };
      const insertedBlock = createBlockStub();

      vi.spyOn(utils, 'delay').mockImplementation((fn) => {
        return () => fn();
      });

      blockManager.deleteSelectedBlocksAndInsertReplacement = vi.fn().mockReturnValue(insertedBlock);

      const host = blockSelection as unknown as {
        replaceSelectedBlocksWithPrintableKey: (event: KeyboardEvent) => void;
      };

      host.replaceSelectedBlocksWithPrintableKey({ key: 'Enter' } as KeyboardEvent);

      expect(blockManager.deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
      expect(caret.setToBlock).toHaveBeenCalledWith(insertedBlock);
      expect(caret.insertContentAtCaretPosition).toHaveBeenCalledWith('');
    });
  });

  describe('prepare', () => {
    it('creates selection instance and registers shortcut handler', () => {
      const { blockSelection, redactor } = createBlockSelection();
      const shortcutsAdd = vi.spyOn(Shortcuts, 'add').mockImplementation(() => undefined);

      blockSelection.prepare();

      expect(shortcutsAdd).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'CMD+A',
          on: redactor })
      );
      expect((blockSelection as unknown as { selection: SelectionUtils }).selection).toBeInstanceOf(SelectionUtils);
    });

    it('handles read-only mode by selecting all blocks via shortcut handler', () => {
      const { blockSelection, modules, blocks } = createBlockSelection();

      Object.defineProperty(modules.ReadOnly, 'isEnabled', {
        value: true,
        writable: true,
        configurable: true,
      });
      const shortcutsAdd = vi.spyOn(Shortcuts, 'add').mockImplementation(() => undefined);

      blockSelection.prepare();

      expect(shortcutsAdd).toHaveBeenCalledTimes(1);

      const handler = (shortcutsAdd.mock.calls[0]?.[0] as { handler: (event: KeyboardEvent) => void }).handler;
      const event = {
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      handler(event);

      // Verify the observable outcome: all blocks should be selected
      expect(blocks.every((block) => block.selected)).toBe(true);
      expect(blockSelection.allBlocksSelected).toBe(true);
    });
  });

  describe('destroy', () => {
    it('removes the CMD+A shortcut', () => {
      const { blockSelection, modules } = createBlockSelection();
      const shortcutsRemove = vi.spyOn(Shortcuts, 'remove').mockImplementation(() => undefined);

      blockSelection.destroy();

      expect(shortcutsRemove).toHaveBeenCalledWith(modules.UI.nodes.redactor, 'CMD+A');
    });
  });

  describe('navigation mode', () => {
    describe('navigationModeEnabled', () => {
      it('returns false by default', () => {
        const { blockSelection } = createBlockSelection();

        expect(blockSelection.navigationModeEnabled).toBe(false);
      });

      it('returns true after enabling navigation mode', () => {
        const { blockSelection } = createBlockSelection();

        blockSelection.enableNavigationMode();

        expect(blockSelection.navigationModeEnabled).toBe(true);
      });
    });

    describe('navigationFocusedBlock', () => {
      it('returns undefined when navigation mode is disabled', () => {
        const { blockSelection } = createBlockSelection();

        expect(blockSelection.navigationFocusedBlock).toBeUndefined();
      });

      it('returns the focused block when navigation mode is enabled', () => {
        const { blockSelection, blocks, modules } = createBlockSelection();
        const blockManager = modules.BlockManager as unknown as { currentBlockIndex: number };

        blockManager.currentBlockIndex = 1;

        blockSelection.enableNavigationMode();

        expect(blockSelection.navigationFocusedBlock).toBe(blocks[1]);
      });
    });

    describe('enableNavigationMode', () => {
      it('sets navigation focus to current block', () => {
        const { blockSelection, blocks, modules } = createBlockSelection();
        const blockManager = modules.BlockManager as unknown as { currentBlockIndex: number };

        blockManager.currentBlockIndex = 1;

        blockSelection.enableNavigationMode();

        expect(blockSelection.navigationModeEnabled).toBe(true);
        expect(blockSelection.navigationFocusedBlock).toBe(blocks[1]);
        expect(blocks[1].holder).toHaveAttribute('data-blok-navigation-focused', 'true');
      });

      it('starts from first block when no current block', () => {
        const { blockSelection, blocks, modules } = createBlockSelection();
        const blockManager = modules.BlockManager as unknown as { currentBlockIndex: number };

        blockManager.currentBlockIndex = -1;

        blockSelection.enableNavigationMode();

        expect(blockSelection.navigationFocusedBlock).toBe(blocks[0]);
      });

      it('does nothing if already enabled', () => {
        const { blockSelection, blocks, modules } = createBlockSelection();
        const blockManager = modules.BlockManager as unknown as { currentBlockIndex: number };

        blockManager.currentBlockIndex = 0;

        blockSelection.enableNavigationMode();
        blockManager.currentBlockIndex = 2;
        blockSelection.enableNavigationMode();

        expect(blockSelection.navigationFocusedBlock).toBe(blocks[0]);
      });
    });

    describe('disableNavigationMode', () => {
      it('removes navigation highlight from focused block', () => {
        const { blockSelection, blocks, modules } = createBlockSelection();
        const blockManager = modules.BlockManager as unknown as { currentBlockIndex: number };

        blockManager.currentBlockIndex = 1;

        blockSelection.enableNavigationMode();
        blockSelection.disableNavigationMode();

        expect(blockSelection.navigationModeEnabled).toBe(false);
        expect(blocks[1].holder).not.toHaveAttribute('data-blok-navigation-focused');
      });

      it('focuses block for editing when requested', () => {
        const { blockSelection, blocks, modules } = createBlockSelection();
        const blockManager = modules.BlockManager as unknown as { currentBlockIndex: number };
        const caret = modules.Caret as unknown as {
          setToBlock: ReturnType<typeof vi.fn>;
          positions: { END: string };
        };

        caret.positions = { END: 'end' };
        blockManager.currentBlockIndex = 1;

        blockSelection.enableNavigationMode();
        blockSelection.disableNavigationMode(true);

        expect(caret.setToBlock).toHaveBeenCalledWith(blocks[1], 'end');
        expect(blockManager.currentBlockIndex).toBe(1);
      });

      it('does nothing if not enabled', () => {
        const { blockSelection, modules } = createBlockSelection();
        const caret = modules.Caret as unknown as { setToBlock: ReturnType<typeof vi.fn> };

        blockSelection.disableNavigationMode(true);

        expect(caret.setToBlock).not.toHaveBeenCalled();
      });
    });

    describe('navigateNext', () => {
      it('moves focus to next block', () => {
        const { blockSelection, blocks, modules } = createBlockSelection();
        const blockManager = modules.BlockManager as unknown as { currentBlockIndex: number };

        blockManager.currentBlockIndex = 0;

        blockSelection.enableNavigationMode();

        const result = blockSelection.navigateNext();

        expect(result).toBe(true);
        expect(blockSelection.navigationFocusedBlock).toBe(blocks[1]);
        expect(blocks[0].holder).not.toHaveAttribute('data-blok-navigation-focused');
        expect(blocks[1].holder).toHaveAttribute('data-blok-navigation-focused', 'true');
      });

      it('returns false when at last block', () => {
        const { blockSelection, blocks, modules } = createBlockSelection();
        const blockManager = modules.BlockManager as unknown as { currentBlockIndex: number };

        blockManager.currentBlockIndex = 2;

        blockSelection.enableNavigationMode();

        const result = blockSelection.navigateNext();

        expect(result).toBe(false);
        expect(blockSelection.navigationFocusedBlock).toBe(blocks[2]);
      });

      it('returns false when navigation mode is disabled', () => {
        const { blockSelection } = createBlockSelection();

        const result = blockSelection.navigateNext();

        expect(result).toBe(false);
      });
    });

    describe('navigatePrevious', () => {
      it('moves focus to previous block', () => {
        const { blockSelection, blocks, modules } = createBlockSelection();
        const blockManager = modules.BlockManager as unknown as { currentBlockIndex: number };

        blockManager.currentBlockIndex = 2;

        blockSelection.enableNavigationMode();

        const result = blockSelection.navigatePrevious();

        expect(result).toBe(true);
        expect(blockSelection.navigationFocusedBlock).toBe(blocks[1]);
        expect(blocks[2].holder).not.toHaveAttribute('data-blok-navigation-focused');
        expect(blocks[1].holder).toHaveAttribute('data-blok-navigation-focused', 'true');
      });

      it('returns false when at first block', () => {
        const { blockSelection, blocks, modules } = createBlockSelection();
        const blockManager = modules.BlockManager as unknown as { currentBlockIndex: number };

        blockManager.currentBlockIndex = 0;

        blockSelection.enableNavigationMode();

        const result = blockSelection.navigatePrevious();

        expect(result).toBe(false);
        expect(blockSelection.navigationFocusedBlock).toBe(blocks[0]);
      });

      it('returns false when navigation mode is disabled', () => {
        const { blockSelection } = createBlockSelection();

        const result = blockSelection.navigatePrevious();

        expect(result).toBe(false);
      });
    });

    describe('clearSelection disables navigation mode', () => {
      it('disables navigation mode when selection is cleared', () => {
        const { blockSelection, modules } = createBlockSelection();
        const blockManager = modules.BlockManager as unknown as { currentBlockIndex: number };

        blockManager.currentBlockIndex = 1;

        blockSelection.enableNavigationMode();
        expect(blockSelection.navigationModeEnabled).toBe(true);

        blockSelection.clearSelection();

        expect(blockSelection.navigationModeEnabled).toBe(false);
      });
    });
  });
});
