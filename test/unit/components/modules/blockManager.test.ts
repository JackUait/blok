import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MockInstance } from 'vitest';

import { BlockManager } from '../../../../src/components/modules/blockManager';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokConfig } from '../../../../types';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import { BlockChanged } from '../../../../src/components/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { Block } from '../../../../src/components/block';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import type { InlineToolAdapter } from '../../../../src/components/tools/inline';
import type { BlockTuneAdapter } from '../../../../src/components/tools/tune';
import { ToolsCollection } from '../../../../src/components/tools/collection';
import { ToolNotFoundError } from '../../../../src/components/errors/tool-not-found';
import { ToolType } from '@/types/tools/adapters/tool-type';
import type { BlockToolConstructable } from '@/types/tools/block-tool';
import type { ConversionConfig } from '@/types/configs/conversion-config';
import { BlockAddedMutationType } from '../../../../types/events/block/BlockAdded';
import { BlockRemovedMutationType } from '../../../../types/events/block/BlockRemoved';
import { BlockMovedMutationType } from '../../../../types/events/block/BlockMoved';
import { BlockChangedMutationType } from '../../../../types/events/block/BlockChanged';
import type { BlockMutationEventDetail } from '../../../../types/events/block/Base';

interface BlockManagerInternalAccess {
  factory: {
    composeBlock(): Block;
  };
  operations: {
    replace(block: Block, tool: string, data: Record<string, unknown>): Block;
  };
  blockDidMutated<Type extends string>(
    mutationType: Type,
    block: Block,
    detailData: Record<string, unknown>
  ): Block;
}

type BlockManagerContext = {
  blockManager: BlockManager;
  composeBlockSpy: MockInstance;
  eventsDispatcher: EventsDispatcher<BlokEventMap>;
};

type CreateBlockManagerOptions = {
  initialBlocks?: Block[];
  blokOverrides?: Partial<BlokModules>;
  useCustomEventsDispatcher?: boolean;
};

/**
 * Create a mock BlockToolAdapter for testing
 */
const createMockToolAdapter = (options: {
  name?: string;
  sanitizeConfig?: Record<string, boolean>;
  conversionConfig?: ConversionConfig;
  settings?: Record<string, unknown>;
} = {}): BlockToolAdapter => {
  const mockTool = {
    render: vi.fn(() => document.createElement('div')),
    save: vi.fn(() => ({})),
    rendered: () => {},
  };

  const adapter = {
    type: ToolType.Block,
    name: options.name ?? 'paragraph',
    constructable: class {
      render = mockTool.render;
      save = mockTool.save;
      rendered = mockTool.rendered;
    } as unknown as BlockToolConstructable,
    create: vi.fn(() => mockTool),
    sanitizeConfig: options.sanitizeConfig ?? {},
    conversionConfig: options.conversionConfig,
    settings: options.settings ?? {},
    toolbox: undefined,
    tunes: new ToolsCollection<BlockTuneAdapter>(),
    inlineTools: new ToolsCollection<InlineToolAdapter>(),
  } as unknown as BlockToolAdapter;

  return adapter;
};

/**
 * Create a ToolsCollection with mock tools
 */
const createMockToolsCollection = (toolNames: string[] = ['paragraph']): ToolsCollection<BlockToolAdapter> => {
  const collection = new ToolsCollection<BlockToolAdapter>();

  for (const name of toolNames) {
    const adapter = createMockToolAdapter({ name });
    collection.set(name, adapter);
  }

  return collection;
};

