import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockSelectionKeys } from '../../../../../../src/components/modules/blockEvents/composers/blockSelectionKeys';
import type { Block } from '../../../../../../src/components/block';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { CrossBlockSubRange, CrossBlockTextSelection } from '../../../../../../src/components/selection/cross-block-range';
import { SelectionUtils } from '../../../../../../src/components/selection';
import { DATA_ATTR } from '../../../../../../src/components/constants/data-attributes';

/**
 * Behaviour pinning for BlockSelectionKeys, written against surviving mutants.
 *
 * The composer decides what a destructive keypress applies to, so the fixtures
 * below use asymmetric depths, ids and text lengths: a fixture where every list
 * item sits at depth 0 and every block is interchangeable cannot tell a correct
 * comparison from an inverted one.
 */

interface BlockOptions {
  id: string;
  name?: string;
  parentId?: string | null;
  contentIds?: string[];
  /** Renders a `[data-list-depth]` marker inside the holder. */
  depth?: number;
  /** Renders an `input[type="checkbox"]` inside the holder (checklist item). */
  checkbox?: 'checked' | 'unchecked';
  ownsChildren?: boolean;
  mergeable?: boolean;
  isEmpty?: boolean;
  selected?: boolean;
  text?: string;
  /** Set to null to model a block whose editing host is gone. */
  lastInput?: null;
  firstInput?: null;
}

interface BlockFixture {
  block: Block;
  holder: HTMLElement;
  input: HTMLElement;
  checkbox: HTMLInputElement | null;
}

const createBlockFixture = (options: BlockOptions): BlockFixture => {
  const holder = document.createElement('div');

  holder.setAttribute(DATA_ATTR.element, '');
  holder.setAttribute('data-fixture-id', options.id);

  const input = document.createElement('div');

  input.contentEditable = 'true';
  input.textContent = options.text ?? options.id;
  holder.appendChild(input);

  if (options.depth !== undefined) {
    const marker = document.createElement('span');

    marker.setAttribute('data-list-depth', String(options.depth));
    holder.appendChild(marker);
  }

  let checkbox: HTMLInputElement | null = null;

  if (options.checkbox !== undefined) {
    checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = options.checkbox === 'checked';
    holder.appendChild(checkbox);
  }

  const name = options.name ?? 'list';

  const block = {
    id: options.id,
    name,
    holder,
    parentId: options.parentId ?? null,
    contentIds: options.contentIds ?? [],
    selected: options.selected ?? false,
    isEmpty: options.isEmpty ?? false,
    mergeable: options.mergeable ?? true,
    inputs: [input],
    firstInput: options.firstInput === null ? undefined : input,
    lastInput: options.lastInput === null ? undefined : input,
    tool: {
      name,
      isDefault: name === 'paragraph',
      isLineBreaksEnabled: false,
      ownsChildren: options.ownsChildren ?? false,
    },
    hasMedia: false,
    updateCurrentInput: vi.fn(),
    render: vi.fn(),
    save: vi.fn(() => Promise.resolve({
      id: options.id,
      tool: name,
      data: { text: options.text ?? options.id },
      time: 0,
      tunes: {},
    })),
  } as unknown as Block;

  return {
    block,
    holder,
    input,
    checkbox,
  };
};

const createBlock = (options: BlockOptions): Block => createBlockFixture(options).block;

const keyboardEvent = (options: Partial<KeyboardEvent> = {}): KeyboardEvent => {
  return {
    key: '',
    code: '',
    keyCode: 0,
    isComposing: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...options,
  } as unknown as KeyboardEvent;
};

const clipboardEvent = (): ClipboardEvent => {
  return {
    preventDefault: vi.fn(),
    clipboardData: null,
  } as unknown as ClipboardEvent;
};

interface HarnessOptions {
  blocks: Block[];
  /** Defaults to the blocks flagged `selected`. */
  selectedBlocks?: Block[];
  /** Defaults to `selectedBlocks.length > 0`. */
  anyBlockSelected?: boolean;
  textSelection?: CrossBlockTextSelection | null;
  /** What `deleteSelectedBlocksAndInsertReplacement` hands back. */
  insertedBlock?: Block;
  /** Replaces the faithful index → block lookup for the vanishing-block case. */
  getBlockByIndex?: (index: number) => Block | undefined;
  /** Runs before each `update` resolves, to model DOM changes landing mid-loop. */
  onUpdate?: (block: Block) => void;
}

