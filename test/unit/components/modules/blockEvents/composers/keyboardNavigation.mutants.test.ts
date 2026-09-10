import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardNavigation } from '../../../../../../src/components/modules/blockEvents/composers/keyboardNavigation';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../../types';
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
  lastInput?: HTMLElement | undefined;
  mergeable?: boolean;
  toolIsDefault?: boolean;
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
    lastInput: 'lastInput' in overrides ? overrides.lastInput : input,
    previousInput: overrides.previousInput,
    nextInput: overrides.nextInput,
    tool: {
      isDefault: overrides.toolIsDefault ?? true,
      isLineBreaksEnabled: false,
      name: overrides.name ?? 'paragraph',
      keepsChildrenOnEnter: overrides.keepsChildrenOnEnter ?? false,
      ownsChildren: overrides.ownsChildren ?? false,
    },
    isEmpty: overrides.isEmpty ?? false,
    hasMedia: false,
    mergeable: overrides.mergeable ?? true,
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
  toolbarClose: ReturnType<typeof vi.fn>;
  inlineToolbarClose: ReturnType<typeof vi.fn>;
  inlineToolbarTryToShow: ReturnType<typeof vi.fn>;
  blockManagerMerge: ReturnType<typeof vi.fn>;
  split: ReturnType<typeof vi.fn>;
  replace: ReturnType<typeof vi.fn>;
  clearSelection: ReturnType<typeof vi.fn>;
  saverSave: ReturnType<typeof vi.fn>;
  markCaretBeforeChange: ReturnType<typeof vi.fn>;
  updateLastCaretAfterPosition: ReturnType<typeof vi.fn>;
  blockManager: {
    currentBlock: Block | undefined;
    previousBlock: Block | null;
    nextBlock: Block | null;
  };
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
  someFlipperButtonFocused?: boolean;
  anyBlockSelected?: boolean;
  navigated?: boolean;
  /** `'absent'` leaves `UI.isRtl` undefined, exercising the `?? false` default. */
  isRtl?: boolean | 'absent';
  onEnter?: BlokConfig['onEnter'];
  onSubmit?: BlokConfig['onSubmit'];
  saverResult?: unknown;
  afterRemove?: { currentBlock: Block | undefined };
}

/** Wraps a block's holder in a `[data-blok-table-cell-blocks]` container. */
const inTableCell = (block: Block, container = document.createElement('div')): Block => {
  container.setAttribute('data-blok-table-cell-blocks', '');
  container.appendChild(block.holder);

  return block;
};

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
  const toolbarClose = vi.fn();
  const inlineToolbarClose = vi.fn();
  const inlineToolbarTryToShow = vi.fn(() => Promise.resolve());
  const blockManagerMerge = vi.fn(() => Promise.resolve());
  const split = vi.fn(() => insertedBlock);
  const replace = vi.fn(() => insertedBlock);
  const clearSelection = vi.fn();
  const saverSave = vi.fn(() => Promise.resolve(options.saverResult));
  const markCaretBeforeChange = vi.fn();
  const updateLastCaretAfterPosition = vi.fn();

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
    split,
    replace,
    removeBlock: vi.fn(() => {
      if (options.afterRemove !== undefined) {
        blockManager.currentBlock = options.afterRemove.currentBlock;
      }
    }),
    setCurrentBlockByChildNode,
    mergeBlocks: blockManagerMerge,
    setBlockParent,
    transactForTool: (fn: () => void) => fn(),
  };

  const yjs: Record<string, unknown> = {
    stopCapturing: vi.fn(),
    markCaretBeforeChange,
    updateLastCaretAfterPosition,
  };

  if (options.withTransactMoves === true) {
    yjs.transactMoves = transactMoves;
  }

  const ui: Record<string, unknown> = {
    someToolbarOpened: options.someToolbarOpened ?? false,
    someFlipperButtonFocused: options.someFlipperButtonFocused ?? false,
    closeAllToolbars,
  };

  if (options.isRtl !== 'absent') {
    ui.isRtl = options.isRtl ?? false;
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
      close: toolbarClose,
      moveAndOpen,
      hideBlockActions,
    } as unknown as BlokModules['Toolbar'],
    InlineToolbar: {
      opened: false,
      close: inlineToolbarClose,
      tryToShow: inlineToolbarTryToShow,
    } as unknown as BlokModules['InlineToolbar'],
    UI: ui as unknown as BlokModules['UI'],
    BlockSelection: {
      anyBlockSelected: options.anyBlockSelected ?? false,
      clearSelection,
      selectBlock: vi.fn(),
    } as unknown as BlokModules['BlockSelection'],
    CrossBlockSelection: {
      toggleBlockSelectedState,
    } as unknown as BlokModules['CrossBlockSelection'],
    Tools: {
      defaultTool: { name: 'paragraph' },
    } as unknown as BlokModules['Tools'],
    YjsManager: yjs as unknown as BlokModules['YjsManager'],
    Saver: {
      save: saverSave,
    } as unknown as BlokModules['Saver'],
    API: { methods: {} } as unknown as BlokModules['API'],
  } as unknown as BlokModules;

  return {
    blok,
    nav: new KeyboardNavigation(blok, () => options.onEnter, () => options.onSubmit),
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
    toolbarClose,
    inlineToolbarClose,
    inlineToolbarTryToShow,
    blockManagerMerge,
    split,
    replace,
    clearSelection,
    saverSave,
    markCaretBeforeChange,
    updateLastCaretAfterPosition,
    blockManager,
  };
};

const TOGGLE_MARKER = '<div data-blok-toggle-open="true"></div>';
const NESTED_SLOT_MARKER = '<div data-blok-nested-blocks></div>';

const flushTimers = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40));

/**
 * jsdom routes a throw out of a timer or a DOM listener to window's `error`
 * event, so a mutant that only crashes there would leave every assertion
 * green. Record them and assert the list stayed empty.
 */
const swallowedErrors: unknown[] = [];
const recordSwallowedError = (event: unknown): void => {
  swallowedErrors.push(event);
};

beforeEach(() => {
  vi.clearAllMocks();
  swallowedErrors.length = 0;
  window.addEventListener('error', recordSwallowedError);
});

