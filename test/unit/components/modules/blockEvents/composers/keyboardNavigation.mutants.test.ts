import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardNavigation } from '../../../../../../src/components/modules/blockEvents/composers/keyboardNavigation';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../../src/components/block';
import { keyCodes } from '../../../../../../src/components/utils';
import * as caretUtils from '../../../../../../src/components/utils/caret/index';
import { SelectionUtils } from '../../../../../../src/components/selection';

const createKeyboardEvent = (options: Partial<KeyboardEvent> = {}): KeyboardEvent => {
  const mockEvent = {
    keyCode: options.keyCode ?? 0,
    key: options.key ?? '',
    code: options.code ?? '',
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
    target: options.target ?? null,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...options,
  };

  return mockEvent as unknown as KeyboardEvent;
};

interface BlockOverrides {
  id?: string;
  name?: string;
  parentId?: string | null;
  contentIds?: string[];
  isEmpty?: boolean;
  markerHtml?: string;
  keepsChildrenOnEnter?: boolean;
  ownsChildren?: boolean;
  previousInput?: HTMLElement | undefined;
  nextInput?: HTMLElement | undefined;
  currentInput?: HTMLElement | undefined;
}

const createBlock = (overrides: BlockOverrides = {}): Block => {
  const input = document.createElement('div');

  input.contentEditable = 'true';
  input.textContent = overrides.id ?? 'test-block';

  const holder = document.createElement('div');

  holder.appendChild(input);

  if (overrides.markerHtml !== undefined) {
    holder.insertAdjacentHTML('beforeend', overrides.markerHtml);
  }

  return {
    id: overrides.id ?? 'test-block',
    name: overrides.name ?? 'paragraph',
    parentId: overrides.parentId ?? null,
    contentIds: overrides.contentIds ?? [],
    holder,
    currentInput: 'currentInput' in overrides ? overrides.currentInput : input,
    inputs: [input],
    firstInput: input,
    lastInput: input,
    previousInput: overrides.previousInput,
    nextInput: overrides.nextInput,
    tool: {
      isDefault: true,
      isLineBreaksEnabled: false,
      name: overrides.name ?? 'paragraph',
      keepsChildrenOnEnter: overrides.keepsChildrenOnEnter ?? false,
      ownsChildren: overrides.ownsChildren ?? false,
    },
    isEmpty: overrides.isEmpty ?? false,
    hasMedia: false,
    mergeable: true,
    updateCurrentInput: vi.fn(),
    save: vi.fn(() => Promise.resolve({})),
    render: vi.fn(),
  } as unknown as Block;
};

interface Harness {
  blok: BlokModules;
  nav: KeyboardNavigation;
  setBlockParent: ReturnType<typeof vi.fn>;
  setToBlock: ReturnType<typeof vi.fn>;
  moveAndOpen: ReturnType<typeof vi.fn>;
  hideBlockActions: ReturnType<typeof vi.fn>;
  removeBlock: ReturnType<typeof vi.fn>;
  setCurrentBlockByChildNode: ReturnType<typeof vi.fn>;
  insertDefaultBlockAtIndex: ReturnType<typeof vi.fn>;
  closeAllToolbars: ReturnType<typeof vi.fn>;
  toggleBlockSelectedState: ReturnType<typeof vi.fn>;
  navigateNext: ReturnType<typeof vi.fn>;
  navigatePrevious: ReturnType<typeof vi.fn>;
  navigateVerticalNext: ReturnType<typeof vi.fn>;
  navigateVerticalPrevious: ReturnType<typeof vi.fn>;
  transactMoves: ReturnType<typeof vi.fn>;
  blockManager: { currentBlock: Block | undefined };
}

interface HarnessOptions {
  currentBlock?: Block | undefined;
  previousBlock?: Block | null;
  nextBlock?: Block | null;
  blocks?: Block[];
  registry?: Block[];
  insertedBlock?: Block;
  withTransactMoves?: boolean;
  someToolbarOpened?: boolean;
  anyBlockSelected?: boolean;
  navigated?: boolean;
  afterRemove?: { currentBlock: Block | undefined };
}

