/**
 * Behavioural pins for BasePasteHandler — the shared base every paste handler
 * inherits, so a defect here loses content on every paste path at once.
 *
 * Covers: which insertion path a payload takes, whether the current block is
 * replaced (content loss when it is wrong), the table-cell redirect that keeps
 * pasted blocks out of a table's grid, the caret-split of a multi-line plain
 * text paste, the inherited list style/depth carried on pasted content, the
 * parent wiring of pasted blocks, and the sanitizer config used for inline
 * paste.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BasePasteHandler } from '../../../../../../src/components/modules/paste/handlers/base';
import type { SanitizerConfigBuilder } from '../../../../../../src/components/modules/paste/sanitizer-config';
import type { ToolRegistry } from '../../../../../../src/components/modules/paste/tool-registry';
import type { PasteData } from '../../../../../../src/components/modules/paste/types';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { PasteEvent, PasteEventDetail } from '../../../../../../types';

/**
 * Concrete subclass: the protected members are BasePasteHandler's API to its
 * subclasses, and the only way to reach this file. The six private helpers are
 * exercised only through insertPasteData.
 */
class TestHandler extends BasePasteHandler {
  public canHandle(): number {
    return 0;
  }

  public async handle(): Promise<boolean> {
    return false;
  }

  public callComposePasteEvent(type: string, detail: PasteEventDetail): PasteEvent {
    return this.composePasteEvent(type, detail);
  }

  public callShouldReplaceCurrentBlock(toolName?: string): boolean {
    return this.shouldReplaceCurrentBlock(toolName);
  }

  public async callInsertPasteData(data: PasteData[], canReplace: boolean): Promise<void> {
    return this.insertPasteData(data, canReplace);
  }

  /** canReplace is forwarded as-is so `undefined` still exercises the default. */
  public async callInsertBlock(data: PasteData, canReplace?: boolean): Promise<void> {
    return this.insertBlock(data, canReplace);
  }

  public async callProcessSingleBlock(data: PasteData, canReplace: boolean): Promise<void> {
    return this.processSingleBlock(data, canReplace);
  }

  public async callProcessInlinePaste(data: PasteData, canReplace: boolean): Promise<void> {
    return this.processInlinePaste(data, canReplace);
  }
}

interface MockTool {
  isDefault: boolean;
  baseSanitizeConfig: Record<string, unknown>;
}

interface MockBlock {
  id: string;
  name: string;
  parentId: string | null;
  isEmpty: boolean;
  currentInput: HTMLElement | null;
  holder: HTMLElement;
  tool: MockTool;
}

interface PasteRecord {
  tool: string;
  replace: boolean;
  toolData: Record<string, unknown> | undefined;
  /** Value of operations.suppressStopCapturing at the moment paste() ran. */
  suppressed: boolean | undefined;
}

interface UpdateRecord {
  block: MockBlock;
  data: unknown;
  suppressed: boolean | undefined;
}

interface ParentRecord {
  block: MockBlock;
  parentId: string | null;
}

interface SetToBlockRecord {
  block: MockBlock | undefined;
  position: unknown;
}

const createMockBlock = (overrides: Partial<MockBlock> = {}): MockBlock => {
  const holder = document.createElement('div');
  const currentInput = document.createElement('div');

  holder.append(currentInput);

  return {
    id: 'current-block',
    name: 'paragraph',
    parentId: null,
    isEmpty: false,
    currentInput,
    holder,
    tool: { isDefault: true, baseSanitizeConfig: { b: true, i: true, a: { href: true } } },
    ...overrides,
  };
};

interface HarnessConfig {
  currentBlock?: MockBlock;
  /** Drop transactForTool from the mock to exercise the legacy fallback. */
  withTransactForTool?: boolean;
  /** Drop update() to exercise the "no list restamp available" path. */
  withUpdate?: boolean;
  /** Drop the undo-suppression bridge entirely. */
  withOperations?: boolean;
  /** parentId every freshly pasted block reports. */
  pastedBlockParentId?: string | null;
}