afterEach(() => {
  window.removeEventListener('error', recordSwallowedError);
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

    const setCursor = vi.spyOn(SelectionUtils, 'setCursor').mockImplementation(() => new DOMRect());
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

// ---------------------------------------------------------------------------
// Mutation-sweep coverage. Every fixture below exists to separate one mutant
// from the real code, so most of them hold exactly ONE modifier/key condition
// true and assert on the side effect that condition gates.
// ---------------------------------------------------------------------------

describe('KeyboardNavigation — block movement shortcut truth table', () => {
  beforeEach(() => {
    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);
    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
  });

  it('Ctrl+Shift+ArrowDown skips arrow navigation and never starts a selection', () => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'ArrowDown', keyCode: keyCodes.DOWN, ctrlKey: true, shiftKey: true })
    );

    expect(harness.toggleBlockSelectedState).not.toHaveBeenCalled();
    expect(harness.navigateVerticalNext).not.toHaveBeenCalled();
  });

  it('Ctrl+Shift+ArrowRight still crosses into the next block (wrong key for the down shortcut)', () => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT, ctrlKey: true, shiftKey: true })
    );

    expect(harness.toggleBlockSelectedState).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Shift+ArrowUp still reaches the plain arrow handling in the down handler', () => {
    const harness = createHarness({ navigated: true });
    const event = createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP, ctrlKey: true, shiftKey: true });

    harness.nav.handleArrowRightAndDown(event);

    expect(harness.clearSelection).toHaveBeenCalledWith(event);
  });

  it('Ctrl+Shift+ArrowDown is still handled by the up handler (wrong direction key)', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'ArrowDown', keyCode: keyCodes.DOWN, ctrlKey: true, shiftKey: true })
    );

    expect(harness.closeAllToolbars).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Shift+ArrowUp skips the up handler entirely', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP, ctrlKey: true, shiftKey: true })
    );

    expect(harness.closeAllToolbars).not.toHaveBeenCalled();
  });
});

describe('KeyboardNavigation — reading direction', () => {
  it('a UI without an isRtl flag behaves as left-to-right for ArrowRight', () => {
    const harness = createHarness({ navigated: true, isRtl: 'absent' });

    harness.nav.handleArrowRightAndDown(createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT }));

    expect(harness.navigateNext).toHaveBeenCalledTimes(1);
  });

  it('RTL keeps plain ArrowRight inside the block', () => {
    const harness = createHarness({ navigated: true, isRtl: true });

    harness.nav.handleArrowRightAndDown(createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT }));

    expect(harness.navigateNext).not.toHaveBeenCalled();
  });

  it('RTL turns Shift+ArrowRight into a plain native shift-extend', () => {
    const harness = createHarness({ navigated: true, isRtl: true });

    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT, shiftKey: true })
    );

    expect(harness.toggleBlockSelectedState).not.toHaveBeenCalled();
  });

  it('RTL keeps plain ArrowLeft inside the block', () => {
    const harness = createHarness({ navigated: true, isRtl: true });

    harness.nav.handleArrowLeftAndUp(createKeyboardEvent({ key: 'ArrowLeft', keyCode: keyCodes.LEFT }));

    expect(harness.navigatePrevious).not.toHaveBeenCalled();
  });

  it('RTL turns Shift+ArrowLeft into a plain native shift-extend', () => {
    const harness = createHarness({ navigated: true, isRtl: true });

    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'ArrowLeft', keyCode: keyCodes.LEFT, shiftKey: true })
    );

    expect(harness.toggleBlockSelectedState).not.toHaveBeenCalled();
  });

  it('RTL never consults the nbsp hop for a plain ArrowRight', () => {
    const harness = createHarness({ navigated: true, isRtl: true });
    const nbspNode = document.createTextNode(' ');

    vi.spyOn(caretUtils, 'findNbspAfterEmptyInline').mockReturnValue({ node: nbspNode, offset: 1 });

    const setCursor = vi.spyOn(SelectionUtils, 'setCursor').mockImplementation(() => new DOMRect());

    harness.nav.handleArrowRightAndDown(createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT }));

    expect(setCursor).not.toHaveBeenCalled();
  });
});

describe('KeyboardNavigation — table cell containment', () => {
  beforeEach(() => {
    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
  });

  it('Tab inside a table cell does not indent the block', () => {
    const sibling = createBlock({ id: 'sibling' });
    const block = inTableCell(createBlock({ id: 'block' }));
    const harness = createHarness({ currentBlock: block, blocks: [sibling, block], registry: [sibling, block] });
    const event = createKeyboardEvent({ key: 'Tab', keyCode: keyCodes.TAB });

    harness.nav.handleTab(event);

    expect(harness.setBlockParent).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('Tab with a multi-block selection is left to the block-selection handler', () => {
    const sibling = createBlock({ id: 'sibling' });
    const block = createBlock({ id: 'block' });
    const harness = createHarness({
      currentBlock: block,
      blocks: [sibling, block],
      registry: [sibling, block],
      anyBlockSelected: true,
    });

    harness.nav.handleTab(createKeyboardEvent({ key: 'Tab', keyCode: keyCodes.TAB }));

    expect(harness.setBlockParent).not.toHaveBeenCalled();
  });

  it('Backspace inside a table cell leaves the toolbar open', () => {
    const currentBlock = inTableCell(createBlock({ id: 'in-cell' }));
    const harness = createHarness({ currentBlock });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.toolbarClose).not.toHaveBeenCalled();
  });

  it('Backspace at the first block of a table cell does not merge out of the cell', () => {
    const currentBlock = inTableCell(createBlock({ id: 'in-cell' }));
    const harness = createHarness({ currentBlock, previousBlock: null });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.blockManagerMerge).not.toHaveBeenCalled();
  });

  it('Backspace in a cell whose previous block sits in no cell is a no-op', () => {
    const currentBlock = inTableCell(createBlock({ id: 'in-cell' }));
    const previousBlock = createBlock({ id: 'loose' });
    const harness = createHarness({
      currentBlock,
      previousBlock,
      blocks: [previousBlock, currentBlock],
      registry: [previousBlock, currentBlock],
    });
    const event = createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE });

    harness.nav.handleBackspace(event);

    expect(harness.blockManagerMerge).not.toHaveBeenCalled();
  });

  it('Delete at the last block of a table cell does not merge out of the cell', () => {
    const currentBlock = inTableCell(createBlock({ id: 'in-cell' }));
    const harness = createHarness({ currentBlock, nextBlock: null });

    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

    harness.nav.handleDelete(createKeyboardEvent({ key: 'Delete', keyCode: keyCodes.DELETE }));

    expect(harness.blockManagerMerge).not.toHaveBeenCalled();
  });

  it('Delete at the end of a cell block whose next block sits in no cell is a no-op', () => {
    const currentBlock = inTableCell(createBlock({ id: 'in-cell' }));
    const nextBlock = createBlock({ id: 'loose' });
    const harness = createHarness({
      currentBlock,
      nextBlock,
      blocks: [currentBlock, nextBlock],
      registry: [currentBlock, nextBlock],
    });

    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

    harness.nav.handleDelete(createKeyboardEvent({ key: 'Delete', keyCode: keyCodes.DELETE }));

    expect(harness.blockManagerMerge).not.toHaveBeenCalled();
  });
});

