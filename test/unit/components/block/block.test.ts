import { describe, it, expect, vi, beforeAll, afterAll, afterEach, type Mock } from 'vitest';

import { Block } from '../../../../src/components/block';
import { ToolsCollection } from '../../../../src/components/tools/collection';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import type { BlockTuneAdapter } from '../../../../src/components/tools/tune';
import type { API as ApiModules } from '../../../../src/components/modules/api';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import type { BlockToolData } from '@/types';
import type { BlockTuneData } from '@/types/block-tunes/block-tune-data';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import { FakeCursorAboutToBeToggled, FakeCursorHaveBeenSet } from '../../../../src/components/events';
import { SelectionUtils } from '../../../../src/components/selection';

interface MockToolInstance {
  render: Mock<() => HTMLElement>;
  save: Mock<(el: HTMLElement) => Promise<BlockToolData>>;
  validate: Mock<(data: BlockToolData) => Promise<boolean>>;
  renderSettings?: () => unknown;
  merge?: (data: BlockToolData) => void | Promise<void>;
  destroy?: () => void;
}

interface TuneFactoryResult {
  name: string;
  adapter: BlockTuneAdapter;
  instance: {
    render: Mock<() => HTMLElement | { title: string }>;
    wrap: Mock<(node: HTMLElement) => HTMLElement>;
    save: Mock<() => BlockTuneData>;
  };
}

interface CreateBlockOptions {
  toolOverrides?: Partial<MockToolInstance>;
  renderSettings?: () => unknown;
  data?: BlockToolData;
  tunes?: TuneFactoryResult[];
  tunesData?: Record<string, BlockTuneData>;
  eventBus?: EventsDispatcher<BlokEventMap>;
}

interface CreateBlockResult {
  block: Block;
  toolInstance: MockToolInstance;
  toolAdapter: BlockToolAdapter;
  tunes: TuneFactoryResult[];
  renderElement: HTMLElement;
}

const requestIdleCallbackMock = vi.fn((callback: IdleRequestCallback): number => {
  callback({
    didTimeout: false,
    timeRemaining: () => 1,
  });

  return 1;
});

const cancelIdleCallbackMock = vi.fn((_id: number): void => {});

beforeAll(() => {
  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    writable: true,
    value: requestIdleCallbackMock,
  });

  Object.defineProperty(window, 'cancelIdleCallback', {
    configurable: true,
    writable: true,
    value: cancelIdleCallbackMock,
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  requestIdleCallbackMock.mockClear();
  cancelIdleCallbackMock.mockClear();
});

afterAll(() => {
  vi.restoreAllMocks();
});

const createTuneAdapter = (name: string, {
  isInternal = false,
  renderReturn,
  saveReturn,
}: {
  isInternal?: boolean;
  renderReturn?: HTMLElement | { title: string };
  saveReturn?: BlockTuneData;
} = {}): TuneFactoryResult => {
  const instance = {
    render: vi.fn((): HTMLElement | { title: string } => renderReturn ?? { title: `${name}-action` }),
    wrap: vi.fn((node: HTMLElement): HTMLElement => node),
    save: vi.fn((): BlockTuneData => saveReturn ?? { [`${name}Enabled`]: true }),
  };

  const adapter = {
    name,
    isInternal,
    create: vi.fn(() => instance),
  } as unknown as BlockTuneAdapter;

  return {
    name,
    adapter,
    instance,
  };
};

const createBlock = (options: CreateBlockOptions = {}): CreateBlockResult => {
  const renderElement = document.createElement('div');

  renderElement.setAttribute('contenteditable', 'true');

  const toolInstance: MockToolInstance = {
    render: options.toolOverrides?.render ?? vi.fn((): HTMLElement => renderElement),
    save: options.toolOverrides?.save
      ?? vi.fn(async (_el: HTMLElement): Promise<BlockToolData> => ({ text: 'saved' } as BlockToolData)),
    validate: options.toolOverrides?.validate ?? vi.fn(async (_data: BlockToolData): Promise<boolean> => true),
    renderSettings: options.renderSettings ?? options.toolOverrides?.renderSettings,
    merge: options.toolOverrides?.merge,
    destroy: options.toolOverrides?.destroy,
  };

  const tunes = options.tunes ?? [];
  const tunesCollection = new ToolsCollection<BlockTuneAdapter>(
    tunes.map(({ adapter }) => [adapter.name, adapter] as [ string, BlockTuneAdapter ])
  );

  const toolAdapter = {
    name: 'paragraph',
    settings: { config: { placeholder: 'Test' } },
    create: vi.fn(() => toolInstance as unknown as object),
    tunes: tunesCollection,
    sanitizeConfig: {},
    inlineTools: new ToolsCollection(),
    conversionConfig: undefined,
  } as unknown as BlockToolAdapter;

  const block = new Block({
    id: 'test-block',
    data: options.data ?? {},
    tool: toolAdapter,
    readOnly: false,
    tunesData: options.tunesData ?? {},
    api: {} as ApiModules,
  }, options.eventBus);

  return {
    block,
    toolInstance,
    toolAdapter,
    tunes,
    renderElement,
  };
};