const createHarness = (options: HarnessOptions = {}): Harness => {
  const currentBlock = 'currentBlock' in options ? options.currentBlock : createBlock();
  const insertedBlock = options.insertedBlock ?? createBlock({ id: 'inserted-block' });
  const registry = options.registry ?? [];

  const setBlockParent = vi.fn();
  const setToBlock = vi.fn();
  const moveAndOpen = vi.fn();
  const hideBlockActions = vi.fn();
  const setCurrentBlockByChildNode = vi.fn();
  const insertDefaultBlockAtIndex = vi.fn(() => insertedBlock);
  const closeAllToolbars = vi.fn();
  const toggleBlockSelectedState = vi.fn();
  const navigateNext = vi.fn(() => options.navigated ?? false);
  const navigatePrevious = vi.fn(() => options.navigated ?? false);
  const navigateVerticalNext = vi.fn(() => options.navigated ?? false);
  const navigateVerticalPrevious = vi.fn(() => options.navigated ?? false);
  const transactMoves = vi.fn((fn: () => void) => fn());

  const blocks = options.blocks ?? (currentBlock === undefined ? [] : [currentBlock]);

  const blockManager = {
    currentBlock,
    previousBlock: options.previousBlock ?? null,
    nextBlock: options.nextBlock ?? null,
    blocks,
    currentBlockIndex: 0,
    getBlockIndex: (block: Block) => blocks.indexOf(block),
    getBlockById: (id: string) => registry.find((block) => block.id === id),
    insertDefaultBlockAtIndex,
    split: vi.fn(() => insertedBlock),
    replace: vi.fn(() => insertedBlock),
    removeBlock: vi.fn(() => {
      if (options.afterRemove !== undefined) {
        blockManager.currentBlock = options.afterRemove.currentBlock;
      }
    }),
    setCurrentBlockByChildNode,
    mergeBlocks: vi.fn(() => Promise.resolve()),
    setBlockParent,
    transactForTool: (fn: () => void) => fn(),
  };

  const yjs: Record<string, unknown> = {
    stopCapturing: vi.fn(),
    markCaretBeforeChange: vi.fn(),
    updateLastCaretAfterPosition: vi.fn(),
  };

  if (options.withTransactMoves === true) {
    yjs.transactMoves = transactMoves;
  }

  const blok = {
    BlockManager: blockManager as unknown as BlokModules['BlockManager'],
    Caret: {
      positions: { START: 'start', END: 'end', DEFAULT: 'default' },
      setToBlock,
      navigateNext,
      navigatePrevious,
      navigateVerticalNext,
      navigateVerticalPrevious,
    } as unknown as BlokModules['Caret'],
    Toolbar: {
      opened: false,
      close: vi.fn(),
      moveAndOpen,
      hideBlockActions,
    } as unknown as BlokModules['Toolbar'],
    InlineToolbar: {
      opened: false,
      close: vi.fn(),
      tryToShow: vi.fn(() => Promise.resolve()),
    } as unknown as BlokModules['InlineToolbar'],
    UI: {
      someToolbarOpened: options.someToolbarOpened ?? false,
      someFlipperButtonFocused: false,
      closeAllToolbars,
      isRtl: false,
    } as unknown as BlokModules['UI'],
    BlockSelection: {
      anyBlockSelected: options.anyBlockSelected ?? false,
      clearSelection: vi.fn(),
      selectBlock: vi.fn(),
    } as unknown as BlokModules['BlockSelection'],
    CrossBlockSelection: {
      toggleBlockSelectedState,
    } as unknown as BlokModules['CrossBlockSelection'],
    Tools: {
      defaultTool: { name: 'paragraph' },
    } as unknown as BlokModules['Tools'],
    YjsManager: yjs as unknown as BlokModules['YjsManager'],
  } as unknown as BlokModules;

  return {
    blok,
    nav: new KeyboardNavigation(blok),
    setBlockParent,
    setToBlock,
    moveAndOpen,
    hideBlockActions,
    removeBlock: blockManager.removeBlock,
    setCurrentBlockByChildNode,
    insertDefaultBlockAtIndex,
    closeAllToolbars,
    toggleBlockSelectedState,
    navigateNext,
    navigatePrevious,
    navigateVerticalNext,
    navigateVerticalPrevious,
    transactMoves,
    blockManager,
  };
};

