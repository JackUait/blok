import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { BlocksAPI } from '../../../src/components/modules/api/blocks';
import { EventsDispatcher } from '../../../src/components/utils/events';

import type { ModuleConfig } from '../../../src/types-internal/module-config';
import type { OutputData } from '../../../types';
import type { BlokEventMap } from '../../../src/components/events';
import type { BlokModules } from '../../../src/types-internal/blok-modules';

/**
 * Tests for the echo-safety of the public blocks.render() API.
 *
 * render() is a full clear-and-rebuild, which destroys the caret/selection.
 * When a consumer round-trips editor output through their state
 * (data → render → onSave → setState → data), the echoed document is
 * structurally identical to the current content — rendering it again would
 * clobber the caret for zero visual change. The API therefore compares the
 * incoming document against the current saved state and no-ops on equality.
 */

type RendererMock = {
  render: ReturnType<typeof vi.fn>;
  markRenderStart: ReturnType<typeof vi.fn>;
  markRenderEnd: ReturnType<typeof vi.fn>;
  pendingHashScroll: string | null;
};

type BlokStub = {
  BlockManager: { clear: ReturnType<typeof vi.fn>; getBlockById: ReturnType<typeof vi.fn> };
  ModificationsObserver: { disable: ReturnType<typeof vi.fn>; enable: ReturnType<typeof vi.fn> };
  Renderer: RendererMock;
  Saver: { save: ReturnType<typeof vi.fn> };
  BlockSelection: { selectBlock: ReturnType<typeof vi.fn> };
};

const savedDoc = (text: string): OutputData => ({
  time: 111,
  version: '1.0.0',
  blocks: [ { id: 'b1', type: 'paragraph', data: { text } } ],
});

const createBlocksApi = (currentContent: OutputData | undefined): { blocksApi: BlocksAPI; blok: BlokStub } => {
  const blok: BlokStub = {
    BlockManager: {
      clear: vi.fn().mockResolvedValue(undefined),
      getBlockById: vi.fn(),
    },
    ModificationsObserver: {
      disable: vi.fn(),
      enable: vi.fn(),
    },
    Renderer: {
      render: vi.fn().mockResolvedValue(undefined),
      markRenderStart: vi.fn(),
      markRenderEnd: vi.fn(),
      pendingHashScroll: null,
    },
    Saver: {
      save: vi.fn().mockResolvedValue(currentContent),
    },
    BlockSelection: {
      selectBlock: vi.fn(),
    },
  };

  const moduleConfig: ModuleConfig = {
    config: {
      defaultBlock: 'paragraph',
    },
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  };

  const blocksApi = new BlocksAPI(moduleConfig);

  blocksApi.state = blok as unknown as BlokModules;

  return { blocksApi, blok };
};

describe('Blocks API render() echo-safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips the clear-and-rebuild when the incoming document equals current content', async () => {
    const { blocksApi, blok } = createBlocksApi(savedDoc('Hello'));

    // Same blocks, different envelope (time/version) — a typical server echo.
    await blocksApi.methods.render({
      time: 999,
      version: '9.9.9',
      blocks: [ { id: 'b1', type: 'paragraph', data: { text: 'Hello' } } ],
    });

    expect(blok.BlockManager.clear).not.toHaveBeenCalled();
    expect(blok.Renderer.render).not.toHaveBeenCalled();
  });

  it('renders when the incoming document differs from current content', async () => {
    const { blocksApi, blok } = createBlocksApi(savedDoc('Hello'));

    await blocksApi.methods.render(savedDoc('Changed'));

    expect(blok.BlockManager.clear).toHaveBeenCalledTimes(1);
    expect(blok.Renderer.render).toHaveBeenCalledTimes(1);
  });

  it('renders when the current content cannot be serialized', async () => {
    const { blocksApi, blok } = createBlocksApi(undefined);

    await blocksApi.methods.render(savedDoc('Hello'));

    expect(blok.Renderer.render).toHaveBeenCalledTimes(1);
  });

  it('still processes a pending hash scroll when the echo render is skipped', async () => {
    const { blocksApi, blok } = createBlocksApi(savedDoc('Hello'));

    blok.Renderer.pendingHashScroll = 'b1';

    await blocksApi.methods.render(savedDoc('Hello'));

    expect(blok.Renderer.render).not.toHaveBeenCalled();
    expect(blok.Renderer.pendingHashScroll).toBeNull();
  });

  it('keeps rejecting documents without blocks', async () => {
    const { blocksApi } = createBlocksApi(savedDoc('Hello'));

    await expect(blocksApi.methods.render(undefined as unknown as OutputData)).rejects.toThrow('Incorrect data');
  });
});
