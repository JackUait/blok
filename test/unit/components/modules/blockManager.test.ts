import { describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { BlockManager } from '../../../../src/components/modules/blockManager';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokConfig } from '../../../../types';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import { BlockChanged } from '../../../../src/components/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { Block } from '../../../../src/components/block';
import { BlockAddedMutationType } from '../../../../types/events/block/BlockAdded';
import { BlockRemovedMutationType } from '../../../../types/events/block/BlockRemoved';
import { BlockMovedMutationType } from '../../../../types/events/block/BlockMoved';
import { BlockChangedMutationType } from '../../../../types/events/block/BlockChanged';

type BlockManagerContext = {
  blockManager: BlockManager;
};

type CreateBlockManagerOptions = {
  initialBlocks?: Block[];
  blokOverrides?: Partial<BlokModules>;
};

const createBlockStub = (options: {
  id?: string;
  name?: string;
  data?: object;
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
      blockTools: new Map([
        [
          'paragraph',
          {
            create: vi.fn(() => ({
              render: vi.fn(() => document.createElement('div')),
              save: vi.fn(() => ({})),
            })),
          },
        ],
      ]),
    } as unknown as BlokModules['Tools'],
    YjsManager: {
      addBlock: vi.fn(),
      removeBlock: vi.fn(),
      moveBlock: vi.fn(),
      updateBlockData: vi.fn(),
      updateBlockTune: vi.fn(),
      stopCapturing: vi.fn(),
      transact: vi.fn((fn: () => void) => fn()),
      toJSON: vi.fn(() => []),
      getBlockById: vi.fn(() => undefined),
      onBlocksChanged: vi.fn(() => vi.fn()),
      fromJSON: vi.fn(),
    } as unknown as BlokModules['YjsManager'],
  };

  blockManager.state = {
    ...defaultBlokState,
    ...options.blokOverrides,
  } as BlokModules;

  // Call prepare() to initialize the internal blocks storage
  blockManager.prepare();

  // Insert initial blocks using public API
  if (options.initialBlocks?.length) {
    blockManager.insertMany(options.initialBlocks, 0);
    blockManager.currentBlockIndex = 0;
  }

  return {
    blockManager,
  };
};

type BlockDidMutated = BlockManager['blockDidMutated'];
type ComposeBlock = BlockManager['composeBlock'];

const getBlockDidMutatedSpy = (
  blockManager: BlockManager
): MockInstance<BlockDidMutated> => {
  return vi.spyOn(
    blockManager as unknown as { blockDidMutated: BlockDidMutated },
    'blockDidMutated'
  );
};

const getComposeBlockSpy = (
  blockManager: BlockManager
): MockInstance<ComposeBlock> => {
  return vi.spyOn(
    blockManager as unknown as { composeBlock: ComposeBlock },
    'composeBlock'
  );
};