const TOGGLE_MARKER = '<div data-blok-toggle-open="true"></div>';
const NESTED_SLOT_MARKER = '<div data-blok-nested-blocks></div>';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KeyboardNavigation — Tab indent/outdent guards', () => {
  it('Tab with no current block neither reparents nor repositions the toolbar', () => {
    const harness = createHarness({ currentBlock: undefined });
    const event = createKeyboardEvent({ key: 'Tab', keyCode: keyCodes.TAB });

    harness.nav.handleTab(event);

    expect(harness.setBlockParent).not.toHaveBeenCalled();
    expect(harness.moveAndOpen).not.toHaveBeenCalled();
  });

  it('Shift+Tab with no current block neither reparents nor repositions the toolbar', () => {
    const harness = createHarness({ currentBlock: undefined });
    const event = createKeyboardEvent({ key: 'Tab', keyCode: keyCodes.TAB, shiftKey: true });

    harness.nav.handleTab(event);

    expect(harness.setBlockParent).not.toHaveBeenCalled();
    expect(harness.moveAndOpen).not.toHaveBeenCalled();
  });

  it('Shift+Tab on a block whose parent id resolves to nothing stays a native Tab', () => {
    const previousInput = document.createElement('div');
    const child = createBlock({ id: 'child', parentId: 'missing-parent', previousInput });
    const harness = createHarness({ currentBlock: child, registry: [] });
    const event = createKeyboardEvent({ key: 'Tab', keyCode: keyCodes.TAB, shiftKey: true });

    harness.nav.handleTab(event);

    expect(harness.setBlockParent).not.toHaveBeenCalled();
    expect(harness.moveAndOpen).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('Tab nests the block under its preceding sibling inside a single transactMoves group', () => {
    const sibling = createBlock({ id: 'sibling' });
    const block = createBlock({ id: 'block' });
    const harness = createHarness({
      currentBlock: block,
      blocks: [sibling, block],
      registry: [sibling, block],
      withTransactMoves: true,
    });
    const event = createKeyboardEvent({ key: 'Tab', keyCode: keyCodes.TAB });

    harness.nav.handleTab(event);

    expect(harness.transactMoves).toHaveBeenCalledTimes(1);
    expect(harness.setBlockParent.mock.calls[0][0]).toBe(block);
    expect(harness.setBlockParent.mock.calls[0][1]).toBe('sibling');
    expect(harness.moveAndOpen).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe('KeyboardNavigation — Backspace at the start of a nested block', () => {
  beforeEach(() => {
    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
  });

  it('does nothing when the block claims a parent id that resolves to nothing', () => {
    const child = createBlock({ id: 'child', parentId: 'missing-parent' });
    const harness = createHarness({ currentBlock: child, registry: [] });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.setToBlock).not.toHaveBeenCalled();
    expect(harness.setBlockParent).not.toHaveBeenCalled();
    expect(harness.removeBlock).not.toHaveBeenCalled();
  });

  it('outdents a non-empty first child out of its toggle parent, keeping the caret in it', () => {
    const toggle = createBlock({
      id: 'toggle',
      name: 'toggle',
      parentId: 'grandparent',
      contentIds: ['child'],
      markerHtml: TOGGLE_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'toggle' });
    const harness = createHarness({ currentBlock: child, registry: [toggle, child] });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.setBlockParent.mock.calls[0][0]).toBe(child);
    expect(harness.setBlockParent.mock.calls[0][1]).toBe('grandparent');
    expect(harness.setToBlock.mock.calls[0][0]).toBe(child);
    expect(harness.setToBlock.mock.calls[0][1]).toBe('start');
    expect(harness.moveAndOpen.mock.calls[0][0]).toBe(child);
  });

  it('wraps the toggle outdent in transactMoves when the Yjs manager offers it', () => {
    const toggle = createBlock({
      id: 'toggle',
      name: 'toggle',
      parentId: 'grandparent',
      contentIds: ['child'],
      markerHtml: TOGGLE_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'toggle' });
    const harness = createHarness({
      currentBlock: child,
      registry: [toggle, child],
      withTransactMoves: true,
    });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.transactMoves).toHaveBeenCalledTimes(1);
    expect(harness.setBlockParent.mock.calls[0][1]).toBe('grandparent');
  });

  it('removes an empty sole column child and drops the caret at the end of what remains', () => {
    const column = createBlock({
      id: 'column',
      name: 'column',
      parentId: 'column_list',
      contentIds: ['child'],
      markerHtml: NESTED_SLOT_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'column', isEmpty: true });
    const survivor = createBlock({ id: 'survivor' });
    const nextSibling = createBlock({ id: 'next', parentId: 'column' });
    const harness = createHarness({
      currentBlock: child,
      nextBlock: nextSibling,
      registry: [column, child, nextSibling],
      afterRemove: { currentBlock: survivor },
    });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.removeBlock.mock.calls[0][0]).toBe(child);
    // A second setToBlock would mean the generic empty-child path also ran.
    expect(harness.setToBlock).toHaveBeenCalledTimes(1);
    expect(harness.setToBlock.mock.calls[0][0]).toBe(survivor);
    expect(harness.setToBlock.mock.calls[0][1]).toBe('end');
  });

  it('leaves the caret alone when removing the sole column child empties the editor', () => {
    const column = createBlock({
      id: 'column',
      name: 'column',
      parentId: 'column_list',
      contentIds: ['child'],
      markerHtml: NESTED_SLOT_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'column', isEmpty: true });
    const harness = createHarness({
      currentBlock: child,
      registry: [column, child],
      afterRemove: { currentBlock: undefined },
    });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.removeBlock).toHaveBeenCalledTimes(1);
    expect(harness.setToBlock).not.toHaveBeenCalled();
  });

  it('leaves a non-empty sole column child in place', () => {
    const column = createBlock({
      id: 'column',
      name: 'column',
      parentId: 'column_list',
      contentIds: ['child'],
      markerHtml: NESTED_SLOT_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'column' });
    const harness = createHarness({ currentBlock: child, registry: [column, child] });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.removeBlock).not.toHaveBeenCalled();
    expect(harness.setToBlock).not.toHaveBeenCalled();
  });

  it('leaves an empty child alone when its parent id resolves to nothing', () => {
    const child = createBlock({ id: 'child', parentId: 'missing-parent', isEmpty: true });
    const harness = createHarness({ currentBlock: child, registry: [] });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.removeBlock).not.toHaveBeenCalled();
    expect(harness.setToBlock).not.toHaveBeenCalled();
  });

  it('never collapses a non-column container around its empty sole child', () => {
    const callout = createBlock({
      id: 'callout',
      name: 'callout',
      parentId: null,
      contentIds: ['child'],
      markerHtml: NESTED_SLOT_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'callout', isEmpty: true });
    const harness = createHarness({ currentBlock: child, registry: [callout, child] });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.removeBlock).not.toHaveBeenCalled();
    expect(harness.setToBlock).not.toHaveBeenCalled();
  });

  it('keeps a column that still holds other children when one empty child is removed', () => {
    const column = createBlock({
      id: 'column',
      name: 'column',
      parentId: 'column_list',
      contentIds: ['child', 'other'],
      markerHtml: NESTED_SLOT_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'column', isEmpty: true });
    const harness = createHarness({ currentBlock: child, registry: [column, child] });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.removeBlock).not.toHaveBeenCalled();
    expect(harness.setToBlock).not.toHaveBeenCalled();
  });

  it('never removes a non-empty container child that has no previous sibling', () => {
    const callout = createBlock({
      id: 'callout',
      name: 'callout',
      parentId: null,
      contentIds: ['child'],
      markerHtml: NESTED_SLOT_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'callout' });
    const nextSibling = createBlock({ id: 'next', parentId: 'callout' });
    const harness = createHarness({
      currentBlock: child,
      nextBlock: nextSibling,
      registry: [callout, child, nextSibling],
    });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.removeBlock).not.toHaveBeenCalled();
    expect(harness.setToBlock).not.toHaveBeenCalled();
  });

  it('never removes an empty container child whose next block lives in another parent', () => {
    const callout = createBlock({
      id: 'callout',
      name: 'callout',
      parentId: null,
      contentIds: ['child'],
      markerHtml: NESTED_SLOT_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'callout', isEmpty: true });
    const outsider = createBlock({ id: 'outsider' });
    const harness = createHarness({
      currentBlock: child,
      nextBlock: outsider,
      registry: [callout, child, outsider],
    });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.removeBlock).not.toHaveBeenCalled();
    expect(harness.setToBlock).not.toHaveBeenCalled();
  });

  it('removes an empty toggle child and focuses its next sibling in the same parent', () => {
    const toggle = createBlock({
      id: 'toggle',
      name: 'toggle',
      parentId: null,
      contentIds: ['child', 'next'],
      markerHtml: TOGGLE_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'toggle', isEmpty: true });
    const nextSibling = createBlock({ id: 'next', parentId: 'toggle' });
    const harness = createHarness({
      currentBlock: child,
      nextBlock: nextSibling,
      registry: [toggle, child, nextSibling],
    });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.removeBlock.mock.calls[0][0]).toBe(child);
    expect(harness.setToBlock.mock.calls[0][0]).toBe(nextSibling);
    expect(harness.setToBlock.mock.calls[0][1]).toBe('start');
  });
});

