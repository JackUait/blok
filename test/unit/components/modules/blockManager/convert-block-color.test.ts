import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BlockOperations } from '../../../../../src/components/modules/blockManager/operations';
import type { BlockOperationsDependencies, BlockDidMutated } from '../../../../../src/components/modules/blockManager/operations';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import { BlockHierarchy } from '../../../../../src/components/modules/blockManager/hierarchy';
import type { BlockYjsSync } from '../../../../../src/components/modules/blockManager/yjs-sync';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';
import { Blocks } from '../../../../../src/components/blocks';
import type { Block } from '../../../../../src/components/block';
import type { BlockToolAdapter } from '../../../../../src/components/tools/block';
import { ToolsCollection } from '../../../../../src/components/tools/collection';
import { ToolType } from '@/types/tools/adapters/tool-type';
import type { BlockTool, BlockToolConstructable } from '@/types/tools/block-tool';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokConfig } from '@/types/configs';
import type { API } from '../../../../../src/components/modules/api';
import type { YjsManager } from '../../../../../src/components/modules/yjs';
import type { Caret } from '../../../../../src/components/modules/caret';
import type { I18n } from '../../../../../src/components/modules/i18n';
import type { BlockMutationType, BlockToolData } from '@/types';

/**
 * Minimal mock Block: exposes the surface convert() touches — save() (source
 * data, including block-level color), exportDataAsString() (the conversion
 * `text` export) and the hierarchy fields.
 */
const createMockBlock = (options: { id?: string; name?: string; data?: BlockToolData } = {}): Block => {
  const holder = document.createElement('div');
  holder.setAttribute('data-blok-element', '');
  const input = document.createElement('div');
  input.contentEditable = 'true';
  input.setAttribute('contenteditable', 'true');
  holder.appendChild(input);

  const blockData = options.data ?? {};

  return {
    id: options.id ?? `block-${Math.random().toString(16).slice(2)}`,
    name: options.name ?? 'paragraph',
    holder,
    inputs: [input],
    parentId: null,
    contentIds: [],
    mergeable: false,
    exportDataAsString: vi.fn().mockResolvedValue('Hi'),
    isEmpty: false,
    save: vi.fn().mockResolvedValue({ data: blockData }),
    call: vi.fn(),
    ready: Promise.resolve(),
    unwatchBlockMutations: vi.fn(),
    refreshToolRootElement: vi.fn(),
    destroy: vi.fn(),
    tool: {
      name: options.name ?? 'paragraph',
      sanitizeConfig: {},
      conversionConfig: { import: 'text', export: 'text' },
      settings: {},
    },
  } as unknown as Block;
};

const createBlocksStore = (blocks: Block[]): BlocksStore => {
  const workingArea = document.createElement('div');
  const blocksStore = new Blocks(workingArea);

  for (const block of blocks) {
    blocksStore.push(block);
  }

  return new Proxy(blocksStore, { set: Blocks.set, get: Blocks.get }) as unknown as BlocksStore;
};

const createMockDependencies = (): BlockOperationsDependencies => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();

  return {
    config: { defaultBlock: 'paragraph', sanitizer: {} } as BlokConfig,
    YjsManager: {
      addBlock: vi.fn(),
      removeBlock: vi.fn(),
      moveBlock: vi.fn(),
      updateBlockData: vi.fn(),
      updateBlockTune: vi.fn(),
      updateBlockIndent: vi.fn(),
      stopCapturing: vi.fn(),
      transact: vi.fn((fn: () => void) => fn()),
      toJSON: vi.fn(() => []),
      getBlockById: vi.fn(() => undefined),
      getBlockDataObject: vi.fn(() => undefined),
      onBlocksChanged: vi.fn(() => vi.fn()),
      fromJSON: vi.fn(),
    } as unknown as YjsManager,
    Caret: {
      extractFragmentFromCaretPosition: vi.fn(() => document.createDocumentFragment()),
      setToBlock: vi.fn(),
      positions: { START: 'start', END: 'end' },
    } as unknown as Caret,
    I18n: { t: vi.fn((key: string) => key) } as unknown as I18n,
    eventsDispatcher,
  };
};

