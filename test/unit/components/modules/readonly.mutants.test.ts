/**
 * Mutation-targeted tests for `src/components/modules/readonly.ts`.
 *
 * Each test names one defect: a guard whose removal would silently fall
 * through, or a wrong argument that would reach a collaborator unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { ReadOnly } from '../../../../src/components/modules/readonly';
import type { CaretSnapshot } from '../../../../src/components/modules/yjs/types';
import type { BlokConfig } from '../../../../types';

type ToolStub = { isReadOnlySupported?: boolean; supportsInPlaceReadOnly?: boolean };

interface CreateReadOnlyOptions {
  config?: BlokConfig;
  blockTools?: Array<[string, ToolStub]>;
  saverBlocks?: unknown[];
  collaboration?: { isEditingBlocked: boolean };
}

type BlockStub = { setReadOnly: MockInstance<(state: boolean) => void> };

type ReadOnlyMocks = {
  modificationsObserver: {
    disable: MockInstance<() => void>;
    enable: MockInstance<() => void>;
  };
  saver: {
    save: MockInstance<(options?: unknown) => Promise<{ blocks: unknown[] }>>;
  };
  blockManager: {
    blocks: BlockStub[] | undefined;
    clear: MockInstance<() => Promise<void>>;
    getBlockById: MockInstance<(id: string) => { inputs: HTMLElement[] } | undefined>;
    toggleReadOnly: MockInstance<(state: boolean) => void>;
    withViewRebuild: MockInstance<(rebuild: () => Promise<void>) => Promise<void>>;
  };
  renderer: {
    render: MockInstance<(blocks: unknown, options?: unknown) => Promise<void>>;
    markRenderStart: MockInstance<() => void>;
    markRenderEnd: MockInstance<() => void>;
  };
  toolbar: { toggleReadOnly: MockInstance<(state: boolean) => void> };
  inlineToolbar: { toggleReadOnly: MockInstance<(state: boolean) => void> };
  blockSelection: { toggleReadOnly: MockInstance<(state: boolean) => void> };
  ui: { nodes: { wrapper: HTMLDivElement } };
  yjsManager: { captureCaretSnapshot: MockInstance<() => CaretSnapshot | null> };
  caret: {
    setToInput: MockInstance<(input: HTMLElement, position?: string, offset?: number) => void>;
    positions: { START: string; END: string; DEFAULT: string };
  };
};

type CreateReadOnlyResult = {
  readOnly: ReadOnly;
  mocks: ReadOnlyMocks;
  modules: Record<string, unknown>;
};

const createReadOnly = (options?: CreateReadOnlyOptions): CreateReadOnlyResult => {
  const blockTools = new Map<string, ToolStub>(options?.blockTools ?? []);

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
    save: vi.fn<(options?: unknown) => Promise<{ blocks: unknown[] }>>(async () => ({
      blocks: options?.saverBlocks ?? [],
    })),
  };

  const blockManager: ReadOnlyMocks['blockManager'] = {
    blocks: [],
    clear: vi.fn<() => Promise<void>>(async () => undefined),
    getBlockById: vi.fn<(id: string) => { inputs: HTMLElement[] } | undefined>(() => undefined),
    toggleReadOnly: vi.fn<(state: boolean) => void>(() => undefined),
    withViewRebuild: vi.fn<(rebuild: () => Promise<void>) => Promise<void>>(async (rebuild) => {
      await rebuild();
    }),
  };

  const renderer: ReadOnlyMocks['renderer'] = {
    render: vi.fn<(blocks: unknown, options?: unknown) => Promise<void>>(async () => undefined),
    markRenderStart: vi.fn<() => void>(() => undefined),
    markRenderEnd: vi.fn<() => void>(() => undefined),
  };

  const toolbar: ReadOnlyMocks['toolbar'] = {
    toggleReadOnly: vi.fn<(state: boolean) => void>(() => undefined),
  };

  const inlineToolbar: ReadOnlyMocks['inlineToolbar'] = {
    toggleReadOnly: vi.fn<(state: boolean) => void>(() => undefined),
  };

  const blockSelection: ReadOnlyMocks['blockSelection'] = {
    toggleReadOnly: vi.fn<(state: boolean) => void>(() => undefined),
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

  const modules: Record<string, unknown> = {
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
    Tools: { blockTools },
  };

  readOnly.state = modules as unknown as ReadOnly['Blok'];

  return {
    readOnly,
    modules,
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

type SelectionState = { anchorNode: Node | null };

/**
 * A live selection inside the wrapper, plus a snapshot that resolves to a
 * connected input. BlockSelection.toggleReadOnly nulls the anchor, mimicking
 * its real removeAllRanges.
 */
