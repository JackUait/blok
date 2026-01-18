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
import { ToolsCollection } from '../../../../src/components/tools/collection';
import { ToolType } from '@/types/tools/adapters/tool-type';
import { BlockAddedMutationType } from '../../../../types/events/block/BlockAdded';
import { BlockRemovedMutationType } from '../../../../types/events/block/BlockRemoved';
import { BlockMovedMutationType } from '../../../../types/events/block/BlockMoved';
import { BlockChangedMutationType } from '../../../../types/events/block/BlockChanged';

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
  conversionConfig?: Record<string, unknown>;
  settings?: Record<string, unknown>;
} = {}): BlockToolAdapter => {
  const mockTool = {
    render: vi.fn(() => document.createElement('div')),
    save: vi.fn(() => ({})),
    rendered: () => {},
  } as any;

  const adapter = {
    type: ToolType.Block,
    name: options.name ?? 'paragraph',
    constructable: () => mockTool,
    create: vi.fn(() => mockTool),
    sanitizeConfig: options.sanitizeConfig ?? {},
    conversionConfig: options.conversionConfig ?? {},
    settings: options.settings ?? {},
    toolbox: undefined,
    tunes: new ToolsCollection<any>(),
    inlineTools: new ToolsCollection<any>(),
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
    (collection as any).set(name, adapter);
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
      updateBlockData: vi.fn(),
      updateBlockTune: vi.fn(),
      stopCapturing: vi.fn(),
      transact: vi.fn((fn: () => void) => fn()),
      toJSON: vi.fn(() => []),
      getBlockById: vi.fn(() => undefined),
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
    (blockManager as any).factory,
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
      const payload = call[1] as { event: CustomEvent };
      return payload.event.type === BlockRemovedMutationType &&
             (payload.event.detail).target?.id === existingBlock.id;
    })).toBe(true);
    // Verify block-added event was dispatched
    expect(removedCalls.some((call: unknown[]) => {
      const payload = call[1] as { event: CustomEvent };
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
      const payload = call[1] as { event: CustomEvent };
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
      const payload = call[1] as { event: CustomEvent };
      return payload.event.type === BlockMovedMutationType &&
             (payload.event.detail).target?.id === secondBlock.id;
    })).toBe(true);
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
      const payload = call[1] as { event: CustomEvent };
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
      const payload = call[1] as { event: CustomEvent };
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
    });
    // Add conversionConfig to the adapter
    (headerAdapter as any).conversionConfig = {
      import: (text: string, settings?: { level?: number }) => ({
        text: text.toUpperCase(),
        level: settings?.level ?? 1,
      }),
    };

    const headerToolsCollection = createMockToolsCollection(['paragraph', 'header']);
    // Override the header tool with our custom adapter
    (headerToolsCollection as any).set('header', headerAdapter);

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
    const operationsReplaceSpy = vi.spyOn((blockManager as any).operations, 'replace').mockReturnValue(replacedBlock);

    const result = await blockManager.convert(blockToConvert, 'header', { level: 4 });

    // Verify replace was called (without checking deep equality which causes pretty-format issues)
    expect(operationsReplaceSpy).toHaveBeenCalledTimes(1);
    const callArgs = operationsReplaceSpy.mock.calls[0];
    expect(callArgs[0]).toBe(blockToConvert);
    expect(callArgs[1]).toBe('header');
    expect((callArgs[2] as Record<string, unknown>).text).toBe('<P>CONVERTED</P>');
    expect((callArgs[2] as Record<string, unknown>).level).toBe(4);
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

  it('emits enumerable events when blockDidMutated is invoked', () => {
    const block = createBlockStub({ id: 'block-1' });
    const { blockManager, composeBlockSpy: _composeBlockSpy, eventsDispatcher: _eventsDispatcher } = createBlockManager({
      initialBlocks: [ block ],
    });

    const emitSpy = vi.spyOn(_eventsDispatcher, 'emit');

    const detail = { index: 0 };
    const result = (blockManager as any).blockDidMutated(
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