const createHarness = (config: HarnessConfig = {}): {
  handler: TestHandler;
  pasteCalls: PasteRecord[];
  updateCalls: UpdateRecord[];
  parentCalls: ParentRecord[];
  setToBlockCalls: SetToBlockRecord[];
  pastedBlocks: MockBlock[];
  updatedBlocks: MockBlock[];
  operations: { suppressStopCapturing: boolean } | undefined;
  transactForTool: ReturnType<typeof vi.fn>;
  setCurrentBlockByChildNode: ReturnType<typeof vi.fn>;
  insertContentAtCaretPosition: ReturnType<typeof vi.fn>;
  extractFragmentFromCaretPosition: ReturnType<typeof vi.fn>;
  endPosition: unknown;
} => {
  const pasteCalls: PasteRecord[] = [];
  const updateCalls: UpdateRecord[] = [];
  const parentCalls: ParentRecord[] = [];
  const setToBlockCalls: SetToBlockRecord[] = [];
  const pastedBlocks: MockBlock[] = [];
  const updatedBlocks: MockBlock[] = [];
  const endPosition = Symbol('caret-end');

  const operations = config.withOperations === false
    ? undefined
    : { suppressStopCapturing: false };

  const paste = vi.fn(async (
    tool: string,
    _event: PasteEvent,
    replace?: boolean,
    toolData?: Record<string, unknown>
  ): Promise<MockBlock> => {
    pasteCalls.push({
      tool,
      replace: replace === true,
      toolData,
      suppressed: operations?.suppressStopCapturing,
    });

    // transactForTool's close-boundary microtask flips this back; modelling it
    // is what makes a later `true` proof that suppression was re-asserted.
    if (operations !== undefined) {
      operations.suppressStopCapturing = false;
    }

    const block = createMockBlock({
      id: `pasted-${pastedBlocks.length + 1}`,
      name: tool,
      parentId: config.pastedBlockParentId ?? null,
    });

    pastedBlocks.push(block);

    return block;
  });

  const update = vi.fn(async (block: MockBlock, data: unknown): Promise<MockBlock> => {
    updateCalls.push({ block, data, suppressed: operations?.suppressStopCapturing });

    const updated = createMockBlock({
      id: `${block.id}-updated`,
      name: block.name,
      parentId: block.parentId,
    });

    updatedBlocks.push(updated);

    return updated;
  });

  const setBlockParent = vi.fn((block: MockBlock, parentId: string | null): void => {
    parentCalls.push({ block, parentId });
  });

  const setToBlock = vi.fn((block: MockBlock | undefined, position: unknown): void => {
    setToBlockCalls.push({ block, position });
  });

  const transactForTool = vi.fn((fn: () => void): void => {
    fn();
  });

  const setCurrentBlockByChildNode = vi.fn();
  const insertContentAtCaretPosition = vi.fn();
  const extractFragmentFromCaretPosition = vi.fn((): DocumentFragment | undefined => undefined);

  const blockManager: Record<string, unknown> = {
    currentBlock: config.currentBlock,
    paste,
    setBlockParent,
    setCurrentBlockByChildNode,
  };

  if (config.withTransactForTool !== false) {
    blockManager.transactForTool = transactForTool;
  }

  if (config.withUpdate !== false) {
    blockManager.update = update;
  }

  if (operations !== undefined) {
    blockManager.operations = operations;
  }

  const blok = {
    BlockManager: blockManager,
    Caret: {
      setToBlock,
      positions: { END: endPosition, START: Symbol('caret-start') },
      insertContentAtCaretPosition,
      extractFragmentFromCaretPosition,
    },
  } as unknown as BlokModules;

  return {
    handler: new TestHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder),
    pasteCalls,
    updateCalls,
    parentCalls,
    setToBlockCalls,
    pastedBlocks,
    updatedBlocks,
    operations,
    transactForTool,
    setCurrentBlockByChildNode,
    insertContentAtCaretPosition,
    extractFragmentFromCaretPosition,
    endPosition,
  };
};

const createItem = (
  tool: string,
  content: HTMLElement,
  isBlock: boolean,
  extra: Partial<PasteData> = {}
): PasteData => ({
  tool,
  content,
  isBlock,
  event: new CustomEvent('paste', { detail: { data: content } }),
  ...extra,
});

const textContent = (text: string): HTMLElement => {
  const element = document.createElement('div');

  element.textContent = text;

  return element;
};

const htmlContent = (html: string): HTMLElement => {
  const element = document.createElement('div');

  element.innerHTML = html;

  return element;
};

const listContent = (text: string, style: string, depth?: string): HTMLElement => {
  const element = textContent(text);

  element.setAttribute('data-blok-paste-list-style', style);

  if (depth !== undefined) {
    element.setAttribute('data-blok-paste-list-depth', depth);
  }

  return element;
};

const blockItem = (tool: string, text: string): PasteData => createItem(tool, textContent(text), true);
const inlineItem = (tool: string, text: string): PasteData => createItem(tool, textContent(text), false);

describe('BasePasteHandler — composePasteEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a CustomEvent carrying the given type and the SAME detail object', () => {
    const { handler } = createHarness({ currentBlock: createMockBlock() });
    const data = document.createElement('p');
    const detail: PasteEventDetail = { data };

    const event = handler.callComposePasteEvent('tag', detail);

    expect(event).toBeInstanceOf(CustomEvent);
    expect(event.type).toBe('tag');
    // Tools read event.detail.data; a copied or dropped detail silently empties the paste.
    expect(event.detail).toBe(detail);
  });
});

describe('BasePasteHandler — shouldReplaceCurrentBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to replace when there is no current block', () => {
    const { handler } = createHarness({});

    expect(handler.callShouldReplaceCurrentBlock('paragraph')).toBe(false);
  });

  it('replaces when the current block already uses the pasted tool, even if it is non-default and non-empty', () => {
    const currentBlock = createMockBlock({
      name: 'header',
      isEmpty: false,
      tool: { isDefault: false, baseSanitizeConfig: {} },
    });
    const { handler } = createHarness({ currentBlock });

    expect(handler.callShouldReplaceCurrentBlock('header')).toBe(true);
  });

  it('does NOT replace a non-default non-empty block whose name differs from the pasted tool', () => {
    const currentBlock = createMockBlock({
      name: 'paragraph',
      isEmpty: false,
      tool: { isDefault: false, baseSanitizeConfig: {} },
    });
    const { handler } = createHarness({ currentBlock });

    expect(handler.callShouldReplaceCurrentBlock('header')).toBe(false);
  });

  it('replaces an empty default block when no tool name is given', () => {
    const currentBlock = createMockBlock({
      isEmpty: true,
      tool: { isDefault: true, baseSanitizeConfig: {} },
    });
    const { handler } = createHarness({ currentBlock });

    expect(handler.callShouldReplaceCurrentBlock()).toBe(true);
  });

  it('does NOT replace a default block that still has content', () => {
    const currentBlock = createMockBlock({
      isEmpty: false,
      tool: { isDefault: true, baseSanitizeConfig: {} },
    });
    const { handler } = createHarness({ currentBlock });

    expect(handler.callShouldReplaceCurrentBlock()).toBe(false);
  });

  it('does NOT replace an empty NON-default block', () => {
    const currentBlock = createMockBlock({
      name: 'quote',
      isEmpty: true,
      tool: { isDefault: false, baseSanitizeConfig: {} },
    });
    const { handler } = createHarness({ currentBlock });

    expect(handler.callShouldReplaceCurrentBlock()).toBe(false);
  });
});