const createMockBlockToolAdapter = (name: string): BlockToolAdapter => {
  const MockBlockTool = class implements BlockTool {
    render = vi.fn(() => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.setAttribute('contenteditable', 'true');
      return div;
    });
    save = vi.fn(() => ({}));
    rendered() {}
    sanitize = {};
  };

  const adapter = {
    type: ToolType.Block,
    name,
    constructable: MockBlockTool as BlockToolConstructable,
    create: vi.fn(() => new MockBlockTool()),
    sanitizeConfig: {},
    conversionConfig: { import: 'text', export: 'text' },
    settings: {},
    toolbox: undefined,
    tunes: new ToolsCollection(),
    inlineTools: new ToolsCollection(),
    api: {},
    config: {},
    isInternal: false,
    isDefault: false,
    prepare: vi.fn(),
    reset: vi.fn(),
    enabledInlineTools: true,
    enabledBlockTunes: undefined,
    pasteConfig: {},
    hasOnPasteHandler: false,
    isReadOnlySupported: false,
    isLineBreaksEnabled: false,
    baseSanitizeConfig: {},
    isBlock(this: BlockToolAdapter): this is BlockToolAdapter {
      return this.type === ToolType.Block;
    },
    isInline(this: { type: ToolType }): this is { type: ToolType.Inline } {
      return this.type === ToolType.Inline;
    },
    isTune(this: { type: ToolType }): this is { type: ToolType.Tune } {
      return this.type === ToolType.Tune;
    },
  } as unknown as BlockToolAdapter;

  return adapter;
};

const createMockBlockFactory = (): BlockFactory => {
  const mockTools = new ToolsCollection<BlockToolAdapter>();

  mockTools.set('paragraph', createMockBlockToolAdapter('paragraph'));
  mockTools.set('header', createMockBlockToolAdapter('header'));

  return new BlockFactory({
    API: {} as unknown as API,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
    tools: mockTools,
    moduleInstances: { ReadOnly: { isEnabled: false } } as never,
  }, vi.fn());
};

const createMockYjsSync = (): BlockYjsSync => ({
  isSyncingFromYjs: false,
  withAtomicOperation: vi.fn(<T>(fn: () => T): T => fn()),
  subscribe: vi.fn(() => vi.fn()),
  updateBlocksStore: vi.fn(),
  syncBlockDataToYjs: vi.fn(),
  isBlockDataChanged: vi.fn(() => false),
} as unknown as BlockYjsSync);

describe('convert() preserves block-level color', () => {
  let operations: BlockOperations;
  let blocksStore: BlocksStore;

  beforeEach(() => {
    vi.clearAllMocks();

    const dependencies = createMockDependencies();

    blocksStore = createBlocksStore([createMockBlock({ id: 'block-1', name: 'paragraph' })]);

    const repository = new BlockRepository();
    repository.initialize(blocksStore);

    operations = new BlockOperations(
      dependencies,
      repository,
      createMockBlockFactory(),
      new BlockHierarchy(repository),
      vi.fn(<Type extends BlockMutationType>(_t: Type, block: Block) => block) as unknown as BlockDidMutated,
      0
    );
    operations.setYjsSync(createMockYjsSync());
  });

  it('carries textColor/backgroundColor onto the converted block data (any target tool)', async () => {
    const colored = createMockBlock({
      id: 'colored',
      name: 'paragraph',
      data: { text: 'Hi', textColor: 'red', backgroundColor: 'blue' },
    });

    const replaceSpy = vi.spyOn(operations, 'replace').mockReturnValue(colored);

    await operations.convert(colored, 'header', blocksStore);

    expect(replaceSpy).toHaveBeenCalledTimes(1);

    const passedData = replaceSpy.mock.calls[0][2];

    expect(passedData.text).toBe('Hi');
    expect(passedData.textColor).toBe('red');
    expect(passedData.backgroundColor).toBe('blue');
  });

  it('lets explicit overrides win over the carried-over color', async () => {
    const colored = createMockBlock({
      id: 'colored',
      name: 'paragraph',
      data: { text: 'Hi', textColor: 'red' },
    });

    const replaceSpy = vi.spyOn(operations, 'replace').mockReturnValue(colored);

    await operations.convert(colored, 'header', blocksStore, { textColor: 'green' });

    const passedData = replaceSpy.mock.calls[0][2];

    expect(passedData.textColor).toBe('green');
  });

  it('does not add color fields when the source block has none', async () => {
    const plain = createMockBlock({ id: 'plain', name: 'paragraph', data: { text: 'Hi' } });

    const replaceSpy = vi.spyOn(operations, 'replace').mockReturnValue(plain);

    await operations.convert(plain, 'header', blocksStore);

    const passedData = replaceSpy.mock.calls[0][2];

    expect(passedData.textColor).toBeUndefined();
    expect(passedData.backgroundColor).toBeUndefined();
  });
});
