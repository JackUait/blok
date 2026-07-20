import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BlockOperations } from '../../../../../src/components/modules/blockManager/operations';
import type { BlockOperationsDependencies } from '../../../../../src/components/modules/blockManager/operations';
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
import type { API } from '../../../../../src/components/modules/api';
import type { YjsManager } from '../../../../../src/components/modules/yjs';
import type { Caret } from '../../../../../src/components/modules/caret';
import type { I18n } from '../../../../../src/components/modules/i18n';
import type { BlockMutationType, BlockToolData } from '@/types';
import { getListSanitizeConfig, getListConversionConfig } from '../../../../../src/tools/list/static-configs';

/**
 * Minimal source Block for convert(): save() feeds source data (checked, color)
 * and exportDataAsString() feeds the conversion `text` export string.
 */
const createMockBlock = (options: { id?: string; name?: string; data?: BlockToolData; exported?: string } = {}): Block => {
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
    exportDataAsString: vi.fn().mockResolvedValue(options.exported ?? 'Hi'),
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
    config: { defaultBlock: 'paragraph', sanitizer: {} },
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

/**
 * A block tool whose conversionConfig.import is a FUNCTION (like the real list
 * tool) and whose sanitizeConfig is field-keyed ({ text: { ...tag rules } }).
 */
const createListLikeToolAdapter = (name: string): BlockToolAdapter => {
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
    sanitizeConfig: getListSanitizeConfig(),
    conversionConfig: getListConversionConfig(),
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

  mockTools.set('list', createListLikeToolAdapter('list'));

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

describe('convert() into a function-import tool (list)', () => {
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
      vi.fn(<Type extends BlockMutationType>(_t: Type, block: Block) => block),
      0
    );
    operations.setYjsSync(createMockYjsSync());
  });

  it('BUG 1: preserves inline formatting (bold, link) when turning a paragraph INTO a list', async () => {
    const source = createMockBlock({
      id: 'source',
      name: 'paragraph',
      data: { text: 'hello <b>world</b> and a <a href="https://x.dev">link</a>' },
      exported: 'hello <b>world</b> and a <a href="https://x.dev">link</a>',
    });

    const replaceSpy = vi.spyOn(operations, 'replace').mockReturnValue(source);

    await operations.convert(source, 'list', blocksStore);

    const passedData = replaceSpy.mock.calls[0][2];
    const text = passedData.text as string;

    expect(text).toContain('<b>world</b>');
    expect(text).toContain('<a href="https://x.dev">link</a>');
  });

  it('BUG 2: preserves the to-do checked state across a turn-into round trip', async () => {
    // to-do (checklist, checked=true) → bulleted (unordered)
    const checkedTodo = createMockBlock({
      id: 'todo',
      name: 'list',
      data: { text: 'task', style: 'checklist', checked: true },
      exported: 'task',
    });

    const replaceSpy = vi.spyOn(operations, 'replace').mockReturnValue(checkedTodo);

    await operations.convert(checkedTodo, 'list', blocksStore, { style: 'unordered' });

    const passedData = replaceSpy.mock.calls[0][2];

    expect(passedData.checked).toBe(true);
  });

  it('BUG 2: does not force checked on a fresh paragraph → list conversion', async () => {
    const plain = createMockBlock({
      id: 'plain',
      name: 'paragraph',
      data: { text: 'hi' },
      exported: 'hi',
    });

    const replaceSpy = vi.spyOn(operations, 'replace').mockReturnValue(plain);

    await operations.convert(plain, 'list', blocksStore);

    const passedData = replaceSpy.mock.calls[0][2];

    // list import default; source paragraph had no checked to carry
    expect(passedData.checked).toBe(false);
  });
});