describe('BasePasteHandler — table-cell redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Builds tableHolder[data-blok-element] > [data-blok-tool=table] > cell? > blockHolder.
   */
  const buildTableFixture = (options: { withCell: boolean; withTableTool: boolean }): {
    tableHolder: HTMLElement;
    blockHolder: HTMLElement;
  } => {
    const tableHolder = document.createElement('div');

    tableHolder.setAttribute('data-blok-element', '');

    let deepest: HTMLElement = tableHolder;

    if (options.withTableTool) {
      const tableTool = document.createElement('div');

      tableTool.setAttribute('data-blok-tool', 'table');
      deepest.append(tableTool);
      deepest = tableTool;
    }

    if (options.withCell) {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell-blocks', '');
      deepest.append(cell);
      deepest = cell;
    }

    const blockHolder = document.createElement('div');

    deepest.append(blockHolder);

    return { tableHolder, blockHolder };
  };

  it('redirects the insertion point to the table block when a restricted tool is pasted inside a cell', async () => {
    const { tableHolder, blockHolder } = buildTableFixture({ withCell: true, withTableTool: true });
    const currentBlock = createMockBlock({ holder: blockHolder, isEmpty: true });
    const { handler, setCurrentBlockByChildNode } = createHarness({ currentBlock });

    await handler.callInsertPasteData([blockItem('header', 'H'), blockItem('paragraph', 'P')], false);

    expect(setCurrentBlockByChildNode).toHaveBeenCalledTimes(1);
    // Structural DOM equality would accept any same-shaped div, so pin the identity.
    expect(setCurrentBlockByChildNode.mock.calls[0][0]).toBe(tableHolder);
  });

  it('does NOT redirect when the paste inside a cell carries no restricted tool', async () => {
    const { blockHolder } = buildTableFixture({ withCell: true, withTableTool: true });
    const currentBlock = createMockBlock({ holder: blockHolder, isEmpty: true });
    const { handler, setCurrentBlockByChildNode } = createHarness({ currentBlock });

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], false);

    expect(setCurrentBlockByChildNode).not.toHaveBeenCalled();
  });

  it('does NOT redirect a restricted tool pasted inside a table that is NOT a cell', async () => {
    const { blockHolder } = buildTableFixture({ withCell: false, withTableTool: true });
    const currentBlock = createMockBlock({ holder: blockHolder, isEmpty: true });
    const { handler, setCurrentBlockByChildNode } = createHarness({ currentBlock });

    await handler.callInsertPasteData([blockItem('header', 'H'), blockItem('paragraph', 'P')], false);

    expect(setCurrentBlockByChildNode).not.toHaveBeenCalled();
  });

  it('does NOT redirect when the cell has no table block holder above it', async () => {
    const { blockHolder } = buildTableFixture({ withCell: true, withTableTool: false });
    const currentBlock = createMockBlock({ holder: blockHolder, isEmpty: true });
    const { handler, setCurrentBlockByChildNode } = createHarness({ currentBlock });

    await handler.callInsertPasteData([blockItem('header', 'H'), blockItem('paragraph', 'P')], false);

    expect(setCurrentBlockByChildNode).not.toHaveBeenCalled();
  });

  it('checks every pasted item for a restricted tool, not just the first', async () => {
    const { tableHolder, blockHolder } = buildTableFixture({ withCell: true, withTableTool: true });
    const currentBlock = createMockBlock({ holder: blockHolder, isEmpty: true });
    const { handler, setCurrentBlockByChildNode } = createHarness({ currentBlock });

    await handler.callInsertPasteData([blockItem('paragraph', 'P'), blockItem('table', 'T')], false);

    expect(setCurrentBlockByChildNode).toHaveBeenCalledTimes(1);
    expect(setCurrentBlockByChildNode.mock.calls[0][0]).toBe(tableHolder);
  });
});