const createHarness = (options: HarnessOptions) => {
  const { blocks } = options;
  const selectedBlocks = options.selectedBlocks ?? blocks.filter((block) => block.selected);
  const updatedBlocks: Block[] = [];

  const setBlockParent = vi.fn((_block: Block, _parentId: string | null) => undefined);
  const clearCache = vi.fn();
  const clearSelection = vi.fn();
  const copySelectedBlocks = vi.fn(() => Promise.resolve());
  const copyCrossBlockTextSelection = vi.fn();
  const clearTextSelection = vi.fn();
  const setToBlock = vi.fn((_block: Block, _position?: string) => undefined);
  const setToInput = vi.fn((_input: HTMLElement, _position?: string, _offset?: number) => undefined);
  const insertContentAtCaretPosition = vi.fn((_content: string) => undefined);
  const setCurrentBlockByChildNode = vi.fn((_node: Node) => undefined);
  const removeBlock = vi.fn((_block: Block) => Promise.resolve());
  const mergeBlocks = vi.fn((_target: Block, _toMerge: Block) => Promise.resolve());
  const splitBlock = createBlock({ id: 'split-result', name: 'paragraph' });
  const split = vi.fn(() => splitBlock);
  const deleteSelectedBlocksAndInsertReplacement = vi.fn(() => options.insertedBlock);
  const getBlock = vi.fn((holder: HTMLElement) => blocks.find((block) => block.holder === holder));

  const update = vi.fn((block: Block, _data: Record<string, unknown>) => {
    options.onUpdate?.(block);

    const replacement = createBlock({ id: `${block.id}-updated`, name: block.name });

    updatedBlocks.push(replacement);

    return Promise.resolve(replacement);
  });

  /** Mirrors repository.getBlockByIndex: -1 wraps to the LAST block. */
  const defaultGetBlockByIndex = (index: number): Block | undefined => {
    return index === -1 ? blocks[blocks.length - 1] : blocks[index];
  };

  const getBlockByIndex = vi.fn(options.getBlockByIndex ?? defaultGetBlockByIndex);

  const blok = {
    BlockSelection: {
      anyBlockSelected: options.anyBlockSelected ?? selectedBlocks.length > 0,
      selectedBlocks,
      clearCache,
      clearSelection,
      copySelectedBlocks,
      copyCrossBlockTextSelection,
    } as unknown as BlokModules['BlockSelection'],
    BlockManager: {
      blocks,
      currentBlock: blocks[0],
      // Mirrors repository.getBlockIndex: a number, -1 when the block is unknown.
      getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
      getBlockByIndex,
      getBlockById: vi.fn((id: string) => blocks.find((block) => block.id === id)),
      getBlock,
      setBlockParent,
      update,
      removeBlock,
      mergeBlocks,
      split,
      setCurrentBlockByChildNode,
      deleteSelectedBlocksAndInsertReplacement,
    } as unknown as BlokModules['BlockManager'],
    BlockSettings: {
      opened: false,
      contains: vi.fn(() => false),
    } as unknown as BlokModules['BlockSettings'],
    CrossBlockSelection: {
      textSelection: options.textSelection ?? null,
      clearTextSelection,
    } as unknown as BlokModules['CrossBlockSelection'],
    Caret: {
      positions: {
        START: 'start',
        END: 'end',
        DEFAULT: 'default',
      },
      setToBlock,
      setToInput,
      insertContentAtCaretPosition,
    } as unknown as BlokModules['Caret'],
  } as unknown as BlokModules;

  return {
    blok,
    keys: new BlockSelectionKeys(blok),
    updatedBlocks,
    splitBlock,
    mocks: {
      setBlockParent,
      clearCache,
      clearSelection,
      copySelectedBlocks,
      copyCrossBlockTextSelection,
      clearTextSelection,
      setToBlock,
      setToInput,
      insertContentAtCaretPosition,
      setCurrentBlockByChildNode,
      removeBlock,
      mergeBlocks,
      split,
      update,
      getBlockByIndex,
      getBlock,
      deleteSelectedBlocksAndInsertReplacement,
    },
  };
};

/** Lets the awaited save/update loops inside the composer run to completion. */
const flushAsync = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const subRange = (fixture: BlockFixture, start: number, end: number): CrossBlockSubRange => {
  const textNode = fixture.input.firstChild;

  if (textNode === null) {
    throw new Error('fixture input has no text node');
  }

  const range = document.createRange();

  range.setStart(textNode, start);
  range.setEnd(textNode, end);

  return {
    block: fixture.block,
    input: fixture.input,
    range,
    coversWholeInput: start === 0 && end === (textNode.textContent ?? '').length,
  };
};