const createBlockStub = (options: {
  id?: string;
  name?: string;
  data?: Record<string, unknown>;
  tunes?: Record<string, unknown>;
} = {}): Block => {
  const holder = document.createElement('div');

  // Use data attribute for block element identification
  holder.setAttribute('data-blok-element', '');
  const inputs = [ document.createElement('div') ];
  const data = options.data ?? {};
  const preservedTunes = options.tunes ?? {};

  const block = {
    id: options.id ?? `block-${Math.random().toString(16)
      .slice(2)}`,
    name: options.name ?? 'paragraph',
    holder,
    call: vi.fn(),
    destroy: vi.fn(),
    unwatchBlockMutations: vi.fn(),
    tool: {
      name: options.name ?? 'paragraph',
      sanitizeConfig: {},
      conversionConfig: {},
      settings: {},
    } as Record<string, unknown>,
    tunes: preservedTunes,
    mergeable: false,
    mergeWith: vi.fn(),
    exportDataAsString: vi.fn().mockResolvedValue('{}'),
    inputs,
    isEmpty: false,
    updateCurrentInput: vi.fn(),
    focusable: true,
    selected: false,
    dispatchChange: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    validate: vi.fn().mockResolvedValue(true),
    setStretchState: vi.fn(),
    stretched: false,
    getActiveToolboxEntry: vi.fn().mockResolvedValue(undefined),
    config: {},
    parentId: null,
    contentIds: [],
  } as Record<string, unknown>;

  Object.defineProperty(block, 'tool', {
    value: block.tool,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(block, 'tunes', {
    value: block.tunes,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(block, 'data', {
    get: () => Promise.resolve(data),
  });

  Object.defineProperty(block, 'firstInput', {
    get: () => inputs[0],
  });

  Object.defineProperty(block, 'preservedData', {
    get: () => data,
  });

  Object.defineProperty(block, 'preservedTunes', {
    get: () => preservedTunes,
  });

  return block as unknown as Block;
};

const createBlockManager = (
  options: CreateBlockManagerOptions = {}
): BlockManagerContext => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const config = {
    defaultBlock: 'paragraph',
    sanitizer: {},
  } as BlokConfig;

  const blockManager = new BlockManager({
    config,
    eventsDispatcher,
  });

  const defaultBlokState: Partial<BlokModules> = {
    BlockEvents: {
      handleCommandC: vi.fn(),
      handleCommandX: vi.fn(),
      keydown: vi.fn(),
      keyup: vi.fn(),
    } as unknown as BlokModules['BlockEvents'],
    ReadOnly: {
      isEnabled: false,
    } as unknown as BlokModules['ReadOnly'],
    UI: {
      nodes: {
        holder: document.createElement('div'),
        redactor: document.createElement('div'),
        wrapper: document.createElement('div'),
      },
      CSS: {
        blokWrapper: '',
        blokWrapperNarrow: '',
        blokZone: '',
        blokZoneHidden: '',
        blokEmpty: '',
        blokRtlFix: '',
        blokDragging: '',
      },
      checkEmptiness: vi.fn(),
    } as unknown as BlokModules['UI'],
    Tools: {
      blockTools: createMockToolsCollection(['paragraph']),
    } as unknown as BlokModules['Tools'],
    YjsManager: {
      addBlock: vi.fn(),
      removeBlock: vi.fn(),
      moveBlock: vi.fn(),
      updateBlockData: vi.fn(() => true),
      updateBlockMetadata: vi.fn(() => true),
      updateBlockTune: vi.fn(),
      updateBlockIndent: vi.fn(),
      stopCapturing: vi.fn(),
      transact: vi.fn((fn: () => void) => fn()),
      toJSON: vi.fn(() => []),
      getBlockById: vi.fn(() => undefined),
      getBlockDataObject: vi.fn(() => undefined),
      onBlocksChanged: vi.fn(() => vi.fn()),
      fromJSON: vi.fn(),
    } as unknown as BlokModules['YjsManager'],
    Caret: {
      extractFragmentFromCaretPosition: vi.fn(),
      setToBlock: vi.fn(),
      positions: { START: 'start', END: 'end' },
    } as unknown as BlokModules['Caret'],
    I18n: {
      t: vi.fn((key: string) => key),
    } as unknown as BlokModules['I18n'],
  };

  blockManager.state = {
    ...defaultBlokState,
    ...options.blokOverrides,
  } as BlokModules;

  // Call prepare() to initialize the internal blocks storage
  blockManager.prepare();

  // Spy on factory.composeBlock to intercept block creation
  const composeBlockSpy = vi.spyOn(
    (blockManager as unknown as BlockManagerInternalAccess).factory,
    'composeBlock'
  );

  // Insert initial blocks using public API
  if (options.initialBlocks?.length) {
    blockManager.insertMany(options.initialBlocks, 0);
    blockManager.currentBlockIndex = 0;
  }

  return {
    blockManager,
    composeBlockSpy,
    eventsDispatcher,
  };
};

describe('BlockManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('inserts a block and dispatches added mutation', () => {
    const existingBlock = createBlockStub({ id: 'existing' });
    const { blockManager, composeBlockSpy, eventsDispatcher } = createBlockManager({
      initialBlocks: [ existingBlock ],
    });
    const newBlock = createBlockStub({ id: 'new-block' });
    composeBlockSpy.mockReturnValue(newBlock);
    const emitSpy = vi.spyOn(eventsDispatcher, 'emit');

    const result = blockManager.insert({ replace: true,
      needToFocus: true });

    expect(result).toBe(newBlock);
    expect(blockManager.currentBlockIndex).toBe(0);
    expect(blockManager.blocks).toEqual([newBlock]);
    // Verify block-removed event was dispatched
    const removedCalls = emitSpy.mock.calls.filter((call: unknown[]) => call[0] === BlockChanged);
    expect(removedCalls.some((call: unknown[]) => {
      const payload = call[1] as { event: CustomEvent<BlockMutationEventDetail> };
      return payload.event.type === BlockRemovedMutationType &&
             (payload.event.detail).target?.id === existingBlock.id;
    })).toBe(true);
    // Verify block-added event was dispatched
    expect(removedCalls.some((call: unknown[]) => {
      const payload = call[1] as { event: CustomEvent<BlockMutationEventDetail> };
      return payload.event.type === BlockAddedMutationType &&
             (payload.event.detail).target?.id === newBlock.id;
    })).toBe(true);
    expect(composeBlockSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'paragraph' })
    );
  });

  it('removes a block, updates current index, and emits removal mutation', async () => {
    const firstBlock = createBlockStub({ id: 'block-1' });
    const secondBlock = createBlockStub({ id: 'block-2' });
    const { blockManager, eventsDispatcher } = createBlockManager({
      initialBlocks: [firstBlock, secondBlock],
    });

    blockManager.currentBlockIndex = 1;
    const emitSpy = vi.spyOn(eventsDispatcher, 'emit');

    await blockManager.removeBlock(firstBlock, false);

    expect(firstBlock.destroy).toHaveBeenCalledTimes(1);
    expect(blockManager.currentBlockIndex).toBe(0);
    // Verify block-removed event was dispatched
    const removedCalls = emitSpy.mock.calls.filter((call: unknown[]) => call[0] === BlockChanged);
    expect(removedCalls.some((call: unknown[]) => {
      const payload = call[1] as { event: CustomEvent<BlockMutationEventDetail> };
      return payload.event.type === BlockRemovedMutationType &&
             (payload.event.detail).target?.id === firstBlock.id;
    })).toBe(true);
    expect(blockManager.blocks).toEqual([ secondBlock ]);
  });

  it('inserts a default block when the last block is removed', async () => {
    const block = createBlockStub({ id: 'single-block' });
    const defaultBlock = createBlockStub({ id: 'default-block' });
    const { blockManager, composeBlockSpy } = createBlockManager({
      initialBlocks: [ block ],
    });

    // Mock composeBlock to return our default block
    composeBlockSpy.mockReturnValue(defaultBlock);

    await blockManager.removeBlock(block);

    // Verify observable behavior: a default block was inserted via composeBlock
    expect(composeBlockSpy).toHaveBeenCalled();
    // The blocks array should contain at least one block (the default)
    expect(blockManager.blocks.length).toBeGreaterThan(0);
  });

  it('sets currentBlockIndex to 0 after removing the last block with addLastBlock=true', async () => {
    const block = createBlockStub({ id: 'only-block' });
    const defaultBlock = createBlockStub({ id: 'default-block' });
    const { blockManager, composeBlockSpy } = createBlockManager({
      initialBlocks: [ block ],
    });

    composeBlockSpy.mockReturnValue(defaultBlock);

    await blockManager.removeBlock(block);

    expect(blockManager.currentBlockIndex).toBe(0);
    expect(blockManager.currentBlock).toBeDefined();
  });

  it('moves a block and emits movement mutation', () => {
    const firstBlock = createBlockStub({ id: 'block-1' });
    const secondBlock = createBlockStub({ id: 'block-2' });
    const { blockManager, eventsDispatcher } = createBlockManager({
      initialBlocks: [firstBlock, secondBlock],
    });

    blockManager.currentBlockIndex = 1;
    const emitSpy = vi.spyOn(eventsDispatcher, 'emit');

    blockManager.move(0, 1);

    expect(blockManager.currentBlockIndex).toBe(0);
    expect(blockManager.currentBlock).toBe(secondBlock);
    expect(blockManager.blocks).toEqual([secondBlock, firstBlock]);
    // Verify block-moved event was dispatched
    const movedCalls = emitSpy.mock.calls.filter((call: unknown[]) => call[0] === BlockChanged);
    expect(movedCalls.some((call: unknown[]) => {
      const payload = call[1] as { event: CustomEvent<BlockMutationEventDetail> };
      return payload.event.type === BlockMovedMutationType &&
             (payload.event.detail).target?.id === secondBlock.id;
    })).toBe(true);
  });

  it('reparents a block via setBlockParent and emits a movement mutation', async () => {
    const firstBlock = createBlockStub({ id: 'block-1' });
    const secondBlock = createBlockStub({ id: 'block-2' });
    const { blockManager, eventsDispatcher } = createBlockManager({
      initialBlocks: [firstBlock, secondBlock],
    });

    // insertMany seeds blocks inside a Yjs atomic op whose cleanup is deferred to
    // requestAnimationFrame; flush it so isSyncingFromYjs returns to its real
    // resting state (false) before the user-style reparent.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const emitSpy = vi.spyOn(eventsDispatcher, 'emit');

    blockManager.setBlockParent(secondBlock, firstBlock.id);

    expect(secondBlock.parentId).toBe(firstBlock.id);
    // A programmatic reparent must notify 'block changed' listeners (e.g. the
    // React useBlocks hook) so they re-render — emitted as a BlockMoved mutation.
    const movedCalls = emitSpy.mock.calls.filter((call: unknown[]) => call[0] === BlockChanged);
    expect(movedCalls.some((call: unknown[]) => {
      const payload = call[1] as { event: CustomEvent<BlockMutationEventDetail> };
      return payload.event.type === BlockMovedMutationType &&
             (payload.event.detail).target?.id === secondBlock.id;
    })).toBe(true);
  });

  it('does not emit a movement mutation when setBlockParent does not change the parent', () => {
    const firstBlock = createBlockStub({ id: 'block-1' });
    const { blockManager, eventsDispatcher } = createBlockManager({
      initialBlocks: [firstBlock],
    });

    const emitSpy = vi.spyOn(eventsDispatcher, 'emit');

    // Already at root — reasserting null parent is a no-op reparent.
    blockManager.setBlockParent(firstBlock, null);

    const movedCalls = emitSpy.mock.calls.filter((call: unknown[]) =>
      call[0] === BlockChanged &&
      (call[1] as { event: CustomEvent<BlockMutationEventDetail> }).event.type === BlockMovedMutationType
    );
    expect(movedCalls).toHaveLength(0);
  });

  it('should not move a restricted tool into a table cell', () => {
    // Setup: block-1 (paragraph inside table cell), block-2 (header outside)
    const cellBlock = createBlockStub({ id: 'cell-block', name: 'paragraph' });
    const headerBlock = createBlockStub({ id: 'header-block', name: 'header' });
    const { blockManager } = createBlockManager({
      initialBlocks: [cellBlock, headerBlock],
    });

    // Place cellBlock's holder inside a table cell container
    const tableCellContainer = document.createElement('div');
    tableCellContainer.setAttribute('data-blok-table-cell-blocks', '');
    document.body.appendChild(tableCellContainer);
    tableCellContainer.appendChild(cellBlock.holder);

    blockManager.currentBlockIndex = 1;

    // Try to move header block (index 1) to index 0 (next to the cell block)
    blockManager.move(0, 1);

    // The move should be rejected — header is restricted in table cells
    // The header block should stay at its original position
    expect(blockManager.blocks[1]).toBe(headerBlock);
    expect(blockManager.blocks[0]).toBe(cellBlock);

    // Clean up
    document.body.removeChild(tableCellContainer);
  });

  it('recreates block with merged data when updating', async () => {
    const block = createBlockStub({ id: 'block-1',
      data: { text: 'Hello' },
      tunes: { alignment: 'left' } });
    const { blockManager, composeBlockSpy, eventsDispatcher } = createBlockManager({
      initialBlocks: [ block ],
    });
    const newBlock = createBlockStub({ id: 'block-1' });
    composeBlockSpy.mockReturnValue(newBlock);
    const emitSpy = vi.spyOn(eventsDispatcher, 'emit');

    const result = await blockManager.update(block, { text: 'Updated' }, { alignment: 'center' });

    expect(composeBlockSpy).toHaveBeenCalledWith({
      id: 'block-1',
      tool: 'paragraph',
      data: { text: 'Updated' },
      tunes: { alignment: 'center' },
      bindEventsImmediately: true,
    });
    // Verify block-changed event was dispatched
    const changedCalls = emitSpy.mock.calls.filter((call: unknown[]) => call[0] === BlockChanged);
    expect(changedCalls.some((call: unknown[]) => {
      const payload = call[1] as { event: CustomEvent<BlockMutationEventDetail> };
      return payload.event.type === BlockChangedMutationType &&
             (payload.event.detail).target?.id === newBlock.id;
    })).toBe(true);
    expect(blockManager.blocks[0]).toBe(newBlock);
    expect(result).toBe(newBlock);
  });

  it('returns original block when neither data nor tunes provided on update', async () => {
    const block = createBlockStub({ id: 'block-1' });
    const { blockManager, composeBlockSpy, eventsDispatcher } = createBlockManager({
      initialBlocks: [ block ],
    });
    const emitSpy = vi.spyOn(eventsDispatcher, 'emit');

    const result = await blockManager.update(block);

    expect(result).toBe(block);
    expect(composeBlockSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('inserts default block at provided index and shifts current index when not focusing it', () => {
    const existingBlock = createBlockStub({ id: 'existing' });
    const { blockManager, composeBlockSpy, eventsDispatcher } = createBlockManager({
      initialBlocks: [ existingBlock ],
    });

    blockManager.currentBlockIndex = 0;
    const defaultBlock = createBlockStub({ id: 'default' });
    composeBlockSpy.mockReturnValue(defaultBlock);
    const emitSpy = vi.spyOn(eventsDispatcher, 'emit');

    const result = blockManager.insertDefaultBlockAtIndex(0);

    expect(result).toBe(defaultBlock);
    expect(blockManager.blocks[0]).toBe(defaultBlock);
    expect(blockManager.currentBlockIndex).toBe(1);
    expect(composeBlockSpy).toHaveBeenCalledWith({ tool: 'paragraph', bindEventsImmediately: true });
    // Verify block-added event was dispatched
    const addedCalls = emitSpy.mock.calls.filter((call: unknown[]) => call[0] === BlockChanged);
    expect(addedCalls.some((call: unknown[]) => {
      const payload = call[1] as { event: CustomEvent<BlockMutationEventDetail> };
      return payload.event.type === BlockAddedMutationType &&
             (payload.event.detail).target?.id === defaultBlock.id;
    })).toBe(true);
  });

  it('focuses inserted default block when needToFocus is true', () => {
    const { blockManager, composeBlockSpy } = createBlockManager({
      initialBlocks: [createBlockStub({ id: 'first' }), createBlockStub({ id: 'second' })],
    });

    blockManager.currentBlockIndex = 1;
    const defaultBlock = createBlockStub({ id: 'focus-me' });

    composeBlockSpy.mockReturnValue(defaultBlock);

    blockManager.insertDefaultBlockAtIndex(1, true);

    expect(blockManager.blocks[1]).toBe(defaultBlock);
    expect(blockManager.currentBlockIndex).toBe(1);
  });

  it('throws a descriptive error when default block tool is missing', () => {
    const { blockManager } = createBlockManager();

    (blockManager as unknown as { config: BlokConfig }).config.defaultBlock = undefined;

    expect(() => blockManager.insertDefaultBlockAtIndex(0)).toThrow('Could not insert default Block. Default block tool is not defined in the configuration.');
  });

  it('throws (never returns undefined) when insert() is called with no tool and no default block', () => {
    /**
     * Pins the honest contract behind the public `editor.blocks.insert()` return type.
     * BlocksAPI.insert() forwards `tool: undefined` to BlockManager.insert when called
     * with neither a `type` argument nor a configured `defaultBlock`. The synthesis (H1)
     * claimed this path lets the public API return `undefined` despite its declared
     * `BlockAPI` return type. In reality BlockManager.insert (→ operations.insert →
     * BlockInsertion.insert) throws BEFORE constructing a block, so `new BlockAPI(...)`
     * never receives undefined and the public `BlockAPI` return type stays truthful.
     */
    const { blockManager } = createBlockManager();

    (blockManager as unknown as { config: BlokConfig }).config.defaultBlock = undefined;

    let returned: unknown = 'sentinel';

    expect(() => {
      returned = blockManager.insert({});
    }).toThrow('Could not insert Block. Tool name is not specified.');

    // The throw happens before any return, so no undefined ever leaks out.
    expect(returned).toBe('sentinel');
  });

  it('deletes selected blocks and inserts replacement when all blocks are selected', () => {
    const blocks = [
      createBlockStub({ id: 'first' }),
      createBlockStub({ id: 'second' }),
    ];

    blocks[0].selected = true;
    blocks[1].selected = true;

    const { blockManager } = createBlockManager({
      initialBlocks: blocks,
    });

    const removeSpy = vi
      .spyOn(blockManager as unknown as { removeBlock: BlockManager['removeBlock'] }, 'removeBlock')
      .mockResolvedValue();

    const replacementBlock = createBlockStub({ id: 'replacement' });
    const insertSpy = vi
      .spyOn(blockManager as unknown as { insert: BlockManager['insert'] }, 'insert')
      .mockReturnValue(replacementBlock);

    const result = blockManager.deleteSelectedBlocksAndInsertReplacement();

    // Should remove both selected blocks (in reverse order by index)
    expect(removeSpy).toHaveBeenNthCalledWith(1, blocks[1], false, true);
    expect(removeSpy).toHaveBeenNthCalledWith(2, blocks[0], false, true);

    // Should insert replacement block
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'paragraph',
      index: 0,
      needToFocus: true,
      skipYjsSync: true,
    }));

    expect(result).toBe(replacementBlock);
  });

  it('does NOT insert a replacement for a partial selection by default (Backspace over a subset)', () => {
    const blocks = [
      createBlockStub({ id: 'first' }),
      createBlockStub({ id: 'second' }),
      createBlockStub({ id: 'third' }),
    ];

    // Only the first two of three blocks are selected.
    blocks[0].selected = true;
    blocks[1].selected = true;

    const { blockManager } = createBlockManager({ initialBlocks: blocks });

    vi
      .spyOn(blockManager as unknown as { removeBlock: BlockManager['removeBlock'] }, 'removeBlock')
      .mockResolvedValue();

    const insertSpy = vi
      .spyOn(blockManager as unknown as { insert: BlockManager['insert'] }, 'insert')
      .mockReturnValue(createBlockStub({ id: 'replacement' }));

    const result = blockManager.deleteSelectedBlocksAndInsertReplacement();

    // A partial delete must not spawn a stray empty paragraph.
    expect(insertSpy).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('forces a replacement block for a partial selection when asked (typing over a subset)', () => {
    const blocks = [
      createBlockStub({ id: 'first' }),
      createBlockStub({ id: 'second' }),
      createBlockStub({ id: 'third' }),
    ];

    // Only the first two of three blocks are selected.
    blocks[0].selected = true;
    blocks[1].selected = true;

    const { blockManager } = createBlockManager({ initialBlocks: blocks });

    vi
      .spyOn(blockManager as unknown as { removeBlock: BlockManager['removeBlock'] }, 'removeBlock')
      .mockResolvedValue();

    const replacementBlock = createBlockStub({ id: 'replacement' });
    const insertSpy = vi
      .spyOn(blockManager as unknown as { insert: BlockManager['insert'] }, 'insert')
      .mockReturnValue(replacementBlock);

    const result = blockManager.deleteSelectedBlocksAndInsertReplacement(true);

    // The typed char gets one clean block at the seam (index of the first selected block).
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'paragraph',
      index: 0,
      needToFocus: true,
      skipYjsSync: true,
    }));
    expect(result).toBe(replacementBlock);
  });

  it('deletes flat-indented followers together with their selected parent block (Notion subtree delete)', () => {
    const parent = createBlockStub({ id: 'parent' });
    const indentedChild = createBlockStub({ id: 'child' });
    const sibling = createBlockStub({ id: 'sibling' });

    // child is visually nested under parent via flat indent; sibling is back at root
    indentedChild.holder.setAttribute('data-blok-depth', '1');

    parent.selected = true; // only the parent is explicitly selected

    const { blockManager } = createBlockManager({
      initialBlocks: [parent, indentedChild, sibling],
    });

    const removeSpy = vi
      .spyOn(blockManager as unknown as { removeBlock: BlockManager['removeBlock'] }, 'removeBlock')
      .mockResolvedValue();

    blockManager.deleteSelectedBlocksAndInsertReplacement();

    // parent AND its indented follower are removed; the root sibling is untouched
    expect(removeSpy).toHaveBeenCalledWith(indentedChild, false, true);
    expect(removeSpy).toHaveBeenCalledWith(parent, false, true);
    expect(removeSpy).not.toHaveBeenCalledWith(sibling, false, true);
  });

  it('splits the current block using caret fragment contents', () => {
    const fragment = document.createDocumentFragment();

    fragment.appendChild(document.createTextNode('Split content'));

    const caretStub = {
      extractFragmentFromCaretPosition: vi.fn().mockReturnValue(fragment),
    } as unknown as BlokModules['Caret'];

    const { blockManager, composeBlockSpy } = createBlockManager({
      initialBlocks: [ createBlockStub({ id: 'origin' }) ],
      blokOverrides: {
        Caret: caretStub,
      },
    });

    const insertedBlock = createBlockStub({ id: 'split' });
    composeBlockSpy.mockReturnValue(insertedBlock);

    const result = blockManager.split();

    expect(caretStub.extractFragmentFromCaretPosition).toHaveBeenCalledTimes(1);
    // Verify composeBlock was called with the extracted fragment content
    expect(composeBlockSpy).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'paragraph',
      data: { text: 'Split content' },
      bindEventsImmediately: true,
    }));
    expect(result).toBe(insertedBlock);
  });

  it('splits block with empty-only fragment and produces empty text data', () => {
    // Fragment containing only empty elements (br, empty spans) should be treated as empty
    const fragment = document.createDocumentFragment();
    const br = document.createElement('br');
    const emptySpan = document.createElement('span');
    fragment.appendChild(br);
    fragment.appendChild(emptySpan);

    const caretStub = {
      extractFragmentFromCaretPosition: vi.fn().mockReturnValue(fragment),
    } as unknown as BlokModules['Caret'];

    const { blockManager, composeBlockSpy } = createBlockManager({
      initialBlocks: [ createBlockStub({ id: 'origin' }) ],
      blokOverrides: {
        Caret: caretStub,
      },
    });

    const insertedBlock = createBlockStub({ id: 'split' });
    composeBlockSpy.mockReturnValue(insertedBlock);

    const result = blockManager.split();

    // Verify composeBlock was called with empty text (not with HTML markup)
    expect(composeBlockSpy).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'paragraph',
      data: { text: '' },
      bindEventsImmediately: true,
    }));
    expect(result).toBe(insertedBlock);
  });

  it('splits block with whitespace-only fragment and preserves the whitespace', () => {
    // Fragment containing only whitespace should preserve the whitespace (whitespace is meaningful content)
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode('   '));
    fragment.appendChild(document.createTextNode('\n'));

    const caretStub = {
      extractFragmentFromCaretPosition: vi.fn().mockReturnValue(fragment),
    } as unknown as BlokModules['Caret'];

    const { blockManager, composeBlockSpy } = createBlockManager({
      initialBlocks: [ createBlockStub({ id: 'origin' }) ],
      blokOverrides: {
        Caret: caretStub,
      },
    });

    const insertedBlock = createBlockStub({ id: 'split' });
    composeBlockSpy.mockReturnValue(insertedBlock);

    const result = blockManager.split();

    // Verify composeBlock was called with the whitespace preserved (whitespace is content)
    expect(composeBlockSpy).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'paragraph',
      data: { text: '   \n' },
      bindEventsImmediately: true,
    }));
    expect(result).toBe(insertedBlock);
  });

  it('converts a block using the target tool conversion config', async () => {
    const blockToConvert = createBlockStub({ id: 'paragraph',
      name: 'paragraph' });

    (blockToConvert.save as unknown as MockInstance).mockResolvedValue({ data: { text: 'Old' } });
    (blockToConvert.exportDataAsString as unknown as MockInstance).mockResolvedValue('<p>Converted</p>');

    // Create proper mock BlockToolAdapter
    const headerAdapter = createMockToolAdapter({
      name: 'header',
      sanitizeConfig: { p: true },
      settings: { level: 2 },
      conversionConfig: {
        import: (text: string, config?: Record<string, unknown>) => ({
          text: text.toUpperCase(),
          level: (config?.level as number) ?? 1,
        }),
      },
    });

    const headerToolsCollection = createMockToolsCollection(['paragraph', 'header']);
    // Override the header tool with our custom adapter
    headerToolsCollection.set('header', headerAdapter);

    const { blockManager } = createBlockManager({
      initialBlocks: [ blockToConvert ],
      blokOverrides: {
        Tools: {
          blockTools: headerToolsCollection,
        } as unknown as BlokModules['Tools'],
      },
    });

    const replacedBlock = createBlockStub({ id: 'header',
      name: 'header' });
    // Spy on operations.replace instead of blockManager.replace
    const operationsReplaceSpy = vi.spyOn(
      (blockManager as unknown as BlockManagerInternalAccess).operations,
      'replace'
    ).mockReturnValue(replacedBlock);

    const result = await blockManager.convert(blockToConvert, 'header', { level: 4 });

    // Verify replace was called (without checking deep equality which causes pretty-format issues)
    expect(operationsReplaceSpy).toHaveBeenCalledTimes(1);
    const callArgs = operationsReplaceSpy.mock.calls[0] as [Block, string, Record<string, unknown>];
    expect(callArgs[0]).toBe(blockToConvert);
    expect(callArgs[1]).toBe('header');
    expect(callArgs[2].text).toBe('<P>CONVERTED</P>');
    expect(callArgs[2].level).toBe(4);
    expect(result).toBe(replacedBlock);
  });

  it('sets current block by a child node that belongs to the current blok instance', () => {
    const { blockManager, composeBlockSpy: _composeBlockSpy, eventsDispatcher: _eventsDispatcher } = createBlockManager({
      initialBlocks: [
        createBlockStub({ id: 'first' }),
        createBlockStub({ id: 'second' }),
      ],
    });

    const ui = (blockManager as unknown as { Blok: BlokModules }).Blok.UI;

    // Setup proper DOM hierarchy: wrapper contains redactor, which contains blocks
    ui.nodes.wrapper.setAttribute('data-blok-editor', '');
    ui.nodes.wrapper.appendChild(ui.nodes.redactor);
    document.body.appendChild(ui.nodes.wrapper);

    const childNode = document.createElement('span');
    const blocks = blockManager.blocks;

    blocks[1].holder.appendChild(childNode);

    const current = blockManager.setCurrentBlockByChildNode(childNode);

    expect(current).toBe(blocks[1]);
    expect(blockManager.currentBlockIndex).toBe(1);
    expect(blocks[1].updateCurrentInput).toHaveBeenCalledTimes(1);

    const alienWrapper = document.createElement('div');

    // Add both data attribute and class for backward compatibility during migration
    alienWrapper.setAttribute('data-blok-editor', '');
    const alienBlock = createBlockStub({ id: 'alien' });

    alienWrapper.appendChild(alienBlock.holder);
    const alienChild = document.createElement('span');

    alienBlock.holder.appendChild(alienChild);

    expect(blockManager.setCurrentBlockByChildNode(alienChild)).toBeUndefined();

    ui.nodes.wrapper.remove();
  });

  it('sets current block by a child node inside a table cell (block holder moved out of working area)', () => {
    const { blockManager } = createBlockManager({
      initialBlocks: [
        createBlockStub({ id: 'table-block' }),
        createBlockStub({ id: 'cell-block' }),
      ],
    });

    const ui = (blockManager as unknown as { Blok: BlokModules }).Blok.UI;

    ui.nodes.wrapper.setAttribute('data-blok-editor', '');
    ui.nodes.wrapper.appendChild(ui.nodes.redactor);
    document.body.appendChild(ui.nodes.wrapper);

    const blocks = blockManager.blocks;

    // Simulate table cell structure: move block holder from working area into a cell container
    const cellContainer = document.createElement('div');
    cellContainer.setAttribute('data-blok-table-cell-blocks', '');
    const cell = document.createElement('div');
    cell.setAttribute('data-blok-table-cell', '');
    cell.appendChild(cellContainer);

    // The table block's holder contains the cell structure
    blocks[0].holder.appendChild(cell);

    // Move cell-block's holder into the cell container (out of the working area)
    cellContainer.appendChild(blocks[1].holder);

    // Create a child node inside the cell block's contenteditable
    const childNode = document.createElement('span');
    blocks[1].holder.appendChild(childNode);

    // This should find the block even though its holder is not a direct child of working area
    const current = blockManager.setCurrentBlockByChildNode(childNode);

    expect(current).toBe(blocks[1]);
    expect(blockManager.currentBlockIndex).toBe(1);

    ui.nodes.wrapper.remove();
  });

  it('splits block with provided data and returns new block', () => {
    const originalBlock = createBlockStub({ id: 'original', name: 'list' });

    originalBlock.holder.innerHTML = '<div contenteditable="true">Hello World</div>';

    const yjsManagerMock = {
      addBlock: vi.fn(),
      removeBlock: vi.fn(),
      moveBlock: vi.fn(),
      updateBlockData: vi.fn(),
      updateBlockTune: vi.fn(),
      updateBlockIndent: vi.fn(),
      stopCapturing: vi.fn(),
      transact: vi.fn((fn: () => void) => fn()),
      onBlocksChanged: vi.fn(() => vi.fn()),
      fromJSON: vi.fn(),
    } as unknown as BlokModules['YjsManager'];

    // Add list tool to the tools collection
    const toolsCollection = createMockToolsCollection(['paragraph', 'list']);

    const { blockManager, composeBlockSpy } = createBlockManager({
      initialBlocks: [ originalBlock ],
      blokOverrides: {
        YjsManager: yjsManagerMock,
        Tools: {
          blockTools: toolsCollection,
        } as unknown as BlokModules['Tools'],
      },
    });

    const insertedBlock = createBlockStub({ id: 'new-item', name: 'list' });
    composeBlockSpy.mockReturnValue(insertedBlock);

    const result = blockManager.splitBlockWithData(
      'original',
      { text: 'Hello' },
      'list',
      { text: ' World', style: 'unordered' },
      1
    );

    // Yjs transaction should be called
    expect(yjsManagerMock.transact).toHaveBeenCalledTimes(1);

    // Should update original block data in Yjs
    expect(yjsManagerMock.updateBlockData).toHaveBeenCalledWith('original', 'text', 'Hello');

    // Should add new block to Yjs
    expect(yjsManagerMock.addBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'list',
        data: { text: ' World', style: 'unordered' },
      }),
      1
    );

    // composeBlock should be called to create the new block
    expect(composeBlockSpy).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'list',
      data: { text: ' World', style: 'unordered' },
      bindEventsImmediately: true,
    }));

    expect(result).toBe(insertedBlock);
  });

  it('throws when splitBlockWithData receives unknown block id', () => {
    const { blockManager, composeBlockSpy: _composeBlockSpy, eventsDispatcher: _eventsDispatcher } = createBlockManager({
      initialBlocks: [ createBlockStub({ id: 'existing' }) ],
    });

    expect(() => {
      blockManager.splitBlockWithData('unknown', { text: 'a' }, 'paragraph', { text: 'b' }, 1);
    }).toThrow('Block with id "unknown" not found');
  });

  it('throws ToolNotFoundError WITHOUT mutating the document when splitBlockWithData gets an unregistered new tool', () => {
    const originalBlock = createBlockStub({ id: 'original', name: 'paragraph' });

    originalBlock.holder.innerHTML = '<div contenteditable="true">Hello World</div>';

    const yjsManagerMock = {
      addBlock: vi.fn(),
      removeBlock: vi.fn(),
      moveBlock: vi.fn(),
      updateBlockData: vi.fn(() => true),
      updateBlockTune: vi.fn(),
      updateBlockIndent: vi.fn(),
      stopCapturing: vi.fn(),
      transact: vi.fn((fn: () => void) => fn()),
      onBlocksChanged: vi.fn(() => vi.fn()),
      fromJSON: vi.fn(),
    } as unknown as BlokModules['YjsManager'];

    // Only 'paragraph' is registered — 'unknown-tool' is NOT.
    const toolsCollection = createMockToolsCollection(['paragraph']);

    const { blockManager } = createBlockManager({
      initialBlocks: [ originalBlock ],
      blokOverrides: {
        YjsManager: yjsManagerMock,
        Tools: {
          blockTools: toolsCollection,
        } as unknown as BlokModules['Tools'],
      },
    });

    const blockCountBefore = blockManager.blocks.length;
    const contentElBefore = originalBlock.holder.querySelector('[contenteditable="true"]');
    const textBefore = contentElBefore?.innerHTML;

    // Splitting into an unregistered tool must throw the typed error...
    expect(() => {
      blockManager.splitBlockWithData(
        'original',
        { text: 'Hello' },
        'unknown-tool',
        { text: ' World' },
        1
      );
    }).toThrow(ToolNotFoundError);

    // ...and leave the document COMPLETELY unchanged: no truncation of the
    // original block, no phantom block added, no Yjs writes.
    expect(yjsManagerMock.updateBlockData).not.toHaveBeenCalled();
    expect(yjsManagerMock.addBlock).not.toHaveBeenCalled();
    expect(blockManager.blocks.length).toBe(blockCountBefore);

    const contentElAfter = originalBlock.holder.querySelector('[contenteditable="true"]');

    expect(contentElAfter?.innerHTML).toBe(textBefore);
  });

  it('emits enumerable events when blockDidMutated is invoked', () => {
    const block = createBlockStub({ id: 'block-1' });
    const { blockManager, composeBlockSpy: _composeBlockSpy, eventsDispatcher: _eventsDispatcher } = createBlockManager({
      initialBlocks: [ block ],
    });

    const emitSpy = vi.spyOn(_eventsDispatcher, 'emit');

    const detail = { index: 0 };
    const result = (blockManager as unknown as BlockManagerInternalAccess).blockDidMutated(
      BlockAddedMutationType,
      block,
      detail
    );

    expect(result).toBe(block);
    expect(emitSpy).toHaveBeenCalledTimes(1);

    const [eventName, payload] = emitSpy.mock.calls[0] as [string, { event: CustomEvent<BlockMutationEventDetail> }];

    expect(eventName).toBe(BlockChanged);
    expect(payload.event).toBeInstanceOf(CustomEvent);
    expect(payload.event.type).toBe(BlockAddedMutationType);
    expect(payload.event.detail).toEqual(expect.objectContaining(detail));
    expect(payload.event.detail.target).toEqual(expect.objectContaining({
      id: block.id,
      name: block.name,
    }));

    expect(Object.prototype.propertyIsEnumerable.call(payload.event, 'type')).toBe(true);
    expect(Object.prototype.propertyIsEnumerable.call(payload.event, 'detail')).toBe(true);
  });

  describe('hierarchy preservation', () => {
    it('removeBlock promotes children to root level when parent is removed', async () => {
      const parentBlock = createBlockStub({ id: 'parent' });
      const childBlock1 = createBlockStub({ id: 'child-1' });
      const childBlock2 = createBlockStub({ id: 'child-2' });

      // Set up hierarchy: parentBlock has two children
      parentBlock.contentIds = ['child-1', 'child-2'];
      childBlock1.parentId = 'parent';
      childBlock2.parentId = 'parent';

      // Children are hidden (e.g. inside a collapsed toggle)
      childBlock1.holder.classList.add('hidden');
      childBlock2.holder.classList.add('hidden');

      const { blockManager } = createBlockManager({
        initialBlocks: [parentBlock, childBlock1, childBlock2],
      });

      blockManager.currentBlockIndex = 0;

      await blockManager.removeBlock(parentBlock, false);

      // Children should be promoted to root level (parentId cleared)
      expect(childBlock1.parentId).toBeNull();
      expect(childBlock2.parentId).toBeNull();

      // Children should be made visible (hidden class removed)
      expect(childBlock1.holder.classList.contains('hidden')).toBe(false);
      expect(childBlock2.holder.classList.contains('hidden')).toBe(false);
    });

    it('replace() transfers parentId to the new block and keeps children nested under it (structural)', () => {
      const parentBlock = createBlockStub({ id: 'grandparent' });
      const blockToReplace = createBlockStub({ id: 'toggle-parent' });
      const childBlock = createBlockStub({ id: 'child-1' });

      // Set up hierarchy: blockToReplace is child of parentBlock and parent of childBlock
      parentBlock.contentIds = ['toggle-parent'];
      blockToReplace.parentId = 'grandparent';
      blockToReplace.contentIds = ['child-1'];
      childBlock.parentId = 'toggle-parent';

      const { blockManager, composeBlockSpy } = createBlockManager({
        initialBlocks: [parentBlock, blockToReplace, childBlock],
      });

      blockManager.currentBlockIndex = 1;

      const newBlock = createBlockStub({ id: 'new-block' });
      composeBlockSpy.mockReturnValue(newBlock);

      const result = blockManager.replace(blockToReplace, 'paragraph', { text: 'converted' });

      // New block should inherit parentId from the old block
      expect(result.parentId).toBe('grandparent');

      // Parent's contentIds should reference the new block, not the old one
      expect(parentBlock.contentIds).toContain('new-block');
      expect(parentBlock.contentIds).not.toContain('toggle-parent');

      // Nesting is structural and tool-agnostic, so the child stays nested under
      // the converted block (a paragraph can host children too).
      expect(result.contentIds).toContain('child-1');
      expect(childBlock.parentId).toBe('new-block');
    });

    it('insert({ replace: true }) re-homes the replaced container children onto the new block', () => {
      // The generic insert-replace path (what useBlocks.insert({ replace }) and
      // toolbox/shortcut turn-into delegate to) must preserve the replaced
      // container's children, exactly like blockManager.replace() above. Without
      // this, the children keep a parentId pointing at the removed block and are
      // orphaned — unreachable via getChildren.
      const blockToReplace = createBlockStub({ id: 'toggle-parent' });
      const childBlock = createBlockStub({ id: 'child-1' });

      blockToReplace.contentIds = ['child-1'];
      childBlock.parentId = 'toggle-parent';

      const { blockManager, composeBlockSpy } = createBlockManager({
        initialBlocks: [blockToReplace, childBlock],
      });

      blockManager.currentBlockIndex = 0;

      const newBlock = createBlockStub({ id: 'new-block' });

      composeBlockSpy.mockReturnValue(newBlock);

      const result = blockManager.insert({
        tool: 'paragraph',
        data: { text: 'converted' },
        index: 0,
        replace: true,
      });

      // The child must follow onto the replacement, not dangle on the removed id.
      expect(childBlock.parentId).toBe('new-block');
      expect(result.contentIds).toContain('child-1');
    });

    it('insert({ replace: true }) with a prebuilt container keeps ITS OWN children (guard)', () => {
      // The re-home is guarded on the new block having no children of its own
      // (block-insertion.ts: `block.contentIds.length === 0`). When the caller
      // replaces with a PREBUILT container that already carries its own
      // contentIds, those must be preserved — the replaced block's children must
      // NOT be force-adopted over them. (The common turn-into composes an empty
      // block, so it still adopts; this guards the explicit prebuilt-container
      // case, which the re-home test above does not exercise.)
      const blockToReplace = createBlockStub({ id: 'toggle-parent' });
      const replacedChild = createBlockStub({ id: 'child-1' });

      blockToReplace.contentIds = ['child-1'];
      replacedChild.parentId = 'toggle-parent';

      const { blockManager, composeBlockSpy } = createBlockManager({
        initialBlocks: [blockToReplace, replacedChild],
      });

      blockManager.currentBlockIndex = 0;

      // The replacement arrives WITH its own child already attached.
      const newBlock = createBlockStub({ id: 'new-block' });

      newBlock.contentIds = ['own-child'];
      composeBlockSpy.mockReturnValue(newBlock);

      const result = blockManager.insert({
        tool: 'paragraph',
        data: { text: 'converted' },
        index: 0,
        replace: true,
      });

      // The guard skips re-homing: the prebuilt container keeps its own child and
      // does NOT swallow the replaced block's child.
      expect(result.contentIds).toEqual(['own-child']);
      expect(replacedChild.parentId).not.toBe('new-block');
    });

    it('update() preserves parentId and contentIds on the recreated block', async () => {
      const parentBlock = createBlockStub({ id: 'parent' });
      const blockToUpdate = createBlockStub({ id: 'block-1', data: { text: 'Hello' } });
      const childBlock = createBlockStub({ id: 'child-1' });

      // Set up hierarchy
      parentBlock.contentIds = ['block-1'];
      blockToUpdate.parentId = 'parent';
      blockToUpdate.contentIds = ['child-1'];
      childBlock.parentId = 'block-1';

      const { blockManager, composeBlockSpy } = createBlockManager({
        initialBlocks: [parentBlock, blockToUpdate, childBlock],
      });

      const newBlock = createBlockStub({ id: 'block-1' });
      composeBlockSpy.mockReturnValue(newBlock);

      await blockManager.update(blockToUpdate, { text: 'Updated' });

      // composeBlock should be called with parentId and contentIds
      expect(composeBlockSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'parent',
          contentIds: ['child-1'],
        })
      );
    });
  });

  it('keeps isSyncingFromYjs true during insertMany RENDERED lifecycle', () => {
    /**
     * Regression test: RENDERED lifecycle hooks (e.g., Table.rendered() which
     * creates table cell paragraph blocks via api.blocks.insert()) must run
     * with isSyncingFromYjs = true during insertMany. Without this, those
     * inserts create 'local' origin Yjs transactions that pollute the undo
     * stack, causing redo to restore table cells instead of the user's action.
     */
    const block = createBlockStub({ id: 'test-block' });

    // Track isSyncingFromYjs state during block rendered() call
    let syncingDuringRendered = false;
    const originalCall = block.call as ReturnType<typeof vi.fn>;

    originalCall.mockImplementation((method: string) => {
      if (method === 'rendered') {
        // During insertMany, isSyncingFromYjs should be true
        syncingDuringRendered = blockManager.isSyncingFromYjs;
      }
    });

    const { blockManager } = createBlockManager({});

    blockManager.insertMany([block], 0);

    expect(syncingDuringRendered).toBe(true);
  });

  describe('insertMany contentIds reconciliation', () => {
    /**
     * Regression guard for the callout paste bug (commit 062d9fd1): hierarchical
     * input JSON can carry `parent: X` on a child without a matching `content: [...]`
     * on the parent. Downstream consumers (collapseToLegacy, drag descendants,
     * block selection copy) treat parent.contentIds as authoritative, so any child
     * missing from contentIds gets ejected. insertMany must reconcile the
     * invariant `child.parentId ⇒ parent.contentIds.includes(child.id)` up front.
     */
    it('back-fills parent.contentIds from children.parentId on load', () => {
      const parent = createBlockStub({ id: 'cal1' });
      const child = createBlockStub({ id: 'hdr1' });

      (parent as unknown as { contentIds: string[] }).contentIds = [];
      (child as unknown as { parentId: string }).parentId = 'cal1';

      const { blockManager } = createBlockManager({});
      blockManager.insertMany([parent, child], 0);

      expect((parent as unknown as { contentIds: string[] }).contentIds).toContain('hdr1');
    });

    it('does not duplicate ids already present in contentIds', () => {
      const parent = createBlockStub({ id: 'cal1' });
      const child = createBlockStub({ id: 'hdr1' });

      (parent as unknown as { contentIds: string[] }).contentIds = ['hdr1'];
      (child as unknown as { parentId: string }).parentId = 'cal1';

      const { blockManager } = createBlockManager({});
      blockManager.insertMany([parent, child], 0);

      expect((parent as unknown as { contentIds: string[] }).contentIds).toEqual(['hdr1']);
    });

    it('merges missing child into a partially populated contentIds', () => {
      const parent = createBlockStub({ id: 'cal1' });
      const existing = createBlockStub({ id: 'hdr1' });
      const missing = createBlockStub({ id: 'p-pasted' });

      (parent as unknown as { contentIds: string[] }).contentIds = ['hdr1'];
      (existing as unknown as { parentId: string }).parentId = 'cal1';
      (missing as unknown as { parentId: string }).parentId = 'cal1';

      const { blockManager } = createBlockManager({});
      blockManager.insertMany([parent, existing, missing], 0);

      expect((parent as unknown as { contentIds: string[] }).contentIds).toEqual(['hdr1', 'p-pasted']);
    });

    it('ignores child whose parentId points to a non-existent parent', () => {
      const orphan = createBlockStub({ id: 'orphan' });
      const unrelated = createBlockStub({ id: 'u1' });

      (orphan as unknown as { parentId: string }).parentId = 'ghost-parent';

      const { blockManager } = createBlockManager({});

      expect(() => blockManager.insertMany([orphan, unrelated], 0)).not.toThrow();
      expect((unrelated as unknown as { contentIds: string[] }).contentIds).toEqual([]);
    });

    it('reconciles even when child precedes parent in the blocks array', () => {
      const parent = createBlockStub({ id: 'cal1' });
      const child = createBlockStub({ id: 'hdr1' });

      (parent as unknown as { contentIds: string[] }).contentIds = [];
      (child as unknown as { parentId: string }).parentId = 'cal1';

      const { blockManager } = createBlockManager({});
      // Child listed FIRST; parent second.
      blockManager.insertMany([child, parent], 0);

      expect((parent as unknown as { contentIds: string[] }).contentIds).toContain('hdr1');
    });

    /**
     * The reconcile is intentionally keyed on `block.parentId`, not on tool name,
     * so it must work for EVERY container block type, not just callout. This
     * regression guards the generic contract so a future refactor cannot silently
     * narrow the reconcile to one container type and leave toggle, header, list,
     * database, table etc. re-exposed to the paste-ejection drift.
     */
    it('reconciles contentIds generically across every container type in one call', () => {
      const toggle = createBlockStub({ id: 'tog1' });
      const toggleChild = createBlockStub({ id: 'tog-kid' });
      const header = createBlockStub({ id: 'hdr1' });
      const headerChild = createBlockStub({ id: 'hdr-kid' });
      const list = createBlockStub({ id: 'list1' });
      const listChild = createBlockStub({ id: 'list-kid' });

      (toggle as unknown as { contentIds: string[] }).contentIds = [];
      (header as unknown as { contentIds: string[] }).contentIds = [];
      (list as unknown as { contentIds: string[] }).contentIds = [];
      (toggleChild as unknown as { parentId: string }).parentId = 'tog1';
      (headerChild as unknown as { parentId: string }).parentId = 'hdr1';
      (listChild as unknown as { parentId: string }).parentId = 'list1';

      const { blockManager } = createBlockManager({});
      blockManager.insertMany([toggle, toggleChild, header, headerChild, list, listChild], 0);

      expect((toggle as unknown as { contentIds: string[] }).contentIds).toEqual(['tog-kid']);
      expect((header as unknown as { contentIds: string[] }).contentIds).toEqual(['hdr-kid']);
      expect((list as unknown as { contentIds: string[] }).contentIds).toEqual(['list-kid']);
    });
  });

  describe('insertMany change notification', () => {
    /**
     * Regression guard: a programmatic bulk insert (editor.blocks.insertMany,
     * used by React useBlocks insertTree/insertMarkdown) must emit a BlockChanged
     * mutation so reactive consumers (the React useBlocks hook's
     * useSyncExternalStore subscription) re-render. A single editor.blocks.insert
     * already emits BlockAdded; insertMany must too. One event for the whole batch
     * is enough — it only needs to bump the subscription version, not storm.
     */
    it('emits a single block-added mutation when notify is requested', () => {
      const first = createBlockStub({ id: 'bulk-1' });
      const second = createBlockStub({ id: 'bulk-2' });
      const { blockManager, eventsDispatcher } = createBlockManager({});
      const emitSpy = vi.spyOn(eventsDispatcher, 'emit');

      blockManager.insertMany([first, second], 0, { notify: true });

      const changedCalls = emitSpy.mock.calls.filter((call: unknown[]) => call[0] === BlockChanged);

      expect(changedCalls).toHaveLength(1);
      const payload = changedCalls[0][1] as { event: CustomEvent<BlockMutationEventDetail> };

      expect(payload.event.type).toBe(BlockAddedMutationType);
    });

    /**
     * The render/seed path (Renderer.render -> BlockManager.insertMany) must stay
     * silent: loading a document is not a 'block changed' mutation (it has its own
     * block:rendered events), and emitting here would fire spurious change events
     * on every initial render and risk feedback loops with controlled `data`.
     */
    it('does not emit a block-changed mutation by default', () => {
      const first = createBlockStub({ id: 'seed-1' });
      const second = createBlockStub({ id: 'seed-2' });
      const { blockManager, eventsDispatcher } = createBlockManager({});
      const emitSpy = vi.spyOn(eventsDispatcher, 'emit');

      blockManager.insertMany([first, second], 0);

      const changedCalls = emitSpy.mock.calls.filter((call: unknown[]) => call[0] === BlockChanged);

      expect(changedCalls).toHaveLength(0);
    });
  });

  describe('edit metadata on mutation', () => {
    it('should update block lastEditedAt and lastEditedBy on content change', async () => {
      const block = createBlockStub({ id: 'block-meta' });

      // Simulate a saved payload with one field so syncBlockDataToYjs actually
      // calls updateBlockData — the new contract only bumps metadata when at
      // least one data field actually changed.
      (block.save as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { text: 'hello' } });

      const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
      const config = {
        defaultBlock: 'paragraph',
        sanitizer: {},
        user: { id: 'test-user-1' },
      } as BlokConfig;

      const blockManager = new BlockManager({
        config,
        eventsDispatcher,
      });

      blockManager.state = {
        BlockEvents: {
          handleCommandC: vi.fn(),
          handleCommandX: vi.fn(),
          keydown: vi.fn(),
          keyup: vi.fn(),
        } as unknown as BlokModules['BlockEvents'],
        ReadOnly: {
          isEnabled: false,
        } as unknown as BlokModules['ReadOnly'],
        UI: {
          nodes: {
            holder: document.createElement('div'),
            redactor: document.createElement('div'),
            wrapper: document.createElement('div'),
          },
          CSS: {
            blokWrapper: '',
            blokWrapperNarrow: '',
            blokZone: '',
            blokZoneHidden: '',
            blokEmpty: '',
            blokRtlFix: '',
            blokDragging: '',
          },
          checkEmptiness: vi.fn(),
        } as unknown as BlokModules['UI'],
        Tools: {
          blockTools: createMockToolsCollection(['paragraph']),
        } as unknown as BlokModules['Tools'],
        YjsManager: {
          addBlock: vi.fn(),
          removeBlock: vi.fn(),
          moveBlock: vi.fn(),
          // Return true to indicate the data actually changed — this is what
          // syncBlockDataToYjs uses as the signal to bump edit metadata.
          updateBlockData: vi.fn(() => true),
          updateBlockMetadata: vi.fn(() => true),
          updateBlockTune: vi.fn(),
          stopCapturing: vi.fn(),
          transact: vi.fn((fn: () => void) => fn()),
          toJSON: vi.fn(() => []),
          getBlockById: vi.fn(() => undefined),
          getBlockDataObject: vi.fn(() => undefined),
          onBlocksChanged: vi.fn(() => vi.fn()),
          fromJSON: vi.fn(),
        } as unknown as BlokModules['YjsManager'],
        Caret: {
          extractFragmentFromCaretPosition: vi.fn(),
          setToBlock: vi.fn(),
          positions: { START: 'start', END: 'end' },
        } as unknown as BlokModules['Caret'],
        I18n: {
          t: vi.fn((key: string) => key),
        } as unknown as BlokModules['I18n'],
      } as BlokModules;

      blockManager.prepare();

      const now = Date.now();

      (blockManager as unknown as BlockManagerInternalAccess).blockDidMutated(
        BlockChangedMutationType,
        block,
        { index: 0 }
      );

      // syncBlockDataToYjs is async — flush pending microtasks before asserting.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(block.lastEditedAt).toBeTypeOf('number');
      expect((block.lastEditedAt as number)).toBeGreaterThanOrEqual(now);
      expect((block.lastEditedAt as number)).toBeLessThanOrEqual(Date.now());
      expect(block.lastEditedBy).toBe('test-user-1');
    });

    it('should set lastEditedBy to null when no user is configured', async () => {
      const block = createBlockStub({ id: 'block-no-user' });

      (block.save as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { text: 'hello' } });

      const { blockManager } = createBlockManager();

      (blockManager as unknown as BlockManagerInternalAccess).blockDidMutated(
        BlockChangedMutationType,
        block,
        { index: 0 }
      );

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(block.lastEditedAt).toBeTypeOf('number');
      expect(block.lastEditedBy).toBeNull();
    });

    it('should NOT bump lastEditedAt or call updateBlockMetadata when no data field changed', async () => {
      const block = createBlockStub({ id: 'block-noop' });

      (block.save as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { text: 'unchanged' } });

      const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
      const config = {
        defaultBlock: 'paragraph',
        sanitizer: {},
        user: { id: 'test-user-1' },
      } as BlokConfig;

      const blockManager = new BlockManager({
        config,
        eventsDispatcher,
      });

      const updateBlockDataMock = vi.fn(() => false);
      const updateBlockMetadataMock = vi.fn(() => false);

      blockManager.state = {
        BlockEvents: {
          handleCommandC: vi.fn(),
          handleCommandX: vi.fn(),
          keydown: vi.fn(),
          keyup: vi.fn(),
        } as unknown as BlokModules['BlockEvents'],
        ReadOnly: {
          isEnabled: false,
        } as unknown as BlokModules['ReadOnly'],
        UI: {
          nodes: {
            holder: document.createElement('div'),
            redactor: document.createElement('div'),
            wrapper: document.createElement('div'),
          },
          CSS: {
            blokWrapper: '',
            blokWrapperNarrow: '',
            blokZone: '',
            blokZoneHidden: '',
            blokEmpty: '',
            blokRtlFix: '',
            blokDragging: '',
          },
          checkEmptiness: vi.fn(),
        } as unknown as BlokModules['UI'],
        Tools: {
          blockTools: createMockToolsCollection(['paragraph']),
        } as unknown as BlokModules['Tools'],
        YjsManager: {
          addBlock: vi.fn(),
          removeBlock: vi.fn(),
          moveBlock: vi.fn(),
          updateBlockData: updateBlockDataMock,
          updateBlockMetadata: updateBlockMetadataMock,
          updateBlockTune: vi.fn(),
          stopCapturing: vi.fn(),
          transact: vi.fn((fn: () => void) => fn()),
          toJSON: vi.fn(() => []),
          getBlockById: vi.fn(() => undefined),
          getBlockDataObject: vi.fn(() => undefined),
          onBlocksChanged: vi.fn(() => vi.fn()),
          fromJSON: vi.fn(),
        } as unknown as BlokModules['YjsManager'],
        Caret: {
          extractFragmentFromCaretPosition: vi.fn(),
          setToBlock: vi.fn(),
          positions: { START: 'start', END: 'end' },
        } as unknown as BlokModules['Caret'],
        I18n: {
          t: vi.fn((key: string) => key),
        } as unknown as BlokModules['I18n'],
      } as BlokModules;

      blockManager.prepare();

      const lastEditedAtBefore = block.lastEditedAt;

      (blockManager as unknown as BlockManagerInternalAccess).blockDidMutated(
        BlockChangedMutationType,
        block,
        { index: 0 }
      );

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(updateBlockDataMock).toHaveBeenCalled();
      expect(updateBlockMetadataMock).not.toHaveBeenCalled();
      expect(block.lastEditedAt).toBe(lastEditedAtBefore);
    });
  });
});
