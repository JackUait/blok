import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import type { BlockFactoryDependencies } from '../../../../../src/components/modules/blockManager/factory';
import { API } from '../../../../../src/components/modules/api';
import { BlockToolAdapter } from '../../../../../src/components/tools/block';
import { ToolsCollection } from '../../../../../src/components/tools/collection';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import { Block } from '../../../../../src/components/block';
import type { ComposeBlockOptions } from '../../../../../src/components/modules/blockManager/types';
import type { API as APIInterface, BlockToolData, SanitizerConfig, ConversionConfig } from '@/types';
import type { BlockTool, BlockToolConstructorOptions } from '@/types/tools/block-tool';
import type { BlockTuneData } from '@/types/block-tunes/block-tune-data';

/**
 * Create a minimal BlockAPI mock for test return values
 */
const createMockBlockAPI = () => ({
  id: 'mock-block-id',
  name: 'mock-block',
  config: {},
  holder: document.createElement('div'),
  isEmpty: true,
  selected: false,
  focusable: false,
  stretched: false,
  call: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
  validate: vi.fn().mockResolvedValue(true),
  dispatchChange: vi.fn(),
  getActiveToolboxEntry: vi.fn().mockResolvedValue(undefined),
});

/**
 * Create a mock API methods object (the interface)
 */
const createMockAPIMethods = (): APIInterface => ({
  blocks: {
    clear: vi.fn().mockResolvedValue(undefined),
    render: vi.fn().mockResolvedValue(undefined),
    renderFromHTML: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    move: vi.fn(),
    getBlockByIndex: vi.fn(),
    getById: vi.fn(),
    getCurrentBlockIndex: vi.fn(() => 0),
    getBlockIndex: vi.fn(),
    getBlockByElement: vi.fn(),
    getChildren: vi.fn(() => []),
    getBlocksCount: vi.fn(() => 0),
    insert: vi.fn(),
    insertMany: vi.fn(() => []),
    composeBlockData: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue(createMockBlockAPI()),
    convert: vi.fn().mockResolvedValue(createMockBlockAPI()),
    stopBlockMutationWatching: vi.fn(),
    splitBlock: vi.fn().mockReturnValue(createMockBlockAPI()),
  },
  caret: {
    setToFirstBlock: vi.fn(() => false),
    setToLastBlock: vi.fn(() => false),
    setToPreviousBlock: vi.fn(() => false),
    setToNextBlock: vi.fn(() => false),
    setToBlock: vi.fn(() => false),
    focus: vi.fn(() => false),
    updateLastCaretAfterPosition: vi.fn(),
  },
  tools: {
    getBlockTools: vi.fn(() => []),
  },
  events: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
  listeners: {
    on: vi.fn(),
    off: vi.fn(),
    offById: vi.fn(),
  },
  notifier: {
    show: vi.fn(),
  },
  sanitizer: {
    clean: vi.fn(() => ''),
  },
  saver: {
    save: vi.fn().mockResolvedValue({ blocks: [] }),
  },
  selection: {
    findParentTag: vi.fn(),
    expandToTag: vi.fn(),
    setFakeBackground: vi.fn(),
    removeFakeBackground: vi.fn(),
    clearFakeBackground: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  },
  styles: {
    block: 'blok-block',
    inlineToolButton: 'blok-inline-tool-button',
    inlineToolButtonActive: 'blok-inline-tool-button--active',
    input: 'blok-input',
    loader: 'blok-loader',
    button: 'blok-button',
    settingsButton: 'blok-settings-button',
    settingsButtonActive: 'blok-settings-button--active',
    settingsButtonFocused: 'blok-settings-button--focused',
    settingsButtonFocusedAnimated: 'blok-settings-button--focused-animated',
  },
  toolbar: {
    close: vi.fn(),
    open: vi.fn(),
    toggleBlockSettings: vi.fn(),
    toggleToolbox: vi.fn(),
  },
  inlineToolbar: {
    close: vi.fn(),
    open: vi.fn(),
  },
  tooltip: {
    show: vi.fn(),
    hide: vi.fn(),
    onHover: vi.fn(),
  },
  i18n: {
    t: vi.fn((key: string) => key),
    has: vi.fn(() => false),
    getEnglishTranslation: vi.fn(() => ''),
  },
  readOnly: {
    toggle: vi.fn().mockResolvedValue(false),
    isEnabled: false,
  },
  ui: {
    nodes: {
      wrapper: document.createElement('div'),
      redactor: document.createElement('div'),
    },
  },
});