describe('Block', () => {
  describe('call', () => {
    it('invokes tool method when present', () => {
      const { block, toolInstance } = createBlock();
      const customMethod = vi.fn();

      (toolInstance as unknown as { custom: typeof customMethod }).custom = customMethod;

      block.call('custom', { foo: 'bar' });

      expect(customMethod).toHaveBeenCalledWith({ foo: 'bar' });
    });

    it('skips invocation for missing methods', () => {
      const { block } = createBlock();

      expect(() => {
        block.call('unknown');
      }).not.toThrow();
    });
  });

  describe('mergeWith', () => {
    it('throws when tool does not support merging', async () => {
      const { block } = createBlock();

      await expect(block.mergeWith({} as BlockToolData)).rejects.toThrow('does not support merging');
    });

    it('delegates merge to tool when supported', async () => {
      const merge = vi.fn();
      const { block } = createBlock({
        toolOverrides: {
          merge,
        },
      });

      const payload = { text: 'merge me' } as BlockToolData;

      await block.mergeWith(payload);

      expect(merge).toHaveBeenCalledWith(payload);
    });
  });

  describe('save', () => {
    it('collects tool data and tunes data including unavailable ones', async () => {
      const userTune = createTuneAdapter('userTune');
      const internalTune = createTuneAdapter('internalTune', { isInternal: true });
      const { block, toolInstance } = createBlock({
        tunes: [userTune, internalTune],
        tunesData: {
          missingTune: { collapsed: true },
        },
      });

      const performanceSpy = vi.spyOn(window.performance, 'now');

      performanceSpy.mockReturnValueOnce(100);
      performanceSpy.mockReturnValueOnce(160);

      const result = await block.save();

      expect(toolInstance.save).toHaveBeenCalledWith(block.pluginsContent);
      expect(result).toMatchObject({
        id: 'test-block',
        tool: 'paragraph',
        data: { text: 'saved' },
        tunes: {
          userTune: { userTuneEnabled: true },
          internalTune: { internalTuneEnabled: true },
          missingTune: { collapsed: true },
        },
        time: 60,
      });

      performanceSpy.mockRestore();
    });
  });

  describe('getTunes', () => {
    it('splits tool-specific and common tunes including html entries', () => {
      const htmlButton = document.createElement('button');
      const userTune = createTuneAdapter('userTune');
      const internalTune = createTuneAdapter('internalTune', {
        isInternal: true,
        renderReturn: htmlButton,
      });

      const renderSettings = (): Array<{ title: string }> => [ { title: 'Tool Action' } ];
      const { block } = createBlock({
        tunes: [userTune, internalTune],
        renderSettings,
      });

      const tunes = block.getTunes();

      expect(tunes.toolTunes).toEqual([ { title: 'Tool Action' } ]);

      expect(tunes.commonTunes).toEqual([
        expect.objectContaining({ title: 'userTune-action' }),
        expect.objectContaining({
          type: PopoverItemType.Html,
          element: htmlButton,
        }),
      ]);
    });
  });

  describe('inputs handling', () => {
    it('caches inputs until cache is dropped', () => {
      const { block } = createBlock();
      const content = block.pluginsContent;
      const cachedInputs = block.inputs;
      const firstInput = document.createElement('div');

      firstInput.setAttribute('contenteditable', 'true');
      content.appendChild(firstInput);

      expect(block.inputs).toBe(cachedInputs);

      (block as unknown as { dropInputsCache: () => void }).dropInputsCache();

      const refreshedInputs = block.inputs;

      expect(refreshedInputs).not.toBe(cachedInputs);
      expect(refreshedInputs).toContain(firstInput);

      const secondInput = document.createElement('div');

      secondInput.setAttribute('contenteditable', 'true');
      content.appendChild(secondInput);

      expect(block.inputs).toBe(refreshedInputs);

      (block as unknown as { dropInputsCache: () => void }).dropInputsCache();

      const refreshedInputsAgain = block.inputs;

      expect(refreshedInputsAgain).not.toBe(refreshedInputs);
      expect(refreshedInputsAgain).toContain(firstInput);
      expect(refreshedInputsAgain).toContain(secondInput);
    });
  });

  describe('setData', () => {
    it('clears contenteditable content when called with empty object on paragraph block', async () => {
      const { block, renderElement } = createBlock({ data: { text: 'initial content' } });

      renderElement.innerHTML = 'hello';

      const result = await block.setData({});

      expect(result).toBe(true);
      expect(renderElement.innerHTML).toBe('');
    });

    it('updates contenteditable content when called with text property', async () => {
      const { block, renderElement } = createBlock({ data: { text: 'initial content' } });

      renderElement.innerHTML = 'old text';

      const result = await block.setData({ text: 'new text' });

      expect(result).toBe(true);
      expect(renderElement.innerHTML).toBe('new text');
    });

    it('returns false for non-paragraph blocks with empty data', async () => {
      const renderElement = document.createElement('div');

      renderElement.setAttribute('contenteditable', 'true');

      const toolInstance = {
        render: vi.fn((): HTMLElement => renderElement),
        save: vi.fn(async (): Promise<BlockToolData> => ({ src: 'image.png' })),
        validate: vi.fn(async (): Promise<boolean> => true),
      };

      const toolAdapter = {
        name: 'image', // Not a paragraph
        settings: { config: {} },
        create: vi.fn(() => toolInstance as unknown as object),
        tunes: new ToolsCollection<BlockTuneAdapter>(),
        sanitizeConfig: {},
        inlineTools: new ToolsCollection(),
        conversionConfig: undefined,
      } as unknown as BlockToolAdapter;

      const block = new Block({
        id: 'test-image-block',
        data: { src: 'image.png' },
        tool: toolAdapter,
        readOnly: false,
        tunesData: {},
        api: {} as ApiModules,
      });

      renderElement.innerHTML = 'caption text';

      const result = await block.setData({});

      // Should return false because it's not a paragraph block
      expect(result).toBe(false);
      // Content should remain unchanged
      expect(renderElement.innerHTML).toBe('caption text');
    });
  });

  describe('currentInputIndex', () => {
    it('returns the default input index', () => {
      const { block } = createBlock();

      // Default should be 0
      expect(block.currentInputIndex).toBe(0);
    });

    it('returns the updated input index when currentInput is changed', () => {
      const { block } = createBlock();
      const content = block.pluginsContent;

      // Add additional inputs to the block (as siblings, not nested)
      const secondInput = document.createElement('div');

      secondInput.setAttribute('contenteditable', 'true');

      const thirdInput = document.createElement('div');

      thirdInput.setAttribute('contenteditable', 'true');

      // Get the parent of pluginsContent to add siblings
      const parent = content.parentElement;

      if (parent === null) {
        throw new Error('Expected parent element');
      }

      parent.appendChild(secondInput);
      parent.appendChild(thirdInput);

      // Drop inputs cache to refresh
      (block as unknown as { dropInputsCache: () => void }).dropInputsCache();

      // Verify we now have 3 inputs
      expect(block.inputs.length).toBe(3);

      // Set current input to second element
      block.currentInput = secondInput;
      expect(block.currentInputIndex).toBe(1);

      // Set current input to third element
      block.currentInput = thirdInput;
      expect(block.currentInputIndex).toBe(2);
    });
  });

  describe('block state helpers', () => {
    it('detects empty state based on text and media content', () => {
      const { block } = createBlock();

      block.pluginsContent.textContent = '';
      expect(block.isEmpty).toBe(true);

      block.pluginsContent.textContent = 'filled';
      expect(block.isEmpty).toBe(false);

      block.pluginsContent.textContent = '';
      const image = document.createElement('img');

      block.holder.appendChild(image);
      expect(block.hasMedia).toBe(true);
      expect(block.isEmpty).toBe(false);
    });

    it('toggles selection class and emits fake cursor events', () => {
      const eventBus = new EventsDispatcher<BlokEventMap>();
      const emitSpy = vi.spyOn(eventBus, 'emit');
      const { block } = createBlock({ eventBus });

      const isRangeInsideContainerSpy = vi.spyOn(SelectionUtils, 'isRangeInsideContainer').mockReturnValue(true);
      const isFakeCursorInsideContainerSpy = vi.spyOn(SelectionUtils, 'isFakeCursorInsideContainer').mockReturnValue(true);
      const addFakeCursorSpy = vi.spyOn(SelectionUtils, 'addFakeCursor').mockImplementation(() => {});
      const removeFakeCursorSpy = vi.spyOn(SelectionUtils, 'removeFakeCursor').mockImplementation(() => {});

      block.selected = true;

      expect(block.holder.getAttribute('data-blok-selected')).toBe('true');
      expect(emitSpy).toHaveBeenCalledWith(FakeCursorAboutToBeToggled, { state: true });
      expect(emitSpy).toHaveBeenCalledWith(FakeCursorHaveBeenSet, { state: true });

      block.selected = false;

      expect(emitSpy).toHaveBeenCalledWith(FakeCursorAboutToBeToggled, { state: false });
      expect(emitSpy).toHaveBeenCalledWith(FakeCursorHaveBeenSet, { state: false });
      expect(addFakeCursorSpy).toHaveBeenCalledTimes(1);
      expect(removeFakeCursorSpy).toHaveBeenCalledTimes(1);

      isRangeInsideContainerSpy.mockRestore();
      isFakeCursorInsideContainerSpy.mockRestore();
      addFakeCursorSpy.mockRestore();
      removeFakeCursorSpy.mockRestore();
    });
  });
});
