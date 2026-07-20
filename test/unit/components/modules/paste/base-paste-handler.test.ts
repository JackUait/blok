/**
 * Regression tests for BasePasteHandler.insertPasteData multi-item paste
 * undo grouping.
 *
 * Multi-item paste must land in a SINGLE Yjs undo entry so that Cmd+Z
 * removes every block created by the paste in one step. The handler must:
 *   1. Wrap the multi-item loop in BlockManager.transactForTool
 *   2. Not call YjsManager.stopCapturing between iterations
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BasePasteHandler } from '../../../../../src/components/modules/paste/handlers/base';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';
import type { PasteData } from '../../../../../src/components/modules/paste/types';

class TestHandler extends BasePasteHandler {
  public canHandle(): number {
    return 0;
  }
  public async handle(): Promise<boolean> {
    return false;
  }

  public async callInsertPasteData(data: PasteData[], canReplace: boolean): Promise<void> {
    return this.insertPasteData(data, canReplace);
  }
}

const createPasteItem = (tool: string, text: string): PasteData => {
  const content = document.createElement('div');

  content.textContent = text;

  return {
    tool,
    content,
    isBlock: true,
    event: new CustomEvent('paste', { detail: { data: content } }),
  };
};

const createBlok = (): {
  blok: BlokModules;
  pasteMock: ReturnType<typeof vi.fn>;
  setBlockParentMock: ReturnType<typeof vi.fn>;
  transactForToolMock: ReturnType<typeof vi.fn>;
  stopCapturingMock: ReturnType<typeof vi.fn>;
} => {
  let blockCounter = 0;
  const pasteMock = vi.fn(async (toolName: string) => {
    blockCounter++;
    return {
      id: `block-${blockCounter}`,
      name: toolName,
      parentId: null,
      holder: document.createElement('div'),
      isEmpty: false,
    };
  });
  const setBlockParentMock = vi.fn();
  const transactForToolMock = vi.fn((fn: () => void) => fn());
  const stopCapturingMock = vi.fn();

  const blok = {
    BlockManager: {
      currentBlock: null,
      paste: pasteMock,
      setBlockParent: setBlockParentMock,
      transactForTool: transactForToolMock,
      setCurrentBlockByChildNode: vi.fn(),
    },
    Caret: {
      setToBlock: vi.fn(),
      positions: { END: 'end' },
      insertContentAtCaretPosition: vi.fn(),
    },
    YjsManager: {
      stopCapturing: stopCapturingMock,
    },
  } as unknown as BlokModules;

  return { blok, pasteMock, setBlockParentMock, transactForToolMock, stopCapturingMock };
};

const createInlinePasteItem = (tool: string, text: string): PasteData => {
  const content = document.createElement('div');

  content.textContent = text;

  return {
    tool,
    content,
    isBlock: false,
    event: new CustomEvent('paste', { detail: { data: content } }),
  };
};

describe('BasePasteHandler — multi-line plain-text paste into a non-empty block (caret split)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges the first line at the caret and carries the post-caret remainder onto the last line', async () => {
    const { blok, pasteMock, transactForToolMock } = createBlok();

    // A non-empty current block whose caret splits "ThisIs|Here": the
    // post-caret remainder is "Here".
    const remainderFragment = document.createDocumentFragment();

    remainderFragment.append(document.createTextNode('Here'));

    const currentInput = document.createElement('div');
    const currentBlock = {
      id: 'current',
      name: 'paragraph',
      parentId: null,
      isEmpty: false,
      currentInput,
      holder: document.createElement('div'),
      tool: { baseSanitizeConfig: {} },
    };

    const blokModules = blok as unknown as {
      BlockManager: { currentBlock: typeof currentBlock };
      Caret: {
        insertContentAtCaretPosition: ReturnType<typeof vi.fn>;
        extractFragmentFromCaretPosition: ReturnType<typeof vi.fn>;
      };
    };

    blokModules.BlockManager.currentBlock = currentBlock;
    blokModules.Caret.extractFragmentFromCaretPosition = vi.fn(() => remainderFragment);

    const handler = new TestHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder);

    const data: PasteData[] = [
      createInlinePasteItem('paragraph', 'First'),
      createInlinePasteItem('paragraph', 'Second'),
      createInlinePasteItem('paragraph', 'Third'),
    ];

    await handler.callInsertPasteData(data, false);

    // First line merged inline into the current block at the caret.
    expect(blokModules.Caret.insertContentAtCaretPosition).toHaveBeenCalledTimes(1);
    expect(blokModules.Caret.insertContentAtCaretPosition.mock.calls[0][0]).toContain('First');

    // The post-caret remainder was extracted from the current block.
    expect(blokModules.Caret.extractFragmentFromCaretPosition).toHaveBeenCalledTimes(1);

    // Only the middle + last lines become new blocks (the first merged inline).
    expect(pasteMock).toHaveBeenCalledTimes(2);

    // The remainder rides with the LAST pasted segment.
    expect(data[2].content.textContent).toBe('ThirdHere');

    // Still grouped into a single undo entry.
    expect(transactForToolMock).toHaveBeenCalledTimes(1);
  });
});

describe('BasePasteHandler — caret split is suppressed in container / newline-prefixed contexts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildHandler = (currentBlock: Record<string, unknown>): {
    handler: TestHandler;
    pasteMock: ReturnType<typeof vi.fn>;
    caret: {
      insertContentAtCaretPosition: ReturnType<typeof vi.fn>;
      extractFragmentFromCaretPosition: ReturnType<typeof vi.fn>;
    };
  } => {
    const { blok, pasteMock } = createBlok();

    const blokModules = blok as unknown as {
      BlockManager: { currentBlock: Record<string, unknown> };
      Caret: {
        insertContentAtCaretPosition: ReturnType<typeof vi.fn>;
        extractFragmentFromCaretPosition: ReturnType<typeof vi.fn>;
      };
    };

    blokModules.BlockManager.currentBlock = currentBlock;
    blokModules.Caret.extractFragmentFromCaretPosition = vi.fn(() => document.createDocumentFragment());

    const handler = new TestHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder);

    return { handler, pasteMock, caret: blokModules.Caret };
  };

  it('does NOT caret-merge the first line when the caret is inside a container child (toggle child)', async () => {
    // currentBlock.holder lives inside a [data-blok-toggle-children] region, so the
    // pasted lines must land in the container, not merge into the clicked child.
    const childrenContainer = document.createElement('div');

    childrenContainer.setAttribute('data-blok-toggle-children', '');

    const childHolder = document.createElement('div');

    childrenContainer.append(childHolder);

    const currentInput = document.createElement('div');

    childHolder.append(currentInput);

    const { handler, pasteMock, caret } = buildHandler({
      id: 'child',
      name: 'paragraph',
      parentId: 'toggle-1',
      isEmpty: false,
      currentInput,
      holder: childHolder,
      tool: { baseSanitizeConfig: {} },
    });

    const data: PasteData[] = [
      createInlinePasteItem('paragraph', 'First'),
      createInlinePasteItem('paragraph', 'Second'),
      createInlinePasteItem('paragraph', 'Third'),
    ];

    await handler.callInsertPasteData(data, false);

    // No inline merge — all three lines become separate blocks.
    expect(caret.insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(caret.extractFragmentFromCaretPosition).not.toHaveBeenCalled();
    expect(pasteMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT caret-merge the first line when the caret is in a container title', async () => {
    // The toggle title block itself owns the [data-blok-toggle-children] region;
    // the caret (currentInput) is in the title, outside that region.
    const holder = document.createElement('div');
    const currentInput = document.createElement('div');

    holder.append(currentInput);

    const childrenContainer = document.createElement('div');

    childrenContainer.setAttribute('data-blok-toggle-children', '');
    holder.append(childrenContainer);

    const { handler, pasteMock, caret } = buildHandler({
      id: 'toggle-1',
      name: 'toggle',
      parentId: null,
      isEmpty: false,
      currentInput,
      holder,
      tool: { baseSanitizeConfig: {} },
    });

    const data: PasteData[] = [
      createInlinePasteItem('paragraph', 'First'),
      createInlinePasteItem('paragraph', 'Second'),
      createInlinePasteItem('paragraph', 'Third'),
    ];

    await handler.callInsertPasteData(data, false);

    expect(caret.insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(caret.extractFragmentFromCaretPosition).not.toHaveBeenCalled();
    expect(pasteMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT caret-merge and drops the empty lead when the paste is newline-prefixed (empty first segment)', async () => {
    const holder = document.createElement('div');
    const currentInput = document.createElement('div');

    holder.append(currentInput);

    const { handler, pasteMock, caret } = buildHandler({
      id: 'existing',
      name: 'paragraph',
      parentId: null,
      isEmpty: false,
      currentInput,
      holder,
      tool: { baseSanitizeConfig: {} },
    });

    // Leading empty segment models a paste that began with a newline.
    const data: PasteData[] = [
      createInlinePasteItem('paragraph', ''),
      createInlinePasteItem('paragraph', 'Second block'),
      createInlinePasteItem('paragraph', 'Third block'),
    ];

    await handler.callInsertPasteData(data, false);

    // No inline merge, and the empty lead is dropped: only the two real lines
    // become new blocks.
    expect(caret.insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(caret.extractFragmentFromCaretPosition).not.toHaveBeenCalled();
    expect(pasteMock).toHaveBeenCalledTimes(2);
  });
});

describe('BasePasteHandler — multi-item paste undo grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wraps the multi-item paste loop in BlockManager.transactForTool so one Cmd+Z undoes the whole paste', async () => {  
    const { blok, transactForToolMock, pasteMock } = createBlok();
    const handler = new TestHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder);

    const data: PasteData[] = [
      createPasteItem('paragraph', 'First'),
      createPasteItem('paragraph', 'Second'),
      createPasteItem('paragraph', 'Third'),
    ];

    await handler.callInsertPasteData(data, false);

    expect(transactForToolMock).toHaveBeenCalledTimes(1);
    // All three pastes happened — the bug being fixed is about grouping,
    // not insertion, so the block count must stay correct.
    expect(pasteMock).toHaveBeenCalledTimes(3);
  });

  it('does not call YjsManager.stopCapturing between pasted items', async () => {
    // The old implementation called YjsManager.stopCapturing() at the top of
    // every loop iteration to force separate undo entries. With the fix, the
    // handler must leave grouping to transactForTool and never fire an
    // explicit stopCapturing itself.
    const { blok, stopCapturingMock } = createBlok();
    const handler = new TestHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder);

    const data: PasteData[] = [
      createPasteItem('paragraph', 'First'),
      createPasteItem('paragraph', 'Second'),
      createPasteItem('paragraph', 'Third'),
    ];

    await handler.callInsertPasteData(data, false);

    // The mock transactForTool is `(fn) => fn()`, which does not emit any
    // boundary stopCapturing calls. Any invocation recorded here therefore
    // originated from the handler code itself — which the fix removes.
    expect(stopCapturingMock).not.toHaveBeenCalled();
  });
});
