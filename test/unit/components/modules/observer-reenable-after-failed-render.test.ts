import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BlocksAPI } from '../../../../src/components/modules/api/blocks';
import { ReadOnly } from '../../../../src/components/modules/readonly';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { OutputData } from '../../../../types';

/**
 * Every path that takes the observer out of service does it as a MUTEX around
 * a DOM rewrite: disable, rewrite, enable. The rewrite is the part that can
 * throw — a malformed block reaches `normalizeOutputBlock`, a tool's `render`
 * rejects — and an `enable()` sitting outside the try/finally is then never
 * reached, which kills onChange/onSave for the rest of the editor's life.
 */

type ObserverMock = {
  disable: ReturnType<typeof vi.fn>;
  enable: ReturnType<typeof vi.fn>;
};

const createObserverMock = (): ObserverMock => ({
  disable: vi.fn(),
  enable: vi.fn(),
});

const createBlocksApi = (
  observer: ObserverMock
): { blocksApi: BlocksAPI; renderer: { render: ReturnType<typeof vi.fn> } } => {
  const renderer = {
    render: vi.fn(async () => undefined),
    markRenderStart: vi.fn(),
    markRenderEnd: vi.fn(),
    pendingHashScroll: null,
  };

  const blocksApi = new BlocksAPI({
    config: { defaultBlock: 'paragraph' },
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  blocksApi.state = {
    BlockManager: {
      clear: vi.fn(async () => undefined),
    },
    ModificationsObserver: observer,
    Renderer: renderer,
    // undefined disables render()'s echo-equality skip, so the render really runs
    Saver: {
      save: vi.fn(async () => undefined),
    },
    InlineToolbar: {
      close: vi.fn(),
    },
  } as unknown as BlokModules;

  return {
    blocksApi,
    renderer,
  };
};

const sampleData: OutputData = {
  blocks: [{
    id: 'block-1',
    type: 'paragraph',
    data: { text: 'hi' },
  }],
};

type ReadOnlyHarness = {
  readOnly: ReadOnly;
  saverSave: ReturnType<typeof vi.fn>;
  rendererRender: ReturnType<typeof vi.fn>;
  blocks: Array<{ setReadOnly: ReturnType<typeof vi.fn> }>;
};

const createReadOnly = (
  observer: ObserverMock,
  toolSupportsInPlace: boolean
): ReadOnlyHarness => {
  const readOnly = new ReadOnly({
    config: { readOnly: false },
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  const saverSave = vi.fn(async () => ({ blocks: [] }));
  const rendererRender = vi.fn(async () => undefined);
  const blocks: Array<{ setReadOnly: ReturnType<typeof vi.fn> }> = [];

  readOnly.state = {
    ModificationsObserver: observer,
    Saver: {
      save: saverSave,
    },
    BlockManager: {
      blocks,
      clear: vi.fn(async () => undefined),
      getBlockById: vi.fn(() => undefined),
      toggleReadOnly: vi.fn(),
      withViewRebuild: vi.fn(async (rebuild: () => Promise<void>) => {
        await rebuild();
      }),
    },
    Renderer: {
      render: rendererRender,
      markRenderStart: vi.fn(),
      markRenderEnd: vi.fn(),
    },
    UI: {
      nodes: { wrapper: document.createElement('div') },
    },
    YjsManager: {
      captureCaretSnapshot: vi.fn(() => null),
    },
    Caret: {
      setToInput: vi.fn(),
      positions: {
        START: 'start',
        END: 'end',
        DEFAULT: 'default',
      },
    },
    Tools: {
      blockTools: new Map([
        ['paragraph', {
          isReadOnlySupported: true,
          supportsInPlaceReadOnly: toolSupportsInPlace,
        }],
      ]),
    },
  } as unknown as BlokModules;

  return {
    readOnly,
    saverSave,
    rendererRender,
    blocks,
  };
};

describe('ModificationsObserver is re-enabled even when the guarded rewrite fails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('blocks.render()', () => {
    it('re-enables the observer when the render rejects', async () => {
      const observer = createObserverMock();
      const { blocksApi, renderer } = createBlocksApi(observer);

      renderer.render.mockRejectedValue(new Error('malformed block'));

      await expect(blocksApi.render(sampleData)).rejects.toThrow('malformed block');

      expect(observer.disable).toHaveBeenCalledTimes(1);
      expect(observer.enable).toHaveBeenCalledTimes(1);
    });

    it('still re-enables the observer on the happy path', async () => {
      const observer = createObserverMock();
      const { blocksApi } = createBlocksApi(observer);

      await blocksApi.render(sampleData);

      expect(observer.enable).toHaveBeenCalledTimes(1);
    });
  });

  describe('read-only toggle — full re-render path', () => {
    it('re-enables the observer when the re-render rejects', async () => {
      const observer = createObserverMock();
      const { readOnly, rendererRender } = createReadOnly(observer, false);

      await readOnly.prepare();
      rendererRender.mockRejectedValue(new Error('render exploded'));

      await expect(readOnly.toggle(true)).rejects.toThrow('render exploded');

      expect(observer.disable).toHaveBeenCalledTimes(1);
      expect(observer.enable).toHaveBeenCalledTimes(1);
    });

    it('re-enables the observer when the serialization rejects', async () => {
      const observer = createObserverMock();
      const { readOnly, saverSave } = createReadOnly(observer, false);

      await readOnly.prepare();
      saverSave.mockRejectedValue(new Error('save exploded'));

      await expect(readOnly.toggle(true)).rejects.toThrow('save exploded');

      expect(observer.disable).toHaveBeenCalledTimes(1);
      expect(observer.enable).toHaveBeenCalledTimes(1);
    });
  });

  describe('read-only toggle — in-place path', () => {
    it("re-enables the observer when a tool's setReadOnly throws", async () => {
      const observer = createObserverMock();
      const { readOnly, blocks } = createReadOnly(observer, true);

      blocks.push({
        setReadOnly: vi.fn(() => {
          throw new Error('tool exploded');
        }),
      });

      await readOnly.prepare();

      await expect(readOnly.toggle(true)).rejects.toThrow('tool exploded');

      expect(observer.disable).toHaveBeenCalledTimes(1);
      expect(observer.enable).toHaveBeenCalledTimes(1);
    });
  });
});
