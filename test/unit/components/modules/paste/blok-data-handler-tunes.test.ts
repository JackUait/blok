import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlokDataHandler } from '../../../../../src/components/modules/paste/handlers/blok-data-handler';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';
import type { Block } from '../../../../../src/components/block';

type Inserted = { tool: string; data: Record<string, unknown>; tunes?: unknown };

const setup = (): { handler: BlokDataHandler; inserted: Inserted[] } => {
  const inserted: Inserted[] = [];
  let counter = 0;

  const modules = {
    BlockManager: {
      currentBlock: { tool: { isDefault: true }, isEmpty: true, parentId: null },
      insert: vi.fn((options: Inserted) => {
        inserted.push(options);

        return { id: `new-${counter++}`, name: options.tool, parentId: null, contentIds: [] } as unknown as Block;
      }),
      setBlockParent: vi.fn(),
      transactForTool: vi.fn((fn: () => void) => fn()),
    },
    Caret: { setToBlock: vi.fn(), positions: { END: 'end' } },
    Tools: {
      stubTool: 'stub',
      unavailable: new Map(),
      blockTools: {
        get: vi.fn(() => ({
          sanitizeConfig: {},
          tunes: new Map([['noteTune', { name: 'noteTune', sanitizeConfig: { note: { b: true } } }]]),
        })),
      },
    },
    YjsManager: { stopCapturing: vi.fn() },
  } as unknown as BlokModules;

  const handler = new BlokDataHandler(
    modules,
    { toolsPatterns: [], findToolForPattern: vi.fn() } as unknown as ToolRegistry,
    {} as unknown as SanitizerConfigBuilder,
    { sanitizer: {} }
  );

  return { handler, inserted };
};

describe('BlokDataHandler — block tunes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the tune data of each pasted block', async () => {
    const { handler, inserted } = setup();

    await handler.handle(JSON.stringify([
      { id: 'a', tool: 'paragraph', data: { text: 'Tuned' }, tunes: { noteTune: { note: 'keep me' } } },
      { id: 'b', tool: 'header', data: { text: 'Head', level: 2 }, tunes: { noteTune: { note: 'head note' } } },
    ]), { canReplaceCurrentBlock: false });

    expect(inserted.map(b => [b.tool, b.tunes])).toEqual([
      ['paragraph', { noteTune: { note: 'keep me' } }],
      ['header', { noteTune: { note: 'head note' } }],
    ]);
  });

  it('keeps the tune data of a table cell child', async () => {
    const { handler, inserted } = setup();

    await handler.handle(JSON.stringify([
      {
        id: 'tbl',
        tool: 'table',
        data: { content: [[{ blocks: ['cell'] }]] },
        parentId: null,
        contentIds: ['cell'],
        tunes: { noteTune: { note: 'table note' } },
      },
      { id: 'cell', tool: 'paragraph', data: { text: 'In cell' }, parentId: 'tbl', tunes: { noteTune: { note: 'cell note' } } },
    ]), { canReplaceCurrentBlock: false });

    expect(inserted.map(b => [b.tool, b.tunes])).toEqual([
      ['paragraph', { noteTune: { note: 'cell note' } }],
      ['table', { noteTune: { note: 'table note' } }],
    ]);
  });

  it('drops a tune the pasted block\'s tool does not enable', async () => {
    const { handler, inserted } = setup();

    await handler.handle(JSON.stringify([
      { id: 'a', tool: 'paragraph', data: { text: 'A' }, tunes: { noteTune: { note: 'keep' }, forgedTune: { x: 1 } } },
    ]), { canReplaceCurrentBlock: false });

    expect(inserted[0].tunes).toEqual({ noteTune: { note: 'keep' } });
  });

  it('cleans tune data with the tune\'s sanitize rules', async () => {
    const { handler, inserted } = setup();

    await handler.handle(JSON.stringify([
      { id: 'a', tool: 'paragraph', data: { text: 'A' }, tunes: { noteTune: { note: '<img src="x" onerror="alert(1)"><b>ok</b>' } } },
    ]), { canReplaceCurrentBlock: false });

    expect(inserted[0].tunes).toEqual({ noteTune: { note: '<b>ok</b>' } });
  });

  it('drops tunes that are not an object', async () => {
    const { handler, inserted } = setup();

    await handler.handle(JSON.stringify([
      { id: 'a', tool: 'paragraph', data: { text: 'A' }, tunes: null },
      { id: 'b', tool: 'paragraph', data: { text: 'B' }, tunes: ['x'] },
      { id: 'c', tool: 'paragraph', data: { text: 'C' }, tunes: 'x' },
    ]), { canReplaceCurrentBlock: false });

    expect(inserted.map(b => 'tunes' in b)).toEqual([false, false, false]);
  });
});
