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

const createStub = (
  id: string,
  options: { parentId?: string | null; ownsChildren?: boolean; inputs?: number } = {}
): BlockStub => {
  const holder = document.createElement('div');

  holder.setAttribute(DATA_ATTR.element, '');
  holder.setAttribute('data-stub-id', id);
  holder.scrollIntoView = vi.fn();

  const inputs: HTMLElement[] = [];

  for (let index = 0; index < (options.inputs ?? 1); index += 1) {
    const input = document.createElement('div');

    input.setAttribute('contenteditable', 'true');
    input.textContent = `text of ${id} #${index}`;
    holder.appendChild(input);
    inputs.push(input);
  }

  const first = inputs[0];
  const last = inputs[inputs.length - 1];

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
    get: () => (holder.contains(first) ? first : undefined),
  });

  Object.defineProperty(stub, 'lastInput', {
    configurable: true,
    get: () => (holder.contains(last) ? last : undefined),
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
  /** A block one container deeper than cellA — never a direct child of cellA. */
  let deepBlock: BlockStub;
  /** A block with two editing hosts, so firstInput and lastInput differ. */
  let paired: BlockStub;
  /** A holder inside cellA that no block owns. */
  let strayHolder: HTMLElement;
  /** When set, replaces the repository's answer for a range gesture. */
  let siblingRangeOverride: Block[] | null;

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
  let disableHoverForCooldown: ReturnType<typeof vi.fn>;
  let resetBlockHoverState: ReturnType<typeof vi.fn>;
  /** What the mocked `window.getSelection()` reports about the live selection. */
  let selectionAnchors: { anchorNode: Node | null; focusNode: Node | null; anchorOffset: number };
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
    selectionAnchors = { anchorNode: null,
      focusNode: null,
      anchorOffset: 0 };
    disableHoverForCooldown = vi.fn();
    resetBlockHoverState = vi.fn();

    p = ['p0', 'p1', 'p2', 'p3'].map((id) => createStub(id));
    toggle = createStub('toggle');
    toggleChildren = ['t0', 't1'].map((id) => createStub(id, { parentId: 'toggle' }));
    table = createStub('table', { ownsChildren: true });
    cellABlocks = ['c0', 'c1', 'c2', 'c3'].map((id) => createStub(id, { parentId: 'table' }));
    cellBBlock = createStub('c4', { parentId: 'table' });
    deepBlock = createStub('deep', { parentId: 'table' });
    paired = createStub('pair', { inputs: 2 });
    tail = createStub('p4');

    blocks = [...p, toggle, ...toggleChildren, table, ...cellABlocks, cellBBlock, deepBlock, tail, paired];

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

    /**
     * Between c0 and c1 sit two holders that are NOT direct children of cellA:
     * one owned by a deeper container, one owned by no block at all. A child
     * range must never count either of them.
     */
    const deepContainer = document.createElement('div');

    deepContainer.setAttribute(DATA_ATTR.nestedBlocks, '');
    deepContainer.appendChild(deepBlock.holder);
    strayHolder = document.createElement('div');
    strayHolder.setAttribute(DATA_ATTR.element, '');
    cellA.appendChild(cellABlocks[0].holder);
    cellABlocks[0].holder.after(deepContainer);
    deepContainer.after(cellABlocks[1].holder);
    cellABlocks[1].holder.after(cellABlocks[2].holder, cellABlocks[3].holder, strayHolder);
    cellB.appendChild(cellBBlock.holder);
    table.holder.append(cellA, cellB);
    siblingRangeOverride = null;

    redactor.appendChild(tail.holder);
    redactor.appendChild(paired.holder);
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
          (anchor: Block, target: Block) => siblingRangeOverride ?? repository.getSelectionSiblingRange(anchor, target)
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
        disableHoverForCooldown,
        resetBlockHoverState,
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
      anchorNode: selectionAnchors.anchorNode,
      focusNode: selectionAnchors.focusNode,
      get anchorOffset() {
        return selectionAnchors.anchorOffset;
      },
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
      blockManagerState.currentBlock = paired;

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

    it('still steps the keyboard selection with no selection object to drop', () => {
      blockManagerState.currentBlock = p[1];

      expect(() => module.toggleBlockSelectedState(true)).not.toThrow();
      expect(selectedIds()).toEqual(['p1', 'p2']);
    });
  });

  describe('markDestroyed with a partial UI', () => {
    it('survives a UI whose node registry is missing', () => {
      const bare = new CrossBlockSelection({
        config: {},
        eventsDispatcher: {
          on: vi.fn(),
          off: vi.fn(),
        } as unknown as CrossBlockSelection['eventsDispatcher'],
      });

      bare.state = { UI: {} } as unknown as CrossBlockSelection['Blok'];

      expect(() => bare.markDestroyed()).not.toThrow();
    });

    it('survives a Blok state with no UI module at all', () => {
      const bare = new CrossBlockSelection({
        config: {},
        eventsDispatcher: {
          on: vi.fn(),
          off: vi.fn(),
        } as unknown as CrossBlockSelection['eventsDispatcher'],
      });

      bare.state = {} as unknown as CrossBlockSelection['Blok'];

      expect(() => bare.markDestroyed()).not.toThrow();
    });
  });

  describe('selectBlocksOfTextSelection — refused promotion', () => {
    it('reports no promotion when the endpoints have no selectable range', () => {
      selectAcross(p[1], p[2]);
      siblingRangeOverride = [];

      expect(module.selectBlocksOfTextSelection()).toBe(false);
      expect(selectedIds()).toEqual([]);
      expect(toolbarOpenMultiple).not.toHaveBeenCalled();
    });

    it('drops the paint that went with the range it replaced', () => {
      selectAcross(p[1], p[2]);
      module.syncTextSelectionHighlight();
      expect(highlights.has(HIGHLIGHT_NAME)).toBe(true);

      module.selectBlocksOfTextSelection();

      expect(highlights.has(HIGHLIGHT_NAME)).toBe(false);
    });
  });

  describe('syncTextSelectionHighlight — wrapper edge cases', () => {
    it('survives a wrapper that is already gone', () => {
      redactorHolder.wrapper = undefined;
      selectAcross(p[1], p[2]);

      expect(() => module.syncTextSelectionHighlight()).not.toThrow();
    });

    it('touches the wrapper attribute only on a transition', () => {
      const setAttribute = vi.spyOn(wrapper, 'setAttribute');
      const removeAttribute = vi.spyOn(wrapper, 'removeAttribute');

      selectAcross(p[1], p[2]);
      module.syncTextSelectionHighlight();
      module.syncTextSelectionHighlight();

      expect(setAttribute).toHaveBeenCalledTimes(1);
      expect(removeAttribute).not.toHaveBeenCalled();
    });

    it('marks the wrapper with an empty attribute value', () => {
      selectAcross(p[1], p[2]);

      module.syncTextSelectionHighlight();

      expect(wrapper.getAttribute(DATA_ATTR.crossSelection)).toBe('');
    });

    it('does not touch the wrapper attribute when there was nothing stamped', () => {
      const removeAttribute = vi.spyOn(wrapper, 'removeAttribute');

      expect(wrapper.hasAttribute(DATA_ATTR.crossSelection)).toBe(false);

      module.syncTextSelectionHighlight();

      expect(removeAttribute).not.toHaveBeenCalled();
    });

    it('paints one sub-range per editing host, not a placeholder', () => {
      selectAcross(p[1], p[2]);

      module.syncTextSelectionHighlight();

      const painted = highlights.get(HIGHLIGHT_NAME) as HighlightStub;

      expect(painted.ranges).toHaveLength(2);
      expect(painted.ranges.map((range) => range.startContainer)).toEqual([textNodeOf(p[1]), inputOf(p[2])]);
    });
  });

  describe('engine paint trust', () => {    it('leaves the paint to an engine that reports a spanning selection', () => {
      selectionAnchors.anchorNode = textNodeOf(p[1]);
      selectionAnchors.focusNode = textNodeOf(p[2]);
      selectAcross(p[1], p[2]);

      module.syncTextSelectionHighlight();

      expect(highlights.has(HIGHLIGHT_NAME)).toBe(false);
      expect(wrapper.hasAttribute(DATA_ATTR.crossSelection)).toBe(false);
    });
  });

  /** A mouseover with no relatedTarget — the pointer entering the window. */
  const mouseOverFromOutside = (block: BlockStub): void => {
    inputOf(block).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  };

  /** A mousedown on the redactor itself — inside the editor, in no block. */
  const mouseDownOnRedactor = (init: MouseEventInit = {}): MouseEvent => {
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      ...init,
    });

    redactor.dispatchEvent(event);

    return event;
  };

  /** Register a caret hit test at a point that resolves to any node. */
  const atPointNode = (x: number, y: number, node: Node, offset: number): void => {
    caretPoints.set(`${x},${y}`, { node,
      offset });
  };

  const inputOfIndex = (block: BlockStub, index: number): HTMLElement => {
    const inputs = block.holder.querySelectorAll('[contenteditable="true"]');
    const input = inputs[index];

    if (!(input instanceof HTMLElement)) {
      throw new Error(`stub ${block.id} has no editable input #${index}`);
    }

    return input;
  };

  describe('mouseover with no related target', () => {
    it('anchors on the last selected block', () => {
      module.watchSelection(mouseDownOn(p[1]));

      mouseOverFromOutside(p[3]);

      expect(selectedIds()).toEqual(['p1', 'p2', 'p3']);
    });
  });

  describe('mouseover side effects', () => {
    it('closes the toolbar as a block-level range moves', () => {
      module.watchSelection(mouseDownOn(p[1]));
      toolbarClose.mockClear();

      mouseOverOn(p[3], p[1]);

      expect(toolbarClose).toHaveBeenCalled();
    });

    it('drops a stale child selection when the drag never reaches a range', () => {
      module.watchSelection(mouseDownOn(cellABlocks[0]));
      mouseOverOn(cellABlocks[1], cellABlocks[0]);
      expect(cellABlocks[1].selected).toBe(true);

      siblingRangeOverride = [];
      mouseOverOn(p[0], cellABlocks[1]);

      expect(selectedIds()).toEqual([]);
    });
  });

  describe('mouseover during a text drag', () => {
    beforeEach(async () => {
      await module.prepare();
      atPoint(10, 10, p[1], 1);
      atPoint(20, 50, p[2], 2);
    });

    it('does not let the block path rewrite the range a text drag set', () => {
      mouseDownOn(p[1], { clientX: 10,
        clientY: 10 });
      mouseMove(20, 50, p[2]);
      mouseOverOn(p[3], p[2]);

      expect(selectedIds()).toEqual([]);
    });
  });

  describe('nested (same-container) drag — foreign holders', () => {
    it('never counts a deeper container or an unowned holder as a child', () => {
      module.watchSelection(mouseDownOn(cellABlocks[0]));
      mouseOverOn(cellABlocks[1], cellABlocks[0]);

      expect(selectedIds()).toEqual(['c0', 'c1']);
      expect(deepBlock.selected).toBe(false);
    });

    it('closes both toolbars once a child range stands', () => {
      module.watchSelection(mouseDownOn(cellABlocks[0]));
      inlineToolbarClose.mockClear();
      toolbarClose.mockClear();

      mouseOverOn(cellABlocks[1], cellABlocks[0]);

      expect(inlineToolbarClose).toHaveBeenCalled();
      expect(toolbarClose).toHaveBeenCalled();
    });
  });

  describe('Shift+DRAG side effects', () => {
    beforeEach(async () => {
      await module.prepare();
    });

    it('invalidates the selection cache and closes the toolbar as the range extends', () => {
      blockManagerState.currentBlock = p[2];
      p[0].selected = true;

      mouseDownOn(p[2], { shiftKey: true });
      clearCache.mockClear();
      toolbarClose.mockClear();

      mouseOverOn(p[3], p[2]);

      expect(clearCache).toHaveBeenCalled();
      expect(toolbarClose).toHaveBeenCalled();
    });

    it('reopens the multi-block toolbar and announces when the drag ends', () => {
      blockManagerState.currentBlock = p[2];
      mouseDownOn(p[2], { shiftKey: true });
      mouseOverOn(p[3], p[2]);
      disableHoverForCooldown.mockClear();
      resetBlockHoverState.mockClear();
      toolbarOpenMultiple.mockClear();
      vi.mocked(announce).mockClear();

      mouseUp();

      expect(disableHoverForCooldown).toHaveBeenCalled();
      expect(resetBlockHoverState).toHaveBeenCalled();
      expect(toolbarOpenMultiple).toHaveBeenCalled();
      expect(announce).toHaveBeenCalledWith('a11y.blocksSelected', { politeness: 'polite' });
    });

    it('does not reopen the toolbar when a Shift+CLICK never became a drag', () => {
      blockManagerState.currentBlock = p[1];
      mouseDownOn(p[3], { shiftKey: true });
      disableHoverForCooldown.mockClear();
      toolbarOpenMultiple.mockClear();
      vi.mocked(announce).mockClear();

      mouseUp();

      expect(disableHoverForCooldown).not.toHaveBeenCalled();
      expect(toolbarOpenMultiple).not.toHaveBeenCalled();
      expect(announce).not.toHaveBeenCalled();
    });

    it('stands down while a block drag is in progress', () => {
      blockManagerState.currentBlock = p[2];
      mouseDownOn(p[2], { shiftKey: true });
      dragState.isDragging = true;

      mouseOverOn(p[3], p[2]);

      expect(selectedIds()).toEqual(['p2']);
    });
  });

  describe('Cmd+Shift+Click side effects', () => {
    beforeEach(async () => {
      await module.prepare();
    });

    it('invalidates the cache, closes the inline toolbar and opens the multi-block one', () => {
      mouseDownOn(p[2], { shiftKey: true,
        metaKey: true });

      expect(clearCache).toHaveBeenCalled();
      expect(inlineToolbarClose).toHaveBeenCalled();
      expect(toolbarOpenMultiple).toHaveBeenCalled();
    });

    it('keeps the first toggled block as the anchor for later gestures', () => {
      mouseDownOn(p[2], { shiftKey: true,
        metaKey: true });
      mouseDownOn(p[3], { shiftKey: true,
        metaKey: true });

      expect(module.isCrossBlockSelectionStarted).toBe(true);
    });
  });

  describe('Shift+Click side effects', () => {
    beforeEach(async () => {
      await module.prepare();
    });

    it('closes the inline toolbar and opens the multi-block one', () => {
      blockManagerState.currentBlock = p[1];

      mouseDownOn(p[3], { shiftKey: true });

      expect(inlineToolbarClose).toHaveBeenCalled();
      expect(toolbarOpenMultiple).toHaveBeenCalled();
    });

    it('still clears the old selection when the press hit no block', () => {
      selectAcross(p[1], p[2]);
      clearSelection.mockClear();

      redactor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true,
        button: 0,
        shiftKey: true }));

      expect(clearSelection).toHaveBeenCalled();
    });

    it('still clears the old selection when there is no block to anchor on', () => {
      blockManagerState.currentBlock = undefined;
      selectAcross(p[1], p[2]);
      clearSelection.mockClear();

      mouseDownOn(p[3], { shiftKey: true });

      expect(clearSelection).toHaveBeenCalled();
    });
  });

  describe('cross-block TEXT drag — re-assertion', () => {
    beforeEach(async () => {
      await module.prepare();
      atPoint(10, 10, p[1], 1);
    });

    const rangeBetween = (from: BlockStub, fromOffset: number, to: BlockStub, toOffset: number): Range => {
      const range = document.createRange();

      range.setStart(textNodeOf(from), fromOffset);
      range.setEnd(textNodeOf(to), toOffset);

      return range;
    };

    const dragToSecondBlock = (): void => {
      mouseDownOn(p[1], { clientX: 10,
        clientY: 10 });
      atPoint(20, 50, p[2], 2);
      mouseMove(20, 50, p[2]);
    };

    it('leaves a selection that already matches the drag alone', () => {
      dragToSecondBlock();
      removeAllRanges.mockClear();

      document.dispatchEvent(new Event('selectionchange'));

      expect(removeAllRanges).not.toHaveBeenCalled();
    });

    it.each([
      ['start container', () => rangeBetween(p[0], 1, p[2], 2)],
      ['start offset', () => rangeBetween(p[1], 0, p[2], 2)],
      ['end container', () => rangeBetween(p[1], 1, p[1], 2)],
      ['end offset', () => rangeBetween(p[1], 1, p[2], 1)],
    ])('re-asserts when only the %s differs', (_component, build) => {
      dragToSecondBlock();
      removeAllRanges.mockClear();
      selectionRange = build();

      document.dispatchEvent(new Event('selectionchange'));

      expect(removeAllRanges).toHaveBeenCalledTimes(1);
    });

    it('paints its own range once the engine has been caught clamping it', () => {
      selectionAnchors.anchorNode = textNodeOf(p[1]);
      selectionAnchors.focusNode = textNodeOf(p[2]);
      dragToSecondBlock();

      const clamped = rangeBetween(p[1], 0, p[1], 2);

      selectionRange = clamped;
      document.dispatchEvent(new Event('selectionchange'));

      expect(highlights.has(HIGHLIGHT_NAME)).toBe(true);
    });

    it('does not latch a clamp for a rewrite that still spans two hosts', () => {
      selectionAnchors.anchorNode = textNodeOf(p[1]);
      selectionAnchors.focusNode = textNodeOf(p[2]);
      dragToSecondBlock();

      /** A different spanning range: another writer, not the engine's clamp. */
      selectionRange = rangeBetween(p[0], 1, p[2], 2);
      document.dispatchEvent(new Event('selectionchange'));

      expect(selectionRange?.startContainer).toBe(textNodeOf(p[1]));
      expect(highlights.has(HIGHLIGHT_NAME)).toBe(false);
    });
  });

  describe('cross-block TEXT drag — anchor capture', () => {
    beforeEach(async () => {
      await module.prepare();
    });

    it('reads the anchor from the live selection once and reuses it', () => {
      caretPoints.clear();
      selectionAnchors.anchorNode = textNodeOf(p[1]);
      selectionAnchors.anchorOffset = 2;
      atPoint(20, 50, p[2], 2);

      mouseDownOn(p[1], { clientX: 10,
        clientY: 10 });
      mouseMove(20, 50, p[2]);

      expect(selectionRange?.startContainer).toBe(textNodeOf(p[1]));
      expect(selectionRange?.startOffset).toBe(2);

      /** The engine moves the caret; the drag must keep the anchor it captured. */
      selectionAnchors.anchorNode = textNodeOf(p[0]);
      selectionAnchors.anchorOffset = 3;
      mouseMove(20, 50, p[2]);

      expect(selectionRange?.startContainer).toBe(textNodeOf(p[1]));
      expect(selectionRange?.startOffset).toBe(2);
    });

    it('falls back to the pointer origin when the selection reports no caret', () => {
      caretPoints.clear();
      atPoint(10, 10, p[1], 1);
      atPoint(20, 50, p[2], 2);

      mouseDownOn(p[1], { clientX: 10,
        clientY: 10 });
      mouseMove(20, 50, p[2]);

      expect(selectionRange?.startContainer).toBe(textNodeOf(p[1]));
      expect(selectionRange?.startOffset).toBe(1);
    });
  });

  describe('cross-block TEXT drag — focus edge from geometry', () => {
    beforeEach(async () => {
      await module.prepare();
    });

    it('snaps to the end of a block that follows the anchor', () => {
      caretPoints.clear();
      atPoint(10, 10, p[1], 1);

      mouseDownOn(p[1], { clientX: 10,
        clientY: 10 });
      mouseMove(20, 0, p[2]);

      expect(selectionRange?.endContainer).toBe(inputOf(p[2]));
      expect(selectionRange?.endOffset).toBe(1);
    });

    it('snaps to the start of a block that precedes the anchor', () => {
      caretPoints.clear();
      atPoint(10, 10, p[2], 1);

      mouseDownOn(p[2], { clientX: 10,
        clientY: 10 });
      mouseMove(20, 0, p[0]);

      expect(selectionRange?.startContainer).toBe(inputOf(p[0]));
      expect(selectionRange?.startOffset).toBe(0);
    });
  });

  describe('clear — a block that left the document', () => {    it('keeps the caret still when the anchor block is gone', () => {
      module.watchSelection(mouseDownOn(p[0]));
      mouseOverOn(p[2], p[0]);
      expect(selectedIds()).toEqual(['p0', 'p1', 'p2']);

      const [removed] = blocks.splice(0, 1);

      try {
        module.clear(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
        expect(setToBlock).not.toHaveBeenCalled();
      } finally {
        blocks.unshift(removed);
      }
    });

    it('keeps the caret still when the target block is gone', () => {
      module.watchSelection(mouseDownOn(p[0]));
      mouseOverOn(p[2], p[0]);

      const [removed] = blocks.splice(2, 1);

      try {
        module.clear(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
        expect(setToBlock).not.toHaveBeenCalled();
      } finally {
        blocks.splice(2, 0, removed);
      }
    });
  });

  describe('clear — arrow keys', () => {
    const selectForwardRange = (): void => {
      module.watchSelection(mouseDownOn(p[1]));
      mouseOverOn(p[3], p[1]);
    };

    it('moves the caret to the end of the range on ArrowRight', () => {
      selectForwardRange();

      module.clear(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

      expect(setToBlock.mock.calls[0][0]).toBe(p[3]);
      expect(setToBlock.mock.calls[0][1]).toBe('end');
    });

    it('moves the caret to the start of the range on ArrowLeft', () => {
      selectForwardRange();

      module.clear(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));

      expect(setToBlock.mock.calls[0][0]).toBe(p[1]);
      expect(setToBlock.mock.calls[0][1]).toBe('start');
    });

    it('moves the caret to the end of the range on ArrowDown when the anchor comes first', () => {
      selectForwardRange();

      module.clear(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      expect(setToBlock.mock.calls[0][0]).toBe(p[3]);
      expect(setToBlock.mock.calls[0][1]).toBe('end');
    });
  });

  describe('mousedown on the editor but not on a block', () => {
    beforeEach(async () => {
      await module.prepare();
    });

    it('registers no drag watchers', () => {
      module.watchSelection(mouseDownOnRedactor());

      mouseOverOn(p[3], p[1]);

      expect(selectedIds()).toEqual([]);
    });

    it('still clears the old selection on a modifier+Shift+Click', () => {
      selectAcross(p[1], p[2]);
      clearSelection.mockClear();

      mouseDownOnRedactor({ shiftKey: true,
        metaKey: true });

      expect(clearSelection).toHaveBeenCalled();
    });
  });

  describe('mousedown routing — refused and stood-down paths', () => {
    beforeEach(async () => {
      await module.prepare();
    });

    it('leaves the old selection to the outside-click path when the UI has no redactor', () => {
      selectAcross(p[1], p[2]);
      redactorHolder.redactor = undefined;
      clearSelection.mockClear();

      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true,
        button: 0 }));

      expect(clearSelection).not.toHaveBeenCalled();
    });

    it('does not range-select while rectangle selection owns the gesture', () => {
      isRectActivated.mockReturnValue(true);
      blockManagerState.currentBlock = p[1];

      mouseDownOn(p[3], { shiftKey: true });

      expect(selectedIds()).toEqual([]);
    });

    it('does not toggle a block when the press was not a left click', () => {
      mouseDownOn(p[3], { shiftKey: true,
        metaKey: true,
        button: 2 });

      expect(selectedIds()).toEqual([]);
    });

    it('does not range-select a Shift+Click made with a non-left button', () => {
      blockManagerState.currentBlock = p[1];

      mouseDownOn(p[3], { shiftKey: true,
        button: 2 });

      expect(selectedIds()).toEqual([]);
    });

    it('clears the old text selection on a plain press inside the editor', () => {
      selectAcross(p[1], p[2]);
      clearSelection.mockClear();

      mouseDownOn(p[1]);

      expect(clearSelection).toHaveBeenCalled();
    });
  });

  describe('a range that cannot be resolved', () => {
    beforeEach(async () => {
      await module.prepare();
    });

    it('opens no toolbar on a Shift+Click that resolves to no range', () => {
      blockManagerState.currentBlock = p[1];
      siblingRangeOverride = [];
      toolbarOpenMultiple.mockClear();

      mouseDownOn(p[3], { shiftKey: true });

      expect(toolbarOpenMultiple).not.toHaveBeenCalled();
      expect(selectedIds()).toEqual([]);
    });

    it('stops the keyboard step that resolves to no range', () => {
      blockManagerState.currentBlock = p[1];
      siblingRangeOverride = [];
      toolbarClose.mockClear();

      module.toggleBlockSelectedState(true);

      expect(toolbarClose).not.toHaveBeenCalled();
      expect(p[2].holder.scrollIntoView).not.toHaveBeenCalled();
    });

    it('extends the Shift+drag base selection but drops it when no range resolves', () => {
      p[0].selected = true;
      blockManagerState.currentBlock = p[2];

      mouseDownOn(p[2], { shiftKey: true });
      expect(selectedIds()).toEqual(['p2']);

      siblingRangeOverride = [];
      mouseOverOn(p[3], p[2]);

      expect(selectedIds()).toEqual(['p2']);
    });
  });

  describe('cross-block TEXT drag — a point outside every editing host', () => {
    beforeEach(async () => {
      await module.prepare();
    });

    it('falls back to the hovered block edge for a point with no host', () => {
      caretPoints.clear();
      atPoint(10, 10, p[1], 1);
      atPointNode(20, 50, redactor, 0);

      mouseDownOn(p[1], { clientX: 10,
        clientY: 10 });
      mouseMove(20, 50, p[2]);

      expect(selectionRange?.endContainer).toBe(inputOf(p[2]));
      expect(selectionRange?.endOffset).toBe(1);
    });

    it('anchors the edge on the hovered block last editing host', () => {
      caretPoints.clear();
      atPoint(10, 10, p[1], 1);

      mouseDownOn(p[1], { clientX: 10,
        clientY: 10 });
      mouseMove(20, 50, paired);

      expect(selectionRange?.endContainer).toBe(inputOfIndex(paired, 1));
    });
  });

  describe('cross-block TEXT drag — stood-down gestures', () => {
    beforeEach(async () => {
      await module.prepare();
      atPoint(10, 10, p[1], 1);
      atPoint(20, 50, p[2], 2);
    });

    const startDrag = (): void => {
      mouseDownOn(p[1], { clientX: 10,
        clientY: 10 });
    };

    it('stands down while a block drag owns the gesture', () => {
      startDrag();
      dragState.isDragging = true;

      mouseMove(20, 50, p[2]);

      expect(selectionRange).toBeNull();
    });

    it('stands down while a toolbar is open', () => {
      startDrag();
      uiState.someToolbarOpened = true;

      mouseMove(20, 50, p[2]);

      expect(selectionRange).toBeNull();
    });

    it('stands down while rectangle selection owns the gesture', () => {
      startDrag();
      isRectActivated.mockReturnValue(true);

      mouseMove(20, 50, p[2]);

      expect(selectionRange).toBeNull();
    });

    it('does not re-run the block teardown on every move', () => {
      startDrag();
      atPoint(20, 50, p[2], 2);
      mouseMove(20, 50, p[2]);

      expect(inlineToolbarClose).toHaveBeenCalled();
      expect(toolbarClose).toHaveBeenCalled();

      inlineToolbarClose.mockClear();
      toolbarClose.mockClear();
      atPoint(30, 60, p[2], 0);
      mouseMove(30, 60, p[2]);

      expect(inlineToolbarClose).not.toHaveBeenCalled();
      expect(toolbarClose).not.toHaveBeenCalled();
    });

    it('clears the paint when the gesture ends with nothing selected', () => {
      startDrag();
      atPoint(20, 50, p[2], 2);
      mouseMove(20, 50, p[2]);
      expect(highlights.has(HIGHLIGHT_NAME)).toBe(true);

      selectionRange = null;
      mouseUp();

      expect(highlights.has(HIGHLIGHT_NAME)).toBe(false);
    });
  });

  describe('cross-block TEXT drag — focus in another host of the same block', () => {
    beforeEach(async () => {
      await module.prepare();
    });

    it('drops the standing intent when the drag stays inside one block', () => {
      caretPoints.clear();
      atPointNode(10, 10, inputOfIndex(paired, 0).firstChild ?? inputOfIndex(paired, 0), 1);
      atPointNode(20, 50, inputOfIndex(paired, 1), 0);

      mouseDownOn(paired, { clientX: 10,
        clientY: 10 });
      mouseMove(20, 50, paired);

      expect(selectionRange).toBeNull();
    });
  });

  describe('cross-block TEXT drag — handed back to the block path', () => {
    beforeEach(async () => {
      await module.prepare();
      atPoint(10, 10, p[1], 1);
    });

    const startDrag = (): void => {
      mouseDownOn(p[1], { clientX: 10,
        clientY: 10 });
    };

    it('does not select blocks when no text range was ever standing', () => {
      p[2].holder.setAttribute(DATA_ATTR.keyboardOwner, '');
      atPoint(20, 50, p[2], 2);

      startDrag();
      mouseMove(20, 50, p[2]);

      expect(selectedIds()).toEqual([]);
    });

    it('opens the multi-block toolbar after the block path takes over', () => {
      atPoint(20, 50, p[2], 2);
      startDrag();
      atPoint(5, 5, p[0], 1);
      mouseMove(5, 5, p[0]);

      inputOf(p[2]).remove();
      atPoint(20, 90, p[3], 2);
      toolbarOpenMultiple.mockClear();
      mouseMove(20, 90, p[3]);
      mouseUp();

      expect(toolbarOpenMultiple).toHaveBeenCalled();
    });

    it('closes both toolbars and keeps the anchor when the takeover applies', () => {
      atPoint(20, 50, p[2], 2);
      startDrag();
      atPoint(5, 5, p[0], 1);
      mouseMove(5, 5, p[0]);

      inputOf(p[2]).remove();
      atPoint(20, 90, p[3], 2);
      inlineToolbarClose.mockClear();
      toolbarClose.mockClear();
      mouseMove(20, 90, p[3]);

      expect(inlineToolbarClose).toHaveBeenCalled();
      expect(toolbarClose).toHaveBeenCalled();
    });

    it('drops the child selection and paints nothing when no range resolves', () => {
      atPoint(20, 50, p[2], 2);
      startDrag();
      atPoint(5, 5, p[0], 1);
      mouseMove(5, 5, p[0]);

      cellABlocks[0].selected = true;
      inputOf(p[2]).remove();
      atPoint(20, 90, p[3], 2);
      siblingRangeOverride = [];
      toolbarClose.mockClear();
      mouseMove(20, 90, p[3]);

      expect(cellABlocks[0].selected).toBe(false);
      expect(toolbarClose).not.toHaveBeenCalled();
    });

    it('does nothing when both endpoints resolve to the same container', () => {
      caretPoints.clear();
      atPoint(10, 10, cellABlocks[0], 1);
      atPointNode(20, 50, inputOf(cellABlocks[1]), 0);
      cellABlocks[1].holder.setAttribute(DATA_ATTR.keyboardOwner, '');

      inputOf(cellABlocks[0]).dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: 10,
        clientY: 10,
      }));
      mouseMove(20, 50, cellABlocks[1]);

      expect(selectedIds()).toEqual([]);
    });

    it('does nothing when a standing text range ends on its own container', () => {
      caretPoints.clear();
      atPoint(10, 10, cellABlocks[0], 1);
      atPointNode(20, 50, inputOf(cellABlocks[1]), 0);

      inputOf(cellABlocks[0]).dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: 10,
        clientY: 10,
      }));
      mouseMove(20, 50, cellABlocks[1]);
      expect(selectionRange).not.toBeNull();

      /** The range is now illegal, but both ends resolve to the table. */
      cellABlocks[1].holder.setAttribute(DATA_ATTR.keyboardOwner, '');
      mouseMove(20, 50, cellABlocks[1]);

      expect(selectedIds()).toEqual([]);
    });
  });

  describe('nested (same-container) drag — selection bookkeeping', () => {
    it('invalidates the cache once the child range stands', () => {
      module.watchSelection(mouseDownOn(cellABlocks[0]));
      clearCache.mockClear();

      mouseOverOn(cellABlocks[1], cellABlocks[0]);

      expect(clearCache).toHaveBeenCalled();
    });
  });

  describe('text drag — deselection bookkeeping', () => {
    beforeEach(async () => {
      await module.prepare();
      atPoint(10, 10, p[1], 1);
      atPoint(20, 50, p[2], 2);
    });

    const startDrag = (): void => {
      mouseDownOn(p[1], { clientX: 10,
        clientY: 10 });
    };

    it('invalidates the cache when a block selection has to be dropped', () => {
      p[0].selected = true;
      startDrag();
      clearCache.mockClear();

      mouseMove(20, 50, p[2]);

      expect(clearCache).toHaveBeenCalled();
      expect(selectedIds()).toEqual([]);
    });

    it('does not invalidate the cache when no block was selected', () => {
      startDrag();
      clearCache.mockClear();

      mouseMove(20, 50, p[2]);

      expect(clearCache).not.toHaveBeenCalled();
    });
  });

  describe('nested child cleanup', () => {
    it('clears only selected children, and only when there are some', () => {
      module.watchSelection(mouseDownOn(cellABlocks[0]));
      mouseOverOn(cellABlocks[1], cellABlocks[0]);
      p[3].selected = true;

      siblingRangeOverride = [];
      clearCache.mockClear();
      mouseOverOn(p[0], cellABlocks[1]);

      expect(selectedIds()).toEqual(['p3']);
      expect(clearCache).toHaveBeenCalled();
    });

    it('leaves the cache alone when no child block is selected', () => {
      module.watchSelection(mouseDownOn(cellABlocks[0]));
      siblingRangeOverride = [];
      clearCache.mockClear();

      mouseOverOn(p[0], cellABlocks[0]);

      expect(clearCache).not.toHaveBeenCalled();
    });
  });

  describe('block-path mouseup bookkeeping', () => {
    it('disables hover and resets the hover state', () => {
      module.watchSelection(mouseDownOn(p[1]));
      mouseOverOn(p[3], p[1]);
      disableHoverForCooldown.mockClear();
      resetBlockHoverState.mockClear();

      mouseUp();

      expect(disableHoverForCooldown).toHaveBeenCalled();
      expect(resetBlockHoverState).toHaveBeenCalled();
    });
  });
});