describe('KeyboardNavigation — Enter inside containers', () => {
  beforeEach(() => {
    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);
    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);
  });

  it('nests the new block inside an open toggle instead of leaving it a sibling', () => {
    const toggleBlock = createBlock({ id: 'open-toggle', markerHtml: TOGGLE_MARKER });
    const inserted = createBlock({ id: 'inserted-block' });
    const harness = createHarness({ currentBlock: toggleBlock, insertedBlock: inserted });
    const event = createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER });

    harness.nav.handleEnter(event);

    expect(harness.setBlockParent.mock.calls[0][0]).toBe(inserted);
    expect(harness.setBlockParent.mock.calls[0][1]).toBe('open-toggle');
    // forceTopLevel must stay off: the new line belongs inside the toggle.
    expect(harness.insertDefaultBlockAtIndex.mock.calls[0][3]).toBe(false);
  });

  it('anchors the new block at root level for a top-level block and leaves its parent alone', () => {
    const block = createBlock({ id: 'top-level' });
    // The inserted block lands with a stray parent: a top-level Enter must not adopt it.
    const inserted = createBlock({ id: 'inserted-block', parentId: 'stray-container' });
    const harness = createHarness({ currentBlock: block, insertedBlock: inserted });
    const event = createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER });

    harness.nav.handleEnter(event);

    expect(harness.insertDefaultBlockAtIndex.mock.calls[0][3]).toBe(true);
    expect(harness.setBlockParent).not.toHaveBeenCalled();
  });

  it('inserts a plain sibling for a non-last empty child instead of unwrapping the container', () => {
    const callout = createBlock({
      id: 'callout',
      name: 'callout',
      parentId: null,
      contentIds: ['child', 'other'],
      markerHtml: NESTED_SLOT_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'callout', isEmpty: true });
    const harness = createHarness({ currentBlock: child, registry: [callout, child] });
    const event = createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER });

    harness.nav.handleEnter(event);

    expect(harness.insertDefaultBlockAtIndex).toHaveBeenCalledTimes(1);
  });

  it('exits a callout by outdenting its empty last child inside a transactMoves group', () => {
    const callout = createBlock({
      id: 'callout',
      name: 'callout',
      parentId: 'root-parent',
      contentIds: ['sibling', 'child'],
      markerHtml: NESTED_SLOT_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'callout', isEmpty: true });
    const harness = createHarness({
      currentBlock: child,
      registry: [callout, child],
      withTransactMoves: true,
    });
    const event = createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER });

    harness.nav.handleEnter(event);

    expect(harness.transactMoves).toHaveBeenCalledTimes(1);
    expect(harness.insertDefaultBlockAtIndex).not.toHaveBeenCalled();
    expect(harness.setBlockParent.mock.calls[0][0]).toBe(child);
    expect(harness.setBlockParent.mock.calls[0][1]).toBe('root-parent');
  });
});

