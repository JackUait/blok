import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DragNDrop from '../../../../src/components/modules/dragNDrop';
import SelectionUtils from '../../../../src/components/selection';
import EventsDispatcher from '../../../../src/components/utils/events';
import type { EditorEventMap } from '../../../../src/components/events';
import type { EditorModules } from '../../../../src/types-internal/editor-modules';
import type { EditorConfig } from '../../../../types';
import type Block from '../../../../src/components/block';

type TestModules = {
  UI: {
    nodes: {
      holder: HTMLElement;
    };
  };
  BlockManager: {
    blocks: Block[];
    setCurrentBlockByChildNode: ReturnType<typeof vi.fn>;
    lastBlock: Block | { holder: HTMLElement };
  };
  Paste: {
    processDataTransfer: ReturnType<typeof vi.fn>;
  };
  Caret: {
    setToBlock: ReturnType<typeof vi.fn>;
    positions: {
      START: string;
      END: string;
    };
  };
  InlineToolbar: {
    close: ReturnType<typeof vi.fn>;
  };
};
type PartialModules = Partial<TestModules>;
type DragNDropTestContext = {
  dragNDrop: DragNDrop;
  modules: TestModules;
};
type InternalDragNDrop = {
  readOnlyMutableListeners: {
    on: (element: EventTarget, event: string, handler: (event: Event) => void, options?: boolean | AddEventListenerOptions) => void;
    clearAll: () => void;
  };
  processDrop: (event: DragEvent) => Promise<void>;
  processDragStart: () => void;
  processDragOver: (event: DragEvent) => void;
  isStartedAtEditor: boolean;
};

const createDragNDrop = (overrides: PartialModules = {}): DragNDropTestContext => {
  const dragNDrop = new DragNDrop({
    config: {} as EditorConfig,
    eventsDispatcher: new EventsDispatcher<EditorEventMap>(),
  });

  const holder = document.createElement('div');
  const lastBlockHolder = document.createElement('div');

  const defaults: TestModules = {
    UI: {
      nodes: {
        holder,
      },
    },
    BlockManager: {
      blocks: [],
      setCurrentBlockByChildNode: vi.fn(),
      lastBlock: {
        holder: lastBlockHolder,
      },
    },
    Paste: {
      processDataTransfer: vi.fn().mockResolvedValue(undefined),
    },
    Caret: {
      setToBlock: vi.fn(),
      positions: {
        START: 'start-position',
        END: 'end-position',
      },
    },
    InlineToolbar: {
      close: vi.fn(),
    },
  };

  const mergedState: TestModules = {
    ...defaults,
    ...overrides,
  };

  dragNDrop.state = mergedState as unknown as EditorModules;

  return {
    dragNDrop,
    modules: mergedState,
  };
};

