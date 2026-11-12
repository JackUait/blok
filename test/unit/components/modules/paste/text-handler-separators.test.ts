import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TextHandler } from '../../../../../src/components/modules/paste/handlers/text-handler';
import type { BlokConfig } from '../../../../../types/configs/blok-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';

interface Pasted {
  tool: string;
  text: string;
}

const setup = (tools: string[] = ['paragraph', 'divider']): { handler: TextHandler; pasted: Pasted[] } => {
  const pasted: Pasted[] = [];
  let counter = 0;
  const currentBlock = {
    id: 'target',
    name: 'paragraph',
    parentId: null,
    isEmpty: true,
    currentInput: document.createElement('div'),
    holder: document.createElement('div'),
    tool: { baseSanitizeConfig: {} },
  };

  const blok = {
    Tools: { blockTools: new Map(tools.map((name) => [name, {}])) },
    BlockManager: {
      currentBlock,
      paste: vi.fn(async (tool: string, event: { detail: { data: HTMLElement } }) => {
        counter++;
        pasted.push({ tool, text: event.detail.data.textContent ?? '' });

        return { id: `block-${counter}`, name: tool, parentId: null, holder: document.createElement('div'), isEmpty: false };
      }),
      setBlockParent: vi.fn(),
      setCurrentBlockByChildNode: vi.fn(),
    },
    Caret: {
      setToBlock: vi.fn(),
      positions: { END: 'end' },
      insertContentAtCaretPosition: vi.fn(),
      extractFragmentFromCaretPosition: vi.fn(() => document.createDocumentFragment()),
    },
  } as unknown as BlokModules;

  const config = { defaultBlock: 'paragraph' } as unknown as BlokConfig;

  return { handler: new TextHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder, config), pasted };
};

describe('TextHandler — a lone separator line in plain text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('becomes a divider, and every other line stays plain text', async () => {
    const { handler, pasted } = setup();

    await handler.handle('a *b* c\nsecond line\n\n---\n\nAfter', { canReplaceCurrentBlock: true });

    expect(pasted).toEqual([
      { tool: 'paragraph', text: 'a *b* c' },
      { tool: 'paragraph', text: 'second line' },
      { tool: 'divider', text: '' },
      { tool: 'paragraph', text: 'After' },
    ]);
  });

  it('reads ***, ___, a longer run, a short indent and CRLF line ends as separators', async () => {
    const { handler, pasted } = setup();

    await handler.handle('one\r\n\r\n***\r\n\r\ntwo\n\n   _____  \n\nthree', { canReplaceCurrentBlock: true });

    expect(pasted.map((item) => item.tool)).toEqual(['paragraph', 'divider', 'paragraph', 'divider', 'paragraph']);
  });

  it('keeps a dash line under text, a dash run inside text and a code indent as text', async () => {
    const { handler, pasted } = setup();

    await handler.handle('Title\n---\nbody\n\nwait --- what\n\n    ---\n\n-*-', { canReplaceCurrentBlock: true });

    expect(pasted.every((item) => item.tool === 'paragraph')).toBe(true);
    expect(pasted.map((item) => item.text)).toEqual(['Title', '---', 'body', 'wait --- what', '    ---', '-*-']);
  });

  it('keeps separators as text when the editor has no divider tool', async () => {
    const { handler, pasted } = setup(['paragraph']);

    await handler.handle('Before\n\n---\n\nAfter', { canReplaceCurrentBlock: true });

    expect(pasted.map((item) => item.tool)).toEqual(['paragraph', 'paragraph', 'paragraph']);
  });

  it('keeps separators as text when the html flavour says the text is literal', async () => {
    const { handler, pasted } = setup();

    await handler.handle('Before\n\n---\n\nAfter', { canReplaceCurrentBlock: true, literalText: true });

    expect(pasted.map((item) => item.tool)).toEqual(['paragraph', 'paragraph', 'paragraph']);
  });

  it('inserts no empty paragraph for a blank first line', async () => {
    const { handler, pasted } = setup();

    await handler.handle('\n\nBefore\n\n---\n\nAfter', { canReplaceCurrentBlock: true });

    expect(pasted.map((item) => item.tool)).toEqual(['paragraph', 'divider', 'paragraph']);
  });

  it('turns a separator pasted alone into one divider', async () => {
    const { handler, pasted } = setup();

    await handler.handle('***', { canReplaceCurrentBlock: true });

    expect(pasted).toEqual([{ tool: 'divider', text: '' }]);
  });

  it('stays fast on long dash runs that are not separators', async () => {
    const { handler } = setup(['divider']);
    const hostile = `${'- '.repeat(50_000)}x\n\n`.repeat(4);
    const started = performance.now();

    await handler.handle(hostile, { canReplaceCurrentBlock: false });

    expect(performance.now() - started).toBeLessThan(200);
  });
});
