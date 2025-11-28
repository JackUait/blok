import { describe, it, expect, vi, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';

import ReadOnly from '../../../../src/components/modules/readonly';
import { CriticalError } from '../../../../src/components/errors/critical';
import type { BlokConfig } from '../../../../types';

interface CreateReadOnlyOptions {
  config?: BlokConfig;
  blockTools?: Array<[string, { isReadOnlySupported?: boolean }]>;
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
    clear: MockInstance<() => Promise<void>>;
    toggleReadOnly: MockInstance<(state: boolean) => void>;
  };
  renderer: {
    render: MockInstance<(blocks: unknown[]) => Promise<void>>;
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
  const blockTools = new Map<string, { isReadOnlySupported?: boolean }>(blockToolsEntries);

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
    clear: vi.fn<() => Promise<void>>(async () => undefined),
    toggleReadOnly: vi.fn<(state: boolean) => void>((_state) => undefined),
  };

  const renderer: ReadOnlyMocks['renderer'] = {
    render: vi.fn<(blocks: unknown[]) => Promise<void>>(async (_blocks) => undefined),
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
});