describe('BasePasteHandler — insertPasteData dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing at all for an empty paste', async () => {
    const currentBlock = createMockBlock();
    const { handler, pasteCalls, insertContentAtCaretPosition, transactForTool } = createHarness({ currentBlock });

    await handler.callInsertPasteData([], false);

    expect(pasteCalls).toHaveLength(0);
    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(transactForTool).not.toHaveBeenCalled();
  });

  it('routes ONE inline item to the caret, never through the multi-block loop', async () => {
    const currentBlock = createMockBlock({ name: 'paragraph' });
    const { handler, pasteCalls, insertContentAtCaretPosition, transactForTool } = createHarness({ currentBlock });

    await handler.callInsertPasteData([createItem('paragraph', htmlContent('<b>one</b>'), false)], false);

    expect(pasteCalls).toHaveLength(0);
    expect(transactForTool).not.toHaveBeenCalled();
    expect(insertContentAtCaretPosition).toHaveBeenCalledTimes(1);
  });

  it('routes ONE inline item to the caret even when its tool differs from the current block', async () => {
    const currentBlock = createMockBlock({ name: 'paragraph' });
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({ currentBlock });

    await handler.callInsertPasteData([createItem('header', htmlContent('<b>one</b>'), false)], false);

    // Treating it as a block would compare tool names and insert a header block,
    // turning inline text into a new block of the wrong type.
    expect(pasteCalls).toHaveLength(0);
    expect(insertContentAtCaretPosition).toHaveBeenCalledTimes(1);
  });

  it('routes ONE block item of a different tool to insertBlock', async () => {
    const currentBlock = createMockBlock({ name: 'paragraph' });
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({ currentBlock });

    await handler.callInsertPasteData([blockItem('header', 'Heading')], false);

    expect(pasteCalls).toHaveLength(1);
    expect(pasteCalls[0].tool).toBe('header');
    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
  });

  it('inserts every item of a multi-item paste as its own block', async () => {
    const currentBlock = createMockBlock();
    const { handler, pasteCalls, transactForTool } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [blockItem('paragraph', 'A'), blockItem('paragraph', 'B'), blockItem('paragraph', 'C')],
      false
    );

    expect(pasteCalls.map((call) => call.tool)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(transactForTool).toHaveBeenCalledTimes(1);
  });

  it('forwards each item toolData to BlockManager.paste', async () => {
    const currentBlock = createMockBlock();
    const { handler, pasteCalls } = createHarness({ currentBlock });
    const seeded = createItem('column_list', textContent('C'), true, { toolData: { noSeed: true } });

    await handler.callInsertPasteData([seeded, blockItem('paragraph', 'P')], false);

    expect(pasteCalls[0].toolData).toStrictEqual({ noSeed: true });
    expect(pasteCalls[1].toolData).toBeUndefined();
  });

  it('moves the caret to each freshly pasted block, then back to the current block', async () => {
    const currentBlock = createMockBlock();
    const { handler, setToBlockCalls, pastedBlocks, endPosition } = createHarness({ currentBlock });

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], false);

    expect(setToBlockCalls).toHaveLength(3);
    expect(setToBlockCalls[0].block).toBe(pastedBlocks[0]);
    expect(setToBlockCalls[0].position).toBe(endPosition);
    expect(setToBlockCalls[1].block).toBe(pastedBlocks[1]);
    expect(setToBlockCalls[2].block).toBe(currentBlock);
  });

  it('does not touch the caret at the end when there is no current block', async () => {
    const { handler, setToBlockCalls, pastedBlocks } = createHarness({});

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], false);

    expect(setToBlockCalls).toHaveLength(2);
    expect(setToBlockCalls[0].block).toBe(pastedBlocks[0]);
    expect(setToBlockCalls[1].block).toBe(pastedBlocks[1]);
  });

  it('still inserts every block when BlockManager has no transactForTool', async () => {
    const currentBlock = createMockBlock();
    const { handler, pasteCalls } = createHarness({ currentBlock, withTransactForTool: false });

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], false);

    expect(pasteCalls).toHaveLength(2);
  });

  it('keeps undo suppression asserted on every loop iteration', async () => {
    const currentBlock = createMockBlock();
    const { handler, pasteCalls, operations } = createHarness({ currentBlock });

    expect(operations?.suppressStopCapturing).toBe(false);

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], false);

    expect(pasteCalls.map((call) => call.suppressed)).toEqual([true, true]);
  });

  it('inserts blocks even when BlockManager exposes no operations bridge', async () => {
    const currentBlock = createMockBlock();
    const { handler, pasteCalls } = createHarness({ currentBlock, withOperations: false });

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], false);

    expect(pasteCalls.map((call) => call.suppressed)).toEqual([undefined, undefined]);
  });
});