describe('KeyboardNavigation — Tab indent fallbacks', () => {
  it('Tab on a block with no preceding sibling stays a native Tab', () => {
    const block = createBlock({ id: 'block' });
    const harness = createHarness({ currentBlock: block, blocks: [block], registry: [block] });
    const event = createKeyboardEvent({ key: 'Tab', keyCode: keyCodes.TAB });

    harness.nav.handleTab(event);

    expect(harness.moveAndOpen).not.toHaveBeenCalled();
    expect(harness.setBlockParent).not.toHaveBeenCalled();
  });

  it('Shift+Tab on a top-level block never reparents or repositions the toolbar', () => {
    const block = createBlock({ id: 'block', parentId: null });
    const harness = createHarness({ currentBlock: block, blocks: [block], registry: [block] });
    const event = createKeyboardEvent({ key: 'Tab', keyCode: keyCodes.TAB, shiftKey: true });

    harness.nav.handleTab(event);

    expect(harness.moveAndOpen).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('Shift+Tab outdents a block to its grandparent and repositions the toolbar', () => {
    const grandparent = createBlock({ id: 'grandparent', parentId: null });
    const parent = createBlock({ id: 'parent', parentId: 'grandparent', contentIds: ['block'] });
    const block = createBlock({ id: 'block', parentId: 'parent' });
    const harness = createHarness({
      currentBlock: block,
      blocks: [grandparent, parent, block],
      registry: [grandparent, parent, block],
    });
    const event = createKeyboardEvent({ key: 'Tab', keyCode: keyCodes.TAB, shiftKey: true });

    harness.nav.handleTab(event);

    expect(harness.setBlockParent.mock.calls[0][0]).toBe(block);
    expect(harness.setBlockParent.mock.calls[0][1]).toBe('grandparent');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.moveAndOpen.mock.calls[0][0]).toBe(block);
  });

  it('a non-indentable Tab lets native Tab walk to the block next input', () => {
    const nextInput = document.createElement('div');
    const block = createBlock({ id: 'block', nextInput });
    const harness = createHarness({ currentBlock: block, blocks: [block], registry: [block] });
    const event = createKeyboardEvent({ key: 'Tab', keyCode: keyCodes.TAB });

    harness.nav.handleTab(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('KeyboardNavigation — Enter composition and toolbar gates', () => {
  it('Enter that commits an IME composition never creates a block', () => {
    const harness = createHarness();
    const event = createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER, isComposing: true });

    harness.nav.handleEnter(event);

    expect(harness.insertDefaultBlockAtIndex).not.toHaveBeenCalled();
    expect(harness.split).not.toHaveBeenCalled();
  });

  it('Enter with an open toolbar but no focused flipper button still creates a block', () => {
    const harness = createHarness({ someToolbarOpened: true, someFlipperButtonFocused: false });

    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

    harness.nav.handleEnter(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.insertDefaultBlockAtIndex).toHaveBeenCalledTimes(1);
  });

  it('Enter with an open toolbar AND a focused flipper button is left to the flipper', () => {
    const harness = createHarness({ someToolbarOpened: true, someFlipperButtonFocused: true });

    harness.nav.handleEnter(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.insertDefaultBlockAtIndex).not.toHaveBeenCalled();
  });

  it('an onEnter that returns false leaves the default block creation alone', () => {
    const onEnter = vi.fn(() => false);
    const harness = createHarness({ onEnter });

    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

    const event = createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER });

    harness.nav.handleEnter(event);

    expect(harness.insertDefaultBlockAtIndex).toHaveBeenCalledTimes(1);
    expect(harness.markCaretBeforeChange).toHaveBeenCalledTimes(1);
  });

  it('an onEnter that returns true suppresses the split and the native newline', () => {
    const onEnter = vi.fn(() => true);
    const harness = createHarness({ onEnter });

    const event = createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER });

    harness.nav.handleEnter(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.insertDefaultBlockAtIndex).not.toHaveBeenCalled();
    expect(harness.split).not.toHaveBeenCalled();
  });

  it('an onSubmit serializes the document, suppresses the split and skips the default path', async () => {
    const data = { blocks: [] };
    const onSubmit = vi.fn();
    const harness = createHarness({ onSubmit, saverResult: data });

    const event = createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER });

    harness.nav.handleEnter(event);
    await flushTimers();

    expect(harness.saverSave).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(data, harness.blok.API.methods);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.markCaretBeforeChange).not.toHaveBeenCalled();
  });

  it('the default Enter path marks the caret before and after the change', () => {
    const harness = createHarness();

    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

    harness.nav.handleEnter(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.markCaretBeforeChange).toHaveBeenCalledTimes(1);
    expect(harness.updateLastCaretAfterPosition).toHaveBeenCalledTimes(1);
  });
});

describe('KeyboardNavigation — createBlockOnEnter cases', () => {
  beforeEach(() => {
    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);
    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);
  });

  it('an empty quote resets to the default tool instead of being left behind', () => {
    const quote = createBlock({ id: 'quote', name: 'quote', isEmpty: true });
    const harness = createHarness({ currentBlock: quote });

    harness.nav.handleEnter(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.replace.mock.calls[0][0]).toBe(quote);
    expect(harness.replace.mock.calls[0][1]).toBe('paragraph');
  });

  it('an empty toggle heading is never reset to the default tool', () => {
    const heading = createBlock({
      id: 'heading',
      name: 'header',
      isEmpty: true,
      markerHtml: TOGGLE_MARKER,
    });
    const harness = createHarness({ currentBlock: heading });

    harness.nav.handleEnter(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.replace).not.toHaveBeenCalled();
  });

  it('an empty default paragraph at the caret start inserts above itself', () => {
    const paragraph = createBlock({ id: 'paragraph', isEmpty: true });
    const harness = createHarness({ currentBlock: paragraph, blocks: [paragraph] });

    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

    harness.nav.handleEnter(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.insertDefaultBlockAtIndex.mock.calls[0][0]).toBe(0);
  });

  it('an empty non-default block at the caret start inserts BELOW itself, not above', () => {
    const custom = createBlock({ id: 'custom', name: 'custom', isEmpty: true, toolIsDefault: false });
    const harness = createHarness({ currentBlock: custom, blocks: [custom] });

    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

    harness.nav.handleEnter(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.insertDefaultBlockAtIndex.mock.calls[0][0]).toBe(1);
  });

  it('a non-empty top-level block at the caret start inserts above inside no parent', () => {
    const block = createBlock({ id: 'block' });
    const harness = createHarness({ currentBlock: block, blocks: [block] });

    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

    harness.nav.handleEnter(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.insertDefaultBlockAtIndex.mock.calls[0][0]).toBe(0);
    expect(harness.setBlockParent).not.toHaveBeenCalled();
  });

  it('a nested block at the caret start inserts above inside the same parent', () => {
    const parent = createBlock({ id: 'parent', contentIds: ['block'] });
    const block = createBlock({ id: 'block', parentId: 'parent' });
    const harness = createHarness({ currentBlock: block, blocks: [parent, block], registry: [parent, block] });

    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

    harness.nav.handleEnter(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.setBlockParent.mock.calls[0][1]).toBe('parent');
  });

  it('a block without a current input never takes the caret-start path', () => {
    const block = createBlock({ id: 'block', currentInput: undefined });
    const harness = createHarness({ currentBlock: block, blocks: [block] });

    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

    harness.nav.handleEnter(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.insertDefaultBlockAtIndex).not.toHaveBeenCalled();
    expect(harness.split).toHaveBeenCalledTimes(1);
  });

  it('the caret-start insert requests neither a nested nor a middle placement', () => {
    const block = createBlock({ id: 'block' });
    const harness = createHarness({ currentBlock: block, blocks: [block] });

    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

    harness.nav.handleEnter(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.insertDefaultBlockAtIndex.mock.calls[0].slice(1, 3)).toStrictEqual([false, false]);
  });

  it('a block with no current input splits when the caret cannot be at the end', () => {
    const block = createBlock({ id: 'block', currentInput: undefined });
    const harness = createHarness({ currentBlock: block, blocks: [block] });

    harness.nav.handleEnter(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.split).toHaveBeenCalledTimes(1);
    expect(harness.insertDefaultBlockAtIndex).not.toHaveBeenCalled();
  });
});

