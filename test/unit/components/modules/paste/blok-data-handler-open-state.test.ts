import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlokDataHandler } from '../../../../../src/components/modules/paste/handlers/blok-data-handler';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';
import type { Block } from '../../../../../src/components/block';

/**
 * A toggle opens itself on insert when it was created here, as the real
 * toggle's rendered() does. The fake insert does the same for 'toggle'.
 */
const setup = (): { handler: BlokDataHandler; open: Map<string, unknown>; set: ReturnType<typeof vi.fn>; setToBlock: ReturnType<typeof vi.fn> } => {
  const open = new Map<string, unknown>();
  const set = vi.fn((id: string, key: string, value: unknown) => {
    if (key === 'open') {
      open.set(id, value);
    }
  });
  const counter = { next: 0 };
  const setToBlock = vi.fn();

  const modules = {
    BlockManager: {
      currentBlock: { tool: { isDefault: true }, isEmpty: false, parentId: null },
      insert: vi.fn((options: { tool: string }) => {
        const id = `new-${counter.next++}`;

        if (options.tool === 'toggle') {
          open.set(id, true);
        }

        return { id, name: options.tool, parentId: null, contentIds: [] } as unknown as Block;
      }),
      setBlockParent: vi.fn(),
      transactForTool: vi.fn((fn: () => void) => fn()),
    },
    Caret: { setToBlock, positions: { END: 'end' } },
    Tools: {
      stubTool: 'stub',
      unavailable: new Map(),
      blockTools: { get: vi.fn(() => ({ sanitizeConfig: {}, tunes: new Map() })) },
    },
    YjsManager: { stopCapturing: vi.fn() },
    ViewStateAPI: {
      methods: {
        get: vi.fn((id: string, key: string) => (key === 'open' ? open.get(id) : undefined)),
        set,
      },
    },
  } as unknown as BlokModules;

  const handler = new BlokDataHandler(
    modules,
    { toolsPatterns: [], findToolForPattern: vi.fn() } as unknown as ToolRegistry,
    {} as unknown as SanitizerConfigBuilder,
    { sanitizer: {} }
  );

  return { handler, open, set, setToBlock };
};

describe('BlokDataHandler — open state of pasted toggles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('closes a toggle that was closed when copied', async () => {
    const { handler, open } = setup();

    await handler.handle(JSON.stringify([
      { id: 'tog', tool: 'toggle', data: { text: 'Outer' }, parentId: null, contentIds: ['tin'], open: false },
      { id: 'tin', tool: 'toggle', data: { text: 'Inner' }, parentId: 'tog', open: false },
    ]), { canReplaceCurrentBlock: false, fromBlokClipboard: true });

    expect([open.get('new-0'), open.get('new-1')]).toEqual([false, false]);
  });

  it('leaves the caret in the last pasted block still shown', async () => {
    const { handler, setToBlock } = setup();

    await handler.handle(JSON.stringify([
      { id: 'tog', tool: 'toggle', data: { text: 'Outer' }, parentId: null, contentIds: ['tin'], open: false },
      { id: 'tin', tool: 'toggle', data: { text: 'Inner' }, parentId: 'tog', contentIds: ['p'], open: false },
      { id: 'p', tool: 'paragraph', data: { text: 'Hidden' }, parentId: 'tin', open: false },
    ]), { canReplaceCurrentBlock: false, fromBlokClipboard: true });

    expect(setToBlock.mock.lastCall?.[0]).toMatchObject({ id: 'new-0' });
  });

  it('leaves a toggle open when it was open when copied', async () => {
    const { handler, open, set } = setup();

    await handler.handle(JSON.stringify([
      { id: 'tog', tool: 'toggle', data: { text: 'Outer' }, open: true },
    ]), { canReplaceCurrentBlock: false, fromBlokClipboard: true });

    expect(open.get('new-0')).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it('leaves a toggle alone when the clipboard does not say how it was shown', async () => {
    const { handler, open, set } = setup();

    await handler.handle(JSON.stringify([
      { id: 'tog', tool: 'toggle', data: { text: 'Outer' } },
    ]), { canReplaceCurrentBlock: false, fromBlokClipboard: true });

    expect(open.get('new-0')).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it('writes no view state for a closed block that never opened', async () => {
    const { handler, set } = setup();

    await handler.handle(JSON.stringify([
      { id: 'p', tool: 'paragraph', data: { text: 'Plain' }, open: false },
    ]), { canReplaceCurrentBlock: false, fromBlokClipboard: true });

    expect(set).not.toHaveBeenCalled();
  });
});