describe('BasePasteHandler — replacing the current block on a multi-item paste', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces the empty current block with the FIRST pasted block only', async () => {
    const currentBlock = createMockBlock({ isEmpty: true });
    const { handler, pasteCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], true);

    expect(pasteCalls.map((call) => call.replace)).toEqual([true, false]);
  });

  it('never replaces when the caller did not allow it', async () => {
    const currentBlock = createMockBlock({ isEmpty: true });
    const { handler, pasteCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], false);

    expect(pasteCalls.map((call) => call.replace)).toEqual([false, false]);
  });

  it('never replaces when there is no current block at all', async () => {
    const { handler, pasteCalls } = createHarness({});

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], true);

    expect(pasteCalls.map((call) => call.replace)).toEqual([false, false]);
  });

  it('never replaces a current block that still holds content', async () => {
    const currentBlock = createMockBlock({ isEmpty: false });
    const { handler, pasteCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], true);

    expect(pasteCalls.map((call) => call.replace)).toEqual([false, false]);
  });

  it('replaces an EMPTY list item when the pasted content carries a list style, even without the caller flag', async () => {
    const currentBlock = createMockBlock({ name: 'list', isEmpty: true });
    const { handler, pasteCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [
        createItem('list', listContent('one', 'unordered'), true),
        createItem('list', listContent('two', 'unordered'), true),
      ],
      false
    );

    expect(pasteCalls.map((call) => call.replace)).toEqual([true, false]);
  });

  it('does NOT grant the list-item replace to a non-list target', async () => {
    const currentBlock = createMockBlock({ name: 'paragraph', isEmpty: true });
    const { handler, pasteCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [
        createItem('list', listContent('one', 'unordered'), true),
        createItem('list', listContent('two', 'unordered'), true),
      ],
      false
    );

    expect(pasteCalls.map((call) => call.replace)).toEqual([false, false]);
  });

  it('does NOT grant the list-item replace to a NON-empty list target', async () => {
    const currentBlock = createMockBlock({ name: 'list', isEmpty: false });
    const { handler, pasteCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [
        createItem('list', listContent('one', 'unordered'), true),
        createItem('list', listContent('two', 'unordered'), true),
      ],
      false
    );

    expect(pasteCalls.map((call) => call.replace)).toEqual([false, false]);
  });

  it('does NOT grant the list-item replace when the pasted content carries no list style', async () => {
    const currentBlock = createMockBlock({ name: 'list', isEmpty: true });
    const { handler, pasteCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData([blockItem('list', 'one'), blockItem('list', 'two')], false);

    expect(pasteCalls.map((call) => call.replace)).toEqual([false, false]);
  });
});

describe('BasePasteHandler — inherited list style on pasted blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['ordered', 'unordered', 'checklist'])(
    'restamps a pasted block with the inherited %s list style',
    async (style) => {
      const currentBlock = createMockBlock();
      const { handler, updateCalls, pastedBlocks } = createHarness({ currentBlock });

      await handler.callInsertPasteData(
        [
          createItem('list', listContent('one', style), true),
          createItem('list', listContent('two', style), true),
        ],
        false
      );

      expect(updateCalls).toHaveLength(2);
      expect(updateCalls[0].block).toBe(pastedBlocks[0]);
      expect(updateCalls[0].data).toStrictEqual({ style, depth: 0, checked: false });
    }
  );

  it('carries the inherited nesting depth', async () => {
    const currentBlock = createMockBlock();
    const { handler, updateCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [
        createItem('list', listContent('one', 'ordered', '3'), true),
        createItem('list', listContent('two', 'ordered', '3'), true),
      ],
      false
    );

    expect(updateCalls[0].data).toStrictEqual({ style: 'ordered', depth: 3, checked: false });
  });

  it('clamps an unparsable or negative depth to zero', async () => {
    const currentBlock = createMockBlock();
    const { handler, updateCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [
        createItem('list', listContent('one', 'ordered', 'not-a-number'), true),
        createItem('list', listContent('two', 'ordered', '-2'), true),
      ],
      false
    );

    expect(updateCalls[0].data).toStrictEqual({ style: 'ordered', depth: 0, checked: false });
    expect(updateCalls[1].data).toStrictEqual({ style: 'ordered', depth: 0, checked: false });
  });

  it('leaves the caret on the block update() returned, not the pre-update one', async () => {
    const currentBlock = createMockBlock();
    const { handler, setToBlockCalls, updatedBlocks, pastedBlocks } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [
        createItem('list', listContent('one', 'unordered'), true),
        createItem('list', listContent('two', 'unordered'), true),
      ],
      false
    );

    expect(setToBlockCalls[0].block).toBe(updatedBlocks[0]);
    expect(setToBlockCalls[0].block).not.toBe(pastedBlocks[0]);
  });

  it('does NOT restamp a pasted block whose content carries an unknown list style', async () => {
    const currentBlock = createMockBlock();
    const { handler, updateCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [
        createItem('list', listContent('one', 'roman'), true),
        createItem('list', listContent('two', 'roman'), true),
      ],
      false
    );

    expect(updateCalls).toHaveLength(0);
  });

  it('does NOT restamp when the pasted content carries no list attributes at all', async () => {
    const currentBlock = createMockBlock();
    const { handler, updateCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], false);

    expect(updateCalls).toHaveLength(0);
  });

  it('asserts undo suppression again before restamping', async () => {
    const currentBlock = createMockBlock();
    const { handler, updateCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [
        createItem('list', listContent('one', 'unordered'), true),
        createItem('list', listContent('two', 'unordered'), true),
      ],
      false
    );

    expect(updateCalls.map((call) => call.suppressed)).toEqual([true, true]);
  });

  it('restamps without an operations bridge present', async () => {
    const currentBlock = createMockBlock();
    const { handler, updateCalls } = createHarness({ currentBlock, withOperations: false });

    await handler.callInsertPasteData(
      [
        createItem('list', listContent('one', 'unordered'), true),
        createItem('list', listContent('two', 'unordered'), true),
      ],
      false
    );

    expect(updateCalls).toHaveLength(2);
  });

  it('keeps the pasted block when BlockManager cannot update', async () => {
    const currentBlock = createMockBlock();
    const { handler, setToBlockCalls, pastedBlocks } = createHarness({ currentBlock, withUpdate: false });

    await handler.callInsertPasteData(
      [
        createItem('list', listContent('one', 'unordered'), true),
        createItem('list', listContent('two', 'unordered'), true),
      ],
      false
    );

    expect(setToBlockCalls[0].block).toBe(pastedBlocks[0]);
    expect(setToBlockCalls[1].block).toBe(pastedBlocks[1]);
  });
});

