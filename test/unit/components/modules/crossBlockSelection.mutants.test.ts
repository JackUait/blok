import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CrossBlockSelection } from '../../../../src/components/modules/crossBlockSelection';
import { BlockRepository } from '../../../../src/components/modules/blockManager/repository';
import type { BlocksStore } from '../../../../src/components/modules/blockManager/types';
import type { Block } from '../../../../src/components/block';
import { DATA_ATTR } from '../../../../src/components/constants';
import { announce } from '../../../../src/components/utils/announcer';

vi.mock('../../../../src/components/utils/announcer', () => ({
  announce: vi.fn(),
}));

/** Registry key the module paints under; must match cross-block-highlight.ts. */
const HIGHLIGHT_NAME = 'blok-cross-block-selection';

type BlockStub = Block & {
  holder: HTMLElement & { scrollIntoView: ReturnType<typeof vi.fn> };
};

type CaretHitTest = (x: number, y: number) => { offsetNode: Node | null; offset: number } | null;

type DocumentWithCaret = { caretPositionFromPoint?: CaretHitTest };

type Globals = {
  CSS?: unknown;
  Highlight?: unknown;
};

class HighlightStub {
  public readonly ranges: Range[];

  public constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

const createStub = (id: string, options: { parentId?: string | null; ownsChildren?: boolean } = {}): BlockStub => {
  const holder = document.createElement('div');

  holder.setAttribute(DATA_ATTR.element, '');
  holder.setAttribute('data-stub-id', id);
  holder.scrollIntoView = vi.fn();

  const input = document.createElement('div');

  input.setAttribute('contenteditable', 'true');
  input.textContent = `text of ${id}`;
  holder.appendChild(input);

  let selected = false;

  const stub = {
    holder,
    id,
    name: 'paragraph',
    parentId: options.parentId ?? null,
    tool: { ownsChildren: options.ownsChildren ?? false },
  } as Record<string, unknown>;

  Object.defineProperty(stub, 'firstInput', {
    configurable: true,
    get: () => (holder.contains(input) ? input : undefined),
  });

  Object.defineProperty(stub, 'lastInput', {
    configurable: true,
    get: () => (holder.contains(input) ? input : undefined),
  });

  Object.defineProperty(stub, 'selected', {
    configurable: true,
    get: () => selected,
    set: (value: boolean) => {
      selected = value;
    },
  });

  return stub as unknown as BlockStub;
};

describe('CrossBlockSelection — mutation coverage', () => {
  let module: CrossBlockSelection;
  let redactor: HTMLElement;
  let wrapper: HTMLElement;
  let toolbarWrapper: HTMLElement;

  let blocks: BlockStub[];
  let p: BlockStub[];
  let toggle: BlockStub;
  let toggleChildren: BlockStub[];
  let table: BlockStub;
  let cellA: HTMLElement;
  let cellB: HTMLElement;
  let cellABlocks: BlockStub[];
  let cellBBlock: BlockStub;
  let tail: BlockStub;

  let toolbarClose: ReturnType<typeof vi.fn>;
  let toolbarOpenMultiple: ReturnType<typeof vi.fn>;
  let inlineToolbarClose: ReturnType<typeof vi.fn>;
  let clearCache: ReturnType<typeof vi.fn>;
  let clearSelection: ReturnType<typeof vi.fn>;
  let setToBlock: ReturnType<typeof vi.fn>;
  let i18nT: ReturnType<typeof vi.fn>;
  let isRectActivated: ReturnType<typeof vi.fn>;
  let removeAllRanges: ReturnType<typeof vi.fn>;
  let addRange: ReturnType<typeof vi.fn>;
  let caretPoints: Map<string, { node: Node; offset: number }>;
  let highlights: Map<string, unknown>;
  let selectionRange: Range | null;
  let uiState: { someToolbarOpened: boolean };
  let dragState: { isDragging: boolean };
  let blockManagerState: { currentBlock: Block | undefined };
  let redactorHolder: { redactor: HTMLElement | undefined; wrapper: HTMLElement | undefined };

  const globals = globalThis as unknown as Globals;
  const docWithCaret = document as unknown as DocumentWithCaret;
  let originalCss: unknown;
  let originalHighlight: unknown;
  let originalCaretHitTest: CaretHitTest | undefined;

  const selectedIds = (): string[] => blocks.filter((block) => block.selected).map((block) => block.id);

  const blockOfNode = (node: Node | null): BlockStub | undefined => {
    if (node === null) {
      return undefined;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const holder = element?.closest(`[${DATA_ATTR.element}]`) ?? null;

    return blocks.find((block) => block.holder === holder);
  };

  const inputOf = (block: BlockStub): HTMLElement => {
    const input = block.holder.querySelector('[contenteditable="true"]');

    if (!(input instanceof HTMLElement)) {
      throw new Error(`stub ${block.id} has no editable input`);
    }

    return input;
  };

  const textNodeOf = (block: BlockStub): Node => {
    const node = inputOf(block).firstChild;

    if (node === null) {
      throw new Error(`stub ${block.id} has no text`);
    }

    return node;
  };

  const mouseDownOn = (block: BlockStub, init: MouseEventInit = {}): MouseEvent => {
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      ...init,
    });

    inputOf(block).dispatchEvent(event);

    return event;
  };

  const mouseOverOn = (block: BlockStub, from: BlockStub): void => {
    inputOf(block).dispatchEvent(new MouseEvent('mouseover', {
      bubbles: true,
      relatedTarget: inputOf(from),
    }));
  };

  const atPoint = (x: number, y: number, block: BlockStub, offset: number): void => {
    caretPoints.set(`${x},${y}`, { node: textNodeOf(block),
      offset });
  };

  const mouseMove = (x: number, y: number, over: BlockStub, buttons = 1): void => {
    const target = over.holder.querySelector('[contenteditable="true"]') ?? over.holder;

    target.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      buttons,
      clientX: x,
      clientY: y,
    }));
  };

  const mouseUp = (): void => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  };

  beforeEach(() => {
    vi.clearAllMocks();

    originalCaretHitTest = docWithCaret.caretPositionFromPoint;
    originalCss = globals.CSS;
    originalHighlight = globals.Highlight;
    highlights = new Map<string, unknown>();
    globals.CSS = { highlights };
    globals.Highlight = HighlightStub;

    toolbarClose = vi.fn();
    toolbarOpenMultiple = vi.fn();
    inlineToolbarClose = vi.fn();
    clearCache = vi.fn();
    clearSelection = vi.fn();
    setToBlock = vi.fn();
    i18nT = vi.fn((key: string) => key);
    isRectActivated = vi.fn().mockReturnValue(false);
    removeAllRanges = vi.fn(() => {
      selectionRange = null;
    });
    addRange = vi.fn((range: Range) => {
      selectionRange = range;
    });
    caretPoints = new Map<string, { node: Node; offset: number }>();
    selectionRange = null;

    p = ['p0', 'p1', 'p2', 'p3'].map((id) => createStub(id));
    toggle = createStub('toggle');
    toggleChildren = ['t0', 't1'].map((id) => createStub(id, { parentId: 'toggle' }));
    table = createStub('table', { ownsChildren: true });
    cellABlocks = ['c0', 'c1', 'c2', 'c3'].map((id) => createStub(id, { parentId: 'table' }));
    cellBBlock = createStub('c4', { parentId: 'table' });
    tail = createStub('p4');

    blocks = [...p, toggle, ...toggleChildren, table, ...cellABlocks, cellBBlock, tail];

    redactor = document.createElement('div');
    wrapper = document.createElement('div');
    toolbarWrapper = document.createElement('div');

    p.forEach((block) => redactor.appendChild(block.holder));
    redactor.appendChild(toggle.holder);

    /** A toggle's children are plain content: no nested-blocks container. */
    const toggleBody = document.createElement('div');

    toggleChildren.forEach((block) => toggleBody.appendChild(block.holder));
    toggle.holder.appendChild(toggleBody);

    redactor.appendChild(table.holder);
    cellA = document.createElement('div');
    cellB = document.createElement('div');
    cellA.setAttribute(DATA_ATTR.nestedBlocks, '');
    cellB.setAttribute(DATA_ATTR.nestedBlocks, '');
    cellABlocks.forEach((block) => cellA.appendChild(block.holder));
    cellB.appendChild(cellBBlock.holder);
    table.holder.append(cellA, cellB);

    redactor.appendChild(tail.holder);
    wrapper.appendChild(redactor);
    document.body.appendChild(wrapper);
    document.body.appendChild(toolbarWrapper);

    const repository = new BlockRepository();

    repository.initialize({ array: blocks } as unknown as BlocksStore);

    blockManagerState = { currentBlock: p[0] };
    uiState = { someToolbarOpened: false };
    dragState = { isDragging: false };
    redactorHolder = { redactor,
      wrapper };

    module = new CrossBlockSelection({
      config: {},
      eventsDispatcher: {
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as CrossBlockSelection['eventsDispatcher'],
    });

    module.state = {
      BlockManager: {
        blocks,
        get currentBlock() {
          return blockManagerState.currentBlock;
        },
        getBlock: vi.fn((element: HTMLElement) => blockOfNode(element)),
        getBlockByChildNode: vi.fn((node: Node) => blockOfNode(node)),
        getBlockById: vi.fn((id: string) => repository.getBlockById(id)),
        resolveToRootBlock: vi.fn((block: Block) => repository.resolveToRootBlock(block)),
        resolveToSelectableBlock: vi.fn((block: Block) => repository.resolveToSelectableBlock(block)),
        isSelectionUnit: vi.fn((block: Block) => repository.isSelectionUnit(block)),
        getSelectionSiblingRange: vi.fn(
          (anchor: Block, target: Block) => repository.getSelectionSiblingRange(anchor, target)
        ),
      },
      BlockSelection: {
        clearCache,
        clearSelection,
        get anyBlockSelected() {
          return blocks.some((block) => block.selected);
        },
        get selectedBlocks() {
          return blocks.filter((block) => block.selected);
        },
      },
      InlineToolbar: { close: inlineToolbarClose },
      Toolbar: {
        close: toolbarClose,
        moveAndOpenForMultipleBlocks: toolbarOpenMultiple,
        nodes: { wrapper: toolbarWrapper },
      },
      Caret: {
        positions: { START: 'start',
          END: 'end',
          DEFAULT: 'default' },
        setToBlock,
      },
      UI: {
        nodes: redactorHolder,
        disableHoverForCooldown: vi.fn(),
        resetBlockHoverState: vi.fn(),
        get someToolbarOpened() {
          return uiState.someToolbarOpened;
        },
      },
      DragManager: {
        get isDragging() {
          return dragState.isDragging;
        },
      },
      RectangleSelection: { isRectActivated },
      I18n: { t: i18nT },
    } as unknown as CrossBlockSelection['Blok'];

    vi.spyOn(window, 'getSelection').mockImplementation(() => ({
      removeAllRanges,
      addRange,
      get rangeCount() {
        return selectionRange === null ? 0 : 1;
      },
      getRangeAt: () => selectionRange,
      anchorNode: null,
      focusNode: null,
      get isCollapsed() {
        return selectionRange === null;
      },
    } as unknown as Selection));

    docWithCaret.caretPositionFromPoint = (x: number, y: number) => {
      const point = caretPoints.get(`${x},${y}`);

      return point === undefined ? null : { offsetNode: point.node,
        offset: point.offset };
    };
  });

  afterEach(() => {
    mouseUp();
    module.markDestroyed();
    wrapper.remove();
    toolbarWrapper.remove();
    globals.CSS = originalCss;
    globals.Highlight = originalHighlight;
    docWithCaret.caretPositionFromPoint = originalCaretHitTest;
    vi.restoreAllMocks();
  });

  /** A real cross-block range: from inside one block's text into another's. */
  const selectAcross = (from: BlockStub, to: BlockStub): Range => {
    const range = document.createRange();

    range.setStart(textNodeOf(from), 1);
    range.setEnd(textNodeOf(to), 2);
    selectionRange = range;

    return range;
  };

  describe('textSelection', () => {
    it('is null when the editor UI has no redactor yet', () => {
      selectAcross(p[1], p[2]);
      redactorHolder.redactor = undefined;

      expect(module.textSelection).toBeNull();
    });

    it('resolves the start and end blocks of a range spanning two blocks', () => {
      selectAcross(p[1], p[2]);

      const selection = module.textSelection;

      expect(selection?.startBlock.id).toBe('p1');
      expect(selection?.endBlock.id).toBe('p2');
    });

    it('is null while the range stays inside one block', () => {
      const range = document.createRange();

      range.setStart(textNodeOf(p[1]), 0);
      range.setEnd(textNodeOf(p[1]), 3);
      selectionRange = range;

      expect(module.textSelection).toBeNull();
    });
  });

  describe('syncTextSelectionHighlight', () => {
    it('paints the sub-ranges and stamps the wrapper while a cross-block range stands', () => {
      selectAcross(p[1], p[2]);

      module.syncTextSelectionHighlight();

      expect(highlights.has(HIGHLIGHT_NAME)).toBe(true);
      expect(wrapper.hasAttribute(DATA_ATTR.crossSelection)).toBe(true);
    });

    it('drops the paint and the stamp once the range is gone', () => {
      selectAcross(p[1], p[2]);
      module.syncTextSelectionHighlight();

      selectionRange = null;
      module.syncTextSelectionHighlight();

      expect(highlights.has(HIGHLIGHT_NAME)).toBe(false);
      expect(wrapper.hasAttribute(DATA_ATTR.crossSelection)).toBe(false);
    });

    it('does nothing at all once the module is destroyed', () => {
      selectAcross(p[1], p[2]);
      module.markDestroyed();
      highlights.clear();

      module.syncTextSelectionHighlight();

      expect(highlights.has(HIGHLIGHT_NAME)).toBe(false);
      expect(wrapper.hasAttribute(DATA_ATTR.crossSelection)).toBe(false);
    });

    it('leaves the native paint alone when the engine has no highlight registry', () => {
      globals.CSS = undefined;
      selectAcross(p[1], p[2]);

      module.syncTextSelectionHighlight();

      expect(wrapper.hasAttribute(DATA_ATTR.crossSelection)).toBe(false);
    });
  });

  describe('markDestroyed', () => {
    it('releases the painted highlight and the wrapper stamp', () => {
      selectAcross(p[1], p[2]);
      module.syncTextSelectionHighlight();

      module.markDestroyed();

      expect(highlights.has(HIGHLIGHT_NAME)).toBe(false);
      expect(wrapper.hasAttribute(DATA_ATTR.crossSelection)).toBe(false);
      expect(module.isDestroyed).toBe(true);
    });
  });

  describe('clearTextSelection', () => {
    it('drops the document range and the paint that went with it', () => {
      selectAcross(p[1], p[2]);
      module.syncTextSelectionHighlight();

      module.clearTextSelection();

      expect(removeAllRanges).toHaveBeenCalledTimes(1);
      expect(highlights.has(HIGHLIGHT_NAME)).toBe(false);
    });
  });

  describe('selectBlocksOfTextSelection', () => {
    it('returns false and selects nothing when there is no text selection', () => {
      expect(module.selectBlocksOfTextSelection()).toBe(false);
      expect(selectedIds()).toEqual([]);
      expect(toolbarOpenMultiple).not.toHaveBeenCalled();
    });

    it('promotes the range to a block selection of exactly the spanned blocks', () => {
      selectAcross(p[1], p[2]);

      expect(module.selectBlocksOfTextSelection()).toBe(true);
      expect(selectedIds()).toEqual(['p1', 'p2']);
      expect(inlineToolbarClose).toHaveBeenCalled();
      expect(toolbarOpenMultiple).toHaveBeenCalled();
      expect(announce).toHaveBeenCalledWith('a11y.blocksSelected', { politeness: 'polite' });
      expect(i18nT).toHaveBeenCalledWith('a11y.blocksSelected', { count: 2 });
    });
  });

  describe('block-level drag (mouseover)', () => {
    it('selects the inclusive range backwards from the anchor', () => {
      module.watchSelection(mouseDownOn(p[2]));
      mouseOverOn(p[0], p[2]);

      expect(selectedIds()).toEqual(['p0', 'p1', 'p2']);
    });

    it('recomputes from the anchor instead of toggling when the drag reverses', () => {
      module.watchSelection(mouseDownOn(p[2]));
      mouseOverOn(p[0], p[2]);
      mouseOverOn(p[3], p[0]);

      expect(selectedIds()).toEqual(['p2', 'p3']);
    });

    it('ignores a gesture started with a non-left button', () => {
      module.watchSelection(mouseDownOn(p[2], { button: 2 }));
      mouseOverOn(p[0], p[2]);

      expect(selectedIds()).toEqual([]);
    });

    it('stands down while a block drag is in progress', () => {
      module.watchSelection(mouseDownOn(p[2]));
      dragState.isDragging = true;
      mouseOverOn(p[0], p[2]);

      expect(selectedIds()).toEqual([]);
    });

    it('stands down while a toolbar is open', () => {
      module.watchSelection(mouseDownOn(p[2]));
      uiState.someToolbarOpened = true;
      mouseOverOn(p[0], p[2]);

      expect(selectedIds()).toEqual([]);
    });

    it('stands down while rectangle selection owns the drag', () => {
      module.watchSelection(mouseDownOn(p[2]));
      isRectActivated.mockReturnValue(true);
      mouseOverOn(p[0], p[2]);

      expect(selectedIds()).toEqual([]);
    });

    it('opens the multi-block toolbar and announces on mouseup', () => {
      module.watchSelection(mouseDownOn(p[1]));
      mouseOverOn(p[3], p[1]);
      mouseUp();

      expect(toolbarOpenMultiple).toHaveBeenCalled();
      expect(i18nT).toHaveBeenCalledWith('a11y.blocksSelected', { count: 3 });
    });

    it('opens nothing on mouseup when the gesture never left its block', () => {
      module.watchSelection(mouseDownOn(p[1]));
      mouseUp();

      expect(toolbarOpenMultiple).not.toHaveBeenCalled();
      expect(announce).not.toHaveBeenCalled();
    });

    it('stops reacting to hovers once the gesture ended', () => {
      module.watchSelection(mouseDownOn(p[1]));
      mouseUp();
      mouseOverOn(p[3], p[1]);

      expect(selectedIds()).toEqual([]);
    });
  });

  describe('nested (same-container) drag', () => {
    it('selects the child-block range between two lines of one cell', () => {
      module.watchSelection(mouseDownOn(cellABlocks[1]));
      mouseOverOn(cellABlocks[2], cellABlocks[1]);

      expect(selectedIds()).toEqual(['c1', 'c2']);
      expect(removeAllRanges).toHaveBeenCalled();
    });

    it('selects the same lines when the drag runs backwards', () => {
      module.watchSelection(mouseDownOn(cellABlocks[3]));
      mouseOverOn(cellABlocks[1], cellABlocks[3]);

      expect(selectedIds()).toEqual(['c1', 'c2', 'c3']);
    });

    it('collapses to the anchor line when the pointer returns to it mid-range', () => {
      module.watchSelection(mouseDownOn(cellABlocks[1]));
      mouseOverOn(cellABlocks[3], cellABlocks[1]);
      mouseOverOn(cellABlocks[1], cellABlocks[3]);

      expect(selectedIds()).toEqual(['c1']);
    });

    it('leaves the native selection alone while the drag stays on its own line', () => {
      module.watchSelection(mouseDownOn(cellABlocks[1]));
      mouseOverOn(cellABlocks[1], cellABlocks[1]);

      expect(selectedIds()).toEqual([]);
      expect(removeAllRanges).not.toHaveBeenCalled();
    });

    it('drops the child selection when the drag crosses into another cell', () => {
      module.watchSelection(mouseDownOn(cellABlocks[1]));
      mouseOverOn(cellABlocks[3], cellABlocks[1]);
      mouseOverOn(cellBBlock, cellABlocks[3]);

      expect(selectedIds()).toEqual([]);
    });

    it('drops the child selection when the drag leaves the container entirely', () => {
      module.watchSelection(mouseDownOn(cellABlocks[1]));
      mouseOverOn(cellABlocks[3], cellABlocks[1]);
      mouseOverOn(p[0], cellABlocks[3]);

      expect(selectedIds()).toEqual(['p0', 'p1', 'p2', 'p3', 'toggle', 'table']);
    });
  });

  describe('clear', () => {
    it('puts the caret at the END of the last block for ArrowDown on a backwards selection', () => {
      module.watchSelection(mouseDownOn(p[3]));
      mouseOverOn(p[1], p[3]);

      module.clear(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      expect(setToBlock.mock.calls[0][0]).toBe(p[3]);
      expect(setToBlock.mock.calls[0][1]).toBe('end');
    });

    it('puts the caret at the START of the first block for ArrowUp on a backwards selection', () => {
      module.watchSelection(mouseDownOn(p[3]));
      mouseOverOn(p[1], p[3]);

      module.clear(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

      expect(setToBlock.mock.calls[0][0]).toBe(p[1]);
      expect(setToBlock.mock.calls[0][1]).toBe('start');
    });

    it('falls back to the END of the last block for a non-arrow key', () => {
      module.watchSelection(mouseDownOn(p[3]));
      mouseOverOn(p[1], p[3]);

      module.clear(new KeyboardEvent('keydown', { key: 'a' }));

      expect(setToBlock.mock.calls[0][0]).toBe(p[3]);
      expect(setToBlock.mock.calls[0][1]).toBe('end');
    });

    it('moves no caret when the reason is not a keyboard event', () => {
      module.watchSelection(mouseDownOn(p[3]));
      mouseOverOn(p[1], p[3]);

      module.clear(new MouseEvent('mousedown'));

      expect(setToBlock).not.toHaveBeenCalled();
      expect(module.isCrossBlockSelectionStarted).toBe(false);
    });

    it('forgets the gesture without touching the caret when nothing is selected', () => {
      module.watchSelection(mouseDownOn(p[3]));
      mouseOverOn(p[1], p[3]);
      blocks.forEach((_, index) => {
        blocks[index].selected = false;
      });

      module.clear(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      expect(setToBlock).not.toHaveBeenCalled();
      expect(module.isCrossBlockSelectionStarted).toBe(false);
    });
  });

  describe('toggleBlockSelectedState', () => {
    it('climbs out of a container to its next sibling when the last child is reached', () => {
      blockManagerState.currentBlock = toggleChildren[1];

      module.toggleBlockSelectedState(true);

      expect(selectedIds()).toEqual(['toggle', 'table']);
      expect(table.holder.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    });

    it('climbs out backwards to the container previous sibling from the first child', () => {
      blockManagerState.currentBlock = toggleChildren[0];

      module.toggleBlockSelectedState(false);

      expect(selectedIds()).toEqual(['p3', 'toggle']);
    });

    it('steps to the next sibling at the same level', () => {
      blockManagerState.currentBlock = p[1];

      module.toggleBlockSelectedState(true);

      expect(selectedIds()).toEqual(['p1', 'p2']);
      expect(toolbarClose).toHaveBeenCalled();
      expect(toolbarOpenMultiple).toHaveBeenCalled();
    });

    it('extends by one more block on a second step', () => {
      blockManagerState.currentBlock = p[1];

      module.toggleBlockSelectedState(true);
      module.toggleBlockSelectedState(true);

      expect(selectedIds()).toEqual(['p1', 'p2', 'p3']);
      expect(i18nT).toHaveBeenLastCalledWith('a11y.blocksSelected', { count: 3 });
    });

    it('does nothing at the end of the document', () => {
      blockManagerState.currentBlock = tail;

      module.toggleBlockSelectedState(true);

      expect(selectedIds()).toEqual([]);
      expect(toolbarOpenMultiple).not.toHaveBeenCalled();
    });

    it('does nothing when there is neither a selection nor a current block', () => {
      blockManagerState.currentBlock = undefined;

      module.toggleBlockSelectedState(true);

      expect(selectedIds()).toEqual([]);
    });

    it('defaults to stepping forward', () => {
      blockManagerState.currentBlock = p[1];

      module.toggleBlockSelectedState();

      expect(selectedIds()).toEqual(['p1', 'p2']);
    });
  });

  describe('mousedown routing', () => {
    beforeEach(async () => {
      await module.prepare();
    });

    it('selects the inclusive range from the caret block on Shift+Click', () => {
      blockManagerState.currentBlock = p[1];

      mouseDownOn(p[3], { shiftKey: true });

      expect(selectedIds()).toEqual(['p1', 'p2', 'p3']);
      expect(i18nT).toHaveBeenCalledWith('a11y.blocksSelected', { count: 3 });
    });

    it('stays silent when a repeated Shift+Click does not change the selection', () => {
      blockManagerState.currentBlock = p[1];

      mouseDownOn(p[3], { shiftKey: true });
      mouseUp();
      vi.mocked(announce).mockClear();
      mouseDownOn(p[3], { shiftKey: true });

      expect(announce).not.toHaveBeenCalled();
    });

    it('extends the existing selection additively on a Shift+DRAG', () => {
      p[0].selected = true;
      blockManagerState.currentBlock = p[2];

      mouseDownOn(p[2], { shiftKey: true });
      mouseOverOn(p[3], p[2]);

      expect(selectedIds()).toEqual(['p0', 'p2', 'p3']);
    });

    it('opens the multi-block toolbar when the Shift gesture was a drag', () => {
      p[0].selected = true;
      blockManagerState.currentBlock = p[2];

      mouseDownOn(p[2], { shiftKey: true });
      mouseOverOn(p[3], p[2]);
      toolbarOpenMultiple.mockClear();
      mouseUp();

      expect(toolbarOpenMultiple).toHaveBeenCalled();
    });

    it('leaves the selection untouched when the Shift drag hovers the pivot itself', () => {
      p[0].selected = true;
      blockManagerState.currentBlock = p[2];

      mouseDownOn(p[2], { shiftKey: true });
      mouseOverOn(p[2], p[2]);

      expect(selectedIds()).toEqual(['p2']);
    });

    it('toggles a single block in and out on Cmd+Shift+Click', () => {
      p[0].selected = true;

      mouseDownOn(p[2], { shiftKey: true,
        metaKey: true });

      expect(selectedIds()).toEqual(['p0', 'p2']);

      mouseDownOn(p[2], { shiftKey: true,
        metaKey: true });

      expect(selectedIds()).toEqual(['p0']);
    });

    it('closes the toolbar when the toggle empties the selection', () => {
      mouseDownOn(p[2], { shiftKey: true,
        altKey: true });
      toolbarClose.mockClear();

      mouseDownOn(p[2], { shiftKey: true,
        altKey: true });

      expect(selectedIds()).toEqual([]);
      expect(toolbarClose).toHaveBeenCalled();
      expect(module.isCrossBlockSelectionStarted).toBe(false);
    });

    it('preserves the selection when the press lands on the toolbar', () => {
      module.watchSelection(mouseDownOn(p[1]));
      mouseOverOn(p[3], p[1]);
      mouseUp();
      clearSelection.mockClear();

      toolbarWrapper.dispatchEvent(new MouseEvent('mousedown', { bubbles: true,
        button: 0 }));

      expect(clearSelection).not.toHaveBeenCalled();
      expect(selectedIds()).toEqual(['p1', 'p2', 'p3']);
    });

    it('clears the selection when the press lands outside the editor', () => {
      const outside = document.createElement('div');

      document.body.appendChild(outside);
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true,
        button: 0 }));

      expect(clearSelection).toHaveBeenCalled();
      outside.remove();
    });

    it('stands down entirely while rectangle selection is active', () => {
      isRectActivated.mockReturnValue(true);

      mouseDownOn(p[1]);
      mouseOverOn(p[3], p[1]);

      expect(clearSelection).not.toHaveBeenCalled();
      expect(selectedIds()).toEqual([]);
    });

    it('stands down when the editor UI has no redactor', () => {
      redactorHolder.redactor = undefined;

      mouseDownOn(p[1]);

      expect(clearSelection).not.toHaveBeenCalled();
    });
  });
  describe('selectionchange wiring', () => {
    it('repaints the cross-block highlight when the document selection changes', async () => {
      await module.prepare();
      selectAcross(p[1], p[2]);

      document.dispatchEvent(new Event('selectionchange'));

      expect(highlights.has(HIGHLIGHT_NAME)).toBe(true);
      expect(wrapper.hasAttribute(DATA_ATTR.crossSelection)).toBe(true);
    });
  });

  describe('markDestroyed without a UI', () => {
    it('survives a wrapper that is already gone', () => {
      redactorHolder.wrapper = undefined;

      expect(() => module.markDestroyed()).not.toThrow();
    });
  });

  describe('cross-block TEXT drag', () => {
    beforeEach(async () => {
      await module.prepare();
      atPoint(10, 10, p[1], 1);
    });

    const startDrag = (): void => {
      mouseDownOn(p[1], { clientX: 10,
        clientY: 10 });
    };

    it('applies a spanning range and stands the block path down', () => {
      p[0].selected = true;
      startDrag();
      atPoint(20, 50, p[2], 2);

      mouseMove(20, 50, p[2]);

      expect(selectionRange?.startContainer).toBe(textNodeOf(p[1]));
      expect(selectionRange?.endContainer).toBe(textNodeOf(p[2]));
      expect(selectedIds()).toEqual([]);
      expect(highlights.has(HIGHLIGHT_NAME)).toBe(true);
    });

    it('ignores a move made after the button was released outside the window', () => {
      startDrag();
      atPoint(20, 50, p[2], 2);

      mouseMove(20, 50, p[2], 0);

      expect(selectionRange).toBeNull();
    });

    it('snaps the focus to the hovered block edge when no character is under the pointer', () => {
      startDrag();

      mouseMove(20, 50, p[2]);

      expect(selectionRange?.startContainer).toBe(textNodeOf(p[1]));
      expect(selectionRange?.endContainer).toBe(inputOf(p[2]));
    });

    it('drops the standing intent when the pointer comes back to the anchor block', () => {
      startDrag();
      atPoint(20, 50, p[2], 2);
      mouseMove(20, 50, p[2]);
      atPoint(12, 12, p[1], 3);
      mouseMove(12, 12, p[1]);

      const collapsed = document.createRange();

      collapsed.setStart(textNodeOf(p[1]), 0);
      collapsed.setEnd(textNodeOf(p[1]), 2);
      selectionRange = collapsed;

      document.dispatchEvent(new Event('selectionchange'));

      expect(selectionRange).toBe(collapsed);
    });

    it('re-asserts its range when the engine rewrites the selection mid-drag', () => {
      startDrag();
      atPoint(20, 50, p[2], 2);
      mouseMove(20, 50, p[2]);

      const clamped = document.createRange();

      clamped.setStart(textNodeOf(p[1]), 0);
      clamped.setEnd(textNodeOf(p[1]), 2);
      selectionRange = clamped;

      document.dispatchEvent(new Event('selectionchange'));

      expect(selectionRange?.startContainer).toBe(textNodeOf(p[1]));
      expect(selectionRange?.endContainer).toBe(textNodeOf(p[2]));
    });

    it('re-asserts only once per move so a clamping engine cannot ping-pong', () => {
      startDrag();
      atPoint(20, 50, p[2], 2);
      mouseMove(20, 50, p[2]);

      const firstClamp = document.createRange();

      firstClamp.setStart(textNodeOf(p[1]), 0);
      firstClamp.setEnd(textNodeOf(p[1]), 2);
      selectionRange = firstClamp;
      document.dispatchEvent(new Event('selectionchange'));

      const secondClamp = document.createRange();

      secondClamp.setStart(textNodeOf(p[1]), 1);
      secondClamp.setEnd(textNodeOf(p[1]), 3);
      selectionRange = secondClamp;
      document.dispatchEvent(new Event('selectionchange'));

      expect(selectionRange).toBe(secondClamp);
    });

    it('opens no multi-block toolbar when the gesture was a text drag', () => {
      startDrag();
      atPoint(20, 50, p[2], 2);
      mouseMove(20, 50, p[2]);
      toolbarOpenMultiple.mockClear();

      mouseUp();

      expect(toolbarOpenMultiple).not.toHaveBeenCalled();
    });

    it('hands the gesture to the block path when it reaches a block with no text', () => {
      startDrag();
      atPoint(5, 5, p[0], 1);
      mouseMove(5, 5, p[0]);

      inputOf(p[2]).remove();
      atPoint(20, 90, p[3], 2);
      mouseMove(20, 90, p[3]);

      expect(selectedIds()).toEqual(['p1', 'p2', 'p3']);
    });

    it('refuses a text selection into a subtree that owns its own keyboard', () => {
      p[2].holder.setAttribute(DATA_ATTR.keyboardOwner, '');
      startDrag();
      atPoint(20, 50, p[2], 2);

      mouseMove(20, 50, p[2]);

      expect(selectionRange).toBeNull();
      expect(highlights.has(HIGHLIGHT_NAME)).toBe(false);
    });

    it('refuses a text selection that would leave its nested container', () => {
      caretPoints.clear();
      atPoint(10, 10, cellABlocks[1], 1);
      mouseDownOn(cellABlocks[1], { clientX: 10,
        clientY: 10 });
      atPoint(20, 50, p[0], 2);

      mouseMove(20, 50, p[0]);

      expect(selectionRange).toBeNull();
    });
  });
  describe('an engine that reports no selection object', () => {
    beforeEach(async () => {
      await module.prepare();
      vi.spyOn(window, 'getSelection').mockReturnValue(null);
    });

    it('still runs every path that would drop the native range', () => {
      blockManagerState.currentBlock = p[1];

      expect(() => {
        module.clearTextSelection();
        module.syncTextSelectionHighlight();
        mouseDownOn(p[3], { shiftKey: true });
        mouseOverOn(p[2], p[3]);
        mouseUp();
        mouseDownOn(p[0], { shiftKey: true,
          metaKey: true });
        module.watchSelection(mouseDownOn(cellABlocks[1]));
        mouseOverOn(cellABlocks[2], cellABlocks[1]);
      }).not.toThrow();

      expect(selectedIds()).toEqual(['p0', 'p2', 'p3', 'c1', 'c2']);
    });
  });
});
