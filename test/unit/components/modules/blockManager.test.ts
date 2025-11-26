import { describe, expect, it, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';

import BlockManager from '../../../../src/components/modules/blockManager';
import EventsDispatcher from '../../../../src/components/utils/events';
import type { EditorConfig } from '../../../../types';
import type { EditorModules } from '../../../../src/types-internal/editor-modules';
import { BlockChanged } from '../../../../src/components/events';
import type { EditorEventMap } from '../../../../src/components/events';
import Block from '../../../../src/components/block';
import { BlockAddedMutationType } from '../../../../types/events/block/BlockAdded';
import { BlockRemovedMutationType } from '../../../../types/events/block/BlockRemoved';
import { BlockMovedMutationType } from '../../../../types/events/block/BlockMoved';
import { BlockChangedMutationType } from '../../../../types/events/block/BlockChanged';

type BlockManagerContext = {
  blockManager: BlockManager;
  blocksStub: ReturnType<typeof createBlocksStub>;
};

type BlocksStub = {
  proxy: Block[] & Record<PropertyKey, unknown>;
  insert: Mock<(index: number, block: Block, replace?: boolean) => void>;
  insertMany: Mock<(items: Block[], index?: number) => void>;
  replace: Mock<(index: number, block: Block) => void>;
  move: Mock<(toIndex: number, fromIndex: number, skipDOM?: boolean) => void>;
  remove: Mock<(index: number) => void>;
  indexOf: Mock<(block: Block) => number>;
  blocks: Block[];
};

type CreateBlockManagerOptions = {
  initialBlocks?: Block[];
  editorOverrides?: Partial<EditorModules>;
};

const createBlockStub = (options: {
  id?: string;
  name?: string;
  data?: object;
  tunes?: Record<string, unknown>;
} = {}): Block => {
  const holder = document.createElement('div');

  holder.classList.add(Block.CSS.wrapper);
  const inputs = [ document.createElement('div') ];
  const data = options.data ?? {};

  const block = {
    id: options.id ?? `block-${Math.random().toString(16)
      .slice(2)}`,
    name: options.name ?? 'paragraph',
    holder,
    call: vi.fn(),
    destroy: vi.fn(),
    tool: {
      name: options.name ?? 'paragraph',
      sanitizeConfig: {},
      conversionConfig: {},
      settings: {},
    } as Record<string, unknown>,
    tunes: options.tunes ?? {},
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

  return block as unknown as Block;
};

const createBlocksStub = (initialBlocks: Block[] = []): BlocksStub => {
  const blocks = [ ...initialBlocks ];

  const stub = {
    get array(): Block[] {
      return blocks;
    },
    get length(): number {
      return blocks.length;
    },
    get nodes(): HTMLElement[] {
      return blocks.map((block) => block.holder);
    },
    insert: vi.fn((index: number, block: Block, replace = false) => {
      const targetIndex = index ?? blocks.length;

      if (replace) {
        blocks.splice(targetIndex, 1, block);
      } else {
        blocks.splice(targetIndex, 0, block);
      }
    }),
    insertMany: vi.fn((items: Block[], index = 0) => {
      blocks.splice(index, 0, ...items);
    }),
    replace: vi.fn((index: number, block: Block) => {
      blocks[index] = block;
    }),
    move: vi.fn((toIndex: number, fromIndex: number, _skipDOM = false) => {
      const [ movedBlock ] = blocks.splice(fromIndex, 1);

      blocks.splice(toIndex, 0, movedBlock);
    }),
    remove: vi.fn((index: number) => {
      blocks.splice(index, 1);
    }),
    indexOf: vi.fn((block: Block) => blocks.indexOf(block)),
    get: vi.fn((index: number) => blocks[index]),
  };

  const proxy = new Proxy(stub, {
    get(target, property: string | symbol) {
      if (typeof property === 'string' && !Number.isNaN(Number(property))) {
        return blocks[Number(property)];
      }

      return Reflect.get(target, property);
    },
    set(target, property: string | symbol, value: Block) {
      if (typeof property === 'string' && !Number.isNaN(Number(property))) {
        blocks[Number(property)] = value;

        return true;
      }

      Reflect.set(target, property, value);

      return true;
    },
  }) as unknown as BlocksStub['proxy'];

  const result: BlocksStub = {
    proxy,
    insert: stub.insert,
    insertMany: stub.insertMany,
    replace: stub.replace,
    move: stub.move,
    remove: stub.remove,
    indexOf: stub.indexOf,
    blocks,
  };

  return result;
};

const createBlockManager = (
  options: CreateBlockManagerOptions = {}
): BlockManagerContext => {
  const eventsDispatcher = new EventsDispatcher<EditorEventMap>();
  const config = {
    defaultBlock: 'paragraph',
    sanitizer: {},
  } as EditorConfig;

  const blockManager = new BlockManager({
    config,
    eventsDispatcher,
  });

  const defaultEditorState: Partial<EditorModules> = {
    BlockEvents: {
      handleCommandC: vi.fn(),
      handleCommandX: vi.fn(),
      keydown: vi.fn(),
      keyup: vi.fn(),
    } as unknown as EditorModules['BlockEvents'],
    ReadOnly: {
      isEnabled: false,
    } as unknown as EditorModules['ReadOnly'],
    UI: {
      nodes: {
        holder: document.createElement('div'),
        redactor: document.createElement('div'),
        wrapper: document.createElement('div'),
      },
      CSS: {
        editorWrapper: 'codex-editor',
        editorWrapperNarrow: 'codex-editor--narrow',
        editorZone: 'codex-editor__redactor',
        editorZoneHidden: 'codex-editor__redactor--hidden',
        editorEmpty: 'codex-editor--empty',
        editorRtlFix: 'codex-editor--rtl',
      },
      checkEmptiness: vi.fn(),
    } as unknown as EditorModules['UI'],
  };

  blockManager.state = {
    ...defaultEditorState,
    ...options.editorOverrides,
  } as EditorModules;

  const blocksStub = createBlocksStub(options.initialBlocks);

  (blockManager as unknown as { _blocks: unknown })._blocks = blocksStub.proxy;

  if (options.initialBlocks?.length) {
    blockManager.currentBlockIndex = 0;
  }

  return {
    blockManager,
    blocksStub,
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
    const { blockManager, blocksStub } = createBlockManager({
      initialBlocks: [ existingBlock ],
    });
    const newBlock = createBlockStub({ id: 'new-block' });
    const composeBlockSpy = getComposeBlockSpy(blockManager).mockReturnValue(newBlock);
    const blockDidMutatedSpy = getBlockDidMutatedSpy(blockManager);

    const result = blockManager.insert({ replace: true,
      needToFocus: true });

    expect(result).toBe(newBlock);
    expect(blocksStub.insert).toHaveBeenCalledWith(0, newBlock, true);
    expect(blockManager.currentBlockIndex).toBe(0);
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
    const { blockManager, blocksStub } = createBlockManager({
      initialBlocks: [firstBlock, secondBlock],
    });

    blockManager.currentBlockIndex = 1;
    const blockDidMutatedSpy = getBlockDidMutatedSpy(blockManager);

    await blockManager.removeBlock(firstBlock, false);

    expect(blocksStub.remove).toHaveBeenCalledWith(0);
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
    const { blockManager, blocksStub } = createBlockManager({
      initialBlocks: [ block ],
    });
    const newBlock = createBlockStub({ id: 'default' });
    const insertSpy = vi
      .spyOn(blockManager as unknown as { insert: BlockManager['insert'] }, 'insert')
      .mockReturnValue(newBlock);

    await blockManager.removeBlock(block);

    expect(blocksStub.remove).toHaveBeenCalledWith(0);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it('moves a block and emits movement mutation', () => {
    const firstBlock = createBlockStub({ id: 'block-1' });
    const secondBlock = createBlockStub({ id: 'block-2' });
    const { blockManager, blocksStub } = createBlockManager({
      initialBlocks: [firstBlock, secondBlock],
    });

    blockManager.currentBlockIndex = 1;
    const blockDidMutatedSpy = getBlockDidMutatedSpy(blockManager);

    blockManager.move(0, 1);

    expect(blocksStub.move).toHaveBeenCalledWith(0, 1, false);
    expect(blockManager.currentBlockIndex).toBe(0);
    expect(blockManager.currentBlock).toBe(secondBlock);
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
    const { blockManager, blocksStub } = createBlockManager({
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
    });
    expect(blocksStub.replace).toHaveBeenCalledWith(0, newBlock);
    expect(blockDidMutatedSpy).toHaveBeenCalledWith(
      BlockChangedMutationType,
      newBlock,
      expect.objectContaining({ index: 0 })
    );
    expect(result).toBe(newBlock);
  });

  it('returns original block when neither data nor tunes provided on update', async () => {
    const block = createBlockStub({ id: 'block-1' });
    const { blockManager, blocksStub } = createBlockManager({
      initialBlocks: [ block ],
    });
    const composeBlockSpy = getComposeBlockSpy(blockManager);
    const blockDidMutatedSpy = getBlockDidMutatedSpy(blockManager);

    const result = await blockManager.update(block);

    expect(result).toBe(block);
    expect(composeBlockSpy).not.toHaveBeenCalled();
    expect(blocksStub.replace).not.toHaveBeenCalled();
    expect(blockDidMutatedSpy).not.toHaveBeenCalled();
  });

  it('inserts default block at provided index and shifts current index when not focusing it', () => {
    const existingBlock = createBlockStub({ id: 'existing' });
    const { blockManager, blocksStub } = createBlockManager({
      initialBlocks: [ existingBlock ],
    });

    blockManager.currentBlockIndex = 0;
    const defaultBlock = createBlockStub({ id: 'default' });
    const composeBlockSpy = getComposeBlockSpy(blockManager).mockReturnValue(defaultBlock);
    const blockDidMutatedSpy = getBlockDidMutatedSpy(blockManager);

    const result = blockManager.insertDefaultBlockAtIndex(0);

    expect(result).toBe(defaultBlock);
    expect(blocksStub.blocks[0]).toBe(defaultBlock);
    expect(blockManager.currentBlockIndex).toBe(1);
    expect(composeBlockSpy).toHaveBeenCalledWith({ tool: 'paragraph' });
    expect(blockDidMutatedSpy).toHaveBeenCalledWith(
      BlockAddedMutationType,
      defaultBlock,
      expect.objectContaining({ index: 0 })
    );
  });

  it('focuses inserted default block when needToFocus is true', () => {
    const { blockManager, blocksStub } = createBlockManager({
      initialBlocks: [createBlockStub({ id: 'first' }), createBlockStub({ id: 'second' })],
    });

    blockManager.currentBlockIndex = 1;
    const defaultBlock = createBlockStub({ id: 'focus-me' });

    getComposeBlockSpy(blockManager).mockReturnValue(defaultBlock);

    blockManager.insertDefaultBlockAtIndex(1, true);

    expect(blocksStub.blocks[1]).toBe(defaultBlock);
    expect(blockManager.currentBlockIndex).toBe(1);
  });

  it('throws a descriptive error when default block tool is missing', () => {
    const { blockManager } = createBlockManager();

    (blockManager as unknown as { config: EditorConfig }).config.defaultBlock = undefined;

    expect(() => blockManager.insertDefaultBlockAtIndex(0)).toThrow('Could not insert default Block. Default block tool is not defined in the configuration.');
  });

  it('removes only selected blocks and returns the first removed index', () => {
    const blocks = [
      createBlockStub({ id: 'first' }),
      createBlockStub({ id: 'second' }),
      createBlockStub({ id: 'third' }),
    ];

    blocks[1].selected = true;
    blocks[2].selected = true;

    const { blockManager } = createBlockManager({
      initialBlocks: blocks,
    });

    const removeSpy = vi
      .spyOn(blockManager as unknown as { removeBlock: BlockManager['removeBlock'] }, 'removeBlock')
      .mockResolvedValue();

    const firstRemovedIndex = blockManager.removeSelectedBlocks();

    expect(removeSpy).toHaveBeenNthCalledWith(1, blocks[2], false);
    expect(removeSpy).toHaveBeenNthCalledWith(2, blocks[1], false);
    expect(firstRemovedIndex).toBe(1);
  });

  it('splits the current block using caret fragment contents', () => {
    const fragment = document.createDocumentFragment();

    fragment.appendChild(document.createTextNode('Split content'));

    const caretStub = {
      extractFragmentFromCaretPosition: vi.fn().mockReturnValue(fragment),
    } as unknown as EditorModules['Caret'];

    const { blockManager } = createBlockManager({
      initialBlocks: [ createBlockStub({ id: 'origin' }) ],
      editorOverrides: {
        Caret: caretStub,
      },
    });

    const insertedBlock = createBlockStub({ id: 'split' });
    const insertSpy = vi.spyOn(blockManager as unknown as { insert: BlockManager['insert'] }, 'insert').mockReturnValue(insertedBlock);

    const result = blockManager.split();

    expect(caretStub.extractFragmentFromCaretPosition).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith({ data: { text: 'Split content' } });
    expect(result).toBe(insertedBlock);
  });

  it('converts a block using the target tool conversion config', async () => {
    const blockToConvert = createBlockStub({ id: 'paragraph',
      name: 'paragraph' });

    (blockToConvert.save as Mock).mockResolvedValue({ data: { text: 'Old' } });
    (blockToConvert.exportDataAsString as Mock).mockResolvedValue('<p>Converted</p>');

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
      editorOverrides: {
        Tools: {
          blockTools: new Map([ [replacingTool.name, replacingTool] ]),
        } as unknown as EditorModules['Tools'],
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

  it('sets current block by a child node that belongs to the current editor instance', () => {
    const blocks = [
      createBlockStub({ id: 'first' }),
      createBlockStub({ id: 'second' }),
    ];
    const { blockManager } = createBlockManager({
      initialBlocks: blocks,
    });

    const ui = (blockManager as unknown as { Editor: EditorModules }).Editor.UI;

    ui.nodes.wrapper.classList.add(ui.CSS.editorWrapper);
    ui.nodes.wrapper.appendChild(blocks[0].holder);
    ui.nodes.wrapper.appendChild(blocks[1].holder);
    document.body.appendChild(ui.nodes.wrapper);

    const childNode = document.createElement('span');

    blocks[1].holder.appendChild(childNode);

    const current = blockManager.setCurrentBlockByChildNode(childNode);

    expect(current).toBe(blocks[1]);
    expect(blockManager.currentBlockIndex).toBe(1);
    expect(blocks[1].updateCurrentInput).toHaveBeenCalledTimes(1);

    const alienWrapper = document.createElement('div');

    alienWrapper.classList.add(ui.CSS.editorWrapper);
    const alienBlock = createBlockStub({ id: 'alien' });

    alienWrapper.appendChild(alienBlock.holder);
    const alienChild = document.createElement('span');

    alienBlock.holder.appendChild(alienChild);

    expect(blockManager.setCurrentBlockByChildNode(alienChild)).toBeUndefined();

    ui.nodes.wrapper.remove();
  });

  it('emits enumerable events when blockDidMutated is invoked', () => {
    const block = createBlockStub({ id: 'block-1' });
    const { blockManager } = createBlockManager({
      initialBlocks: [ block ],
    });

    const emitSpy = vi.spyOn(
      (blockManager as unknown as { eventsDispatcher: EventsDispatcher<EditorEventMap> }).eventsDispatcher,
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