describe('KeyboardNavigation — arrow navigation side effects', () => {
  it('ArrowDown resolves the current block from the live selection anchor', () => {
    const harness = createHarness();
    const anchorNode = document.createTextNode('anchor');

    vi.spyOn(SelectionUtils, 'get').mockReturnValue({ anchorNode } as unknown as Selection);

    harness.nav.handleArrowRightAndDown(createKeyboardEvent({ key: 'ArrowDown', keyCode: keyCodes.DOWN }));

    expect(harness.setCurrentBlockByChildNode.mock.calls[0][0]).toBe(anchorNode);
  });

  it('ArrowUp resolves the current block from the live selection anchor', () => {
    const harness = createHarness();
    const anchorNode = document.createTextNode('anchor');

    vi.spyOn(window, 'getSelection').mockReturnValue({ anchorNode } as unknown as Selection);
    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

    harness.nav.handleArrowLeftAndUp(createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP }));

    expect(harness.setCurrentBlockByChildNode.mock.calls[0][0]).toBe(anchorNode);
  });

  it('plain ArrowRight hops over the nbsp that follows an emptied inline tag', () => {
    const harness = createHarness();
    const nbspNode = document.createTextNode(' ');

    vi.spyOn(caretUtils, 'findNbspAfterEmptyInline').mockReturnValue({ node: nbspNode, offset: 1 });

    const setCursor = vi.spyOn(SelectionUtils, 'setCursor').mockImplementation(() => new Range());
    const event = createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT });

    harness.nav.handleArrowRightAndDown(event);

    expect(setCursor.mock.calls[0][0]).toBe(nbspNode);
    expect(setCursor.mock.calls[0][1]).toBe(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.navigateNext).not.toHaveBeenCalled();
  });

  it('Shift+ArrowUp closes the open toolbars the flipper does not own', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP, shiftKey: true })
    );

    expect(harness.closeAllToolbars).toHaveBeenCalledTimes(1);
  });

  it('a successful ArrowUp hop repositions the toolbar with its block handles hidden', () => {
    const block = createBlock({ id: 'landing-block' });
    const harness = createHarness({ currentBlock: block, navigated: true });
    const event = createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP });

    harness.nav.handleArrowLeftAndUp(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.moveAndOpen.mock.calls[0][0]).toBe(block);
    expect(harness.hideBlockActions).toHaveBeenCalledTimes(1);
  });

  it('a successful ArrowDown hop repositions the toolbar with its block handles hidden', () => {
    const block = createBlock({ id: 'landing-block' });
    const harness = createHarness({ currentBlock: block, navigated: true });
    const event = createKeyboardEvent({ key: 'ArrowDown', keyCode: keyCodes.DOWN });

    harness.nav.handleArrowRightAndDown(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.moveAndOpen.mock.calls[0][0]).toBe(block);
    expect(harness.hideBlockActions).toHaveBeenCalledTimes(1);
  });
});