describe('BlockManager', () => {
  it('inserts a block and dispatches added mutation', () => {
    const existingBlock = createBlockStub({ id: 'existing' });
    const { blockManager } = createBlockManager({
      initialBlocks: [ existingBlock ],
    });
    const newBlock = createBlockStub({ id: 'new-block' });
    const composeBlockSpy = getComposeBlockSpy(blockManager).mockReturnValue(newBlock);
    const blockDidMutatedSpy = getBlockDidMutatedSpy(blockManager);

    const result = blockManager.insert({ replace: true,
      needToFocus: true });

    expect(result).toBe(newBlock);
    expect(blockManager.currentBlockIndex).toBe(0);
    expect(blockManager.blocks).toEqual([newBlock]);
    expect(blockDidMutatedSpy).toHaveBeenCalledWith(
      BlockRemovedMutationType,
      existingBlock,
      expect.objectContaining({ index: 0 })
    );
    expect(blockDidMutatedSpy).toHaveBeenCalledWith(
      BlockAddedMutationType,
      newBlock,
      expect.objectContaining({ index: 0 })
    );
    expect(composeBlockSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'paragraph' })
    );
  });

  it('removes a block, updates current index, and emits removal mutation', async () => {
    const firstBlock = createBlockStub({ id: 'block-1' });
    const secondBlock = createBlockStub({ id: 'block-2' });
    const { blockManager } = createBlockManager({
      initialBlocks: [firstBlock, secondBlock],
    });

    blockManager.currentBlockIndex = 1;
    const blockDidMutatedSpy = getBlockDidMutatedSpy(blockManager);

    await blockManager.removeBlock(firstBlock, false);

    expect(firstBlock.destroy).toHaveBeenCalledTimes(1);
    expect(blockManager.currentBlockIndex).toBe(0);
    expect(blockDidMutatedSpy).toHaveBeenCalledWith(
      BlockRemovedMutationType,
      firstBlock,
      expect.objectContaining({ index: 0 })
    );
    expect(blockManager.blocks).toEqual([ secondBlock ]);
  });

  it('inserts a default block when the last block is removed', async () => {
    const block = createBlockStub({ id: 'single-block' });
    const defaultBlock = createBlockStub({ id: 'default-block' });
    const { blockManager } = createBlockManager({
      initialBlocks: [ block ],
    });

    // Mock insert to add the default block to the blocksStore (avoiding complex setup)
    vi.spyOn(blockManager, 'insert').mockImplementation(() => {
      (blockManager as any).blocksStore.insert(0, defaultBlock, false);
      return defaultBlock;
    });

    await blockManager.removeBlock(block);

    // Verify observable behavior: the default block is present in the blocks array
    expect(blockManager.blocks).toContain(defaultBlock);
  });

  it('moves a block and emits movement mutation', () => {
    const firstBlock = createBlockStub({ id: 'block-1' });
    const secondBlock = createBlockStub({ id: 'block-2' });
    const { blockManager } = createBlockManager({
      initialBlocks: [firstBlock, secondBlock],
    });

    blockManager.currentBlockIndex = 1;
    const blockDidMutatedSpy = getBlockDidMutatedSpy(blockManager);

    blockManager.move(0, 1);

    expect(blockManager.currentBlockIndex).toBe(0);
    expect(blockManager.currentBlock).toBe(secondBlock);
    expect(blockManager.blocks).toEqual([secondBlock, firstBlock]);
    expect(blockDidMutatedSpy).toHaveBeenCalledWith(
      BlockMovedMutationType,
      secondBlock,
      expect.objectContaining({ fromIndex: 1,
        toIndex: 0 })
    );
  });

  it('recreates block with merged data when updating', async () => {
    const block = createBlockStub({ id: 'block-1',
      data: { text: 'Hello' },
      tunes: { alignment: 'left' } });
    const { blockManager } = createBlockManager({
      initialBlocks: [ block ],
    });
    const newBlock = createBlockStub({ id: 'block-1' });
    const composeBlockSpy = getComposeBlockSpy(blockManager).mockReturnValue(newBlock);
    const blockDidMutatedSpy = getBlockDidMutatedSpy(blockManager);

    const result = await blockManager.update(block, { text: 'Updated' }, { alignment: 'center' });

    expect(composeBlockSpy).toHaveBeenCalledWith({
      id: 'block-1',
      tool: 'paragraph',
      data: { text: 'Updated' },
      tunes: { alignment: 'center' },
      bindEventsImmediately: true,
    });
    expect(blockDidMutatedSpy).toHaveBeenCalledWith(
      BlockChangedMutationType,
      newBlock,
      expect.objectContaining({ index: 0 })
    );
    expect(blockManager.blocks[0]).toBe(newBlock);
    expect(result).toBe(newBlock);
  });

  it('returns original block when neither data nor tunes provided on update', async () => {
    const block = createBlockStub({ id: 'block-1' });
    const { blockManager } = createBlockManager({
      initialBlocks: [ block ],
    });
    const composeBlockSpy = getComposeBlockSpy(blockManager);
    const blockDidMutatedSpy = getBlockDidMutatedSpy(blockManager);

    const result = await blockManager.update(block);

    expect(result).toBe(block);
    expect(composeBlockSpy).not.toHaveBeenCalled();
    expect(blockDidMutatedSpy).not.toHaveBeenCalled();
  });

  it('inserts default block at provided index and shifts current index when not focusing it', () => {
    const existingBlock = createBlockStub({ id: 'existing' });
    const { blockManager } = createBlockManager({
      initialBlocks: [ existingBlock ],
    });

    blockManager.currentBlockIndex = 0;
    const defaultBlock = createBlockStub({ id: 'default' });
    const composeBlockSpy = getComposeBlockSpy(blockManager).mockReturnValue(defaultBlock);
    const blockDidMutatedSpy = getBlockDidMutatedSpy(blockManager);

    const result = blockManager.insertDefaultBlockAtIndex(0);

    expect(result).toBe(defaultBlock);
    expect(blockManager.blocks[0]).toBe(defaultBlock);
    expect(blockManager.currentBlockIndex).toBe(1);
    expect(composeBlockSpy).toHaveBeenCalledWith({ tool: 'paragraph', bindEventsImmediately: true });
    expect(blockDidMutatedSpy).toHaveBeenCalledWith(
      BlockAddedMutationType,
      defaultBlock,
      expect.objectContaining({ index: 0 })
    );
  });

  it('focuses inserted default block when needToFocus is true', () => {
    const { blockManager } = createBlockManager({
      initialBlocks: [createBlockStub({ id: 'first' }), createBlockStub({ id: 'second' })],
    });

    blockManager.currentBlockIndex = 1;
    const defaultBlock = createBlockStub({ id: 'focus-me' });

    getComposeBlockSpy(blockManager).mockReturnValue(defaultBlock);

    blockManager.insertDefaultBlockAtIndex(1, true);

    expect(blockManager.blocks[1]).toBe(defaultBlock);
    expect(blockManager.currentBlockIndex).toBe(1);
  });

  it('throws a descriptive error when default block tool is missing', () => {
    const { blockManager } = createBlockManager();

    (blockManager as unknown as { config: BlokConfig }).config.defaultBlock = undefined;

    expect(() => blockManager.insertDefaultBlockAtIndex(0)).toThrow('Could not insert default Block. Default block tool is not defined in the configuration.');
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

  it('splits the current block using caret fragment contents', () => {
    const fragment = document.createDocumentFragment();

    fragment.appendChild(document.createTextNode('Split content'));

    const caretStub = {
      extractFragmentFromCaretPosition: vi.fn().mockReturnValue(fragment),
    } as unknown as BlokModules['Caret'];

    const { blockManager } = createBlockManager({
      initialBlocks: [ createBlockStub({ id: 'origin' }) ],
      blokOverrides: {
        Caret: caretStub,
      },
    });

    const insertedBlock = createBlockStub({ id: 'split' });
    const insertSpy = vi.spyOn(blockManager as unknown as { insert: BlockManager['insert'] }, 'insert').mockReturnValue(insertedBlock);

    const result = blockManager.split();

    expect(caretStub.extractFragmentFromCaretPosition).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'paragraph',
      data: { text: 'Split content' },
      skipYjsSync: true,
    }));
    expect(result).toBe(insertedBlock);
  });

  it('converts a block using the target tool conversion config', async () => {
    const blockToConvert = createBlockStub({ id: 'paragraph',
      name: 'paragraph' });

    (blockToConvert.save as unknown as MockInstance).mockResolvedValue({ data: { text: 'Old' } });
    (blockToConvert.exportDataAsString as unknown as MockInstance).mockResolvedValue('<p>Converted</p>');

    const replacingTool = {
      name: 'header',
      sanitizeConfig: { p: true },
      conversionConfig: {
        import: (text: string, settings?: { level?: number }) => ({
          text: text.toUpperCase(),
          level: settings?.level ?? 1,
        }),
      },
      settings: { level: 2 },
    };

    const { blockManager } = createBlockManager({
      initialBlocks: [ blockToConvert ],
      blokOverrides: {
        Tools: {
          blockTools: new Map([ [replacingTool.name, replacingTool] ]),
        } as unknown as BlokModules['Tools'],
      },
    });

    const replacedBlock = createBlockStub({ id: 'header',
      name: 'header' });
    const replaceSpy = vi.spyOn(blockManager as unknown as { replace: BlockManager['replace'] }, 'replace').mockReturnValue(replacedBlock);

    const result = await blockManager.convert(blockToConvert, 'header', { level: 4 });

    expect(replaceSpy).toHaveBeenCalledWith(blockToConvert, 'header', {
      text: '<P>CONVERTED</P>',
      level: 4,
    });
    expect(result).toBe(replacedBlock);
  });

  it('sets current block by a child node that belongs to the current blok instance', () => {
    const { blockManager } = createBlockManager({
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

  it('splits block with provided data and returns new block', () => {
    const originalBlock = createBlockStub({ id: 'original', name: 'list' });

    originalBlock.holder.innerHTML = '<div contenteditable="true">Hello World</div>';

    const yjsManagerMock = {
      addBlock: vi.fn(),
      removeBlock: vi.fn(),
      moveBlock: vi.fn(),
      updateBlockData: vi.fn(),
      updateBlockTune: vi.fn(),
      stopCapturing: vi.fn(),
      transact: vi.fn((fn: () => void) => fn()),
      onBlocksChanged: vi.fn(() => vi.fn()),
      fromJSON: vi.fn(),
    } as unknown as BlokModules['YjsManager'];

    const { blockManager } = createBlockManager({
      initialBlocks: [ originalBlock ],
      blokOverrides: {
        YjsManager: yjsManagerMock,
      },
    });

    const insertedBlock = createBlockStub({ id: 'new-item', name: 'list' });
    const insertSpy = vi.spyOn(blockManager as unknown as { insert: BlockManager['insert'] }, 'insert').mockReturnValue(insertedBlock);

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

    // Should insert DOM block with skipYjsSync
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'list',
      data: { text: ' World', style: 'unordered' },
      index: 1,
      needToFocus: true,
      skipYjsSync: true,
    }));

    expect(result).toBe(insertedBlock);
  });

  it('throws when splitBlockWithData receives unknown block id', () => {
    const { blockManager } = createBlockManager({
      initialBlocks: [ createBlockStub({ id: 'existing' }) ],
    });

    expect(() => {
      blockManager.splitBlockWithData('unknown', { text: 'a' }, 'paragraph', { text: 'b' }, 1);
    }).toThrow('Block with id "unknown" not found');
  });

  it('emits enumerable events when blockDidMutated is invoked', () => {
    const block = createBlockStub({ id: 'block-1' });
    const { blockManager } = createBlockManager({
      initialBlocks: [ block ],
    });

    const emitSpy = vi.spyOn(
      (blockManager as unknown as { eventsDispatcher: EventsDispatcher<BlokEventMap> }).eventsDispatcher,
      'emit'
    );

    const detail = { index: 0 };
    const result = (blockManager as unknown as { blockDidMutated: BlockDidMutated }).blockDidMutated(
      BlockAddedMutationType,
      block,
      detail
    );

    expect(result).toBe(block);
    expect(emitSpy).toHaveBeenCalledTimes(1);

    const [eventName, payload] = emitSpy.mock.calls[0] as [string, { event: CustomEvent }];

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
});