const setupCaretDom = (mocks: ReadOnlyMocks): { input: HTMLDivElement; selectionState: SelectionState } => {
  const { wrapper } = mocks.ui.nodes;
  const input = document.createElement('div');
  const textNode = document.createTextNode('caret here');

  input.appendChild(textNode);
  wrapper.appendChild(input);
  document.body.appendChild(wrapper);

  const selectionState: SelectionState = { anchorNode: textNode };

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

const IN_PLACE_TOOLS: Array<[string, ToolStub]> = [
  ['paragraph', { isReadOnlySupported: true, supportsInPlaceReadOnly: true }],
];

describe('ReadOnly mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('toggle() with no argument flips the current state instead of repeating it', async () => {
    const { readOnly } = createReadOnly();

    await readOnly.toggle(true);

    const result = await readOnly.toggle();

    expect(result).toBe(false);
    expect(readOnly.isEnabled).toBe(false);
  });

  it('a redundant toggle(true) does not re-capture the caret', async () => {
    const { readOnly, mocks } = createReadOnly();
    const { input } = setupCaretDom(mocks);

    const otherInput = document.createElement('div');

    otherInput.appendChild(document.createTextNode('second'));
    mocks.ui.nodes.wrapper.appendChild(otherInput);

    mocks.yjsManager.captureCaretSnapshot
      .mockReturnValueOnce({ blockId: 'block-1', inputIndex: 0, offset: 4 })
      .mockReturnValue({ blockId: 'block-2', inputIndex: 0, offset: 99 });
    mocks.blockManager.getBlockById.mockImplementation((id: string) => {
      if (id === 'block-1') {
        return { inputs: [input] };
      }

      return id === 'block-2' ? { inputs: [otherInput] } : undefined;
    });

    await readOnly.toggle(true);
    await readOnly.toggle(true);
    await readOnly.toggle(false);

    // The snapshot taken while turning read-only on is the one restored
    expect(mocks.caret.setToInput).toHaveBeenCalledWith(input, 'default', 4);
  });

  it('in-place toggle does not restore the caret while turning read-only ON', async () => {
    const { readOnly, mocks } = createReadOnly({ config: { readOnly: false }, blockTools: IN_PLACE_TOOLS });

    await readOnly.prepare();

    setupCaretDom(mocks);

    await readOnly.toggle(true);

    expect(mocks.caret.setToInput).not.toHaveBeenCalled();
    expect(mocks.saver.save).not.toHaveBeenCalled();
  });

  it('restore is skipped when the snapshot resolves to no block', async () => {
    const { readOnly, mocks } = createReadOnly();

    setupCaretDom(mocks);

    await readOnly.toggle(true);

    mocks.blockManager.getBlockById.mockReturnValue(undefined);

    await expect(readOnly.toggle(false)).resolves.toBe(false);

    expect(mocks.caret.setToInput).not.toHaveBeenCalled();
  });

  it('restore is skipped when the block input is detached from the DOM', async () => {
    const { readOnly, mocks } = createReadOnly();

    setupCaretDom(mocks);

    await readOnly.toggle(true);

    const detached = document.createElement('div');

    mocks.blockManager.getBlockById.mockReturnValue({ inputs: [detached] });

    await readOnly.toggle(false);

    expect(detached.isConnected).toBe(false);
    expect(mocks.caret.setToInput).not.toHaveBeenCalled();
  });

  it('capture is skipped when UI has no wrapper yet', async () => {
    const { readOnly, mocks, modules } = createReadOnly();

    setupCaretDom(mocks);
    modules.UI = undefined;

    await expect(readOnly.toggle(true)).resolves.toBe(true);

    expect(mocks.yjsManager.captureCaretSnapshot).not.toHaveBeenCalled();
  });

  it('capture is skipped when YjsManager is absent', async () => {
    const { readOnly, mocks, modules } = createReadOnly();

    setupCaretDom(mocks);
    modules.YjsManager = undefined;

    await expect(readOnly.toggle(true)).resolves.toBe(true);

    expect(mocks.caret.setToInput).not.toHaveBeenCalled();
  });

  it('capture is skipped when the document reports no selection', async () => {
    const { readOnly, mocks } = createReadOnly();

    setupCaretDom(mocks);

    vi.spyOn(window, 'getSelection').mockReturnValue(null);

    await expect(readOnly.toggle(true)).resolves.toBe(true);

    expect(mocks.yjsManager.captureCaretSnapshot).not.toHaveBeenCalled();
  });

  it('restore tolerates a missing UI wrapper', async () => {
    const { readOnly, mocks, modules } = createReadOnly();

    const { input } = setupCaretDom(mocks);

    await readOnly.toggle(true);

    modules.UI = undefined;

    await expect(readOnly.toggle(false)).resolves.toBe(false);

    expect(mocks.caret.setToInput).toHaveBeenCalledWith(input, 'default', 4);
  });

  it('restore tolerates a missing UI wrapper when focus left the editor', async () => {
    const { readOnly, mocks, modules } = createReadOnly();

    const { input } = setupCaretDom(mocks);

    await readOnly.toggle(true);

    const button = document.createElement('button');

    document.body.appendChild(button);
    button.focus();

    // Load-bearing precondition: the defect only shows while focus is outside
    expect(button).toHaveFocus();

    modules.UI = undefined;

    await expect(readOnly.toggle(false)).resolves.toBe(false);

    expect(mocks.caret.setToInput).toHaveBeenCalledWith(input, 'default', 4);
  });

  it('restore runs when nothing at all holds focus', async () => {
    const { readOnly, mocks } = createReadOnly();

    const { input } = setupCaretDom(mocks);

    await readOnly.toggle(true);

    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);

    await readOnly.toggle(false);

    expect(mocks.caret.setToInput).toHaveBeenCalledWith(input, 'default', 4);
  });

  it('a null module entry is skipped without touching its properties', async () => {
    const { readOnly, mocks, modules } = createReadOnly();

    modules.NullModule = null;

    await expect(readOnly.toggle(true)).resolves.toBe(true);

    expect(mocks.toolbar.toggleReadOnly).toHaveBeenCalledWith(true);
  });

  it('the in-place path survives a BlockManager without a blocks array', async () => {
    const { readOnly, mocks } = createReadOnly({ config: { readOnly: false }, blockTools: IN_PLACE_TOOLS });

    await readOnly.prepare();

    mocks.blockManager.blocks = undefined;

    await expect(readOnly.toggle(true)).resolves.toBe(true);

    expect(mocks.modificationsObserver.enable).toHaveBeenCalledTimes(1);
  });

  it('saves with the internal dialect so nesting survives the round trip', async () => {
    const { readOnly, mocks } = createReadOnly({ saverBlocks: [{ id: 'block-1' }] });

    await readOnly.toggle(true);

    expect(mocks.saver.save).toHaveBeenCalledWith({ dialect: 'internal' });
  });

  it('marks the render boundaries exactly once around the re-render', async () => {
    const { readOnly, mocks } = createReadOnly({ saverBlocks: [{ id: 'block-1' }] });

    await readOnly.toggle(true);

    expect(mocks.renderer.markRenderStart).toHaveBeenCalledTimes(1);
    expect(mocks.renderer.markRenderEnd).toHaveBeenCalledTimes(1);
  });

  it('set() leaves the config alone when hideControls is not a boolean', async () => {
    const { readOnly } = createReadOnly({ config: { readOnly: { hideControls: true } } });

    await readOnly.prepare();

    expect(readOnly.isControlsHidden).toBe(true);

    await readOnly.set(true, {});

    expect(readOnly.isControlsHidden).toBe(true);
  });

  it('warns with the exact refusal message when read-only cannot be turned off', async () => {
    const { readOnly } = createReadOnly({ collaboration: { isEditingBlocked: true } });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await readOnly.toggle(false);

    expect(warnSpy).toHaveBeenCalledWith(
      'Read-only cannot be turned off yet: the collaboration session is not synced, or grants no write access.'
    );
    expect(result).toBe(false);
  });

  it('names every unsupported tool in the critical error', async () => {
    const { readOnly } = createReadOnly({
      blockTools: [
        ['alpha', { isReadOnlySupported: false }],
        ['beta', { isReadOnlySupported: false }],
      ],
    });

    await readOnly.prepare();

    await expect(readOnly.set(true)).rejects.toThrowError(
      new Error(
        "To enable read-only mode all connected tools should support it. Tools alpha, beta don't support read-only mode."
      )
    );
  });
});