describe('KeyboardNavigation — nested container Enter', () => {
  beforeEach(() => {
    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);
    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);
  });

  it('Enter on the empty last child of an unknown parent falls back to a plain sibling', () => {
    const child = createBlock({ id: 'child', parentId: 'missing-parent', isEmpty: true });
    const harness = createHarness({ currentBlock: child, registry: [] });

    harness.nav.handleEnter(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.insertDefaultBlockAtIndex).toHaveBeenCalledTimes(1);
  });

  it('an empty list child is never stepwise-outdented on Enter', () => {
    const parent = createBlock({ id: 'parent', contentIds: ['child'] });
    const child = createBlock({ id: 'child', name: 'list', parentId: 'parent', isEmpty: true });
    const harness = createHarness({
      currentBlock: child,
      registry: [parent, child],
      blocks: [parent, child],
    });

    harness.nav.handleEnter(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.insertDefaultBlockAtIndex).toHaveBeenCalledTimes(1);
    expect(harness.setBlockParent).not.toHaveBeenCalled();
  });
});

describe('KeyboardNavigation — Backspace style cascade', () => {
  beforeEach(() => {
    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
    vi.spyOn(caretUtils, 'focus').mockImplementation(() => undefined);
  });

  it('a toggle heading is left to its own handler instead of being reset to text', () => {
    const heading = createBlock({ id: 'heading', name: 'header', markerHtml: TOGGLE_MARKER });
    const harness = createHarness({ currentBlock: heading, blocks: [heading] });

    harness.nav.handleBackspace(createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE }));

    expect(harness.replace).not.toHaveBeenCalled();
  });

  it('a plain heading resets to the default tool keeping its text', () => {
    const heading = createBlock({ id: 'heading', name: 'header' });
    const harness = createHarness({ currentBlock: heading, blocks: [heading] });

    harness.nav.handleBackspace(createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE }));

    expect(harness.replace.mock.calls[0][0]).toBe(heading);
    expect(harness.replace.mock.calls[0][1]).toBe('paragraph');
  });

  it('a list block is not stepwise-outdented by Backspace', () => {
    const parent = createBlock({ id: 'parent', contentIds: ['child'] });
    const child = createBlock({ id: 'child', name: 'list', parentId: 'parent' });
    const harness = createHarness({ currentBlock: child, registry: [parent, child], blocks: [parent, child] });

    harness.nav.handleBackspace(createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE }));

    expect(harness.setBlockParent).not.toHaveBeenCalled();
  });
});

describe('KeyboardNavigation — Backspace empty-block variants', () => {
  beforeEach(() => {
    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
  });

  it('a non-column container child is removed and its next sibling focused', () => {
    const callout = createBlock({
      id: 'callout',
      name: 'callout',
      parentId: null,
      contentIds: ['child', 'next'],
      markerHtml: NESTED_SLOT_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'callout', isEmpty: true });
    const nextSibling = createBlock({ id: 'next', parentId: 'callout' });
    const harness = createHarness({
      currentBlock: child,
      nextBlock: nextSibling,
      registry: [callout, child, nextSibling],
      blocks: [callout, child, nextSibling],
    });

    harness.nav.handleBackspace(createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE }));

    expect(harness.removeBlock.mock.calls[0][0]).toBe(child);
    expect(harness.setToBlock.mock.calls[0][0]).toBe(nextSibling);
    expect(harness.setToBlock.mock.calls[0][1]).toBe('start');
  });
});

describe('KeyboardNavigation — Delete empty-block variants', () => {
  beforeEach(() => {
    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);
    vi.spyOn(caretUtils, 'focus').mockImplementation(() => undefined);
  });

  it('Delete never pulls a block across a parent boundary', () => {
    const currentBlock = createBlock({ id: 'current', parentId: 'container' });
    const nextBlock = createBlock({ id: 'next', parentId: null });
    const harness = createHarness({
      currentBlock,
      nextBlock,
      blocks: [currentBlock, nextBlock],
      registry: [currentBlock, nextBlock],
    });

    harness.nav.handleDelete(createKeyboardEvent({ key: 'Delete', keyCode: keyCodes.DELETE }));

    expect(harness.blockManagerMerge).not.toHaveBeenCalled();
    expect(harness.removeBlock).not.toHaveBeenCalled();
  });

  it('Delete on a top-level empty block absorbs the next block into it', () => {
    const currentBlock = createBlock({ id: 'current', parentId: null, isEmpty: true });
    const nextBlock = createBlock({ id: 'next', parentId: null });
    const harness = createHarness({
      currentBlock,
      nextBlock,
      blocks: [currentBlock, nextBlock],
      registry: [currentBlock, nextBlock],
    });

    harness.nav.handleDelete(createKeyboardEvent({ key: 'Delete', keyCode: keyCodes.DELETE }));

    expect(harness.blockManagerMerge.mock.calls[0][0]).toBe(currentBlock);
    expect(harness.blockManagerMerge.mock.calls[0][1]).toBe(nextBlock);
  });

  it('the forward-Delete merge re-anchors the caret at the start of the merged block', async () => {
    const currentBlock = createBlock({ id: 'current', parentId: null, isEmpty: true });
    const nextBlock = createBlock({ id: 'next', parentId: null });
    const harness = createHarness({
      currentBlock,
      nextBlock,
      blocks: [currentBlock, nextBlock],
      registry: [currentBlock, nextBlock],
    });

    harness.nav.handleDelete(createKeyboardEvent({ key: 'Delete', keyCode: keyCodes.DELETE }));
    await flushTimers();

    expect(harness.setToBlock.mock.calls[0][0]).toBe(currentBlock);
    expect(harness.setToBlock.mock.calls[0][1]).toBe('start');
  });

  it('an empty container child with no previous sibling keeps the caret put', () => {
    const container = createBlock({ id: 'container', contentIds: ['child', 'next'], markerHtml: TOGGLE_MARKER });
    const child = createBlock({ id: 'child', parentId: 'container', isEmpty: true });
    const nextSibling = createBlock({ id: 'next', parentId: 'container' });
    const harness = createHarness({
      currentBlock: child,
      nextBlock: nextSibling,
      previousBlock: null,
      registry: [container, child, nextSibling],
      blocks: [container, child, nextSibling],
    });

    harness.nav.handleDelete(createKeyboardEvent({ key: 'Delete', keyCode: keyCodes.DELETE }));

    expect(harness.removeBlock).not.toHaveBeenCalled();
    expect(harness.setToBlock).not.toHaveBeenCalled();
  });

  it('a column child whose sole child was removed closes the toolbars', () => {
    const column = createBlock({
      id: 'column',
      name: 'column',
      parentId: 'column_list',
      contentIds: ['child'],
    });
    const child = createBlock({ id: 'child', parentId: 'column', isEmpty: true });
    const harness = createHarness({
      currentBlock: child,
      previousBlock: null,
      registry: [column, child],
      blocks: [column, child],
    });

    harness.nav.handleDelete(createKeyboardEvent({ key: 'Delete', keyCode: keyCodes.DELETE }));

    expect(harness.toolbarClose).toHaveBeenCalledTimes(1);
  });

  it('Delete on an empty top-level block removes it and focuses what follows', () => {
    const currentBlock = createBlock({ id: 'current', parentId: null, isEmpty: true, mergeable: false });
    const survivor = createBlock({ id: 'survivor', parentId: null });
    const nextBlock = createBlock({ id: 'next', parentId: null });
    const harness = createHarness({
      currentBlock,
      previousBlock: null,
      nextBlock,
      registry: [currentBlock, survivor, nextBlock],
      blocks: [currentBlock, nextBlock],
      afterRemove: { currentBlock: survivor },
    });

    harness.nav.handleDelete(createKeyboardEvent({ key: 'Delete', keyCode: keyCodes.DELETE }));

    expect(harness.removeBlock.mock.calls[0][0]).toBe(currentBlock);
    expect(harness.setToBlock.mock.calls[0][0]).toBe(survivor);
    // Once for the destructive Delete itself, once after the block is gone.
    expect(harness.toolbarClose).toHaveBeenCalledTimes(2);
  });
});

