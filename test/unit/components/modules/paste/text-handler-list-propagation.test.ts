/**
 * Notion-parity (M-13, M-14, M-15, m-16, M-17): pasting multi-line PLAIN text
 * into a list item must propagate the target item's list style + depth to the
 * continuation blocks instead of inserting default paragraphs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TextHandler } from '../../../../../src/components/modules/paste/handlers/text-handler';
import type { BlokConfig } from '../../../../../types/configs/blok-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';

interface ListData {
  text?: string;
  style?: 'ordered' | 'unordered' | 'checklist';
  depth?: number;
  checked?: boolean;
}

interface CapturedPaste {
  tool: string;
  replace: boolean;
  content: HTMLElement;
}

const createBlok = (currentBlock: unknown): {
  blok: BlokModules;
  pasteCalls: CapturedPaste[];
  updateCalls: Array<{ data: Record<string, unknown> }>;
} => {
  const pasteCalls: CapturedPaste[] = [];
  const updateCalls: Array<{ data: Record<string, unknown> }> = [];
  let counter = 0;

  const pasteMock = vi.fn(async (tool: string, event: { detail: { data: HTMLElement } }, replace = false) => {
    counter++;
    pasteCalls.push({ tool, replace, content: event.detail.data });

    return {
      id: `block-${counter}`,
      name: tool,
      parentId: null,
      holder: document.createElement('div'),
      isEmpty: false,
    };
  });

  const updateMock = vi.fn(async (block: { id: string }, data: Record<string, unknown>) => {
    updateCalls.push({ data });

    return block;
  });

  const blok = {
    BlockManager: {
      currentBlock,
      paste: pasteMock,
      update: updateMock,
      setBlockParent: vi.fn(),
      transactForTool: vi.fn((fn: () => void) => fn()),
      setCurrentBlockByChildNode: vi.fn(),
    },
    Caret: {
      setToBlock: vi.fn(),
      positions: { END: 'end' },
      insertContentAtCaretPosition: vi.fn(),
      extractFragmentFromCaretPosition: vi.fn(() => {
        const frag = document.createDocumentFragment();

        frag.append(document.createTextNode(''));

        return frag;
      }),
    },
  } as unknown as BlokModules;

  return { blok, pasteCalls, updateCalls };
};

const makeListBlock = (data: ListData, opts: { isEmpty?: boolean } = {}): unknown => {
  const currentInput = document.createElement('div');

  return {
    id: 'target',
    name: 'list',
    parentId: null,
    isEmpty: opts.isEmpty ?? false,
    currentInput,
    holder: document.createElement('div'),
    tool: { baseSanitizeConfig: {} },
    data: Promise.resolve(data),
  };
};

const config = { defaultBlock: 'paragraph' } as unknown as BlokConfig;

describe('TextHandler — list-style propagation on multi-line plain paste', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('M-13: continuation lines pasted at end of a BULLETED item become unordered list items', async () => {
    const { blok, pasteCalls, updateCalls } = createBlok(
      makeListBlock({ text: 'first', style: 'unordered', depth: 0 })
    );
    const handler = new TextHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder, config);

    await handler.handle('a\nb\nc', { canReplaceCurrentBlock: false });

    // first line merges inline; b + c become new blocks
    expect(pasteCalls).toHaveLength(2);
    expect(pasteCalls.every((c) => c.tool === 'list')).toBe(true);
    expect(updateCalls.every((c) => c.data.style === 'unordered')).toBe(true);
  });

  it('M-14: continuation lines pasted at end of a NUMBERED item become ordered list items', async () => {
    const { blok, pasteCalls, updateCalls } = createBlok(
      makeListBlock({ text: 'first', style: 'ordered', depth: 0 })
    );
    const handler = new TextHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder, config);

    await handler.handle('a\nb', { canReplaceCurrentBlock: false });

    expect(pasteCalls).toHaveLength(1);
    expect(pasteCalls[0].tool).toBe('list');
    expect(updateCalls[0].data.style).toBe('ordered');
  });

  it('inherits the target item depth', async () => {
    const { blok, updateCalls } = createBlok(
      makeListBlock({ text: 'first', style: 'unordered', depth: 2 })
    );
    const handler = new TextHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder, config);

    await handler.handle('a\nb', { canReplaceCurrentBlock: false });

    expect(updateCalls[0].data.depth).toBe(2);
  });

  it('m-16: continuation lines pasted into a TO-DO item become unchecked checklist items', async () => {
    const { blok, updateCalls } = createBlok(
      makeListBlock({ text: 'first', style: 'checklist', depth: 0, checked: true })
    );
    const handler = new TextHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder, config);

    await handler.handle('a\nb', { canReplaceCurrentBlock: false });

    expect(updateCalls[0].data.style).toBe('checklist');
    expect(updateCalls[0].data.checked).toBe(false);
  });

  it('M-17: pasting into an EMPTY list item replaces it with the first inserted list block', async () => {
    const { blok, pasteCalls, updateCalls } = createBlok(
      makeListBlock({ text: '', style: 'unordered', depth: 0 }, { isEmpty: true })
    );
    const handler = new TextHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder, config);

    // canReplaceCurrentBlock is FALSE because a list item is not the default tool
    await handler.handle('a\nb', { canReplaceCurrentBlock: false });

    // both lines insert as list blocks; the FIRST replaces the empty target
    expect(pasteCalls).toHaveLength(2);
    expect(pasteCalls[0].replace).toBe(true);
    expect(pasteCalls.every((c) => c.tool === 'list')).toBe(true);
    expect(updateCalls.every((c) => c.data.style === 'unordered')).toBe(true);
  });

  it('does not alter normal paragraph paste (no list target)', async () => {
    const paragraph = {
      id: 'p',
      name: 'paragraph',
      parentId: null,
      isEmpty: false,
      currentInput: document.createElement('div'),
      holder: document.createElement('div'),
      tool: { baseSanitizeConfig: {} },
      data: Promise.resolve({ text: 'x' }),
    };
    const { blok, pasteCalls, updateCalls } = createBlok(paragraph);
    const handler = new TextHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder, config);

    await handler.handle('a\nb', { canReplaceCurrentBlock: false });

    expect(pasteCalls.every((c) => c.tool === 'paragraph')).toBe(true);
    expect(updateCalls).toHaveLength(0);
  });
});
