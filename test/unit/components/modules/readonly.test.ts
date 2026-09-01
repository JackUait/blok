import { describe, it, expect, vi, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';

import { ReadOnly } from '../../../../src/components/modules/readonly';
import { CriticalError } from '../../../../src/components/errors/critical';
import type { CaretSnapshot } from '../../../../src/components/modules/yjs/types';
import type { BlokConfig } from '../../../../types';

interface CreateReadOnlyOptions {
  config?: BlokConfig;
  blockTools?: Array<[string, { isReadOnlySupported?: boolean; supportsInPlaceReadOnly?: boolean }]>;
  saverBlocks?: unknown[];
  collaboration?: { isEditingBlocked: boolean };
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
    getBlockById: MockInstance<(id: string) => { inputs: HTMLElement[] } | undefined>;
    toggleReadOnly: MockInstance<(state: boolean) => void>;
    withViewRebuild: MockInstance<(rebuild: () => Promise<void>) => Promise<void>>;
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
  blockSelection: {
    toggleReadOnly: MockInstance<(state: boolean) => void>;
  };
  ui: {
    nodes: { wrapper: HTMLDivElement };
  };
  yjsManager: {
    captureCaretSnapshot: MockInstance<() => CaretSnapshot | null>;
  };
  caret: {
    setToInput: MockInstance<(input: HTMLElement, position?: string, offset?: number) => void>;
    positions: { START: string; END: string; DEFAULT: string };
  };
};

type CreateReadOnlyResult = {
  readOnly: ReadOnly;
  mocks: ReadOnlyMocks;
};

const createReadOnly = (options?: CreateReadOnlyOptions): CreateReadOnlyResult => {
  const blockToolsEntries = options?.blockTools ?? [];
  const blockTools = new Map<string, { isReadOnlySupported?: boolean; supportsInPlaceReadOnly?: boolean }>(blockToolsEntries);

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
    getBlockById: vi.fn<(id: string) => { inputs: HTMLElement[] } | undefined>(() => undefined),
    toggleReadOnly: vi.fn<(state: boolean) => void>((_state) => undefined),
    // rebuilds the view without touching the document — runs its callback as-is
    withViewRebuild: vi.fn<(rebuild: () => Promise<void>) => Promise<void>>(async (rebuild) => {
      await rebuild();
    }),
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

  const blockSelection: ReadOnlyMocks['blockSelection'] = {
    toggleReadOnly: vi.fn<(state: boolean) => void>((_state) => undefined),
  };

  const ui: ReadOnlyMocks['ui'] = {
    nodes: { wrapper: document.createElement('div') },
  };

  const yjsManager: ReadOnlyMocks['yjsManager'] = {
    captureCaretSnapshot: vi.fn<() => CaretSnapshot | null>(() => null),
  };

  const caret: ReadOnlyMocks['caret'] = {
    setToInput: vi.fn<(input: HTMLElement, position?: string, offset?: number) => void>(() => undefined),
    positions: { START: 'start', END: 'end', DEFAULT: 'default' },
  };

  const modules = {
    ModificationsObserver: modificationsObserver,
    Saver: saver,
    BlockManager: blockManager,
    Renderer: renderer,
    Toolbar: toolbar,
    InlineToolbar: inlineToolbar,
    BlockSelection: blockSelection,
    UI: ui,
    YjsManager: yjsManager,
    Caret: caret,
    Collaboration: options?.collaboration,
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
      blockSelection,
      ui,
      yjsManager,
      caret,
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
    // rendered as a view rebuild: the document already holds these blocks
    expect(mocks.renderer.render).toHaveBeenCalledWith(savedBlocks, { skipYjsSync: true });
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
          ['paragraph', { isReadOnlySupported: true, supportsInPlaceReadOnly: true }],
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

      // ModificationsObserver paused during in-place toggle to avoid recording as edits
      expect(mocks.modificationsObserver.disable).toHaveBeenCalled();
      expect(mocks.modificationsObserver.enable).toHaveBeenCalled();
    });

    it('falls back to full re-render when a tool lacks setReadOnly', async () => {
      const { readOnly, mocks } = createReadOnly({
        config: { readOnly: false },
        blockTools: [
          ['paragraph', { isReadOnlySupported: true, supportsInPlaceReadOnly: true }],
          ['custom', { isReadOnlySupported: true, supportsInPlaceReadOnly: false }],
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
          ['paragraph', { isReadOnlySupported: true, supportsInPlaceReadOnly: true }],
        ],
      });

      await readOnly.prepare();

      expect((readOnly as unknown as { supportsInPlaceToggle: boolean }).supportsInPlaceToggle).toBe(true);
    });

    it('supportsInPlaceToggle returns false when any tool class lacks setReadOnly', async () => {
      const { readOnly } = createReadOnly({
        config: { readOnly: false },
        blockTools: [
          ['paragraph', { isReadOnlySupported: true, supportsInPlaceReadOnly: true }],
          ['custom', { isReadOnlySupported: true, supportsInPlaceReadOnly: false }],
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
          ['paragraph', { isReadOnlySupported: true, supportsInPlaceReadOnly: true }],
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

  describe('toolbar survives read-only toggle', () => {
    it('delegates to Toolbar.toggleReadOnly and Toolbar continues to expose moveAndOpen without throwing', async () => {
      const { readOnly, mocks } = createReadOnly();

      const moveAndOpen = vi.fn();

      (mocks.toolbar as unknown as { moveAndOpen: () => void }).moveAndOpen = moveAndOpen;

      await readOnly.set(true);

      expect(mocks.toolbar.toggleReadOnly).toHaveBeenCalledWith(true);
      expect(typeof (mocks.toolbar as unknown as { moveAndOpen: () => void }).moveAndOpen).toBe('function');
      expect(() => (mocks.toolbar as unknown as { moveAndOpen: () => void }).moveAndOpen()).not.toThrow();
    });
  });

  describe('readOnly object config form', () => {
    it('enables read-only mode when config.readOnly is an object', async () => {
      const { readOnly } = createReadOnly({ config: { readOnly: { hideControls: true } } });

      await readOnly.prepare();

      expect(readOnly.isEnabled).toBe(true);
    });

    it('keeps isEnabled a strict boolean (not the config object)', async () => {
      const { readOnly } = createReadOnly({ config: { readOnly: { hideControls: true } } });

      await readOnly.prepare();

      expect(typeof readOnly.isEnabled).toBe('boolean');
    });

    it('throws a critical error for unsupported tools with object config', async () => {
      const { readOnly } = createReadOnly({
        config: { readOnly: { hideControls: true } },
        blockTools: [ ['legacy', { isReadOnlySupported: false } ] ],
      });

      await expect(readOnly.prepare()).rejects.toThrow(CriticalError);
    });

    describe('isControlsHidden', () => {
      it('is false by default', () => {
        const { readOnly } = createReadOnly();

        expect(readOnly.isControlsHidden).toBe(false);
      });

      it('is false for plain readOnly: true', async () => {
        const { readOnly } = createReadOnly({ config: { readOnly: true } });

        await readOnly.prepare();

        expect(readOnly.isControlsHidden).toBe(false);
      });

      it('is true when config requests hideControls and read-only is active', async () => {
        const { readOnly } = createReadOnly({ config: { readOnly: { hideControls: true } } });

        await readOnly.prepare();

        expect(readOnly.isControlsHidden).toBe(true);
      });

      it('turns false when read-only is toggled off, and back on when re-enabled', async () => {
        const { readOnly } = createReadOnly({ config: { readOnly: { hideControls: true } } });

        await readOnly.prepare();
        await readOnly.toggle(false);

        expect(readOnly.isControlsHidden).toBe(false);

        await readOnly.toggle(true);

        expect(readOnly.isControlsHidden).toBe(true);
      });
    });
  });

  describe('caret survives read-only toggle', () => {
    type CaretDom = {
      input: HTMLDivElement;
      selectionState: { anchorNode: Node | null };
    };

    /**
     * Live selection inside the wrapper + a block the snapshot resolves to.
     * BlockSelection.toggleReadOnly nulls the anchor, mimicking its real
     * removeAllRanges — a capture running after the cascade finds nothing.
     */
    const setupCaretDom = (mocks: ReadOnlyMocks): CaretDom => {
      const { wrapper } = mocks.ui.nodes;
      const input = document.createElement('div');
      const textNode = document.createTextNode('caret here');

      input.appendChild(textNode);
      wrapper.appendChild(input);
      document.body.appendChild(wrapper);

      const selectionState: CaretDom['selectionState'] = { anchorNode: textNode };

      vi.spyOn(window, 'getSelection').mockReturnValue({
        get anchorNode(): Node | null {
          return selectionState.anchorNode;
        },
        rangeCount: 0,
      } as unknown as Selection);

      mocks.blockSelection.toggleReadOnly.mockImplementation(() => {
        selectionState.anchorNode = null;
      });

      mocks.yjsManager.captureCaretSnapshot.mockReturnValue({ blockId: 'block-1', inputIndex: 0, offset: 4 });
      mocks.blockManager.getBlockById.mockImplementation((id: string) => {
        return id === 'block-1' ? { inputs: [input] } : undefined;
      });

      return { input, selectionState };
    };

    afterEach(() => {
      document.body.replaceChildren();
    });

    it('restores the caret after a read-only round trip on the re-render path', async () => {
      const { readOnly, mocks } = createReadOnly();
      const { input } = setupCaretDom(mocks);

      await readOnly.toggle(true);
      await readOnly.toggle(false);

      expect(mocks.caret.setToInput).toHaveBeenCalledWith(input, 'default', 4);
    });

    it('restores the caret on the in-place toggle path', async () => {
      const { readOnly, mocks } = createReadOnly({
        config: { readOnly: false },
        blockTools: [
          ['paragraph', { isReadOnlySupported: true, supportsInPlaceReadOnly: true }],
        ],
      });

      await readOnly.prepare();

      const { input } = setupCaretDom(mocks);

      await readOnly.toggle(true);
      await readOnly.toggle(false);

      expect(mocks.saver.save).not.toHaveBeenCalled();
      expect(mocks.caret.setToInput).toHaveBeenCalledWith(input, 'default', 4);
    });

    it('does not restore while the editor stays read-only', async () => {
      const { readOnly, mocks } = createReadOnly();

      setupCaretDom(mocks);

      await readOnly.toggle(true);
      await readOnly.toggle(true);

      expect(mocks.caret.setToInput).not.toHaveBeenCalled();
    });

    it('does not capture when the selection anchor is outside the wrapper', async () => {
      const { readOnly, mocks } = createReadOnly();
      const { selectionState } = setupCaretDom(mocks);
      const outside = document.createElement('div');

      outside.textContent = 'outside';
      document.body.appendChild(outside);
      selectionState.anchorNode = outside.firstChild;

      await readOnly.toggle(true);

      expect(mocks.yjsManager.captureCaretSnapshot).not.toHaveBeenCalled();

      await readOnly.toggle(false);

      expect(mocks.caret.setToInput).not.toHaveBeenCalled();
    });

    it('does not steal focus back when the user focused outside during read-only', async () => {
      const { readOnly, mocks } = createReadOnly();

      setupCaretDom(mocks);

      await readOnly.toggle(true);

      const button = document.createElement('button');

      document.body.appendChild(button);
      button.focus();

      await readOnly.toggle(false);

      expect(mocks.caret.setToInput).not.toHaveBeenCalled();
    });
  });

  describe('reapplyCollaborationArbitration', () => {
    it('skips the module cascade when the derived state is unchanged', async () => {
      const { readOnly, mocks } = createReadOnly();

      const result = await readOnly.reapplyCollaborationArbitration();

      expect(result).toBe(false);
      expect(mocks.blockSelection.toggleReadOnly).not.toHaveBeenCalled();
      expect(mocks.toolbar.toggleReadOnly).not.toHaveBeenCalled();
    });

    it('still applies when the derived state changed', async () => {
      const { readOnly, mocks } = createReadOnly({
        collaboration: { isEditingBlocked: true },
      });

      const result = await readOnly.reapplyCollaborationArbitration();

      expect(result).toBe(true);
      expect(readOnly.isEnabled).toBe(true);
      expect(mocks.blockSelection.toggleReadOnly).toHaveBeenCalledWith(true);
    });
  });
});