describe('KeyboardNavigation — merge internals', () => {
  beforeEach(() => {
    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);
    vi.spyOn(caretUtils, 'focus').mockImplementation(() => undefined);
  });

  const mergeHarness = (): Harness => {
    const previousBlock = createBlock({ id: 'previous' });
    const currentBlock = createBlock({ id: 'current' });
    const harness = createHarness({
      currentBlock,
      previousBlock,
      blocks: [previousBlock, currentBlock],
      registry: [previousBlock, currentBlock],
    });

    return harness;
  };

  it('a merge focuses the target block last input before merging', () => {
    const harness = mergeHarness();

    harness.nav.handleBackspace(createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE }));

    expect(caretUtils.focus).toHaveBeenCalledWith(harness.blockManager.previousBlock?.lastInput, false);
  });

  it('a merge target without a last input is never merged', () => {
    const target = createBlock({ id: 'target', lastInput: undefined });
    const source = createBlock({ id: 'source' });
    const harness = createHarness({
      currentBlock: source,
      previousBlock: target,
      blocks: [target, source],
      registry: [target, source],
    });

    harness.nav.handleBackspace(createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE }));

    expect(harness.blockManagerMerge).not.toHaveBeenCalled();
  });

  it('a Backspace merge does not re-anchor the caret at the start', async () => {
    const harness = mergeHarness();

    harness.nav.handleBackspace(createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE }));
    await flushTimers();

    expect(harness.blockManagerMerge).toHaveBeenCalledTimes(1);
    expect(harness.setToBlock).not.toHaveBeenCalled();
  });

  it('a merge closes the toolbar once it settles outside a table cell', async () => {
    const harness = mergeHarness();

    harness.nav.handleBackspace(createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE }));
    await flushTimers();

    // Once for the destructive Backspace itself, once when the merge settles.
    expect(harness.toolbarClose).toHaveBeenCalledTimes(2);
  });
});

