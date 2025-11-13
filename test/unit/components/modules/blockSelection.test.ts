import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BlockSelection from '../../../../src/components/modules/blockSelection';
import EventsDispatcher from '../../../../src/components/utils/events';
import type { EditorEventMap } from '../../../../src/components/events';
import type { EditorModules } from '../../../../src/types-internal/editor-modules';
import type { EditorConfig } from '../../../../types';
import SelectionUtils from '../../../../src/components/selection';
import Shortcuts from '../../../../src/components/utils/shortcuts';
import type Block from '../../../../src/components/block';

type ModuleOverrides = Partial<EditorModules>;

type SelectionSpy = {
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  clearSaved: ReturnType<typeof vi.fn>;
};

type BlockSelectionSetup = {
  blockSelection: BlockSelection;
  modules: EditorModules;
  blocks: Block[];
  selectionSpy: SelectionSpy;
  redactor: HTMLDivElement;
};

const createBlockStub = (options?: { html?: string; inputs?: HTMLElement[]; initiallySelected?: boolean }): Block => {
  const holder = document.createElement('div');

  holder.className = 'ce-block';
  holder.innerHTML = options?.html ?? '<p>Sample text</p>';

  const inputs = options?.inputs ?? [ document.createElement('div') ];
  let isSelected = options?.initiallySelected ?? false;

  const blockStub = {
    holder,
    inputs,
    save: vi.fn().mockResolvedValue({
      id: 'test',
      tool: 'paragraph',
      data: { text: 'Sample text' },
      tunes: {},
      time: 0,
    }),
  };

  Object.defineProperty(blockStub, 'selected', {
    configurable: true,
    enumerable: true,
    get(): boolean {
      return isSelected;
    },
    set(nextState: boolean) {
      isSelected = nextState;
      holder.classList.toggle('ce-block--selected', nextState);
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
  };

  const defaults: ModuleOverrides = {
    BlockManager: blockManager as unknown as EditorModules['BlockManager'],
    Caret: {
      setToBlock: vi.fn(),
      insertContentAtCaretPosition: vi.fn(),
    } as unknown as EditorModules['Caret'],
    RectangleSelection: {
      clearSelection: vi.fn(),
      isRectActivated: vi.fn(() => false),
    } as unknown as EditorModules['RectangleSelection'],
    CrossBlockSelection: {
      clear: vi.fn(),
    } as unknown as EditorModules['CrossBlockSelection'],
    InlineToolbar: {
      close: vi.fn(),
    } as unknown as EditorModules['InlineToolbar'],
    ReadOnly: {
      isEnabled: false,
    } as unknown as EditorModules['ReadOnly'],
    UI: {
      nodes: {
        redactor,
      },
    } as unknown as EditorModules['UI'],
    Paste: {
      MIME_TYPE: 'application/editorjs',
    } as unknown as EditorModules['Paste'],
  };

  const mergedState = { ...defaults,
    ...overrides } as EditorModules;
  const blockSelection = new BlockSelection({
    config: { sanitizer: {} } as EditorConfig,
    eventsDispatcher: new EventsDispatcher<EditorEventMap>(),
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
      expect(firstBlock.save).toHaveBeenCalledTimes(1);
      expect(secondBlock.save).toHaveBeenCalledTimes(1);
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
      expect(blocks.every((block) => block.selected === false)).toBe(true);
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
      const blockManager = (blockSelection as unknown as { Editor: EditorModules }).Editor.BlockManager;
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
  });
});