describe('BasePasteHandler — parent wiring of pasted blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parents a pasted block to an earlier block of the same paste batch', async () => {
    const currentBlock = createMockBlock();
    const { handler, parentCalls, pastedBlocks } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [
        blockItem('column_list', 'container'),
        createItem('paragraph', textContent('child'), true, { parentPasteIndex: 0 }),
      ],
      false
    );

    expect(parentCalls).toHaveLength(1);
    expect(parentCalls[0].block).toBe(pastedBlocks[1]);
    expect(parentCalls[0].parentId).toBe(pastedBlocks[0].id);
  });

  it('does not parent when the referenced batch index produced no block', async () => {
    const currentBlock = createMockBlock();
    const { handler, parentCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [
        blockItem('paragraph', 'first'),
        createItem('paragraph', textContent('child'), true, { parentPasteIndex: 7 }),
      ],
      false
    );

    expect(parentCalls).toHaveLength(0);
  });

  it('parents every flat block to the container when the caret sits in a container title', async () => {
    const holder = document.createElement('div');
    const currentInput = document.createElement('div');
    const children = document.createElement('div');

    children.setAttribute('data-blok-toggle-children', '');
    holder.append(currentInput, children);

    const currentBlock = createMockBlock({
      id: 'toggle-1',
      name: 'toggle',
      holder,
      currentInput,
      parentId: null,
    });
    const { handler, parentCalls, pastedBlocks } = createHarness({ currentBlock });

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], false);

    expect(parentCalls.map((call) => call.parentId)).toEqual(['toggle-1', 'toggle-1']);
    expect(parentCalls[0].block).toBe(pastedBlocks[0]);
  });

  it('parents blocks to the container when the caret sits in a container CHILD', async () => {
    const children = document.createElement('div');

    children.setAttribute('data-blok-toggle-children', '');

    const holder = document.createElement('div');
    const currentInput = document.createElement('div');

    holder.append(currentInput);
    children.append(holder);

    const currentBlock = createMockBlock({
      id: 'child-1',
      holder,
      currentInput,
      parentId: 'toggle-1',
    });
    const { handler, parentCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], false);

    expect(parentCalls.map((call) => call.parentId)).toEqual(['toggle-1', 'toggle-1']);
  });

  it('clears a parent inherited from the predecessor when pasting at root level', async () => {
    const currentBlock = createMockBlock({ parentId: null });
    const { handler, parentCalls, pastedBlocks } = createHarness({
      currentBlock,
      pastedBlockParentId: 'stale-parent',
    });

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], false);

    expect(parentCalls.map((call) => call.parentId)).toEqual([null, null]);
    expect(parentCalls[0].block).toBe(pastedBlocks[0]);
  });

  it('leaves a root-level pasted block alone when it already has no parent', async () => {
    const currentBlock = createMockBlock({ parentId: null });
    const { handler, parentCalls } = createHarness({ currentBlock, pastedBlockParentId: null });

    await handler.callInsertPasteData([blockItem('paragraph', 'A'), blockItem('paragraph', 'B')], false);

    expect(parentCalls).toHaveLength(0);
  });
});

