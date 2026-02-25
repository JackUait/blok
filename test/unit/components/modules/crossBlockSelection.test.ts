import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CrossBlockSelection } from '../../../../src/components/modules/crossBlockSelection';
import * as _ from '../../../../src/components/utils';
import type { Block } from '../../../../src/components/block';
import type { Listeners } from '../../../../src/components/utils/listeners';

type MutableSelection = Selection & {
  isCollapsed: boolean;
  removeAllRanges: ReturnType<typeof vi.fn>;
  addRange: ReturnType<typeof vi.fn>;
  rangeCount: number;
  anchorNode: Node | null;
  focusNode: Node | null;
};

type BlockWithSelection = Block & {
  scrollIntoView: ReturnType<typeof vi.fn>;
};

const accessPrivate = <T>(instance: CrossBlockSelection, key: string): T =>
  (instance as unknown as Record<string, T>)[key];

const setPrivate = <T>(instance: CrossBlockSelection, key: string, value: T): void => {
  // eslint-disable-next-line no-param-reassign
  (instance as unknown as Record<string, T>)[key] = value;
};

const createBlockStub = (): BlockWithSelection => {
  const holder = document.createElement('div');

  holder.scrollIntoView = vi.fn();
  let selected = false;

  const stub = {
    holder,
  } as Record<string, unknown>;

  Object.defineProperty(stub, 'selected', {
    configurable: true,
    get: () => selected,
    set: (value: boolean) => {
      selected = value;
    },
  });

  return stub as unknown as BlockWithSelection;
};