describe('KeyboardNavigation — ArrowRight/ArrowDown gating', () => {
  const down = (extra: Partial<KeyboardEvent> = {}): KeyboardEvent =>
    createKeyboardEvent({ key: 'ArrowDown', keyCode: keyCodes.DOWN, ...extra });

  it('an unknown key never closes the inline toolbar', () => {
    const harness = createHarness();

    harness.nav.handleArrowRightAndDown(createKeyboardEvent({ key: '', code: '' }));

    expect(harness.inlineToolbarClose).not.toHaveBeenCalled();
  });

  it('a non-flipper key with an open toolbar still closes the inline toolbar', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE })
    );

    expect(harness.inlineToolbarClose).toHaveBeenCalledTimes(1);
  });

  it('plain ArrowDown leaves an open toolbar to the flipper', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowRightAndDown(down());

    expect(harness.inlineToolbarClose).not.toHaveBeenCalled();
  });

  it('Enter with an open toolbar is still the flipper’s key', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER })
    );

    expect(harness.inlineToolbarClose).not.toHaveBeenCalled();
  });

  it('Tab with an open toolbar is still the flipper’s key', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowRightAndDown(createKeyboardEvent({ key: 'Tab', keyCode: keyCodes.TAB }));

    expect(harness.inlineToolbarClose).not.toHaveBeenCalled();
  });

  it('Shift+ArrowDown with an open toolbar still starts a selection', () => {
    const harness = createHarness({ someToolbarOpened: true });

    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

    harness.nav.handleArrowRightAndDown(down({ shiftKey: true }));

    expect(harness.toggleBlockSelectedState).toHaveBeenCalledTimes(1);
  });

  it('plain ArrowDown closes the inline toolbar when outside a table cell', () => {
    const harness = createHarness();

    harness.nav.handleArrowRightAndDown(down());

    expect(harness.inlineToolbarClose).toHaveBeenCalledTimes(1);
  });

  it('plain ArrowDown inside a table cell keeps the inline toolbar open', () => {
    const currentBlock = inTableCell(createBlock({ id: 'in-cell' }));
    const harness = createHarness({ currentBlock });

    harness.nav.handleArrowRightAndDown(down());

    expect(harness.inlineToolbarClose).not.toHaveBeenCalled();
  });

  it('Shift+ArrowDown outside a table cell keeps the inline toolbar open', () => {
    const harness = createHarness();

    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

    harness.nav.handleArrowRightAndDown(down({ shiftKey: true }));

    expect(harness.inlineToolbarClose).not.toHaveBeenCalled();
  });

  it('Shift+ArrowDown at the caret end starts a selection', () => {
    const harness = createHarness();

    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

    harness.nav.handleArrowRightAndDown(down({ shiftKey: true }));

    expect(harness.toggleBlockSelectedState).toHaveBeenCalledTimes(1);
  });

  it('Shift+ArrowDown away from the caret end starts no selection', () => {
    const harness = createHarness();

    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

    harness.nav.handleArrowRightAndDown(down({ shiftKey: true }));

    expect(harness.toggleBlockSelectedState).not.toHaveBeenCalled();
  });

  it('Shift+ArrowUp never takes the down-key selection path', () => {
    const harness = createHarness();

    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP, shiftKey: true })
    );

    expect(harness.toggleBlockSelectedState).not.toHaveBeenCalled();
  });

  it('Shift+ArrowRight away from the caret end starts no selection', () => {
    const harness = createHarness();

    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT, shiftKey: true })
    );

    expect(harness.toggleBlockSelectedState).not.toHaveBeenCalled();
  });

  it('Shift+ArrowRight at the caret end starts a selection', () => {
    const harness = createHarness();

    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT, shiftKey: true })
    );

    expect(harness.toggleBlockSelectedState).toHaveBeenCalledTimes(1);
  });

  it('Shift+ArrowDown offers the inline toolbar while outside a cell', () => {
    const harness = createHarness();

    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

    harness.nav.handleArrowRightAndDown(down({ shiftKey: true }));

    expect(harness.inlineToolbarTryToShow).toHaveBeenCalledTimes(1);
  });

  it('ArrowDown never consults the nbsp hop reserved for ArrowRight', () => {
    const harness = createHarness({ navigated: true });
    const nbspNode = document.createTextNode(' ');

    vi.spyOn(caretUtils, 'findNbspAfterEmptyInline').mockReturnValue({ node: nbspNode, offset: 1 });

    const setCursor = vi.spyOn(SelectionUtils, 'setCursor').mockImplementation(() => new DOMRect());

    harness.nav.handleArrowRightAndDown(down());

    expect(setCursor).not.toHaveBeenCalled();
    expect(harness.navigateVerticalNext).toHaveBeenCalledTimes(1);
  });

  it('Shift+ArrowRight never consults the nbsp hop', () => {
    const harness = createHarness({ navigated: true });
    const nbspNode = document.createTextNode(' ');

    vi.spyOn(caretUtils, 'findNbspAfterEmptyInline').mockReturnValue({ node: nbspNode, offset: 1 });
    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

    const setCursor = vi.spyOn(SelectionUtils, 'setCursor').mockImplementation(() => new DOMRect());

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT, shiftKey: true })
    );

    expect(setCursor).not.toHaveBeenCalled();
  });

  it('plain ArrowRight hops to the nbsp even when the block reports no current input', () => {
    const input = document.createElement('div');

    input.contentEditable = 'true';

    const block = createBlock({ id: 'block', currentInput: undefined });

    (block as { inputs: unknown[] }).inputs = [input];

    const nbspNode = document.createTextNode(' ');
    const harness = createHarness({ currentBlock: block, navigated: true });

    vi.spyOn(caretUtils, 'findNbspAfterEmptyInline').mockReturnValue({ node: nbspNode, offset: 1 });

    const setCursor = vi.spyOn(SelectionUtils, 'setCursor').mockImplementation(() => new DOMRect());

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT, target: input })
    );

    expect(setCursor).toHaveBeenCalledTimes(1);
    expect(setCursor.mock.calls[0][0]).toBe(nbspNode);
  });

  it('plain ArrowDown crosses down, never right', () => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowRightAndDown(down());

    expect(harness.navigateNext).not.toHaveBeenCalled();
    expect(harness.navigateVerticalNext).toHaveBeenCalledWith(false);
  });

  it('plain ArrowRight crosses right, never down', () => {
    const harness = createHarness({ navigated: true });
    const nbspNode = document.createTextNode(' ');

    vi.spyOn(caretUtils, 'findNbspAfterEmptyInline').mockReturnValue(null);
    vi.spyOn(SelectionUtils, 'setCursor').mockImplementation(() => new DOMRect());

    harness.nav.handleArrowRightAndDown(createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT }));

    expect(nbspNode.textContent).toBe(' ');
    expect(harness.navigateVerticalNext).not.toHaveBeenCalled();
    expect(harness.navigateNext).toHaveBeenCalledWith(false, false);
  });

  it('an unhandled ArrowRight still clears the block selection once the caret settles', async () => {
    const harness = createHarness();
    const event = createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT });

    vi.spyOn(caretUtils, 'findNbspAfterEmptyInline').mockReturnValue(null);

    harness.nav.handleArrowRightAndDown(event);
    await flushTimers();

    expect(swallowedErrors).toStrictEqual([]);
    expect(harness.clearSelection).toHaveBeenCalledWith(event);
    expect(harness.blockManager.currentBlock?.updateCurrentInput).toHaveBeenCalledTimes(1);
  });

  it('an unhandled ArrowRight with no current block does not throw', () => {
    const harness = createHarness({ currentBlock: undefined });

    vi.useFakeTimers();

    try {
      harness.nav.handleArrowRightAndDown(createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT }));

      // Fake timers keep the deferred caret refresh inside this test, so a throw
      // there fails an assertion instead of escaping to window's error event.
      expect(() => vi.advanceTimersByTime(50)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }

    expect(harness.clearSelection).toHaveBeenCalledTimes(1);
  });
});