/**
 * Create a mock API class instance
 * Uses Object.create to extend API prototype and define properties
 */
const createMockAPI = (): API => {
  const apiMethods = createMockAPIMethods();

  // Create a mock that extends API.prototype with necessary properties
  const api = Object.create(API.prototype, {
    Blok: { value: {}, writable: false },
    config: { value: {}, writable: false },
    eventsDispatcher: { value: null, writable: false },
    listeners: { value: null, writable: false },
    nodes: { value: {}, writable: false },
    readOnlyMutableListeners: { value: null, writable: false },
  });

  // Override the methods getter to return our mock methods
  Object.defineProperty(api, 'methods', {
    get() { return apiMethods; },
    enumerable: true,
    configurable: true,
  });

  return api;
};

/**
 * Create a mock BlockToolConstructable class
 * Direct return without type assertion - the class implements BlockTool
 * and has the required constructor signature
 */
const createMockConstructable = () => {
  class MockBlockTool implements BlockTool {
    public data: BlockToolData;
    public block: BlockToolConstructorOptions['block'];
    public readOnly: boolean;
    public api: APIInterface;
    public config?: BlockToolConstructorOptions['config'];

    constructor(options: BlockToolConstructorOptions) {
      this.data = options.data;
      this.block = options.block;
      this.readOnly = options.readOnly;
      this.api = options.api;
      this.config = options.config;
    }

    render(): HTMLElement {
      return document.createElement('div');
    }

    save(_block: HTMLElement): BlockToolData {
      return this.data;
    }

    rendered?(): void {}
  }

  // Return with type annotation (not assertion) - the compiler infers this correctly
  return MockBlockTool;
};

/**
 * Create a mock BlockToolAdapter
 */
