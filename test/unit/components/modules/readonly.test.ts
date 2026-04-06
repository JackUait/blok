import { describe, it, expect, vi, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';

import { ReadOnly } from '../../../../src/components/modules/readonly';
import { CriticalError } from '../../../../src/components/errors/critical';
import type { BlokConfig } from '../../../../types';

interface CreateReadOnlyOptions {
  config?: BlokConfig;
  blockTools?: Array<[string, { isReadOnlySupported?: boolean; class?: { prototype: Record<string, unknown> } }]>;
  saverBlocks?: unknown[];
}

type ReadOnlyMocks = {
  modificationsObserver: {
    disable: MockInstance<() => void>;
    enable: MockInstance<() => void>;
  };
  saver: {
    save: MockInstance<() => Promise<{ blocks: unknown[] }>>;
  };
  blockManager: {
    blocks: Array<{ setReadOnly: MockInstance<(state: boolean) => void> }>;
    clear: MockInstance<() => Promise<void>>;
    toggleReadOnly: MockInstance<(state: boolean) => void>;
  };
  renderer: {
    render: MockInstance<(blocks: unknown[]) => Promise<void>>;
    markRenderStart: MockInstance<() => void>;
    markRenderEnd: MockInstance<() => void>;
  };
  toolbar: {
    toggleReadOnly: MockInstance<(state: boolean) => void>;
  };
  inlineToolbar: {
    toggleReadOnly: MockInstance<(state: boolean) => void>;
  };
};

type CreateReadOnlyResult = {
  readOnly: ReadOnly;
  mocks: ReadOnlyMocks;
};

const createReadOnly = (options?: CreateReadOnlyOptions): CreateReadOnlyResult => {
  const blockToolsEntries = options?.blockTools ?? [];
  const blockTools = new Map<string, { isReadOnlySupported?: boolean; class?: { prototype: Record<string, unknown> } }>(blockToolsEntries);

  const readOnly = new ReadOnly({
    config: options?.config ?? {},
    eventsDispatcher: {
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as ReadOnly['eventsDispatcher'],
  });

  const modificationsObserver: ReadOnlyMocks['modificationsObserver'] = {
    disable: vi.fn<() => void>(() => undefined),
    enable: vi.fn<() => void>(() => undefined),
  };

  const saver: ReadOnlyMocks['saver'] = {
    save: vi.fn<() => Promise<{ blocks: unknown[] }>>(async () => ({
      blocks: options?.saverBlocks ?? [],
    })),
  };

  const blockManager: ReadOnlyMocks['blockManager'] = {
    blocks: [],
    clear: vi.fn<() => Promise<void>>(async () => undefined),
    toggleReadOnly: vi.fn<(state: boolean) => void>((_state) => undefined),
  };

  const renderer: ReadOnlyMocks['renderer'] = {
    render: vi.fn<(blocks: unknown[]) => Promise<void>>(async (_blocks) => undefined),
    markRenderStart: vi.fn<() => void>(() => undefined),
    markRenderEnd: vi.fn<() => void>(() => undefined),
  };

  const toolbar: ReadOnlyMocks['toolbar'] = {
    toggleReadOnly: vi.fn<(state: boolean) => void>((_state) => undefined),
  };

  const inlineToolbar: ReadOnlyMocks['inlineToolbar'] = {
    toggleReadOnly: vi.fn<(state: boolean) => void>((_state) => undefined),
  };

  const modules = {
    ModificationsObserver: modificationsObserver,
    Saver: saver,
    BlockManager: blockManager,
    Renderer: renderer,
    Toolbar: toolbar,
    InlineToolbar: inlineToolbar,
    Tools: {
      blockTools,
    },
  };

  readOnly.state = modules as unknown as ReadOnly['Blok'];

  return {
    readOnly,
    mocks: {
      modificationsObserver,
      saver,
      blockManager,
      renderer,
      toolbar,
      inlineToolbar,
    },
  };
};

describe('ReadOnly module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('collects tools that do not support read-only and toggles initial state during prepare', async () => {
    const { readOnly } = createReadOnly({
      config: {
        readOnly: false,
      },
      blockTools: [
        ['paragraph', { isReadOnlySupported: true } ],
        ['legacy', { isReadOnlySupported: false } ],
      ],
    });

    const toggleSpy = vi.spyOn(readOnly, 'toggle').mockResolvedValue(false);

    await readOnly.prepare();

    expect(toggleSpy).toHaveBeenCalledWith(false, true);

    const unsupportedTools =
      (readOnly as unknown as { toolsDontSupportReadOnly: string[] }).toolsDontSupportReadOnly;

    expect(unsupportedTools).toEqual([ 'legacy' ]);
  });

  it('throws a critical error when initializing read-only mode with unsupported tools', async () => {
    const { readOnly } = createReadOnly({
      config: {
        readOnly: true,
      },
      blockTools: [
        ['unsupported', { isReadOnlySupported: false } ],
      ],
    });

    await expect(readOnly.prepare()).rejects.toThrow(CriticalError);
  });

  it('propagates toggle state to modules and re-renders saved blocks', async () => {
    const savedBlocks = [ { id: 'block-1' } ];
    const { readOnly, mocks } = createReadOnly({
      saverBlocks: savedBlocks,
    });

    const result = await readOnly.toggle(true);

    expect(result).toBe(true);
    expect(mocks.blockManager.toggleReadOnly).toHaveBeenCalledWith(true);
    expect(mocks.toolbar.toggleReadOnly).toHaveBeenCalledWith(true);
    expect(mocks.inlineToolbar.toggleReadOnly).toHaveBeenCalledWith(true);
    expect(mocks.modificationsObserver.disable).toHaveBeenCalledTimes(1);
    expect(mocks.saver.save).toHaveBeenCalledTimes(1);
    expect(mocks.blockManager.clear).toHaveBeenCalledTimes(1);
    expect(mocks.renderer.render).toHaveBeenCalledWith(savedBlocks);
    expect(mocks.modificationsObserver.enable).toHaveBeenCalledTimes(1);
  });

  it('prevents enabling read-only mode when unsupported tools are registered', async () => {
    const { readOnly } = createReadOnly();

    (readOnly as unknown as { toolsDontSupportReadOnly: string[] }).toolsDontSupportReadOnly = [
      'legacy',
    ];

    await expect(readOnly.toggle(true)).rejects.toThrow(CriticalError);
  });

  it('skips re-render when the requested state matches the current state', async () => {
    const { readOnly, mocks } = createReadOnly();

    await readOnly.toggle(true);

    mocks.modificationsObserver.disable.mockClear();
    mocks.saver.save.mockClear();
    mocks.blockManager.clear.mockClear();
    mocks.renderer.render.mockClear();
    mocks.modificationsObserver.enable.mockClear();

    const result = await readOnly.toggle(true);

    expect(result).toBe(true);
    expect(mocks.saver.save).not.toHaveBeenCalled();
    expect(mocks.blockManager.clear).not.toHaveBeenCalled();
    expect(mocks.renderer.render).not.toHaveBeenCalled();
    expect(mocks.modificationsObserver.disable).not.toHaveBeenCalled();
    expect(mocks.modificationsObserver.enable).not.toHaveBeenCalled();
  });

  it('skips re-render during the initial toggle', async () => {
    const { readOnly, mocks } = createReadOnly();

    const result = await readOnly.toggle(true, true);

    expect(result).toBe(true);
    expect(mocks.saver.save).not.toHaveBeenCalled();
    expect(mocks.blockManager.clear).not.toHaveBeenCalled();
    expect(mocks.renderer.render).not.toHaveBeenCalled();
    expect(mocks.modificationsObserver.disable).not.toHaveBeenCalled();
    expect(mocks.modificationsObserver.enable).not.toHaveBeenCalled();
    expect(mocks.blockManager.toggleReadOnly).toHaveBeenCalledWith(true);
    expect(mocks.toolbar.toggleReadOnly).toHaveBeenCalledWith(true);
    expect(mocks.inlineToolbar.toggleReadOnly).toHaveBeenCalledWith(true);
  });

  it('restores scroll position after re-render to prevent content jumping', async () => {
    const savedBlocks = [{ id: 'block-1' }];
    const { readOnly, mocks } = createReadOnly({
      saverBlocks: savedBlocks,
    });

    // Simulate user scrolled to 500px
    const scrollYSpy = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(500);
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    // Simulate the re-render causing a scroll jump (e.g., container collapse)
    mocks.renderer.render.mockImplementation(async () => {
      // After re-render, browser may have shifted scroll
      scrollYSpy.mockReturnValue(0);
    });

    await readOnly.toggle(true);

    expect(scrollToSpy).toHaveBeenCalledWith(0, 500);
  });

  it('does not call scrollTo when scroll position is unchanged after re-render', async () => {
    const savedBlocks = [{ id: 'block-1' }];
    const { readOnly } = createReadOnly({
      saverBlocks: savedBlocks,
    });

    // Scroll stays at same position
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(200);
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    await readOnly.toggle(true);

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  describe('in-place toggle', () => {
    it('uses in-place path when all tools support setReadOnly', async () => {
      const mockBlock = {
        setReadOnly: vi.fn(),
      };

      const { readOnly, mocks } = createReadOnly({
        config: { readOnly: false },
        blockTools: [
          ['paragraph', { isReadOnlySupported: true, class: { prototype: { setReadOnly() {} } } }],
        ],
      });

      mocks.blockManager.blocks = [mockBlock];

      await readOnly.prepare();
      await readOnly.toggle(true);

      // In-place path: setReadOnly called on each block
      expect(mockBlock.setReadOnly).toHaveBeenCalledWith(true);

      // Full re-render path NOT taken
      expect(mocks.saver.save).not.toHaveBeenCalled();
      expect(mocks.blockManager.clear).not.toHaveBeenCalled();
      expect(mocks.renderer.render).not.toHaveBeenCalled();
      expect(mocks.modificationsObserver.disable).not.toHaveBeenCalled();
    });

    it('falls back to full re-render when a tool lacks setReadOnly', async () => {
      const { readOnly, mocks } = createReadOnly({
        config: { readOnly: false },
        blockTools: [
          ['paragraph', { isReadOnlySupported: true, class: { prototype: { setReadOnly() {} } } }],
          ['custom', { isReadOnlySupported: true, class: { prototype: {} } }],
        ],
      });

      await readOnly.prepare();
      const result = await readOnly.toggle(true);

      expect(result).toBe(true);

      // Full re-render path taken
      expect(mocks.saver.save).toHaveBeenCalled();
      expect(mocks.blockManager.clear).toHaveBeenCalled();
      expect(mocks.renderer.render).toHaveBeenCalled();
    });

    it('supportsInPlaceToggle returns true when all tool classes have setReadOnly', async () => {
      const { readOnly } = createReadOnly({
        config: { readOnly: false },
        blockTools: [
          ['paragraph', { isReadOnlySupported: true, class: { prototype: { setReadOnly() {} } } }],
        ],
      });

      await readOnly.prepare();

      expect((readOnly as unknown as { supportsInPlaceToggle: boolean }).supportsInPlaceToggle).toBe(true);
    });

    it('supportsInPlaceToggle returns false when any tool class lacks setReadOnly', async () => {
      const { readOnly } = createReadOnly({
        config: { readOnly: false },
        blockTools: [
          ['paragraph', { isReadOnlySupported: true, class: { prototype: { setReadOnly() {} } } }],
          ['custom', { isReadOnlySupported: true, class: { prototype: {} } }],
        ],
      });

      await readOnly.prepare();

      expect((readOnly as unknown as { supportsInPlaceToggle: boolean }).supportsInPlaceToggle).toBe(false);
    });

    it('module toggleReadOnly cascade still runs in in-place path', async () => {
      const mockBlock = {
        setReadOnly: vi.fn(),
      };

      const { readOnly, mocks } = createReadOnly({
        config: { readOnly: false },
        blockTools: [
          ['paragraph', { isReadOnlySupported: true, class: { prototype: { setReadOnly() {} } } }],
        ],
      });

      mocks.blockManager.blocks = [mockBlock];

      await readOnly.prepare();
      await readOnly.toggle(true);

      expect(mocks.blockManager.toggleReadOnly).toHaveBeenCalledWith(true);
      expect(mocks.toolbar.toggleReadOnly).toHaveBeenCalledWith(true);
      expect(mocks.inlineToolbar.toggleReadOnly).toHaveBeenCalledWith(true);
    });
  });

  describe('set method', () => {
    it('sets read-only mode to true', async () => {
      const { readOnly, mocks } = createReadOnly();

      const result = await readOnly.set(true);

      expect(result).toBe(true);
      expect(readOnly.isEnabled).toBe(true);
      expect(mocks.blockManager.toggleReadOnly).toHaveBeenCalledWith(true);
      expect(mocks.toolbar.toggleReadOnly).toHaveBeenCalledWith(true);
      expect(mocks.inlineToolbar.toggleReadOnly).toHaveBeenCalledWith(true);
    });

    it('sets read-only mode to false', async () => {
      const { readOnly, mocks } = createReadOnly();

      await readOnly.set(true);
      mocks.modificationsObserver.disable.mockClear();
      mocks.saver.save.mockClear();
      mocks.blockManager.clear.mockClear();
      mocks.renderer.render.mockClear();
      mocks.modificationsObserver.enable.mockClear();

      const result = await readOnly.set(false);

      expect(result).toBe(false);
      expect(readOnly.isEnabled).toBe(false);
      expect(mocks.blockManager.toggleReadOnly).toHaveBeenCalledWith(false);
    });

    it('requires a boolean parameter (no default toggle behavior)', async () => {
      const { readOnly } = createReadOnly();

      // set() without a parameter should not toggle - it should require a value
      // This is the key difference from toggle()
      await readOnly.set(true);
      expect(readOnly.isEnabled).toBe(true);

      await readOnly.set(false);
      expect(readOnly.isEnabled).toBe(false);
    });

    it('prevents enabling read-only mode when unsupported tools are registered', async () => {
      const { readOnly } = createReadOnly();

      (readOnly as unknown as { toolsDontSupportReadOnly: string[] }).toolsDontSupportReadOnly = [
        'legacy',
      ];

      await expect(readOnly.set(true)).rejects.toThrow(CriticalError);
    });

    it('skips re-render when the requested state matches the current state', async () => {
      const { readOnly, mocks } = createReadOnly();

      await readOnly.set(true);

      mocks.modificationsObserver.disable.mockClear();
      mocks.saver.save.mockClear();
      mocks.blockManager.clear.mockClear();
      mocks.renderer.render.mockClear();
      mocks.modificationsObserver.enable.mockClear();

      const result = await readOnly.set(true);

      expect(result).toBe(true);
      expect(mocks.saver.save).not.toHaveBeenCalled();
      expect(mocks.blockManager.clear).not.toHaveBeenCalled();
      expect(mocks.renderer.render).not.toHaveBeenCalled();
      expect(mocks.modificationsObserver.disable).not.toHaveBeenCalled();
      expect(mocks.modificationsObserver.enable).not.toHaveBeenCalled();
    });
  });
});


