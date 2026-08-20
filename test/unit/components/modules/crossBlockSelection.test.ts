import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CrossBlockSelection } from '../../../../src/components/modules/crossBlockSelection';
import { BlockRepository } from '../../../../src/components/modules/blockManager/repository';
import type { BlocksStore } from '../../../../src/components/modules/blockManager/types';
import * as _ from '../../../../src/components/utils';
import type { Block } from '../../../../src/components/block';
import type { Listeners } from '../../../../src/components/utils/listeners';
import { announce } from '../../../../src/components/utils/announcer';

vi.mock('../../../../src/components/utils/announcer', () => ({
  announce: vi.fn(),
}));

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

let stubCounter = 0;

const createBlockStub = (options: { id?: string; name?: string; parentId?: string | null; ownsChildren?: boolean } = {}): BlockWithSelection => {
  const holder = document.createElement('div');

  holder.scrollIntoView = vi.fn();
  let selected = false;

  stubCounter += 1;

  const stub = {
    holder,
    id: options.id ?? `stub-${stubCounter}`,
    name: options.name ?? 'paragraph',
    parentId: options.parentId ?? null,
    tool: { ownsChildren: options.ownsChildren ?? false },
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
  let i18nT: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    i18nT = vi.fn((key: string) => key);
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

    /**
     * Real BlockRepository over the same stub array, so the selection-unit and
     * sibling-range rules under test are the shipped ones, not a re-statement.
     */
    const repository = new BlockRepository();

    repository.initialize({ array: blocks } as unknown as BlocksStore);

    const blockManager = {
      blocks,
      currentBlock: blocks[0],
      getBlock: vi.fn((element: HTMLElement) => findBlockByNode(element)),
      getBlockByChildNode: vi.fn((node: Node) => findBlockByNode(node)),
      getBlockById: vi.fn((id: string) => repository.getBlockById(id)),
      resolveToRootBlock: vi.fn((block: Block) => repository.resolveToRootBlock(block)),
      resolveToSelectableBlock: vi.fn((block: Block) => repository.resolveToSelectableBlock(block)),
      isSelectionUnit: vi.fn((block: Block) => repository.isSelectionUnit(block)),
      getSelectionSiblingRange: vi.fn(
        (anchor: Block, target: Block) => repository.getSelectionSiblingRange(anchor, target)
      ),
    };

    crossBlockSelection.state = {
      BlockManager: blockManager,
      BlockSelection: {
        clearCache: blockSelectionClearCache,
        clearSelection: blockSelectionClearSelection,
        get anyBlockSelected() {
          return blocks.some((block) => block.selected);
        },
        get selectedBlocks() {
          return blocks.filter((block) => block.selected);
        },
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
        disableHoverForCooldown: vi.fn(),
        resetBlockHoverState: vi.fn(),
        someToolbarOpened: false,
      },
      DragManager: {
        isDragging: false,
      },
      RectangleSelection: {
        isRectActivated: vi.fn().mockReturnValue(false),
      },
      BlockSettings: {
        opened: false,
      },
      I18n: {
        t: i18nT,
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

      onSpy.mockImplementation((_element, eventName, handler) => {
        // prepare() also subscribes to selectionchange (cross-block highlight),
        // so the handler has to be picked by event name, not by call order.
        if (eventName === 'mousedown') {
          capturedHandler = handler;
        }

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

    it('drops the far end when the opposite arrow shrinks the selection', () => {
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[1]);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[3]);
      blocks[1].selected = true;
      blocks[2].selected = true;
      blocks[3].selected = true;

      crossBlockSelection.toggleBlockSelectedState(false);

      expect(blocks[1].selected).toBe(true);
      expect(blocks[2].selected).toBe(true);
      expect(blocks[3].selected).toBe(false);
      expect(blockSelectionClearCache).toHaveBeenCalled();
      expect(toolbarClose).toHaveBeenCalled();
    });

    it('extends by exactly one sibling per press inside a container', () => {
      const toggle = createBlockStub({ id: 'toggle', name: 'header' });
      const table = createBlockStub({ id: 'table', name: 'table', parentId: 'toggle', ownsChildren: true });
      const cell = createBlockStub({ id: 'cell', parentId: 'table' });
      const first = createBlockStub({ id: 'first-child', parentId: 'toggle' });
      const callout = createBlockStub({ id: 'callout', name: 'callout', parentId: 'toggle' });
      const calloutLine = createBlockStub({ id: 'callout-line', parentId: 'callout' });
      const last = createBlockStub({ id: 'last-child', parentId: 'toggle' });

      blocks.length = 0;
      blocks.push(toggle, table, cell, first, callout, calloutLine, last);

      setPrivate(crossBlockSelection, 'firstSelectedBlock', first);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', first);

      crossBlockSelection.toggleBlockSelectedState(true);

      expect(blocks.filter((block) => block.selected).map((block) => block.id)).toEqual(['first-child', 'callout']);
    });

    /**
     * Stepping by flat index walked INTO the next container: from a toggle
     * heading the first Shift+Down landed on its own child, then on a table
     * cell, so the visible selection never moved past the section.
     */
    it('steps over a container instead of into it', () => {
      const toggle = createBlockStub({ id: 'toggle', name: 'header' });
      const toggleChild = createBlockStub({ id: 'toggle-child', parentId: 'toggle' });
      const after = createBlockStub({ id: 'after' });

      blocks.length = 0;
      blocks.push(toggle, toggleChild, after);

      setPrivate(crossBlockSelection, 'firstSelectedBlock', toggle);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', toggle);

      crossBlockSelection.toggleBlockSelectedState(true);

      expect(toggle.selected).toBe(true);
      expect(after.selected).toBe(true);
      expect(toggleChild.selected).toBe(false);
    });

    it('announces the selected block count as the keyboard selection grows (H9)', () => {
      (announce as ReturnType<typeof vi.fn>).mockClear();

      crossBlockSelection.toggleBlockSelectedState(true);

      expect(announce).toHaveBeenCalledWith('a11y.blocksSelected', { politeness: 'polite' });
    });
  });

  describe('clear', () => {
    const createKeyboardEventWithKey = (key: string): KeyboardEvent => {
      return new KeyboardEvent('keydown', { key });
    };

    it('restores caret position at the end when clearing with ArrowDown', () => {
      const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');

      blocks[0].selected = true;
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[2]);

      crossBlockSelection.clear(createKeyboardEventWithKey('ArrowDown'));

      expect(caretSetToBlock).toHaveBeenCalledWith(blocks[2], blokState.Caret.positions.END);
      expect(accessPrivate<Block | null>(crossBlockSelection, 'firstSelectedBlock')).toBeNull();
      expect(accessPrivate<Block | null>(crossBlockSelection, 'lastSelectedBlock')).toBeNull();
    });

    it('restores caret at the start when clearing with ArrowUp', () => {
      const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');

      blocks[0].selected = true;
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[2]);

      crossBlockSelection.clear(createKeyboardEventWithKey('ArrowUp'));

      expect(caretSetToBlock).toHaveBeenCalledWith(blocks[0], blokState.Caret.positions.START);
    });

    it('skips caret restoration when nothing is selected', () => {
      // No blocks selected → anyBlockSelected getter returns false.
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

  describe('M7: Shift+Click range selection', () => {
    let enableCrossBlockSelection: (event: MouseEvent) => void;

    beforeEach(() => {
      enableCrossBlockSelection = accessPrivate(crossBlockSelection, 'enableCrossBlockSelection');
      // Start from a clean caret state (no prior block selection).
      setPrivate(crossBlockSelection, 'firstSelectedBlock', null);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', null);
      for (const block of blocks) {
        block.selected = false;
      }
    });

    it('selects the inclusive range from the caret block to the Shift+clicked block (downward)', () => {
      const preventDefault = vi.fn();
      const event = {
        button: _.mouseButtons.LEFT,
        shiftKey: true,
        target: blocks[2].holder,
        preventDefault,
      } as unknown as MouseEvent;

      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(preventDefault).toHaveBeenCalled();
      expect(blocks[0].selected).toBe(true);
      expect(blocks[1].selected).toBe(true);
      expect(blocks[2].selected).toBe(true);
      expect(blocks[3].selected).toBe(false);
      expect(accessPrivate<Block>(crossBlockSelection, 'firstSelectedBlock')).toBe(blocks[0]);
      expect(accessPrivate<Block>(crossBlockSelection, 'lastSelectedBlock')).toBe(blocks[2]);
    });

    it('selects the inclusive range upward when the anchor is below the clicked block', () => {
      const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');

      (blokState.BlockManager as unknown as { currentBlock: Block }).currentBlock = blocks[3];

      const preventDefault = vi.fn();
      const event = {
        button: _.mouseButtons.LEFT,
        shiftKey: true,
        target: blocks[1].holder,
        preventDefault,
      } as unknown as MouseEvent;

      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(blocks[1].selected).toBe(true);
      expect(blocks[2].selected).toBe(true);
      expect(blocks[3].selected).toBe(true);
      expect(blocks[0].selected).toBe(false);
    });

    it('extends an existing block selection from its anchor to the Shift+clicked block', () => {
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[1]);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[1]);
      blocks[1].selected = true;

      const event = {
        button: _.mouseButtons.LEFT,
        shiftKey: true,
        target: blocks[3].holder,
        preventDefault: vi.fn(),
      } as unknown as MouseEvent;

      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(blocks[0].selected).toBe(false);
      expect(blocks[1].selected).toBe(true);
      expect(blocks[2].selected).toBe(true);
      expect(blocks[3].selected).toBe(true);
      expect(accessPrivate<Block>(crossBlockSelection, 'lastSelectedBlock')).toBe(blocks[3]);
    });

    it('announces the selected block count after a Shift+Click range selection (H9)', () => {
      (announce as ReturnType<typeof vi.fn>).mockClear();
      i18nT.mockClear();

      const event = {
        button: _.mouseButtons.LEFT,
        shiftKey: true,
        target: blocks[2].holder,
        preventDefault: vi.fn(),
      } as unknown as MouseEvent;

      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(i18nT).toHaveBeenCalledWith('a11y.blocksSelected', { count: 3 });
      expect(announce).toHaveBeenCalledWith('a11y.blocksSelected', { politeness: 'polite' });
    });

    it('does not re-announce when a Shift+Click leaves the selected count unchanged (H9)', () => {
      const event = {
        button: _.mouseButtons.LEFT,
        shiftKey: true,
        target: blocks[2].holder,
        preventDefault: vi.fn(),
      } as unknown as MouseEvent;

      enableCrossBlockSelection.call(crossBlockSelection, event);

      (announce as ReturnType<typeof vi.fn>).mockClear();

      // Same click again: same range, same count — no repeat announcement.
      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(announce).not.toHaveBeenCalled();
    });

    it('does not range-select on a plain (no Shift) click', () => {
      const watchSpy = vi.spyOn(crossBlockSelection, 'watchSelection');
      const event = {
        button: _.mouseButtons.LEFT,
        shiftKey: false,
        target: blocks[2].holder,
        preventDefault: vi.fn(),
      } as unknown as MouseEvent;

      enableCrossBlockSelection.call(crossBlockSelection, event);

      // Plain click still goes through the drag-watch path, not range selection.
      expect(watchSpy).toHaveBeenCalledWith(event);
      expect(blocks[1].selected).toBe(false);
    });
  });

  describe('Cmd/Ctrl/Alt + Shift + Click non-contiguous toggle', () => {
    let enableCrossBlockSelection: (event: MouseEvent) => void;

    beforeEach(() => {
      enableCrossBlockSelection = accessPrivate(crossBlockSelection, 'enableCrossBlockSelection');
      for (const block of blocks) {
        block.selected = false;
      }
      // Start from a single selected block (nav-mode selection of block 0).
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[0]);
      blocks[0].selected = true;
    });

    it('Cmd+Shift+Click toggles the clicked block INTO a non-contiguous set (does not fill the gap)', () => {
      const preventDefault = vi.fn();
      const event = {
        button: _.mouseButtons.LEFT,
        shiftKey: true,
        metaKey: true,
        target: blocks[3].holder,
        preventDefault,
      } as unknown as MouseEvent;

      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(preventDefault).toHaveBeenCalled();
      // {0, 3} selected — the gap (1, 2) stays UNselected.
      expect(blocks[0].selected).toBe(true);
      expect(blocks[1].selected).toBe(false);
      expect(blocks[2].selected).toBe(false);
      expect(blocks[3].selected).toBe(true);
    });

    it('Ctrl+Shift+Click toggles the clicked block INTO a non-contiguous set', () => {
      const event = {
        button: _.mouseButtons.LEFT,
        shiftKey: true,
        ctrlKey: true,
        target: blocks[2].holder,
        preventDefault: vi.fn(),
      } as unknown as MouseEvent;

      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(blocks[0].selected).toBe(true);
      expect(blocks[1].selected).toBe(false);
      expect(blocks[2].selected).toBe(true);
      expect(blocks[3].selected).toBe(false);
    });

    it('Alt+Shift+Click toggles the clicked block INTO a non-contiguous set', () => {
      const event = {
        button: _.mouseButtons.LEFT,
        shiftKey: true,
        altKey: true,
        target: blocks[3].holder,
        preventDefault: vi.fn(),
      } as unknown as MouseEvent;

      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(blocks[0].selected).toBe(true);
      expect(blocks[1].selected).toBe(false);
      expect(blocks[2].selected).toBe(false);
      expect(blocks[3].selected).toBe(true);
    });

    it('Cmd+Shift+Click on an already-selected block toggles it OUT, leaving the rest intact', () => {
      blocks[3].selected = true;
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[3]);

      const event = {
        button: _.mouseButtons.LEFT,
        shiftKey: true,
        metaKey: true,
        target: blocks[3].holder,
        preventDefault: vi.fn(),
      } as unknown as MouseEvent;

      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(blocks[0].selected).toBe(true);
      expect(blocks[3].selected).toBe(false);
    });

    it('announces the updated selected block count after a toggle-click (H9)', () => {
      (announce as ReturnType<typeof vi.fn>).mockClear();
      i18nT.mockClear();

      const event = {
        button: _.mouseButtons.LEFT,
        shiftKey: true,
        metaKey: true,
        target: blocks[3].holder,
        preventDefault: vi.fn(),
      } as unknown as MouseEvent;

      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(i18nT).toHaveBeenCalledWith('a11y.blocksSelected', { count: 2 });
      expect(announce).toHaveBeenCalledWith('a11y.blocksSelected', { politeness: 'polite' });
    });

    it('does not announce when a toggle-click collapses the selection to a single block (H9)', () => {
      blocks[3].selected = true;
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[3]);

      (announce as ReturnType<typeof vi.fn>).mockClear();

      const event = {
        button: _.mouseButtons.LEFT,
        shiftKey: true,
        metaKey: true,
        target: blocks[3].holder,
        preventDefault: vi.fn(),
      } as unknown as MouseEvent;

      // Toggling block 3 OUT leaves only block 0 selected — nothing multi-block to convey.
      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(announce).not.toHaveBeenCalled();
    });

    it('records the toggled block as the new anchor for subsequent extension', () => {
      const event = {
        button: _.mouseButtons.LEFT,
        shiftKey: true,
        metaKey: true,
        target: blocks[3].holder,
        preventDefault: vi.fn(),
      } as unknown as MouseEvent;

      enableCrossBlockSelection.call(crossBlockSelection, event);

      expect(accessPrivate<Block>(crossBlockSelection, 'lastSelectedBlock')).toBe(blocks[3]);
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

    it('announces the selected block count after a drag mouseup (H9)', () => {
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[2]);
      blocks[0].selected = true;
      blocks[1].selected = true;
      blocks[2].selected = true;

      (announce as ReturnType<typeof vi.fn>).mockClear();

      accessPrivate<() => void>(crossBlockSelection, 'onMouseUp')();

      expect(i18nT).toHaveBeenCalledWith('a11y.blocksSelected', { count: 3 });
      expect(announce).toHaveBeenCalledWith('a11y.blocksSelected', { politeness: 'polite' });
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

    it('collapses to the anchor when the drag returns to the first selected block', () => {
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[1]);

      const event = {
        relatedTarget: blocks[1].holder,
        target: blocks[0].holder,
      } as unknown as MouseEvent;

      blocks[0].selected = true;
      blocks[1].selected = true;

      accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

      expect(blocks[0].selected).toBe(true);
      expect(blocks[1].selected).toBe(false);
      expect(blockSelectionClearCache).toHaveBeenCalled();
    });

    it('deselects all intermediate blocks when fast-returning to the first selected block', () => {
      /**
       * Simulate 5 blocks: user drags from B0 to B3 (selecting B0-B3),
       * then fast-drags back to B0 skipping B1 and B2.
       */
      const extraBlock = createBlockStub();

      blocks.push(extraBlock);
      redactor.appendChild(extraBlock.holder);

      const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');

      (blokState.BlockManager as unknown as { blocks: BlockWithSelection[] }).blocks = blocks;

      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
      setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[3]);

      blocks[0].selected = true;
      blocks[1].selected = true;
      blocks[2].selected = true;
      blocks[3].selected = true;

      /**
       * Fast mouse movement: mouseover fires with target=B0, related=B3,
       * skipping B1 and B2 entirely.
       */
      const event = {
        relatedTarget: blocks[3].holder,
        target: blocks[0].holder,
      } as unknown as MouseEvent;

      accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

      expect(blocks[0].selected).toBe(true);
      expect(blocks[1].selected).toBe(false);
      expect(blocks[2].selected).toBe(false);
      expect(blocks[3].selected).toBe(false);
    });

    it('selects the whole run between the anchor and the hovered block', () => {
      setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);

      const event = {
        relatedTarget: blocks[1].holder,
        target: blocks[2].holder,
      } as unknown as MouseEvent;

      accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

      expect(inlineToolbarClose).toHaveBeenCalled();
      expect(blocks.map((block) => block.selected)).toEqual([true, true, true, false]);
      expect(accessPrivate<Block>(crossBlockSelection, 'lastSelectedBlock')).toBe(blocks[2]);
    });

    it('does not change selection when rectangle selection is active', () => {
      const blokState = accessPrivate<CrossBlockSelection['Blok']>(crossBlockSelection, 'Blok');

      (blokState.RectangleSelection.isRectActivated as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const event = {
        relatedTarget: blocks[0].holder,
        target: blocks[1].holder,
      } as unknown as MouseEvent;

      blocks[0].selected = false;
      blocks[1].selected = false;

      accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

      expect(blocks[0].selected).toBe(false);
      expect(blocks[1].selected).toBe(false);
    });

    /**
     * A block inside a table cell is not a selection unit — the table is (its
     * contentIds ARE the cell blocks). A drag reaching a cell must therefore
     * select the table, and a drag BETWEEN two cells of the same table must
     * not turn into a block-range selection at all.
     */
    describe('nested blocks resolve to their selection unit', () => {
      let table: BlockWithSelection;
      let cell: BlockWithSelection;

      beforeEach(() => {
        table = createBlockStub({ id: 'table', name: 'table', ownsChildren: true });
        cell = createBlockStub({ id: 'cell', parentId: 'table' });

        blocks.splice(2, 1, table);
        redactor.appendChild(table.holder);
        table.holder.appendChild(cell.holder);
        blocks.push(cell);
      });

      it('selects the table, not the cell block, when the drag reaches into a cell', () => {
        setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
        setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[0]);

        const event = {
          relatedTarget: blocks[0].holder,
          target: cell.holder,
        } as unknown as MouseEvent;

        accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

        expect(table.selected).toBe(true);
        expect(cell.selected).toBe(false);
      });

      it('resolves a cell used as relatedTarget to its table', () => {
        setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
        setPrivate(crossBlockSelection, 'lastSelectedBlock', table);

        const event = {
          relatedTarget: cell.holder,
          target: blocks[3].holder,
        } as unknown as MouseEvent;

        accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

        expect(accessPrivate<Block>(crossBlockSelection, 'lastSelectedBlock')).toBe(blocks[3]);
        expect(blocks.slice(0, 4).map((block) => block.selected)).toEqual([true, true, true, true]);
        expect(cell.selected).toBe(false);
      });

      it('leaves root-level drags untouched', () => {
        setPrivate(crossBlockSelection, 'firstSelectedBlock', blocks[0]);
        setPrivate(crossBlockSelection, 'lastSelectedBlock', blocks[0]);

        const event = {
          relatedTarget: blocks[0].holder,
          target: blocks[1].holder,
        } as unknown as MouseEvent;

        accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

        expect(blocks[0].selected).toBe(true);
        expect(blocks[1].selected).toBe(true);
        expect(cell.selected).toBe(false);
      });

      it('does not start a block selection while the drag stays inside one table', () => {
        const secondCell = createBlockStub({ id: 'cell-2', parentId: 'table' });

        table.holder.appendChild(secondCell.holder);
        blocks.push(secondCell);

        setPrivate(crossBlockSelection, 'firstSelectedBlock', cell);
        setPrivate(crossBlockSelection, 'lastSelectedBlock', cell);

        const event = {
          relatedTarget: cell.holder,
          target: secondCell.holder,
        } as unknown as MouseEvent;

        accessPrivate<(event: MouseEvent) => void>(crossBlockSelection, 'onMouseOver')(event);

        expect(table.selected).toBe(false);
        expect(cell.selected).toBe(false);
        expect(secondCell.selected).toBe(false);
      });
    });
  });
});