describe('BasePasteHandler — caret split of a multi-line plain-text paste', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges the first line at the caret and carries the post-caret remainder onto the last line', async () => {
    const currentBlock = createMockBlock({ isEmpty: false });
    const { handler, pasteCalls, insertContentAtCaretPosition, extractFragmentFromCaretPosition } =
      createHarness({ currentBlock });

    const remainder = document.createDocumentFragment();

    remainder.append(document.createTextNode('Tail'));
    extractFragmentFromCaretPosition.mockReturnValue(remainder);

    const data = [inlineItem('paragraph', 'First'), inlineItem('paragraph', 'Second'), inlineItem('paragraph', 'Third')];

    await handler.callInsertPasteData(data, false);

    expect(insertContentAtCaretPosition).toHaveBeenCalledTimes(1);
    expect(insertContentAtCaretPosition.mock.calls[0][0]).toContain('First');
    expect(pasteCalls).toHaveLength(2);
    expect(data[2].content.textContent).toBe('ThirdTail');
    expect(data[1].content.textContent).toBe('Second');
  });

  it('leaves the last line untouched when the caret had no post-caret remainder', async () => {
    const currentBlock = createMockBlock({ isEmpty: false });
    const { handler, extractFragmentFromCaretPosition } = createHarness({ currentBlock });

    extractFragmentFromCaretPosition.mockReturnValue(undefined);

    const data = [inlineItem('paragraph', 'First'), inlineItem('paragraph', 'Second')];

    await handler.callInsertPasteData(data, false);

    expect(data[1].content.textContent).toBe('Second');
  });

  it('does NOT caret-split a multi-item paste of BLOCK content', async () => {
    const currentBlock = createMockBlock({ isEmpty: false });
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [blockItem('paragraph', 'A'), blockItem('paragraph', 'B'), blockItem('paragraph', 'C')],
      false
    );

    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(pasteCalls).toHaveLength(3);
  });

  it('does NOT caret-split when only SOME items are inline', async () => {
    const currentBlock = createMockBlock({ isEmpty: false });
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({ currentBlock });

    await handler.callInsertPasteData([inlineItem('paragraph', 'A'), blockItem('paragraph', 'B')], false);

    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(pasteCalls).toHaveLength(2);
  });

  it('does NOT caret-split into an EMPTY current block', async () => {
    const currentBlock = createMockBlock({ isEmpty: true });
    const { handler, pasteCalls, insertContentAtCaretPosition, extractFragmentFromCaretPosition } =
      createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [inlineItem('paragraph', 'A'), inlineItem('paragraph', 'B'), inlineItem('paragraph', 'C')],
      false
    );

    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(extractFragmentFromCaretPosition).not.toHaveBeenCalled();
    expect(pasteCalls).toHaveLength(3);
  });

  it('does NOT caret-split when the current block has no editable input', async () => {
    const currentBlock = createMockBlock({ isEmpty: false, currentInput: null });
    const { handler, pasteCalls, insertContentAtCaretPosition, extractFragmentFromCaretPosition } =
      createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [inlineItem('paragraph', 'A'), inlineItem('paragraph', 'B'), inlineItem('paragraph', 'C')],
      false
    );

    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    // Splitting here would tear the block open before falling back to a block
    // insert, so the paste would still look right while the caret content moved.
    expect(extractFragmentFromCaretPosition).not.toHaveBeenCalled();
    expect(pasteCalls).toHaveLength(3);
  });

  it('does NOT caret-split when there is no current block', async () => {
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({});

    await handler.callInsertPasteData(
      [inlineItem('paragraph', 'A'), inlineItem('paragraph', 'B'), inlineItem('paragraph', 'C')],
      false
    );

    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(pasteCalls).toHaveLength(3);
  });

  it('does NOT caret-split when the caret is in a container title', async () => {
    const holder = document.createElement('div');
    const currentInput = document.createElement('div');
    const children = document.createElement('div');

    children.setAttribute('data-blok-toggle-children', '');
    holder.append(currentInput, children);

    const currentBlock = createMockBlock({ id: 'toggle-1', name: 'toggle', holder, currentInput, isEmpty: false });
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [inlineItem('paragraph', 'A'), inlineItem('paragraph', 'B'), inlineItem('paragraph', 'C')],
      false
    );

    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(pasteCalls).toHaveLength(3);
  });

  it('does NOT caret-split when the caret is inside a container child', async () => {
    const children = document.createElement('div');

    children.setAttribute('data-blok-toggle-children', '');

    const holder = document.createElement('div');
    const currentInput = document.createElement('div');

    holder.append(currentInput);
    children.append(holder);

    const currentBlock = createMockBlock({ holder, currentInput, isEmpty: false, parentId: 'toggle-1' });
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [inlineItem('paragraph', 'A'), inlineItem('paragraph', 'B'), inlineItem('paragraph', 'C')],
      false
    );

    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(pasteCalls).toHaveLength(3);
  });

  it('DOES caret-split when the editable input lives inside the block own children region', async () => {
    // The title check must compare the caret against the region, not merely note
    // that the block owns one; a block editing inside its own region is not a title.
    const holder = document.createElement('div');
    const children = document.createElement('div');
    const currentInput = document.createElement('div');

    children.setAttribute('data-blok-toggle-children', '');
    children.append(currentInput);
    holder.append(children);

    const currentBlock = createMockBlock({ holder, currentInput, isEmpty: false });
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [inlineItem('paragraph', 'A'), inlineItem('paragraph', 'B'), inlineItem('paragraph', 'C')],
      false
    );

    expect(insertContentAtCaretPosition).toHaveBeenCalledTimes(1);
    expect(pasteCalls).toHaveLength(2);
  });

  it('drops the empty lead of a newline-prefixed paste instead of merging it', async () => {
    const currentBlock = createMockBlock({ isEmpty: false });
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [inlineItem('paragraph', ''), inlineItem('paragraph', 'Second'), inlineItem('paragraph', 'Third')],
      false
    );

    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(pasteCalls).toHaveLength(2);
  });

  it('treats a whitespace-only lead as an empty lead', async () => {
    const currentBlock = createMockBlock({ isEmpty: false });
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [inlineItem('paragraph', '   '), inlineItem('paragraph', 'Second'), inlineItem('paragraph', 'Third')],
      false
    );

    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(pasteCalls).toHaveLength(2);
  });

  it('does NOT drop the first item of a BLOCK paste whose first block is empty', async () => {
    const currentBlock = createMockBlock({ isEmpty: false });
    const { handler, pasteCalls } = createHarness({ currentBlock });

    await handler.callInsertPasteData(
      [blockItem('image', ''), blockItem('paragraph', 'B'), blockItem('paragraph', 'C')],
      false
    );

    expect(pasteCalls.map((call) => call.tool)).toEqual(['image', 'paragraph', 'paragraph']);
  });
});