describe('CrossBlockSelection', () => {
  let crossBlockSelection: CrossBlockSelection;
  let blocks: BlockWithSelection[];
  let toolbarClose: ReturnType<typeof vi.fn>;
  let inlineToolbarClose: ReturnType<typeof vi.fn>;
  let blockSelectionClearCache: ReturnType<typeof vi.fn>;
  let blockSelectionClearSelection: ReturnType<typeof vi.fn>;
  let caretSetToBlock: ReturnType<typeof vi.fn>;
  let selectionMock: MutableSelection;
  let redactor: HTMLElement;

  beforeEach(() => {
    toolbarClose = vi.fn();
    inlineToolbarClose = vi.fn();
    blockSelectionClearCache = vi.fn();
    blockSelectionClearSelection = vi.fn();
    caretSetToBlock = vi.fn();

    blocks = Array.from({ length: 4 }, () => createBlockStub());

    crossBlockSelection = new CrossBlockSelection({
      config: {},
      eventsDispatcher: {
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as typeof crossBlockSelection['eventsDispatcher'],
    });

    redactor = document.createElement('div');

    blocks.forEach((block) => {
      redactor.appendChild(block.holder);
    });

    const findBlockByNode = (node: Node | null): BlockWithSelection | null => {
      if (!node) {
        return null;
      }

      return (
        blocks.find((candidate) => candidate.holder === node || candidate.holder.contains(node)) ?? null
      );
    };

    const blockManager = {
      blocks,
      currentBlock: blocks[0],
      getBlock: vi.fn((element: HTMLElement) => findBlockByNode(element)),
      getBlockByChildNode: vi.fn((node: Node) => findBlockByNode(node)),
      resolveToRootBlock: vi.fn((block: Block) => block),
    };

    crossBlockSelection.state = {
      BlockManager: blockManager,
      BlockSelection: {
        clearCache: blockSelectionClearCache,
        clearSelection: blockSelectionClearSelection,
        anyBlockSelected: false,
        selectedBlocks: [],
      },
      InlineToolbar: {
        close: inlineToolbarClose,
      },
      Toolbar: {
        close: toolbarClose,
        moveAndOpenForMultipleBlocks: vi.fn(),
        nodes: {
          wrapper: document.createElement('div'),
        },
      },
      Caret: {
        positions: {
          START: 'start',
          END: 'end',
          DEFAULT: 'default',
        },
        setToBlock: caretSetToBlock,
      },
      UI: {
        nodes: {
          redactor,
        },
      },
      DragManager: {
        isDragging: false,
      },
      BlockSettings: {
        opened: false,
      },
    } as unknown as CrossBlockSelection['Blok'];

    setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
    setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[0]);

    selectionMock = {
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
      rangeCount: 0,
      anchorNode: null,
      focusNode: null,
      isCollapsed: true,
    } as unknown as MutableSelection;

    vi.spyOn(window, 'getSelection').mockReturnValue(selectionMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('prepare', () => {
    it('subscribes to document mousedown and forwards events to enableCrossBlockSelection', async () => {
      const listeners = accessPrivate<Listeners>(crossBlockSelection, 'listeners');
      const onSpy = vi.spyOn(listeners, 'on');
      const enableSpy = vi.spyOn(
        crossBlockSelection as unknown as { enableCrossBlockSelection: (event: MouseEvent) => void },
        'enableCrossBlockSelection'
      );
      let capturedHandler: ((event: MouseEvent) => void) | undefined;

      onSpy.mockImplementation((_element, _event, handler) => {
        capturedHandler = handler as (event: MouseEvent) => void;

        return 'listener-id';
      });

      await crossBlockSelection.prepare();

      expect(onSpy).toHaveBeenCalledWith(document, 'mousedown', expect.any(Function));
      expect(capturedHandler).toBeDefined();

      const event = new MouseEvent('mousedown');

      capturedHandler?.(event);

      expect(enableSpy).toHaveBeenCalledWith(event);
    });
  });

  describe('watchSelection', () => {
    it('sets selection bounds and attaches mouse listeners when left button is pressed', () => {
      const listeners = accessPrivate<Listeners>(crossBlockSelection, 'listeners');
      const onSpy = vi.spyOn(listeners, 'on').mockReturnValue('listener-id');
      const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');
      const blockManager = blokState.BlockManager;

      (blockManager.getBlock as ReturnType<typeof vi.fn>).mockReturnValue(blocks[1]);

      crossBlockSelection.watchSelection({
        button: _.mouseButtons.LEFT,
        target: blocks[1].holder,
      } as unknown as MouseEvent);

      expect(blockManager.getBlock).toHaveBeenCalledWith(blocks[1].holder);
      expect(onSpy).toHaveBeenCalledWith(document, 'mouseover', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith(document, 'mouseup', expect.any(Function));
      expect(accessPrivate<Block>(crossBlockSelection, 'firstSelectedBlock')).toBe(blocks[1]);
      expect(accessPrivate<Block>(crossBlockSelection, 'lastSelectedBlock')).toBe(blocks[1]);
    });

    it('ignores non-left mouse buttons', () => {
      const listeners = accessPrivate<Listeners>(crossBlockSelection, 'listeners');
      const onSpy = vi.spyOn(listeners, 'on');
      const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');
      const blockManager = blokState.BlockManager;

      crossBlockSelection.watchSelection({
        button: _.mouseButtons.RIGHT,
        target: blocks[2].holder,
      } as unknown as MouseEvent);

      expect(blockManager.getBlock).not.toHaveBeenCalled();
      expect(onSpy).not.toHaveBeenCalled();
    });
  });

  describe('isCrossBlockSelectionStarted', () => {
    it('returns true when selection spans multiple blocks', () => {
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[2]);

      expect(crossBlockSelection.isCrossBlockSelectionStarted).toBe(true);
    });

    it('returns false when selection does not span multiple blocks', () => {
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[1]);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[1]);

      expect(crossBlockSelection.isCrossBlockSelectionStarted).toBe(false);

      setPrivate(crossBlockSelection, 'firstSelectedBlock', null);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[1]);

      expect(crossBlockSelection.isCrossBlockSelectionStarted).toBe(false);
    });
  });

  describe('toggleBlockSelectedState', () => {
    it('selects the next block and closes toolbars when extending selection forward', () => {
      selectionMock.removeAllRanges.mockClear();

      crossBlockSelection.toggleBlockSelectedState(true);

      expect(blocks[0].selected).toBe(true);
      expect(blocks[1].selected).toBe(true);
      expect(blockSelectionClearCache).toHaveBeenCalled();
      expect(selectionMock.removeAllRanges).toHaveBeenCalled();
      expect(toolbarClose).toHaveBeenCalled();
      expect(inlineToolbarClose).toHaveBeenCalled();
      expect(blocks[1].holder.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    });

    it('deselects the previous block when shrinking the selection', () => {
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[1]);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[1]);
      blocks[1].selected = true;
      blocks[2].selected = true;

      crossBlockSelection.toggleBlockSelectedState(true);

      expect(blocks[1].selected).toBe(false);
      expect(blocks[2].selected).toBe(true);
      expect(blockSelectionClearCache).toHaveBeenCalled();
      expect(toolbarClose).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    const createKeyboardEventWithKey = (key: string): KeyboardEvent => {
      return new KeyboardEvent('keydown', { key });
    };

    it('restores caret position at the end when clearing with ArrowDown', () => {
      const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');

      (blokState.BlockSelection as { anyBlockSelected: boolean }).anyBlockSelected = true;
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[2]);

      crossBlockSelection.clear(createKeyboardEventWithKey('ArrowDown'));

      expect(caretSetToBlock).toHaveBeenCalledWith(blocks[2], blokState.Caret.positions.END);
      expect(accessPrivate<Block | null>(crossBlockSelection, 'firstSelectedBlock')).toBeNull();
      expect(accessPrivate<Block | null>(crossBlockSelection, 'lastSelectedBlock')).toBeNull();
    });

    it('restores caret at the start when clearing with ArrowUp', () => {
      const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');

      (blokState.BlockSelection as { anyBlockSelected: boolean }).anyBlockSelected = true;
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[2]);

      crossBlockSelection.clear(createKeyboardEventWithKey('ArrowUp'));

      expect(caretSetToBlock).toHaveBeenCalledWith(blocks[0], blokState.Caret.positions.START);
    });

    it('skips caret restoration when nothing is selected', () => {
      const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');

      (blokState.BlockSelection as { anyBlockSelected: boolean }).anyBlockSelected = false;
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[2]);

      crossBlockSelection.clear();

      expect(caretSetToBlock).not.toHaveBeenCalled();
    });
  });

  describe('enableCrossBlockSelection', () => {
    let enableCrossBlockSelection: (event: MouseEvent) => void;

    beforeEach(() => {
      enableCrossBlockSelection = accessPrivate(crossBlockSelection, 'enableCrossBlockSelection');
    });

    it('clears block selection when there is an active DOM selection', () => {
      selectionMock.isCollapsed = false;

      const event = new MouseEvent('mousedown');

      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(blockSelectionClearSelection).toHaveBeenCalledWith(event);
    });

    it('starts watching selection when mousedown occurs within the redactor', () => {
      selectionMock.isCollapsed = true;
      const watchSpy = vi.spyOn(crossBlockSelection, 'watchSelection');
      const event = {
        target: blocks[1].holder,
      } as unknown as MouseEvent;

      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(watchSpy).toHaveBeenCalledWith(event);
      expect(blockSelectionClearSelection).not.toHaveBeenCalled();
    });

    it('clears selection when mousedown happens outside the redactor', () => {
      selectionMock.isCollapsed = true;
      const watchSpy = vi.spyOn(crossBlockSelection, 'watchSelection');
      const event = {
        target: document.body,
      } as unknown as MouseEvent;

      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(watchSpy).not.toHaveBeenCalled();
      expect(blockSelectionClearSelection).toHaveBeenCalledWith(event);
    });
  });

  describe('onMouseUp', () => {
    it('removes temporary listeners', () => {
      const listeners = accessPrivate<Listeners>(crossBlockSelection, 'listeners');
      const offSpy = vi.spyOn(listeners, 'off');

      accessPrivate<() => void>(crossBlockSelection, 'onMouseUp')();

      expect(offSpy).toHaveBeenCalledWith(document, 'mouseover', accessPrivate(crossBlockSelection, 'onMouseOver'));
      expect(offSpy).toHaveBeenCalledWith(document, 'mouseup', accessPrivate(crossBlockSelection, 'onMouseUp'));
    });
  });

  describe('onMouseOver', () => {
    it('selects both edges when extending from the first selected block', () => {
      const event = {
        relatedTarget: blocks[0].holder,
        target: blocks[1].holder,
      } as unknown as MouseEvent;

      blocks[0].selected = false;
      blocks[1].selected = false;

      accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

      expect(selectionMock.removeAllRanges).toHaveBeenCalled();
      expect(blocks[0].selected).toBe(true);
      expect(blocks[1].selected).toBe(true);
      expect(blockSelectionClearCache).toHaveBeenCalled();
    });

    it('deselects blocks when returning to the first selected block', () => {
      const event = {
        relatedTarget: blocks[1].holder,
        target: blocks[0].holder,
      } as unknown as MouseEvent;

      blocks[0].selected = true;
      blocks[1].selected = true;

      accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

      expect(blocks[0].selected).toBe(false);
      expect(blocks[1].selected).toBe(false);
      expect(blockSelectionClearCache).toHaveBeenCalled();
    });

    it('delegates range toggling to toggleBlocksSelectedState for intermediate blocks', () => {
      const toggleSpy = vi.spyOn(
        crossBlockSelection as unknown as {
          toggleBlocksSelectedState: (firstBlock: Block, lastBlock: Block) => void;
        },
        'toggleBlocksSelectedState'
      );

      const event = {
        relatedTarget: blocks[1].holder,
        target: blocks[2].holder,
      } as unknown as MouseEvent;

      accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

      expect(inlineToolbarClose).toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith(blocks[1], blocks[2]);
      expect(accessPrivate<Block>(crossBlockSelection, 'lastSelectedBlock')).toBe(blocks[2]);
    });

    describe('resolveToRootBlock integration', () => {
      let childBlock: BlockWithSelection;

      beforeEach(() => {
        childBlock = createBlockStub();
        /**
         * The child block lives inside a table cell, so its holder is
         * inside the parent (blocks[2]) holder in the DOM.
         */
        blocks[2].holder.appendChild(childBlock.holder);

        const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');
        const blockManager = blokState.BlockManager;

        /**
         * getBlockByChildNode may return the child block when the mouse
         * target is inside a table cell.
         */
        (blockManager.getBlockByChildNode as ReturnType<typeof vi.fn>).mockImplementation((node: Node) => {
          if (node === childBlock.holder || childBlock.holder.contains(node)) {
            return childBlock;
          }

          return blocks.find((b) => b.holder === node || b.holder.contains(node)) ?? null;
        });

        /**
         * resolveToRootBlock walks up the parentId chain.
         * For the child it returns the parent table block (blocks[2]);
         * for any root-level block it returns itself.
         */
        (blockManager as Record<string, unknown>).resolveToRootBlock = vi.fn((block: Block) => {
          if (block === (childBlock as unknown as Block)) {
            return blocks[2];
          }

          return block;
        });
      });

      it('resolves a child block inside a table to the parent table block for selection', () => {
        setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
        setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[0]);

        blocks[0].selected = false;

        const event = {
          relatedTarget: blocks[0].holder,
          target: childBlock.holder,
        } as unknown as MouseEvent;

        accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

        const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');
        const blockManager = blokState.BlockManager;

        expect(blockManager.getBlockByChildNode).toHaveBeenCalledWith(childBlock.holder);
        expect((blockManager as Record<string, ReturnType<typeof vi.fn>>).resolveToRootBlock).toHaveBeenCalled();

        /**
         * Selection should land on the root table block (blocks[2]),
         * NOT on the child block.
         */
        expect(blocks[2].selected).toBe(true);
        expect(childBlock.selected).toBe(false);
      });

      it('resolves a child block used as relatedTarget to the parent table block', () => {
        setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
        setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[2]);
        blocks[0].selected = true;
        blocks[2].selected = true;

        /**
         * Mouse moves from the child (inside table) to blocks[3].
         * relatedTarget is the child — should resolve to blocks[2].
         */
        const event = {
          relatedTarget: childBlock.holder,
          target: blocks[3].holder,
        } as unknown as MouseEvent;

        accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

        const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');
        const blockManager = blokState.BlockManager;

        expect((blockManager as Record<string, ReturnType<typeof vi.fn>>).resolveToRootBlock).toHaveBeenCalled();
        expect(accessPrivate<Block>(crossBlockSelection, 'lastSelectedBlock')).toBe(blocks[3]);
      });

      it('does not change behavior for root-level blocks (parentId is null)', () => {
        setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
        setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[0]);

        blocks[0].selected = false;
        blocks[1].selected = false;

        const event = {
          relatedTarget: blocks[0].holder,
          target: blocks[1].holder,
        } as unknown as MouseEvent;

        accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

        const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');
        const blockManager = blokState.BlockManager;

        /**
         * resolveToRootBlock should be called but return the same
         * block since these are root-level blocks.
         */
        expect((blockManager as Record<string, ReturnType<typeof vi.fn>>).resolveToRootBlock).toHaveBeenCalled();

        expect(blocks[0].selected).toBe(true);
        expect(blocks[1].selected).toBe(true);
        expect(childBlock.selected).toBe(false);
      });

      it('skips selection when both target and relatedTarget resolve to the same root block', () => {
        setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
        setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[2]);

        /**
         * Create a second child that also resolves to blocks[2].
         */
        const secondChild = createBlockStub();

        blocks[2].holder.appendChild(secondChild.holder);

        const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');
        const blockManager = blokState.BlockManager;

        (blockManager.getBlockByChildNode as ReturnType<typeof vi.fn>).mockImplementation((node: Node) => {
          if (node === childBlock.holder || childBlock.holder.contains(node)) {
            return childBlock;
          }
          if (node === secondChild.holder || secondChild.holder.contains(node)) {
            return secondChild;
          }

          return blocks.find((b) => b.holder === node || b.holder.contains(node)) ?? null;
        });

        (blockManager as Record<string, ReturnType<typeof vi.fn>>).resolveToRootBlock.mockImplementation(
          (block: Block) => {
            if (block === (childBlock as unknown as Block) || block === (secondChild as unknown as Block)) {
              return blocks[2];
            }

            return block;
          }
        );

        blocks[0].selected = true;
        blocks[2].selected = true;

        const event = {
          relatedTarget: childBlock.holder,
          target: secondChild.holder,
        } as unknown as MouseEvent;

        accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

        /**
         * Both children resolve to the same root block (blocks[2]),
         * so the early `targetBlock === relatedBlock` guard should
         * prevent any selection change.
         */
        expect(blocks[0].selected).toBe(true);
        expect(blocks[2].selected).toBe(true);
        expect(childBlock.selected).toBe(false);
        expect(secondChild.selected).toBe(false);
      });
    });
  });

  describe('toggleBlocksSelectedState', () => {
    it('toggles intermediate blocks when edges have different selection state', () => {
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);

      blocks[1].selected = false;
      blocks[2].selected = false;
      blocks[3].selected = true;

      const toggleBlocksSelectedState = accessPrivate<
        (firstBlock: Block, lastBlock: Block) => void
          >(crossBlockSelection, 'toggleBlocksSelectedState');

      toggleBlocksSelectedState.call(crossBlockSelection, blocks[1], blocks[3]);

      expect(blocks[1].selected).toBe(false);
      expect(blocks[2].selected).toBe(true);
      expect(blocks[3].selected).toBe(false);
      expect(blockSelectionClearCache).toHaveBeenCalledTimes(2);
      expect(toolbarClose).toHaveBeenCalled();
    });

    it('does not toggle the last block when edges have identical selection state', () => {
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);

      blocks[1].selected = false;
      blocks[2].selected = false;

      const toggleBlocksSelectedState = accessPrivate<
        (firstBlock: Block, lastBlock: Block) => void
          >(crossBlockSelection, 'toggleBlocksSelectedState');

      toggleBlocksSelectedState.call(crossBlockSelection, blocks[1], blocks[2]);

      expect(blocks[1].selected).toBe(true);
      expect(blocks[2].selected).toBe(false);
      expect(blockSelectionClearCache).toHaveBeenCalledTimes(1);
      expect(toolbarClose).toHaveBeenCalled();
    });
  });
});