describe('KeyboardNavigation — modifier arrows stay native', () => {
  const cases: Array<[string, Partial<KeyboardEvent>]> = [
    ['Meta', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
  ];

  it.each(cases)('%s+ArrowRight never crosses into the next block', (_label, modifier) => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT, ...modifier })
    );

    expect(harness.navigateNext).not.toHaveBeenCalled();
  });

  it.each(cases)('%s+ArrowDown never crosses into the next block', (_label, modifier) => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'ArrowDown', keyCode: keyCodes.DOWN, ...modifier })
    );

    expect(harness.navigateVerticalNext).not.toHaveBeenCalled();
  });

  it.each(cases)('%s+ArrowLeft never crosses into the previous block', (_label, modifier) => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'ArrowLeft', keyCode: keyCodes.LEFT, ...modifier })
    );

    expect(harness.navigatePrevious).not.toHaveBeenCalled();
  });

  it.each(cases)('%s+ArrowUp never crosses into the previous block', (_label, modifier) => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP, ...modifier })
    );

    expect(harness.navigateVerticalPrevious).not.toHaveBeenCalled();
  });

  it('plain ArrowRight does cross into the next block', () => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowRightAndDown(createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT }));

    expect(harness.navigateNext).toHaveBeenCalledTimes(1);
  });

  it('plain ArrowLeft does cross into the previous block', () => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowLeftAndUp(createKeyboardEvent({ key: 'ArrowLeft', keyCode: keyCodes.LEFT }));

    expect(harness.navigatePrevious).toHaveBeenCalledTimes(1);
  });

  it('plain ArrowDown does cross into the next block', () => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowRightAndDown(createKeyboardEvent({ key: 'ArrowDown', keyCode: keyCodes.DOWN }));

    expect(harness.navigateVerticalNext).toHaveBeenCalledTimes(1);
  });

  it('plain ArrowUp does cross into the previous block', () => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowLeftAndUp(createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP }));

    expect(harness.navigateVerticalPrevious).toHaveBeenCalledTimes(1);
  });
});