describe('KeyboardNavigation — ArrowLeft/ArrowUp gating', () => {
  const up = (extra: Partial<KeyboardEvent> = {}): KeyboardEvent =>
    createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP, ...extra });

  it('an unknown key never closes the toolbars', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowLeftAndUp(createKeyboardEvent({ key: '', code: '' }));

    expect(harness.closeAllToolbars).not.toHaveBeenCalled();
  });

  it('plain ArrowUp leaves an open toolbar to the flipper', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowLeftAndUp(up());

    expect(harness.closeAllToolbars).not.toHaveBeenCalled();
  });

  it('Enter with an open toolbar is still the flipper’s key', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowLeftAndUp(createKeyboardEvent({ key: 'Enter', keyCode: keyCodes.ENTER }));

    expect(harness.closeAllToolbars).not.toHaveBeenCalled();
  });

  it('Tab with an open toolbar is still the flipper’s key', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowLeftAndUp(createKeyboardEvent({ key: 'Tab', keyCode: keyCodes.TAB }));

    expect(harness.closeAllToolbars).not.toHaveBeenCalled();
  });

  it('Home with an open toolbar is still the flipper’s key', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowLeftAndUp(createKeyboardEvent({ key: 'Home', keyCode: keyCodes.HOME }));

    expect(harness.closeAllToolbars).not.toHaveBeenCalled();
  });

  it('a non-flipper key with an open toolbar closes every toolbar', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE })
    );

    expect(harness.closeAllToolbars).toHaveBeenCalledTimes(1);
  });

  it('plain ArrowUp closes the inline toolbar when outside a table cell', () => {
    const harness = createHarness();

    harness.nav.handleArrowLeftAndUp(up());

    expect(harness.inlineToolbarClose).toHaveBeenCalledTimes(1);
  });

  it('plain ArrowUp inside a table cell keeps the inline toolbar open', () => {
    const currentBlock = inTableCell(createBlock({ id: 'in-cell' }));
    const harness = createHarness({ currentBlock });

    harness.nav.handleArrowLeftAndUp(up());

    expect(harness.inlineToolbarClose).not.toHaveBeenCalled();
  });

  it('Shift+ArrowUp outside a table cell keeps the inline toolbar open', () => {
    const harness = createHarness();

    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

    harness.nav.handleArrowLeftAndUp(up({ shiftKey: true }));

    expect(harness.inlineToolbarClose).not.toHaveBeenCalled();
  });

  it('Shift+ArrowUp at the caret start starts a selection', () => {
    const harness = createHarness();

    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

    harness.nav.handleArrowLeftAndUp(up({ shiftKey: true }));

    expect(harness.toggleBlockSelectedState).toHaveBeenCalledWith(false);
  });

  it('Shift+ArrowLeft away from the caret start starts no selection', () => {
    const harness = createHarness();

    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'ArrowLeft', keyCode: keyCodes.LEFT, shiftKey: true })
    );

    expect(harness.toggleBlockSelectedState).not.toHaveBeenCalled();
  });

  it('Shift+ArrowLeft at the caret start starts a selection', () => {
    const harness = createHarness();

    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'ArrowLeft', keyCode: keyCodes.LEFT, shiftKey: true })
    );

    expect(harness.toggleBlockSelectedState).toHaveBeenCalledWith(false);
  });

  it('Shift+ArrowUp offers the inline toolbar while outside a cell', () => {
    const harness = createHarness();

    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

    harness.nav.handleArrowLeftAndUp(up({ shiftKey: true }));

    expect(harness.inlineToolbarTryToShow).toHaveBeenCalledTimes(1);
  });

  it('Shift+ArrowRight is not an up-handler selection key', () => {
    const harness = createHarness();

    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT, shiftKey: true })
    );

    expect(harness.toggleBlockSelectedState).not.toHaveBeenCalled();
  });

  it('plain ArrowUp crosses up, never left', () => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowLeftAndUp(up());

    expect(harness.navigatePrevious).not.toHaveBeenCalled();
    expect(harness.navigateVerticalPrevious).toHaveBeenCalledTimes(1);
  });

  it('plain ArrowLeft crosses left, never up', () => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowLeftAndUp(createKeyboardEvent({ key: 'ArrowLeft', keyCode: keyCodes.LEFT }));

    expect(harness.navigateVerticalPrevious).not.toHaveBeenCalled();
    expect(harness.navigatePrevious).toHaveBeenCalledTimes(1);
  });

  it('an unhandled ArrowLeft still clears the block selection once the caret settles', async () => {
    const harness = createHarness();
    const event = createKeyboardEvent({ key: 'ArrowLeft', keyCode: keyCodes.LEFT });

    harness.nav.handleArrowLeftAndUp(event);
    await flushTimers();

    expect(swallowedErrors).toStrictEqual([]);
    expect(harness.clearSelection).toHaveBeenCalledWith(event);
    expect(harness.blockManager.currentBlock?.updateCurrentInput).toHaveBeenCalledTimes(1);
  });

  it('an unhandled ArrowLeft with no current block does not throw', () => {
    const harness = createHarness({ currentBlock: undefined });

    vi.useFakeTimers();

    try {
      harness.nav.handleArrowLeftAndUp(createKeyboardEvent({ key: 'ArrowLeft', keyCode: keyCodes.LEFT }));

      expect(() => vi.advanceTimersByTime(50)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }

    expect(harness.clearSelection).toHaveBeenCalledTimes(1);
  });

  it('a null window selection never reaches the block resolver', () => {
    const harness = createHarness();

    vi.spyOn(window, 'getSelection').mockReturnValue(null);

    harness.nav.handleArrowLeftAndUp(up());

    expect(harness.setCurrentBlockByChildNode).not.toHaveBeenCalled();
  });

  it('a block selection already in progress keeps the anchor resolver closed', () => {
    const harness = createHarness({ anyBlockSelected: true });

    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      anchorNode: document.createTextNode('anchor'),
    } as unknown as Selection);

    harness.nav.handleArrowLeftAndUp(up());

    expect(harness.setCurrentBlockByChildNode).not.toHaveBeenCalled();
  });

  it('ArrowUp resolves the current block from the live selection anchor', () => {
    const harness = createHarness();
    const anchorNode = document.createTextNode('anchor');

    vi.spyOn(window, 'getSelection').mockReturnValue({ anchorNode } as unknown as Selection);
    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

    harness.nav.handleArrowLeftAndUp(up());

    expect(harness.setCurrentBlockByChildNode).toHaveBeenCalledWith(anchorNode);
  });

  it('ArrowUp reads the caret from the block input when the block reports none', () => {
    const input = document.createElement('div');

    input.contentEditable = 'true';

    const block = createBlock({ id: 'block', currentInput: undefined });

    (block as { inputs: unknown[] }).inputs = [input];

    const harness = createHarness({ currentBlock: block });
    const caretSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP, target: input })
    );

    expect(caretSpy).toHaveBeenCalledWith(input);
  });

  it('a selection-less block without a current input is not asked for its caret', () => {
    const block = createBlock({ id: 'block', currentInput: undefined });
    const harness = createHarness({ currentBlock: block });
    const caretSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP, target: document.createElement('span') })
    );

    expect(caretSpy).not.toHaveBeenCalled();
  });
});

describe('KeyboardNavigation — wrong-arrow guards and toolbar keys', () => {
  it('plain ArrowUp in the down handler never crosses right', () => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowRightAndDown(createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP }));

    expect(harness.navigateNext).not.toHaveBeenCalled();
    expect(harness.navigateVerticalNext).not.toHaveBeenCalled();
  });

  it('plain ArrowDown in the up handler never crosses left', () => {
    const harness = createHarness({ navigated: true });

    harness.nav.handleArrowLeftAndUp(createKeyboardEvent({ key: 'ArrowDown', keyCode: keyCodes.DOWN }));

    expect(harness.navigatePrevious).not.toHaveBeenCalled();
    expect(harness.navigateVerticalPrevious).not.toHaveBeenCalled();
  });

  it('Shift+Tab with an open toolbar is still the flipper key in the down handler', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'Tab', keyCode: keyCodes.TAB, shiftKey: true })
    );

    expect(harness.clearSelection).not.toHaveBeenCalled();
  });

  it('Shift+Tab with an open toolbar is still the flipper key in the up handler', () => {
    const harness = createHarness({ someToolbarOpened: true });

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'Tab', keyCode: keyCodes.TAB, shiftKey: true })
    );

    expect(harness.clearSelection).not.toHaveBeenCalled();
  });
});