describe('BasePasteHandler — insertBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces the empty current block when the caller allows it', async () => {
    const currentBlock = createMockBlock({ isEmpty: true });
    const { handler, pasteCalls, setToBlockCalls, pastedBlocks, endPosition } = createHarness({ currentBlock });

    await handler.callInsertBlock(blockItem('header', 'H'), true);

    expect(pasteCalls).toHaveLength(1);
    expect(pasteCalls[0].replace).toBe(true);
    expect(setToBlockCalls).toHaveLength(1);
    expect(setToBlockCalls[0].block).toBe(pastedBlocks[0]);
    expect(setToBlockCalls[0].position).toBe(endPosition);
  });

  it('defaults to NOT replacing when the caller passes no flag', async () => {
    const currentBlock = createMockBlock({ isEmpty: true });
    const { handler, pasteCalls } = createHarness({ currentBlock });

    await handler.callInsertBlock(blockItem('header', 'H'));

    expect(pasteCalls[0].replace).toBe(false);
  });

  it('does not replace a current block that still holds content', async () => {
    const currentBlock = createMockBlock({ isEmpty: false });
    const { handler, pasteCalls, setToBlockCalls, pastedBlocks } = createHarness({ currentBlock });

    await handler.callInsertBlock(blockItem('header', 'H'), true);

    expect(pasteCalls[0].replace).toBe(false);
    expect(setToBlockCalls).toHaveLength(1);
    expect(setToBlockCalls[0].block).toBe(pastedBlocks[0]);
  });

  it('does not replace when there is no current block', async () => {
    const { handler, pasteCalls } = createHarness({});

    await handler.callInsertBlock(blockItem('header', 'H'), true);

    expect(pasteCalls[0].replace).toBe(false);
  });

  it('forwards the tool name and initial tool data', async () => {
    const currentBlock = createMockBlock({ isEmpty: false });
    const { handler, pasteCalls } = createHarness({ currentBlock });

    await handler.callInsertBlock(createItem('column', textContent('c'), true, { toolData: { noSeed: true } }), false);

    expect(pasteCalls[0].tool).toBe('column');
    expect(pasteCalls[0].toolData).toStrictEqual({ noSeed: true });
  });
});

describe('BasePasteHandler — processSingleBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges inline-only content into a block of the same tool', async () => {
    const currentBlock = createMockBlock({ name: 'paragraph' });
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({ currentBlock });

    await handler.callProcessSingleBlock(createItem('paragraph', htmlContent('<b>inline</b>'), true), false);

    expect(pasteCalls).toHaveLength(0);
    expect(insertContentAtCaretPosition).toHaveBeenCalledTimes(1);
    expect(insertContentAtCaretPosition.mock.calls[0][0]).toBe('<b>inline</b>');
  });

  it('inserts a new block when the pasted tool differs from the current block', async () => {
    const currentBlock = createMockBlock({ name: 'paragraph' });
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({ currentBlock });

    await handler.callProcessSingleBlock(createItem('header', htmlContent('<b>inline</b>'), true), false);

    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(pasteCalls).toHaveLength(1);
    expect(pasteCalls[0].tool).toBe('header');
  });

  it('inserts a new block when the same-tool content carries block-level markup', async () => {
    const currentBlock = createMockBlock({ name: 'paragraph' });
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({ currentBlock });

    await handler.callProcessSingleBlock(createItem('paragraph', htmlContent('<p>one</p><p>two</p>'), true), false);

    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(pasteCalls).toHaveLength(1);
  });

  it('inserts a new block when there is no current block', async () => {
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({});

    await handler.callProcessSingleBlock(createItem('paragraph', htmlContent('<b>inline</b>'), true), false);

    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(pasteCalls).toHaveLength(1);
  });

  it('passes the replace flag through to insertBlock', async () => {
    const currentBlock = createMockBlock({ name: 'paragraph', isEmpty: true });
    const { handler, pasteCalls } = createHarness({ currentBlock });

    await handler.callProcessSingleBlock(blockItem('header', 'H'), true);

    expect(pasteCalls[0].replace).toBe(true);
  });
});

describe('BasePasteHandler — processInlinePaste', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sanitizes the pasted HTML with the CURRENT block tool config before inserting it', async () => {
    const currentBlock = createMockBlock({
      tool: { isDefault: true, baseSanitizeConfig: { b: true } },
    });
    const { handler, insertContentAtCaretPosition } = createHarness({ currentBlock });

    await handler.callProcessInlinePaste(
      createItem('paragraph', htmlContent('<b>keep</b><i>drop</i>'), false),
      false
    );

    expect(insertContentAtCaretPosition).toHaveBeenCalledTimes(1);

    const inserted = insertContentAtCaretPosition.mock.calls[0][0];

    // A wrong (or absent) config either strips allowed markup or lets denied markup through.
    expect(inserted).toContain('<b>keep</b>');
    expect(inserted).not.toContain('<i>');
    expect(inserted).toContain('drop');
  });

  it('inserts a block instead when the current block has no editable input', async () => {
    const currentBlock = createMockBlock({ currentInput: null, isEmpty: true });
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({ currentBlock });

    await handler.callProcessInlinePaste(createItem('paragraph', htmlContent('<b>x</b>'), false), true);

    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(pasteCalls).toHaveLength(1);
    expect(pasteCalls[0].replace).toBe(true);
  });

  it('inserts a block instead when there is no current block', async () => {
    const { handler, pasteCalls, insertContentAtCaretPosition } = createHarness({});

    await handler.callProcessInlinePaste(createItem('paragraph', htmlContent('<b>x</b>'), false), false);

    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(pasteCalls).toHaveLength(1);
  });
});