const textSelectionOf = (subRanges: CrossBlockSubRange[]): CrossBlockTextSelection => {
  const first = subRanges[0];
  const last = subRanges[subRanges.length - 1];

  return {
    range: first.range,
    subRanges,
    startBlock: first.block,
    endBlock: last.block,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  window.getSelection()?.removeAllRanges();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe('BlockSelectionKeys — Tab on a mixed list + structural selection', () => {
  it('indents a list item whose depth equals its unselected previous list item', async () => {
    const previousItem = createBlock({ id: 'li-above', depth: 1 });
    const listItem = createBlock({ id: 'li-target', depth: 1, selected: true });
    const paragraph = createBlock({ id: 'para', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [previousItem, listItem, paragraph] });

    const handled = harness.keys.handleIndent(keyboardEvent({ key: 'Tab' }));

    await flushAsync();

    expect(handled).toBe(true);
    expect(harness.mocks.update).toHaveBeenCalledWith(listItem, expect.objectContaining({ depth: 2 }));
    // The structural half nests under the block above it, independently of the list half.
    expect(harness.mocks.setBlockParent).toHaveBeenCalledWith(paragraph, 'li-target');
  });

  it('refuses to indent a list item already deeper than its unselected previous item', async () => {
    const previousItem = createBlock({ id: 'li-above', depth: 0 });
    const listItem = createBlock({ id: 'li-target', depth: 1, selected: true });
    const paragraph = createBlock({ id: 'para', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [previousItem, listItem, paragraph] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab' }));

    await flushAsync();

    expect(harness.mocks.update).not.toHaveBeenCalled();
    // The structural half still moves — a blocked list indent must not veto it.
    expect(harness.mocks.setBlockParent).toHaveBeenCalledWith(paragraph, 'li-target');
  });

  it('indents a selected pair whose predecessor is selected too, preserving their relative depth', async () => {
    const shallow = createBlock({ id: 'li-shallow', depth: 0, selected: true });
    const deep = createBlock({ id: 'li-deep', depth: 1, selected: true });
    const paragraph = createBlock({ id: 'para', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [shallow, deep, paragraph] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab' }));

    await flushAsync();

    expect(harness.mocks.update).toHaveBeenCalledWith(shallow, expect.objectContaining({ depth: 1 }));
    expect(harness.mocks.update).toHaveBeenCalledWith(deep, expect.objectContaining({ depth: 2 }));
  });

  it('treats a preceding non-list block as the start of a group, even when it carries a depth marker', async () => {
    /**
     * A paragraph with a nested list child renders that child's `[data-list-depth]`
     * marker inside its own holder, so the depth helper reads 2 for a block that is
     * not a list item at all. Group detection must go by the tool name, not depth.
     */
    const paragraphWithNestedList = createBlock({ id: 'para-above', name: 'paragraph', depth: 2 });
    const listItem = createBlock({ id: 'li-target', depth: 1, selected: true });
    const paragraph = createBlock({ id: 'para', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [paragraphWithNestedList, listItem, paragraph] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab' }));

    await flushAsync();

    // First in its group and already nested: Notion refuses a second level here.
    expect(harness.mocks.update).not.toHaveBeenCalled();
  });

  it('refuses to indent a first-in-document list item that is already nested', async () => {
    const firstItem = createBlock({ id: 'li-first', depth: 1, selected: true });
    const paragraph = createBlock({ id: 'para', name: 'paragraph', selected: true });
    const lastItem = createBlock({ id: 'li-last', depth: 1 });
    const harness = createHarness({ blocks: [firstItem, paragraph, lastItem] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab' }));

    await flushAsync();

    // Index 0 has no predecessor. Reading index -1 would wrap to the LAST block.
    expect(harness.mocks.update).not.toHaveBeenCalled();
    expect(harness.mocks.getBlockByIndex).not.toHaveBeenCalledWith(-1);
  });

  it('re-depths a list item that sits at index 0 and marks the replacement selected', async () => {
    const listItem = createBlock({ id: 'li-first', depth: 0, selected: true });
    const paragraph = createBlock({ id: 'para', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [listItem, paragraph] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab' }));

    await flushAsync();

    // Exactly one: the paragraph must be indented structurally, never re-depthed.
    expect(harness.mocks.update).toHaveBeenCalledTimes(1);
    expect(harness.mocks.update).toHaveBeenCalledWith(listItem, expect.objectContaining({ depth: 1 }));
    expect(harness.updatedBlocks[0].selected).toBe(true);
    expect(harness.mocks.clearCache).toHaveBeenCalledTimes(1);
  });

  it('re-depths in document order when the selection arrives out of order', async () => {
    const firstItem = createBlock({ id: 'li-first', depth: 0, selected: true });
    const paragraph = createBlock({ id: 'para', name: 'paragraph', selected: true });
    const laterItem = createBlock({ id: 'li-later', depth: 0, selected: true });
    const blocks = [firstItem, paragraph, laterItem];
    const harness = createHarness({
      blocks,
      selectedBlocks: [laterItem, firstItem, paragraph],
    });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab' }));

    await flushAsync();

    expect(harness.mocks.update.mock.calls[0][0]).toBe(firstItem);
    expect(harness.mocks.update.mock.calls[1][0]).toBe(laterItem);
  });

  it('skips a list item that leaves the store while the re-depth loop is awaiting', async () => {
    const vanishing = createBlock({ id: 'li-vanishing', depth: 0, selected: true });
    const surviving = createBlock({ id: 'li-surviving', depth: 0, selected: true });
    const paragraph = createBlock({ id: 'para', name: 'paragraph', selected: true });
    const blocks = [vanishing, surviving, paragraph];
    const harness = createHarness({
      blocks,
      getBlockByIndex: (index: number) => (index === 0 ? undefined : blocks[index]),
    });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab' }));

    await flushAsync();

    expect(harness.mocks.update).toHaveBeenCalledTimes(1);
    expect(harness.mocks.update.mock.calls[0][0]).toBe(surviving);
    expect(harness.mocks.clearCache).toHaveBeenCalledTimes(1);
  });

  it('drops a selected list item the block store does not know', async () => {
    const known = createBlock({ id: 'li-known', depth: 0, selected: true });
    const paragraph = createBlock({ id: 'para', name: 'paragraph', selected: true });
    const stranger = createBlock({ id: 'li-stranger', depth: 0 });
    const harness = createHarness({
      blocks: [known, paragraph],
      selectedBlocks: [known, stranger, paragraph],
    });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab' }));

    await flushAsync();

    // An unknown block indexes to -1, which would otherwise re-depth the LAST block.
    expect(harness.mocks.update).toHaveBeenCalledTimes(1);
    expect(harness.mocks.update.mock.calls[0][0]).toBe(known);
  });

  it('re-depths every selected list item when only paragraphs sit between them', async () => {
    const listItem = createBlock({ id: 'li-target', depth: 0, selected: true });
    const paragraph = createBlock({ id: 'para', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [listItem, paragraph] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab' }));

    await flushAsync();

    expect(harness.mocks.update.mock.calls.every(([block]) => block.name === 'list')).toBe(true);
  });

  it('does not touch depths when a Tab selection holds no list item at all', async () => {
    const first = createBlock({ id: 'p1', name: 'paragraph', selected: true });
    const second = createBlock({ id: 'p2', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [first, second] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab' }));

    await flushAsync();

    expect(harness.mocks.update).not.toHaveBeenCalled();
    // clearCache only ever runs at the end of a re-depth pass.
    expect(harness.mocks.clearCache).not.toHaveBeenCalled();
  });
});

describe('BlockSelectionKeys — Shift+Tab on a mixed list + structural selection', () => {
  it('decrements the depth of every selected list item', async () => {
    const listItem = createBlock({ id: 'li-target', depth: 1, selected: true });
    const paragraph = createBlock({ id: 'para', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [listItem, paragraph] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab', shiftKey: true }));

    await flushAsync();

    expect(harness.mocks.update).toHaveBeenCalledWith(listItem, expect.objectContaining({ depth: 0 }));
  });

  it('leaves depths alone when one selected list item is already at depth 0', async () => {
    const flatItem = createBlock({ id: 'li-flat', depth: 0, selected: true });
    const deepItem = createBlock({ id: 'li-deep', depth: 2, selected: true });
    const paragraph = createBlock({ id: 'para', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [flatItem, deepItem, paragraph] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab', shiftKey: true }));

    await flushAsync();

    // All-or-nothing: outdenting the deep item alone would collapse their relationship.
    expect(harness.mocks.update).not.toHaveBeenCalled();
  });

  it('does not touch depths when a Shift+Tab selection holds no list item at all', async () => {
    const first = createBlock({ id: 'p1', name: 'paragraph', selected: true });
    const second = createBlock({ id: 'p2', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [first, second] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab', shiftKey: true }));

    await flushAsync();

    expect(harness.mocks.update).not.toHaveBeenCalled();
    expect(harness.mocks.clearCache).not.toHaveBeenCalled();
  });

  it('keeps a selected block with a different parent out of the outdent', () => {
    const grandparent = createBlock({ id: 'gp', name: 'paragraph', contentIds: ['parent'] });
    const parent = createBlock({ id: 'parent', name: 'paragraph', parentId: 'gp', contentIds: ['child'] });
    const child = createBlock({ id: 'child', name: 'paragraph', parentId: 'parent', contentIds: ['grandchild'], selected: true });
    const grandchild = createBlock({ id: 'grandchild', name: 'paragraph', parentId: 'child', selected: true });
    const harness = createHarness({ blocks: [grandparent, parent, child, grandchild] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab', shiftKey: true }));

    // The grandchild rides along with its selected parent; moving it directly would
    // flatten the two of them into siblings.
    expect(harness.mocks.setBlockParent).toHaveBeenCalledTimes(1);
    expect(harness.mocks.setBlockParent).toHaveBeenCalledWith(child, 'gp');
  });

  it('refuses to outdent when the parent block is missing from the store', () => {
    const orphan = createBlock({ id: 'orphan', name: 'paragraph', parentId: 'gone', selected: true });
    const harness = createHarness({ blocks: [orphan] });

    expect(() => harness.keys.handleIndent(keyboardEvent({ key: 'Tab', shiftKey: true }))).not.toThrow();
    expect(harness.mocks.setBlockParent).not.toHaveBeenCalled();
  });
});

describe('BlockSelectionKeys — Shift+Tab on an all-list selection', () => {
  it('decrements the flat depth of root-level list items', async () => {
    const first = createBlock({ id: 'li-1', depth: 1, selected: true });
    const second = createBlock({ id: 'li-2', depth: 1, selected: true });
    const harness = createHarness({ blocks: [first, second] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab', shiftKey: true }));

    await flushAsync();

    expect(harness.mocks.update).toHaveBeenCalledWith(first, expect.objectContaining({ depth: 0 }));
    expect(harness.mocks.update).toHaveBeenCalledWith(second, expect.objectContaining({ depth: 0 }));
    expect(harness.mocks.clearCache).toHaveBeenCalledTimes(1);
  });

  it('decrements only the flat items when the selection mixes flat and structural nesting', async () => {
    const root = createBlock({ id: 'li-root', depth: 0, contentIds: ['li-nested'] });
    const nested = createBlock({ id: 'li-nested', depth: 1, parentId: 'li-root', selected: true });
    const flat = createBlock({ id: 'li-flat', depth: 1, selected: true });
    const harness = createHarness({ blocks: [root, nested, flat] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab', shiftKey: true }));

    await flushAsync();

    // The structurally nested item moves in the tree; only the flat carrier is re-depthed.
    expect(harness.mocks.setBlockParent).toHaveBeenCalledWith(nested, null);
    expect(harness.mocks.update).toHaveBeenCalledTimes(1);
    expect(harness.mocks.update.mock.calls[0][0]).toBe(flat);
  });

  it('is a no-op when one flat list item in the selection is already at depth 0', async () => {
    const flatItem = createBlock({ id: 'li-flat', depth: 0, selected: true });
    const deepItem = createBlock({ id: 'li-deep', depth: 2, selected: true });
    const harness = createHarness({ blocks: [flatItem, deepItem] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab', shiftKey: true }));

    await flushAsync();

    expect(harness.mocks.update).not.toHaveBeenCalled();
    expect(harness.mocks.clearCache).not.toHaveBeenCalled();
  });

  it('runs no depth pass at all when the selection has no flat items', async () => {
    const root = createBlock({ id: 'li-root', depth: 0, contentIds: ['li-nested'] });
    const nested = createBlock({ id: 'li-nested', depth: 1, parentId: 'li-root', selected: true });
    const harness = createHarness({ blocks: [root, nested] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab', shiftKey: true }));

    await flushAsync();

    expect(harness.mocks.update).not.toHaveBeenCalled();
    // An empty depth pass still clears the cache, which is how it shows up here.
    expect(harness.mocks.clearCache).not.toHaveBeenCalled();
  });

  it('skips a list item whose parent block is missing from the store', () => {
    const orphan = createBlock({ id: 'li-orphan', depth: 1, parentId: 'gone', selected: true });
    const harness = createHarness({ blocks: [orphan] });

    expect(() => harness.keys.handleIndent(keyboardEvent({ key: 'Tab', shiftKey: true }))).not.toThrow();
    expect(harness.mocks.setBlockParent).not.toHaveBeenCalled();
  });

  it('outdents an item whose ancestor chain breaks above its parent', () => {
    const broken = createBlock({ id: 'li-broken', depth: 1, parentId: 'gone', contentIds: ['li-target'] });
    const target = createBlock({ id: 'li-target', depth: 2, parentId: 'li-broken', selected: true });
    const harness = createHarness({ blocks: [broken, target] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab', shiftKey: true }));

    // A dead end in the ancestor walk is "no selected ancestor", not "selected".
    expect(harness.mocks.setBlockParent).toHaveBeenCalledTimes(1);
    expect(harness.mocks.setBlockParent).toHaveBeenCalledWith(target, 'gone');
  });

  it('does not move an item whose selected ancestor is two levels up', async () => {
    const top = createBlock({ id: 'li-top', depth: 0, contentIds: ['li-mid'], selected: true });
    const middle = createBlock({ id: 'li-mid', depth: 1, parentId: 'li-top', contentIds: ['li-leaf'] });
    const leaf = createBlock({ id: 'li-leaf', depth: 2, parentId: 'li-mid', selected: true });
    const harness = createHarness({ blocks: [top, middle, leaf] });

    harness.keys.handleIndent(keyboardEvent({ key: 'Tab', shiftKey: true }));

    await flushAsync();

    // The walk must follow the whole parentId chain, not just the immediate parent.
    expect(harness.mocks.setBlockParent).not.toHaveBeenCalled();
    expect(harness.mocks.update).not.toHaveBeenCalled();
  });
});

describe('BlockSelectionKeys — handleIndent guards', () => {
  it('is a no-op when the selection flag is set but the selection is empty', () => {
    const paragraph = createBlock({ id: 'para', name: 'paragraph' });
    const harness = createHarness({
      blocks: [paragraph],
      selectedBlocks: [],
      anyBlockSelected: true,
    });
    const event = keyboardEvent({ key: 'Tab' });

    expect(() => harness.keys.handleIndent(event)).not.toThrow();
    expect(harness.mocks.setBlockParent).not.toHaveBeenCalled();
  });
});

describe('BlockSelectionKeys — handleToggleCheckbox', () => {
  it('ignores a non-list block that merely contains a checkbox', async () => {
    /**
     * A paragraph with a nested checklist child renders that child's checkbox
     * inside the parent's holder. Toggling on the tool name keeps Cmd+Enter from
     * flipping a child's checkbox through its unrelated parent.
     */
    const paragraph = createBlock({
      id: 'para-with-child',
      name: 'paragraph',
      checkbox: 'unchecked',
      selected: true,
    });
    const harness = createHarness({ blocks: [paragraph] });
    const event = keyboardEvent({ key: 'Enter', metaKey: true });

    const handled = harness.keys.handleToggleCheckbox(event);

    await flushAsync();

    expect(handled).toBe(false);
    expect(harness.mocks.update).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does nothing when the selection flag says nothing is selected', async () => {
    const item = createBlock({ id: 'todo', checkbox: 'unchecked', selected: true });
    const harness = createHarness({
      blocks: [item],
      anyBlockSelected: false,
    });

    const handled = harness.keys.handleToggleCheckbox(keyboardEvent({ key: 'Enter', ctrlKey: true }));

    await flushAsync();

    expect(handled).toBe(false);
    expect(harness.mocks.update).not.toHaveBeenCalled();
  });

  it('marks each replacement selected and clears the selection cache', async () => {
    const done = createBlock({ id: 'done', checkbox: 'checked', selected: true });
    const todo = createBlock({ id: 'todo', checkbox: 'unchecked', selected: true });
    const harness = createHarness({ blocks: [done, todo] });

    harness.keys.handleToggleCheckbox(keyboardEvent({ key: 'Enter', metaKey: true }));

    await flushAsync();

    expect(harness.updatedBlocks).toHaveLength(2);
    expect(harness.updatedBlocks.every((block) => block.selected)).toBe(true);
    expect(harness.mocks.clearCache).toHaveBeenCalledTimes(1);
  });

  it('skips an item whose checkbox disappears while the toggle loop awaits', async () => {
    const first = createBlockFixture({ id: 'todo-1', checkbox: 'unchecked', selected: true });
    const second = createBlockFixture({ id: 'todo-2', checkbox: 'unchecked', selected: true });
    const harness = createHarness({
      blocks: [first.block, second.block],
      onUpdate: () => second.checkbox?.remove(),
    });

    harness.keys.handleToggleCheckbox(keyboardEvent({ key: 'Enter', ctrlKey: true }));

    await flushAsync();

    expect(harness.mocks.update).toHaveBeenCalledTimes(1);
    expect(harness.mocks.update.mock.calls[0][0]).toBe(first.block);
    expect(harness.mocks.clearCache).toHaveBeenCalledTimes(1);
  });
});

describe('BlockSelectionKeys — handleDeletion', () => {
  const stubSelection = (exists: boolean, collapsed: boolean): void => {
    vi.spyOn(SelectionUtils, 'isSelectionExists', 'get').mockReturnValue(exists);
    vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(collapsed);
  };

  it('handles the Delete key', () => {
    stubSelection(false, true);

    const target = createBlock({ id: 'doomed', name: 'paragraph', selected: true });
    const replacement = createBlock({ id: 'replacement', name: 'paragraph' });
    const harness = createHarness({ blocks: [target], insertedBlock: replacement });
    const event = keyboardEvent({ key: 'Delete' });

    const handled = harness.keys.handleDeletion(event);

    expect(handled).toBe(true);
    expect(harness.mocks.deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
    expect(harness.mocks.setToBlock).toHaveBeenCalledWith(replacement, 'start');
  });

  it('leaves a non-remove key to the browser even with blocks selected', () => {
    stubSelection(false, true);

    const target = createBlock({ id: 'kept', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [target] });
    const event = keyboardEvent({ key: 'Enter' });

    const handled = harness.keys.handleDeletion(event);

    expect(handled).toBe(false);
    expect(harness.mocks.deleteSelectedBlocksAndInsertReplacement).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('deletes when a collapsed caret sits inside the selection', () => {
    stubSelection(true, true);

    const target = createBlock({ id: 'doomed', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [target], insertedBlock: createBlock({ id: 'replacement', name: 'paragraph' }) });

    expect(harness.keys.handleDeletion(keyboardEvent({ key: 'Backspace' }))).toBe(true);
    expect(harness.mocks.deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
  });

  it('deletes when no document selection exists at all', () => {
    stubSelection(false, false);

    const target = createBlock({ id: 'doomed', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [target], insertedBlock: createBlock({ id: 'replacement', name: 'paragraph' }) });

    expect(harness.keys.handleDeletion(keyboardEvent({ key: 'Backspace' }))).toBe(true);
    expect(harness.mocks.deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
  });

  it('leaves the caret alone when nothing replaced the deleted blocks', () => {
    stubSelection(false, true);

    const target = createBlock({ id: 'doomed', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [target] });

    expect(harness.keys.handleDeletion(keyboardEvent({ key: 'Backspace' }))).toBe(true);
    // No replacement and no nested container: setting the caret would target undefined.
    expect(harness.mocks.setToBlock).not.toHaveBeenCalled();
  });

  it('restores the caret into the nested container the deleted blocks lived in', () => {
    stubSelection(false, true);

    const container = document.createElement('div');

    container.setAttribute(DATA_ATTR.nestedBlocks, '');
    document.body.appendChild(container);

    const insideFirst = createBlockFixture({ id: 'cell-line-1', name: 'paragraph', selected: true });
    const insideSecond = createBlockFixture({ id: 'cell-line-2', name: 'paragraph', selected: true });
    const outside = createBlockFixture({ id: 'outside', name: 'paragraph' });

    container.appendChild(insideFirst.holder);
    container.appendChild(insideSecond.holder);
    document.body.appendChild(outside.holder);

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);

      return 0;
    });

    const harness = createHarness({ blocks: [insideFirst.block, insideSecond.block, outside.block] });

    harness.keys.handleDeletion(keyboardEvent({ key: 'Backspace' }));

    // The unselected block outside the container must not widen the common container
    // to null, and the first surviving holder inside it is where the caret lands.
    expect(harness.mocks.setToBlock).toHaveBeenCalledTimes(1);
    expect(harness.mocks.setToBlock).toHaveBeenCalledWith(insideFirst.block, 'start');
  });
});

describe('BlockSelectionKeys — clipboard handlers', () => {
  const crossBlockFixture = () => {
    const first = createBlockFixture({ id: 'first', name: 'paragraph', text: 'Hello world', selected: true });
    const second = createBlockFixture({ id: 'second', name: 'paragraph', text: 'again friend', selected: true });

    document.body.appendChild(first.holder);
    document.body.appendChild(second.holder);

    const selection = textSelectionOf([subRange(first, 5, 11), subRange(second, 0, 6)]);

    return {
      first,
      second,
      selection,
    };
  };

  it('copies a cross-block text selection instead of the selected blocks', () => {
    const { first, second, selection } = crossBlockFixture();
    const harness = createHarness({
      blocks: [first.block, second.block],
      textSelection: selection,
    });
    const event = clipboardEvent();

    harness.keys.handleCopy(event);

    expect(harness.mocks.copyCrossBlockTextSelection).toHaveBeenCalledWith(event, selection);
    expect(harness.mocks.copySelectedBlocks).not.toHaveBeenCalled();
  });

  it('cuts a cross-block text selection instead of the selected blocks', async () => {
    const { first, second, selection } = crossBlockFixture();
    const harness = createHarness({
      blocks: [first.block, second.block],
      textSelection: selection,
    });
    const event = clipboardEvent();

    harness.keys.handleCut(event);

    await flushAsync();

    expect(harness.mocks.copyCrossBlockTextSelection).toHaveBeenCalledWith(event, selection);
    expect(harness.mocks.copySelectedBlocks).not.toHaveBeenCalled();
    expect(harness.mocks.deleteSelectedBlocksAndInsertReplacement).not.toHaveBeenCalled();
  });

  it('leaves the caret alone when a cut deletes without a replacement block', async () => {
    const target = createBlock({ id: 'doomed', name: 'paragraph', selected: true });
    const harness = createHarness({ blocks: [target] });

    harness.keys.handleCut(clipboardEvent());

    await flushAsync();

    expect(harness.mocks.deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
    expect(harness.mocks.setToBlock).not.toHaveBeenCalled();
  });

  it('restores the caret into the nested container a cut emptied', async () => {
    const container = document.createElement('div');

    container.setAttribute(DATA_ATTR.nestedBlocks, '');
    document.body.appendChild(container);

    const insideFirst = createBlockFixture({ id: 'cell-line-1', name: 'paragraph', selected: true });
    const insideSecond = createBlockFixture({ id: 'cell-line-2', name: 'paragraph', selected: true });
    const outside = createBlockFixture({ id: 'outside', name: 'paragraph' });

    container.appendChild(insideFirst.holder);
    container.appendChild(insideSecond.holder);
    document.body.appendChild(outside.holder);

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);

      return 0;
    });

    const harness = createHarness({ blocks: [insideFirst.block, insideSecond.block, outside.block] });

    harness.keys.handleCut(clipboardEvent());

    await flushAsync();

    expect(harness.mocks.setToBlock).toHaveBeenCalledTimes(1);
    expect(harness.mocks.setToBlock).toHaveBeenCalledWith(insideFirst.block, 'start');
  });
});

describe('BlockSelectionKeys — handleTextSelectionEditKey', () => {
  const editFixture = (key: string, eventOptions: Partial<KeyboardEvent> = {}) => {
    const first = createBlockFixture({ id: 'first', name: 'paragraph', text: 'Hello world' });
    const doomed = createBlockFixture({ id: 'doomed', name: 'paragraph', text: 'middle' });
    const second = createBlockFixture({ id: 'second', name: 'paragraph', text: 'again friend' });

    document.body.appendChild(first.holder);
    document.body.appendChild(doomed.holder);
    document.body.appendChild(second.holder);

    const selection = textSelectionOf([subRange(first, 5, 11), subRange(second, 0, 6)]);
    const harness = createHarness({
      blocks: [first.block, doomed.block, second.block],
      selectedBlocks: [],
      anyBlockSelected: false,
      textSelection: selection,
    });
    const event = keyboardEvent({ key, ...eventOptions });

    return {
      harness,
      event,
      first,
      second,
    };
  };

  it.each([
    ['a composition in progress', { isComposing: true }],
    ['the Meta modifier', { metaKey: true }],
    ['the Control modifier', { ctrlKey: true }],
    ['the Alt modifier', { altKey: true }],
  ])('leaves the keystroke to the browser under %s', (_label, modifier) => {
    const { harness, event } = editFixture('a', modifier);

    expect(harness.keys.handleTextSelectionEditKey(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves a named non-editing key to the browser', () => {
    const { harness, event } = editFixture('ArrowLeft');

    expect(harness.keys.handleTextSelectionEditKey(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(harness.mocks.clearTextSelection).not.toHaveBeenCalled();
  });

  it.each(['Backspace', 'Delete'])('consumes %s and only deletes', async (key) => {
    const { harness, event } = editFixture(key);

    const handled = harness.keys.handleTextSelectionEditKey(event);

    await flushAsync();

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(harness.mocks.split).not.toHaveBeenCalled();
    expect(harness.mocks.insertContentAtCaretPosition).not.toHaveBeenCalled();
  });

  it('splits the joined block after Enter', async () => {
    const { harness, event } = editFixture('Enter');

    const handled = harness.keys.handleTextSelectionEditKey(event);

    await flushAsync();

    expect(handled).toBe(true);
    expect(harness.mocks.split).toHaveBeenCalledTimes(1);
    expect(harness.mocks.setToBlock).toHaveBeenCalledWith(harness.splitBlock, 'start');
    expect(harness.mocks.insertContentAtCaretPosition).not.toHaveBeenCalled();
  });

  it('types the pressed character into the joined block', async () => {
    const { harness, event } = editFixture('x');

    const handled = harness.keys.handleTextSelectionEditKey(event);

    await flushAsync();

    expect(handled).toBe(true);
    expect(harness.mocks.insertContentAtCaretPosition).toHaveBeenCalledWith('x');
    expect(harness.mocks.split).not.toHaveBeenCalled();
  });

  it('does not split when the replacement produced no block', async () => {
    const only = createBlockFixture({ id: 'only', name: 'paragraph', text: 'Hello world' });

    document.body.appendChild(only.holder);

    const selection = textSelectionOf([subRange(only, 0, 2), subRange(only, 5, 7)]);
    const harness = createHarness({
      blocks: [only.block],
      selectedBlocks: [],
      anyBlockSelected: false,
      textSelection: selection,
    });
    const event = keyboardEvent({ key: 'Enter' });

    const handled = harness.keys.handleTextSelectionEditKey(event);

    await flushAsync();

    // Two hosts of the SAME block are that tool's business — nothing was joined.
    expect(handled).toBe(true);
    expect(harness.mocks.split).not.toHaveBeenCalled();
  });
});

describe('BlockSelectionKeys — replaceCrossBlockTextSelection', () => {
  interface ReplaceOptions {
    firstText?: string;
    secondText?: string;
    secondName?: string;
    secondParentId?: string | null;
    secondIsEmpty?: boolean;
    firstMergeable?: boolean;
    firstLastInput?: null;
    detachFirst?: boolean;
    firstFirstInput?: null;
    doomedIds?: string[];
  }

  const replaceFixture = (options: ReplaceOptions = {}) => {
    const first = createBlockFixture({
      id: 'first',
      name: 'paragraph',
      text: options.firstText ?? 'Hello world',
      mergeable: options.firstMergeable ?? true,
      lastInput: options.firstLastInput,
      firstInput: options.firstFirstInput,
    });
    const doomed = (options.doomedIds ?? ['doomed-1', 'doomed-2']).map((id) => createBlockFixture({
      id,
      name: 'paragraph',
      text: id,
    }));
    const second = createBlockFixture({
      id: 'second',
      name: options.secondName ?? 'paragraph',
      text: options.secondText ?? 'again friend',
      parentId: options.secondParentId ?? null,
      isEmpty: options.secondIsEmpty ?? false,
    });

    if (options.detachFirst !== true) {
      document.body.appendChild(first.holder);
    }
    doomed.forEach((fixture) => document.body.appendChild(fixture.holder));
    document.body.appendChild(second.holder);

    const selection = textSelectionOf([subRange(first, 5, 11), subRange(second, 0, 6)]);
    const harness = createHarness({
      blocks: [first.block, ...doomed.map((fixture) => fixture.block), second.block],
      selectedBlocks: [],
      anyBlockSelected: false,
      textSelection: selection,
    });

    return {
      harness,
      first,
      second,
      doomed,
      selection,
    };
  };

  it('deletes both ends, removes the blocks between them bottom-up, and re-anchors at the join point', async () => {
    const { harness, first, second, doomed, selection } = replaceFixture();

    const result = await harness.keys.replaceCrossBlockTextSelection(selection);

    expect(result).toBe(first.block);
    expect(first.input.textContent).toBe('Hello');
    expect(second.input.textContent).toBe('friend');
    expect(harness.mocks.clearTextSelection).toHaveBeenCalledTimes(1);

    // Bottom-up: removing the top block first shifts every index below it.
    expect(harness.mocks.removeBlock).toHaveBeenCalledTimes(2);
    expect(harness.mocks.removeBlock.mock.calls[0][0]).toBe(doomed[1].block);
    expect(harness.mocks.removeBlock.mock.calls[1][0]).toBe(doomed[0].block);

    // The caret is parked at the END of what survived, not at its start.
    const documentSelection = window.getSelection();

    expect(documentSelection?.anchorNode).toBe(first.input.firstChild);
    expect(documentSelection?.anchorOffset).toBe(5);

    expect(harness.mocks.mergeBlocks.mock.calls[0][0]).toBe(first.block);
    expect(harness.mocks.mergeBlocks.mock.calls[0][1]).toBe(second.block);

    expect(harness.mocks.setCurrentBlockByChildNode.mock.calls[0][0]).toBe(first.input);
    // Offset, not "end of block": the merge appends the tail after the join point.
    expect(harness.mocks.setToInput).toHaveBeenCalledWith(first.input, 'default', 5);
  });

  it('refuses a selection whose ends sit in one block', async () => {
    const only = createBlockFixture({ id: 'only', name: 'paragraph', text: 'Hello world' });

    document.body.appendChild(only.holder);

    const selection = textSelectionOf([subRange(only, 0, 2), subRange(only, 5, 7)]);
    const harness = createHarness({
      blocks: [only.block],
      selectedBlocks: [],
      anyBlockSelected: false,
    });

    const result = await harness.keys.replaceCrossBlockTextSelection(selection);

    expect(result).toBeUndefined();
    expect(only.input.textContent).toBe('Hello world');
    expect(harness.mocks.clearTextSelection).not.toHaveBeenCalled();
  });

  it('refuses a selection whose ends sit in different containers', async () => {
    const { harness, first, selection } = replaceFixture({ secondParentId: 'table-cell' });

    const result = await harness.keys.replaceCrossBlockTextSelection(selection);

    expect(result).toBeUndefined();
    expect(first.input.textContent).toBe('Hello world');
    expect(harness.mocks.removeBlock).not.toHaveBeenCalled();
  });

  it('removes an emptied tail block that cannot be merged', async () => {
    const { harness, second, selection } = replaceFixture({
      secondName: 'image',
      secondText: 'again ',
      secondIsEmpty: true,
    });

    await harness.keys.replaceCrossBlockTextSelection(selection);

    expect(harness.mocks.mergeBlocks).not.toHaveBeenCalled();
    expect(harness.mocks.removeBlock).toHaveBeenCalledWith(second.block);
  });

  it('leaves a non-empty tail block that cannot be merged in place', async () => {
    const { harness, second, selection } = replaceFixture({
      secondName: 'image',
      secondIsEmpty: false,
    });

    await harness.keys.replaceCrossBlockTextSelection(selection);

    expect(harness.mocks.mergeBlocks).not.toHaveBeenCalled();
    expect(harness.mocks.removeBlock).not.toHaveBeenCalledWith(second.block);
  });

  it('skips the focus step when the first block has no editing host left', async () => {
    const { harness, first, selection } = replaceFixture({ firstLastInput: null });

    const result = await harness.keys.replaceCrossBlockTextSelection(selection);

    expect(result).toBe(first.block);
    expect(window.getSelection()?.anchorNode).toBeNull();
  });

  it('does not re-point the current block when no input survived', async () => {
    const { harness, selection } = replaceFixture({
      detachFirst: true,
      firstLastInput: null,
      firstFirstInput: null,
    });

    await harness.keys.replaceCrossBlockTextSelection(selection);

    expect(harness.mocks.setCurrentBlockByChildNode).not.toHaveBeenCalled();
    expect(harness.mocks.setToInput).not.toHaveBeenCalled();
  });
});