const createMockToolAdapter = (options: {
  name?: string;
  sanitizeConfig?: SanitizerConfig;
  conversionConfig?: ConversionConfig;
  settings?: Record<string, unknown>;
} = {}): BlockToolAdapter => {
  const mockConstructable = createMockConstructable();
  const mockAPI = createMockAPI();

  const adapter = new BlockToolAdapter({
    name: options.name ?? 'paragraph',
    constructable: mockConstructable,
    api: mockAPI.methods,
    config: options.settings ?? {},
    isDefault: false,
    isInternal: true,
  });

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

/**
 * Create mock dependencies for BlockFactory
 */
const createMockDependencies = (): BlockFactoryDependencies => ({
  API: createMockAPI(),
  eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  readOnly: false,
  tools: createMockToolsCollection(['paragraph', 'header', 'list']),
});

describe('BlockFactory', () => {
  let factory: BlockFactory;
  let dependencies: BlockFactoryDependencies;
  let bindBlockEventsFn: (block: Block) => void;

  beforeEach(() => {
    dependencies = createMockDependencies();
    // Create a mock function compatible with the expected type
    const mockFn = vi.fn((_block: Block) => {});
    bindBlockEventsFn = mockFn;
    factory = new BlockFactory(dependencies, bindBlockEventsFn);
  });

  describe('composeBlock', () => {
    it('creates a Block with default options', () => {
      const options: ComposeBlockOptions = {
        tool: 'paragraph',
      };

      const block = factory.composeBlock(options);

      expect(block).toBeInstanceOf(Block);
      expect(block.name).toBe('paragraph');
    });

    it('creates a Block with provided data', () => {
      const data: BlockToolData = { text: 'Hello World' };
      const tunes: BlockTuneData = { alignment: 'center' };

      const block = factory.composeBlock({
        tool: 'paragraph',
        data,
        id: 'custom-id',
        tunes,
        bindEventsImmediately: true,
      });

      expect(block.id).toBe('custom-id');
    });

    it('creates a Block with parentId and contentIds', () => {
      const block = factory.composeBlock({
        tool: 'paragraph',
        parentId: 'parent-block-id',
        contentIds: ['child-1', 'child-2'],
      });

      expect(block.parentId).toBe('parent-block-id');
      expect(block.contentIds).toEqual(['child-1', 'child-2']);
    });

    it('throws error for unknown tool', () => {
      expect(() => {
        factory.composeBlock({ tool: 'unknown-tool' });
      }).toThrow('Could not compose Block. Tool «unknown-tool» not found.');
    });

    it('creates Block for valid tool name', () => {
      const block = factory.composeBlock({ tool: 'header' });

      expect(block.name).toBe('header');
    });

    it('binds block events immediately when bindEventsImmediately is true', () => {
      const block = factory.composeBlock({
        tool: 'paragraph',
        bindEventsImmediately: true,
      });

      expect(block.name).toBe('paragraph');
      expect(bindBlockEventsFn).toHaveBeenCalledTimes(1);
    });

    it('defers event binding via requestIdleCallback when bindEventsImmediately is false', () => {
      const block = factory.composeBlock({
        tool: 'paragraph',
        bindEventsImmediately: false,
      });

      expect(block.name).toBe('paragraph');
      expect(bindBlockEventsFn).not.toHaveBeenCalled();
      // requestIdleCallback should be called via polyfill
      expect(window.requestIdleCallback).toHaveBeenCalled();
    });

    it('does not bind events in read-only mode', () => {
      dependencies.readOnly = true;
      const readOnlyFactory = new BlockFactory(dependencies, bindBlockEventsFn);

      const block = readOnlyFactory.composeBlock({
        tool: 'paragraph',
        bindEventsImmediately: true,
      });

      expect(block.name).toBe('paragraph');
      expect(bindBlockEventsFn).not.toHaveBeenCalled();
    });

    it('passes correct parameters to Block constructor', () => {
      const data: BlockToolData = { text: 'Test content' };
      const tunes: BlockTuneData = { alignment: 'left' };

      const block = factory.composeBlock({
        tool: 'paragraph',
        data,
        id: 'test-id',
        tunes,
        parentId: 'parent-id',
        contentIds: ['child-1'],
      });

      expect(block.id).toBe('test-id');
    });

    it('creates Block with empty data when not provided', () => {
      const block = factory.composeBlock({ tool: 'paragraph' });

      // Block should be created without error
      expect(block).toBeInstanceOf(Block);
    });

    it('creates Block with empty tunes when not provided', () => {
      const block = factory.composeBlock({ tool: 'paragraph' });

      expect(block).toBeInstanceOf(Block);
    });
  });

  describe('hasTool', () => {
    it('returns true for existing tool', () => {
      expect(factory.hasTool('paragraph')).toBe(true);
      expect(factory.hasTool('header')).toBe(true);
      expect(factory.hasTool('list')).toBe(true);
    });

    it('returns false for non-existing tool', () => {
      expect(factory.hasTool('unknown-tool')).toBe(false);
      expect(factory.hasTool('')).toBe(false);
    });
  });

  describe('getTool', () => {
    it('returns tool adapter for existing tool', () => {
      const tool = factory.getTool('paragraph');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('paragraph');
    });

    it('returns undefined for non-existing tool', () => {
      const tool = factory.getTool('unknown-tool');

      expect(tool).toBeUndefined();
    });
  });

  describe('setReadOnly', () => {
    it('updates read-only state for factory', () => {
      expect(dependencies.readOnly).toBe(false);

      factory.setReadOnly(true);

      // Create a new block after setting read-only
      const block = factory.composeBlock({
        tool: 'paragraph',
        bindEventsImmediately: true,
      });

      // In read-only mode, events should not be bound
      expect(block.name).toBe('paragraph');
      expect(bindBlockEventsFn).not.toHaveBeenCalled();
    });

    it('toggles read-only state back to writable', () => {
      factory.setReadOnly(true);
      factory.setReadOnly(false);

      const block = factory.composeBlock({
        tool: 'paragraph',
        bindEventsImmediately: true,
      });

      expect(block.name).toBe('paragraph');
      expect(bindBlockEventsFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('requestIdleCallback behavior', () => {
    it('executes deferred callback eventually', async () => {
      const block = factory.composeBlock({
        tool: 'paragraph',
        bindEventsImmediately: false,
      });

      expect(block.name).toBe('paragraph');
      // Wait for the setTimeout in the polyfill to execute
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(bindBlockEventsFn).toHaveBeenCalledTimes(1);
    });
  });
});