describe('DragNDrop', () => {
  let dragNDrop: DragNDrop;
  let modules: TestModules;

  beforeEach(() => {
    vi.clearAllMocks();

    ({
      dragNDrop,
      modules,
    } = createDragNDrop());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const getInternal = (): InternalDragNDrop => {
    return dragNDrop as unknown as InternalDragNDrop;
  };

  it('clears listeners when toggled to read-only mode', () => {
    const internal = getInternal();
    const clearSpy = vi.spyOn(internal.readOnlyMutableListeners, 'clearAll');

    dragNDrop.toggleReadOnly(true);

    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('attaches drag-and-drop listeners when read-only mode is disabled', () => {
    const internal = getInternal();
    const onSpy = vi.spyOn(internal.readOnlyMutableListeners, 'on');
    const holder = modules.UI.nodes.holder;

    dragNDrop.toggleReadOnly(false);

    expect(onSpy).toHaveBeenNthCalledWith(1, holder, 'drop', expect.any(Function), true);
    expect(onSpy).toHaveBeenNthCalledWith(2, holder, 'dragstart', expect.any(Function));
    expect(onSpy).toHaveBeenNthCalledWith(3, holder, 'dragover', expect.any(Function), true);
  });

  it('marks drag start when selection exists in editor and closes inline toolbar', () => {
    const internal = getInternal();
    const { close } = modules.InlineToolbar;

    vi.spyOn(SelectionUtils, 'isAtEditor', 'get').mockReturnValue(true);
    vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(false);

    internal.isStartedAtEditor = false;
    internal.processDragStart();

    expect(internal.isStartedAtEditor).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not mark drag start when selection is collapsed', () => {
    const internal = getInternal();
    const { close } = modules.InlineToolbar;

    vi.spyOn(SelectionUtils, 'isAtEditor', 'get').mockReturnValue(true);
    vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(true);

    internal.isStartedAtEditor = false;
    internal.processDragStart();

    expect(internal.isStartedAtEditor).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('resets blocks drop target and positions caret on found block after drop', async () => {
    const internal = getInternal();
    const blockA = { dropTarget: true } as unknown as Block;
    const blockB = { dropTarget: true } as unknown as Block;
    const targetBlock = { id: 'target-block' } as unknown as Block;
    const blocksManager = modules.BlockManager;

    blocksManager.blocks = [
      blockA,
      blockB,
    ];
    blocksManager.setCurrentBlockByChildNode = vi.fn().mockReturnValue(targetBlock);

    const caret = modules.Caret;
    const processDataTransfer = modules.Paste.processDataTransfer;

    const dropEvent = {
      preventDefault: vi.fn(),
      target: document.createElement('div'),
      dataTransfer: {} as DataTransfer,
    } as unknown as DragEvent;

    await internal.processDrop(dropEvent);

    expect(dropEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(blockA.dropTarget).toBe(false);
    expect(blockB.dropTarget).toBe(false);
    expect(caret.setToBlock).toHaveBeenCalledWith(targetBlock, caret.positions.END);
    expect(processDataTransfer).toHaveBeenCalledWith(dropEvent.dataTransfer, true);
    expect(internal.isStartedAtEditor).toBe(false);
  });

  it('falls back to the last block when drop target block is not found', async () => {
    const internal = getInternal();
    const lastBlock = { id: 'last',
      holder: document.createElement('div') } as unknown as Block;
    const blocksManager = modules.BlockManager;

    blocksManager.lastBlock = lastBlock;
    blocksManager.setCurrentBlockByChildNode = vi.fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(lastBlock);

    const caret = modules.Caret;

    const dropEvent = {
      preventDefault: vi.fn(),
      target: document.createElement('div'),
      dataTransfer: {} as DataTransfer,
    } as unknown as DragEvent;

    await internal.processDrop(dropEvent);

    expect(blocksManager.setCurrentBlockByChildNode).toHaveBeenNthCalledWith(1, dropEvent.target);
    expect(blocksManager.setCurrentBlockByChildNode).toHaveBeenNthCalledWith(2, lastBlock.holder);
    expect(caret.setToBlock).toHaveBeenCalledWith(lastBlock, caret.positions.END);
  });

  it('deletes selection when drop starts inside editor with non-collapsed selection', async () => {
    const internal = getInternal();
    const blocksManager = modules.BlockManager;

    blocksManager.blocks = [];
    blocksManager.setCurrentBlockByChildNode = vi.fn().mockReturnValue(undefined);

    internal.isStartedAtEditor = true;

    vi.spyOn(SelectionUtils, 'isAtEditor', 'get').mockReturnValue(true);
    vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(false);

    const execCommandMock = vi.fn().mockReturnValue(true);

    (document as Document & { execCommand: (commandId: string) => boolean }).execCommand = execCommandMock;

    const dropEvent = {
      preventDefault: vi.fn(),
      target: document.createElement('div'),
      dataTransfer: {} as DataTransfer,
    } as unknown as DragEvent;

    await internal.processDrop(dropEvent);

    expect(execCommandMock).toHaveBeenCalledWith('delete');
    expect(internal.isStartedAtEditor).toBe(false);
  });

  it('prevents default behavior on drag over', () => {
    const internal = getInternal();
    const preventDefault = vi.fn();

    internal.processDragOver({
      preventDefault,
    } as unknown as DragEvent);

    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});