describe('KeyboardNavigation — fallback input resolution', () => {
  it('ArrowRight does not invent a caret holder when the target sits outside every input', () => {
    const block = createBlock({ id: 'block', currentInput: undefined });
    const harness = createHarness({ currentBlock: block, navigated: true });
    const nbspNode = document.createTextNode(' ');

    vi.spyOn(caretUtils, 'findNbspAfterEmptyInline').mockReturnValue({ node: nbspNode, offset: 1 });

    const setCursor = vi.spyOn(SelectionUtils, 'setCursor').mockImplementation(() => new DOMRect());

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'ArrowRight', keyCode: keyCodes.RIGHT, target: document.createElement('span') })
    );

    expect(setCursor).not.toHaveBeenCalled();
  });

  it('ArrowUp does not invent a caret holder when the target sits outside every input', () => {
    const block = createBlock({ id: 'block', currentInput: undefined });
    const harness = createHarness({ currentBlock: block });
    const caretSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP, target: document.createElement('span') })
    );

    expect(caretSpy).not.toHaveBeenCalled();
  });

  it('ArrowDown reads the caret from the input that contains the event target', () => {
    const input = document.createElement('div');
    const child = document.createElement('span');

    input.appendChild(child);

    const block = createBlock({ id: 'block', currentInput: undefined });

    (block as { inputs: unknown[] }).inputs = [input];

    const harness = createHarness({ currentBlock: block });
    const caretSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'ArrowDown', keyCode: keyCodes.DOWN, target: child })
    );

    expect(caretSpy).toHaveBeenCalledWith(input);
  });

  it('ArrowUp reads the caret from the input that holds the focused element', () => {
    const input = document.createElement('div');
    const focused = document.createElement('span');

    input.appendChild(focused);

    const block = createBlock({ id: 'block', currentInput: undefined });

    (block as { inputs: unknown[] }).inputs = [input];

    const harness = createHarness({ currentBlock: block });

    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(focused);

    const caretSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

    harness.nav.handleArrowLeftAndUp(
      createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP, target: document.createElement('span') })
    );

    expect(caretSpy).toHaveBeenCalledWith(input);
  });

  it('ArrowDown reads the caret from the input that holds the focused element', () => {
    const input = document.createElement('div');
    const focused = document.createElement('span');

    input.appendChild(focused);

    const block = createBlock({ id: 'block', currentInput: undefined });

    (block as { inputs: unknown[] }).inputs = [input];

    const harness = createHarness({ currentBlock: block });

    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(focused);

    const caretSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

    harness.nav.handleArrowRightAndDown(
      createKeyboardEvent({ key: 'ArrowDown', keyCode: keyCodes.DOWN, target: document.createElement('span') })
    );

    expect(caretSpy).toHaveBeenCalledWith(input);
  });

  it('a non-HTML focused element never crashes the ArrowDown handler', () => {
    const harness = createHarness();

    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    );

    const event = createKeyboardEvent({ key: 'ArrowDown', keyCode: keyCodes.DOWN });

    harness.nav.handleArrowRightAndDown(event);

    expect(harness.clearSelection).toHaveBeenCalledWith(event);
  });

  it('a non-HTML focused element never crashes the ArrowUp handler', () => {
    const harness = createHarness();

    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    );

    const event = createKeyboardEvent({ key: 'ArrowUp', keyCode: keyCodes.UP });

    harness.nav.handleArrowLeftAndUp(event);

    expect(harness.clearSelection).toHaveBeenCalledWith(event);
  });
});

describe('KeyboardNavigation — container child lifecycle', () => {
  beforeEach(() => {
    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);
    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
  });

  it('Delete on an empty sole column child closes the toolbar exactly once', () => {
    const column = createBlock({
      id: 'column',
      name: 'column',
      parentId: 'column_list',
      contentIds: ['child'],
    });
    const child = createBlock({ id: 'child', parentId: 'column', isEmpty: true });
    const nextSibling = createBlock({ id: 'next', parentId: 'column' });
    const harness = createHarness({
      currentBlock: child,
      previousBlock: null,
      nextBlock: nextSibling,
      registry: [column, child, nextSibling],
      blocks: [column, child, nextSibling],
    });

    harness.nav.handleDelete(createKeyboardEvent({ key: 'Delete', keyCode: keyCodes.DELETE }));

    expect(harness.removeBlock.mock.calls[0][0]).toBe(child);
    // Once for the destructive Delete itself, once when the column collapses.
    expect(harness.toolbarClose).toHaveBeenCalledTimes(2);
  });

  it('Delete on an empty toggle child that has no previous sibling closes the toolbar once', () => {
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
      previousBlock: null,
      nextBlock: nextSibling,
      registry: [toggle, child, nextSibling],
      blocks: [toggle, child, nextSibling],
    });

    harness.nav.handleDelete(createKeyboardEvent({ key: 'Delete', keyCode: keyCodes.DELETE }));

    expect(harness.toolbarClose).toHaveBeenCalledTimes(1);
    expect(harness.removeBlock).not.toHaveBeenCalled();
  });



  it('Delete keeps a container child when the previous block lives in another parent', () => {
    const container = createBlock({
      id: 'container',
      name: 'callout',
      parentId: null,
      contentIds: ['child', 'next'],
      markerHtml: NESTED_SLOT_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'container', isEmpty: true });
    const nextSibling = createBlock({ id: 'next', parentId: 'container' });
    const outsider = createBlock({ id: 'outsider', parentId: 'elsewhere' });
    const harness = createHarness({
      currentBlock: child,
      previousBlock: outsider,
      nextBlock: nextSibling,
      registry: [container, child, nextSibling, outsider],
      blocks: [container, outsider, child, nextSibling],
    });

    harness.nav.handleDelete(createKeyboardEvent({ key: 'Delete', keyCode: keyCodes.DELETE }));
    // The container child has no previous sibling, so Delete keeps it and
    // never falls through to the flat-array removal.
    expect(harness.removeBlock).not.toHaveBeenCalled();
    expect(harness.toolbarClose).toHaveBeenCalledTimes(1);
  });

  it('Backspace on a non-empty container child leaves the toolbar close to the caller', () => {
    const container = createBlock({
      id: 'container',
      name: 'callout',
      parentId: null,
      contentIds: ['child'],
      markerHtml: NESTED_SLOT_MARKER,
    });
    const child = createBlock({ id: 'child', parentId: 'container' });
    const harness = createHarness({
      currentBlock: child,
      previousBlock: null,
      registry: [container, child],
      blocks: [container, child],
    });

    harness.nav.handleBackspace(createKeyboardEvent({ key: 'Backspace', keyCode: keyCodes.BACKSPACE }));

    expect(harness.removeBlock).not.toHaveBeenCalled();
    expect(harness.toolbarClose).toHaveBeenCalledTimes(1);
  });
});
