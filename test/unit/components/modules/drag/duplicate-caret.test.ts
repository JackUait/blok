/**
 * Regression coverage for BUG #9 — after Cmd/Ctrl+D the caret must land in the
 * NEW copy ready to edit. Before the fix `duplicateBlocksInPlace` left the
 * duplicates block-selected (via DragOperations.applyDuplicates) and only
 * repositioned the toolbar, so the user ended block-selected, not editing.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { DragController as DragManager } from '../../../../../src/components/modules/drag/DragController';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../src/components/block';
import { BlockToolAdapter } from '../../../../../src/components/tools/block';
import type { API } from '../../../../../types';
import * as tooltip from '../../../../../src/components/utils/tooltip';
import * as announcer from '../../../../../src/components/utils/announcer';

vi.mock(
  '../../../../../src/components/modules/drag/utils/ColumnDropAnimation',
  () => ({
    animateColumnWidths: vi.fn(),
    captureSiblingTops: vi.fn().mockReturnValue([]),
    playSiblingShift: vi.fn(),
    settleDragPreview: vi.fn(),
    finishColumnDropAnimations: vi.fn(),
  })
);

const createBlockStub = (id: string): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  let isSelected = false;
  const block = {
    id,
    name: 'paragraph',
    holder,
    stretched: false,
    contentIds: [] as string[],
    parentId: null as string | null,
    call: vi.fn(),
    save: vi.fn().mockResolvedValue({ data: { text: id }, tunes: {} }),
  };

  Object.defineProperty(block, 'selected', {
    configurable: true,
    enumerable: true,
    get: () => isSelected,
    set: (value: boolean) => {
      isSelected = value;
    },
  });

  return block as unknown as Block;
};

type CaretMock = {
  setToBlock: Mock;
  positions: { START: string; END: string; DEFAULT: string };
};

type DupSetup = {
  dragManager: DragManager;
  blocks: Block[];
  caret: CaretMock;
  clearSelection: Mock;
  selectBlock: Mock;
  moveAndOpen: Mock;
  blockSelection: { selectedBlocks: Block[]; clearSelection: Mock; selectBlock: Mock };
  tools: Record<string, unknown> & { blockTools: Map<string, unknown> };
  insert: Mock;
};

const createSetup = (
  dups: Block | Block[],
  blocks: Block[] = [createBlockStub('block-1'), createBlockStub('block-2')]
): DupSetup => {
  const dupQueue = Array.isArray(dups) ? [...dups] : [dups];
  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-blok-editor', '');

  const allBlocks = [...blocks, ...dupQueue];

  // Hand out one fresh copy per insert() call so a multi-block selection yields
  // distinct duplicated blocks (single-block setups still get their one dup).
  let insertCount = 0;
  const blockManager = {
    blocks,
    getBlockIndex: vi.fn((block: Block) => allBlocks.indexOf(block)),
    getBlockByIndex: vi.fn((index: number) => blocks[index]),
    getBlockById: vi.fn((id: string) => allBlocks.find((b) => b.id === id)),
    move: vi.fn(),
    insert: vi.fn(() => dupQueue[insertCount++] ?? dupQueue[dupQueue.length - 1]),
    setBlockParent: vi.fn(),
    setBlockIndent: vi.fn(),
  };

  const clearSelection = vi.fn();
  const selectBlock = vi.fn();
  const blockSelection = {
    selectedBlocks: [] as Block[],
    clearSelection,
    selectBlock,
  };

  const moveAndOpen = vi.fn();
  const toolbar = {
    close: vi.fn(),
    moveAndOpen,
    skipNextSettingsToggle: vi.fn(),
  };

  const caret: CaretMock = {
    setToBlock: vi.fn(),
    positions: { START: 'start', END: 'end', DEFAULT: 'default' },
  };

  const ui = {
    nodes: { wrapper, redactor: document.createElement('div'), holder: document.createElement('div') },
    contentRect: { left: 0, right: 650 },
  };

  const i18n = { t: vi.fn((key: string) => key), has: vi.fn(() => false) };

  const yjsManager = {
    transact: vi.fn((cb: () => void) => cb()),
    transactMoves: vi.fn((cb: () => void) => cb()),
  };

  // Side (left/right) drops are gated on the columns tool being registered.
  const tools: DupSetup['tools'] = {
    blockTools: new Map<string, unknown>([['column_list', {}], ['column', {}]]),
  };

  const state = {
    BlockManager: blockManager as unknown as BlokModules['BlockManager'],
    BlockSelection: blockSelection as unknown as BlokModules['BlockSelection'],
    Toolbar: toolbar as unknown as BlokModules['Toolbar'],
    Caret: caret as unknown as BlokModules['Caret'],
    UI: ui as unknown as BlokModules['UI'],
    I18n: i18n as unknown as BlokModules['I18n'],
    Tools: tools as unknown as BlokModules['Tools'],
    YjsManager: yjsManager as unknown as BlokModules['YjsManager'],
  } as BlokModules;

  const dragManager = new DragManager({
    config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  dragManager.state = state;
  void dragManager.prepare();

  return { dragManager, blocks, caret, clearSelection, selectBlock, moveAndOpen, blockSelection, tools, insert: blockManager.insert };
};

describe('duplicateBlocksInPlace caret placement (BUG #9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(tooltip, 'hide').mockImplementation(() => undefined);
    vi.spyOn(announcer, 'announce').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('places the caret into the duplicated copy instead of block-selecting it', async () => {
    const dup = createBlockStub('dup-1');
    const { dragManager, blocks, caret, clearSelection } = createSetup(dup);

    await dragManager.duplicateBlocksInPlace(blocks[0]);

    // The lingering block selection from applyDuplicates is cleared, and a text
    // caret lands at the end of the new copy ready to edit (Notion parity).
    expect(clearSelection).toHaveBeenCalled();
    expect(caret.setToBlock).toHaveBeenCalledWith(dup, caret.positions.END);
  });

  it.each([
    ['with a link url', (): { url: string; text: string } => ({ url: 'https://x.test/p1', text: 'Plans' })],
    ['without a link url', (): null => null],
  ])('duplicates a page block %s as another entry point to the same page', async (_, copyAsLink) => {
    const dup = createBlockStub('dup-1');
    const { dragManager, blocks, tools, insert } = createSetup(dup);

    Object.assign(blocks[0], {
      name: 'page',
      save: vi.fn().mockResolvedValue({ data: { pageId: 'p1', textColor: 'red' }, tunes: {} }),
    });
    tools.blockTools.set('page', { copyAsLink, duplicateData: () => ({ pageId: 'p1-copy' }) });
    tools.defaultTool = { name: 'paragraph', conversionConfig: { import: 'text' }, settings: {} };

    const copied = await dragManager.duplicateBlocksInPlace(blocks[0]);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({ tool: 'page', data: { pageId: 'p1', textColor: 'red' } });
    expect(copied).toEqual([dup]);
  });

  it('duplicates a block with the data its tool gives', async () => {
    const dup = createBlockStub('dup-1');
    const { dragManager, blocks, tools, insert } = createSetup(dup);

    Object.assign(blocks[0], {
      name: 'custom',
      save: vi.fn().mockResolvedValue({ data: { ref: 'r1' }, tunes: {} }),
    });
    tools.blockTools.set('custom', {
      duplicateData: (data: { ref: string }) => ({ ref: `${data.ref}-copy` }),
      copyAsLink: () => ({ url: 'https://x.test/r1', text: 'Ref' }),
    });

    await dragManager.duplicateBlocksInPlace(blocks[0]);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({ tool: 'custom', data: { ref: 'r1-copy' } });
  });

  it('duplicates a custom block with its ordinary data when copyAsLink throws', async () => {
    class CustomTool {
      public static copyAsLink(): never {
        throw new Error('link lookup failed');
      }

      public render(): HTMLElement {
        return document.createElement('div');
      }

      public save(): { text: string } {
        return { text: 'ordinary copy' };
      }
    }

    const dup = createBlockStub('dup-1');
    const { dragManager, blocks, tools, insert } = createSetup(dup);

    Object.assign(blocks[0], {
      name: 'custom',
      save: vi.fn().mockResolvedValue({ data: { text: 'ordinary copy' }, tunes: { alignment: { alignment: 'center' } } }),
    });
    tools.blockTools.set('custom', new BlockToolAdapter({
      name: 'custom',
      constructable: CustomTool,
      config: {},
      api: {} as API,
      isDefault: false,
      isInternal: false,
    }));

    const copied = await dragManager.duplicateBlocksInPlace(blocks[0]);

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'custom',
      data: { text: 'ordinary copy' },
      tunes: { alignment: { alignment: 'center' } },
    }));
    expect(copied).toEqual([dup]);
  });

  it('briefly highlights the duplicated copy as just-added (blue arrival pulse)', async () => {
    const dup = createBlockStub('dup-1');
    const { dragManager, blocks } = createSetup(dup);

    expect(dup.holder.classList.contains('blok-block--target')).toBe(false);

    await dragManager.duplicateBlocksInPlace(blocks[0]);

    // Notion parity: a freshly duplicated block gets the same blue "just added"
    // arrival pulse as a hash-navigated block (the `blok-block--target` class,
    // whose keyframes tween `var(--blok-selection)`), signalling what just
    // appeared. Placing the caret alone (BUG #9) gave no visible cue.
    expect(dup.holder.classList.contains('blok-block--target')).toBe(true);
  });

  it('keeps the duplicated blocks block-selected when the source was a block selection', async () => {
    const dup1 = createBlockStub('dup-1');
    const dup2 = createBlockStub('dup-2');
    const { dragManager, blocks, caret, selectBlock, blockSelection } = createSetup([dup1, dup2]);

    // Source: a multi-block BLOCK selection (both blocks selected).
    for (const block of blocks) {
      block.selected = true;
    }
    blockSelection.selectedBlocks = blocks;

    await dragManager.duplicateBlocksInPlace(blocks[0]);

    // Notion parity: duplicating a block selection keeps the NEW copies selected
    // (so the duplicate move can be repeated), rather than collapsing to a caret.
    expect(selectBlock).toHaveBeenCalledWith(dup1);
    expect(selectBlock).toHaveBeenCalledWith(dup2);
    expect(caret.setToBlock).not.toHaveBeenCalled();
  });
});
