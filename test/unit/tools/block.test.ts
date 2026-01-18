import { describe, it, expect, afterEach, vi } from 'vitest';
import type {
  BlockAPI,
  BlockToolData,
  ToolSettings,
  BlockToolConstructable,
  InlineToolConstructable,
  API,
  ToolboxConfigEntry,
  SanitizerConfig,
  Blocks,
  Caret,
  Tools,
  Events,
  Listeners,
  Notifier,
  Sanitizer,
  Saver,
  Selection,
  Styles,
  Toolbar,
  InlineToolbar,
  Tooltip,
  I18n,
  ReadOnly,
  Ui,
} from '@/types';
import { ToolType } from '@/types/tools/adapters/tool-type';
import { BlockToolAdapter } from '../../../src/components/tools/block';
import { InlineToolAdapter } from '../../../src/components/tools/inline';
import { ToolsCollection } from '../../../src/components/tools/collection';
import { InternalBlockToolSettings } from '../../../src/components/tools/base';

type BlockToolAdapterOptions = ConstructorParameters<typeof BlockToolAdapter>[0];

interface ToolConstructorArgs {
  data: BlockToolData;
  block: BlockAPI;
  readOnly: boolean;
  api: API;
  config?: ToolSettings;
}

/**
 * Type guard to check if a constructable is a BlockToolConstructable
 */
const isBlockToolConstructable = (constructable: BlockToolAdapterOptions['constructable']): constructable is BlockToolConstructable => {
  return 'sanitize' in constructable || 'toolbox' in constructable || 'conversionConfig' in constructable;
};

/**
 * Creates a mock BlockTool constructable class for testing.
 * The class implements required instance methods (render, save) to satisfy BlockToolConstructable.
 */
const createConstructable = (overrides: Record<string, unknown> = {}): BlockToolConstructable => {
  class MockBlockTool {
    public static sanitize: SanitizerConfig = {
      rule1: {
        div: true,
      },
    };

    public static toolbox = {
      icon: 'Tool icon',
      title: 'Tool title',
    };

    public static enableLineBreaks = true;

    public static pasteConfig = {
      tags: [ 'div' ],
    };

    public static conversionConfig = {
      import: 'import',
      export: 'export',
    };

    public static isReadOnlySupported = true;

    public static shortcut = 'CTRL+N';

    // Instance properties (set by constructor)
    public data: BlockToolData;
    public block: BlockAPI;
    public readonly: boolean;
    public api: API;
    public config: ToolSettings;

    constructor({ data, block, readOnly, api, config }: ToolConstructorArgs) {
      this.data = data;
      this.block = block;
      this.readonly = readOnly;
      this.api = api;
      this.config = config ?? {};
    }

    // Required BlockTool instance methods
    public render(): HTMLElement {
      return document.createElement('div');
    }

    public save(_blockContent: HTMLElement): BlockToolData {
      return this.data;
    }

    // Optional lifecycle methods
    public static prepare?(data: { toolName: string; config: ToolSettings }): void | Promise<void>;
    public static reset?(): void | Promise<void>;
  }

  Object.assign(MockBlockTool, overrides);

  return MockBlockTool as BlockToolConstructable;
};

/**
 * Creates a partial mock of the API interface for testing.
 * We use empty objects typed as mocks for each API property.
*/
const createMockAPI = (): Partial<API> => ({
  blocks: {} as Blocks,
  caret: {} as Caret,
  tools: {} as Tools,
  events: {} as Events,
  listeners: {} as Listeners,
  notifier: {} as Notifier,
  sanitizer: {} as Sanitizer,
  saver: {} as Saver,
  selection: {} as Selection,
  styles: {} as Styles,
  toolbar: {} as Toolbar,
  inlineToolbar: {} as InlineToolbar,
  tooltip: {} as Tooltip,
  i18n: {} as I18n,
  readOnly: {} as ReadOnly,
  ui: {} as Ui,
});

const createBaseOptions = (): BlockToolAdapterOptions => {
  const constructable = createConstructable();
  const mockAPI = createMockAPI();

  return {
    name: 'blockTool',
    constructable: constructable,
    config: {
      config: {
        option1: 'option1',
        option2: 'option2',
      },
      inlineToolbar: ['link', 'bold'],
      tunes: ['anchor', 'favorites'],
      shortcut: 'CMD+SHIFT+B',
      toolbox: {
        title: 'User Block Tool',
        icon: 'User icon',
      },
    },
    api: mockAPI as API,
    isDefault: false,
    isInternal: false,
    defaultPlaceholder: 'Default placeholder',
  };
};

const mergeOptions = (overrides: Partial<BlockToolAdapterOptions> = {}): BlockToolAdapterOptions => {
  const baseOptions = createBaseOptions();
  const configOverrides = overrides.config;

  const mergedConfig = {
    ...baseOptions.config,
    ...configOverrides,
    config: configOverrides && 'config' in configOverrides
      ? {
        ...baseOptions.config.config,
        ...configOverrides.config,
      }
      : baseOptions.config.config,
  };

  return {
    ...baseOptions,
    ...overrides,
    config: mergedConfig,
  };
};

const createBlockTool = (overrides?: Partial<BlockToolAdapterOptions>): { tool: BlockToolAdapter; options: BlockToolAdapterOptions } => {
  const options = mergeOptions(overrides);
  const tool = new BlockToolAdapter(options);

  return { tool,
    options };
};

const createInlineTool = (sanitize: Record<string, unknown>): InlineToolAdapter => {
  const mockAPI = createMockAPI();

  return new InlineToolAdapter({
    name: `inline-${Math.random()}`,
    constructable: class {
      public static sanitize = sanitize as SanitizerConfig;
      public render(): HTMLElement {
        return document.createElement('span');
      }
      public static isInline = true;
    } as unknown as InlineToolConstructable,
    config: {
      config: {},
    },
    api: mockAPI as API,
    isDefault: false,
    isInternal: false,
  });
};

describe('BlockToolAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('basic metadata', () => {
    it('returns Block tool type', () => {
      const { tool } = createBlockTool();

      expect(tool.type).toBe(ToolType.Block);
    });

    it('exposes tool name', () => {
      const { tool, options } = createBlockTool();

      expect(tool.name).toBe(options.name);
    });

    it('reflects default tool flag', () => {
      const { tool: regularTool } = createBlockTool();
      const { tool: defaultTool } = createBlockTool({ isDefault: true });

      expect(regularTool.isDefault).toBe(false);
      expect(defaultTool.isDefault).toBe(true);
    });

    it('reflects internal tool flag', () => {
      const { tool: externalTool } = createBlockTool();
      const { tool: internalTool } = createBlockTool({ isInternal: true });

      expect(externalTool.isInternal).toBe(false);
      expect(internalTool.isInternal).toBe(true);
    });
  });

  describe('settings', () => {
    it('returns user configuration', () => {
      const { tool, options } = createBlockTool();

      expect(tool.settings).toEqual(options.config.config);
    });

    it('adds default placeholder for default tools', () => {
      const { tool } = createBlockTool({ isDefault: true });

      expect(tool.settings).toHaveProperty('placeholder', 'Default placeholder');
    });
  });

  describe('sanitize configuration', () => {
    it('returns constructable sanitize config by default', () => {
      const { tool, options } = createBlockTool();

      if (isBlockToolConstructable(options.constructable)) {
        expect(tool.sanitizeConfig).toEqual(options.constructable.sanitize);
      } else {
        expect(tool.sanitizeConfig).toEqual({});
      }
    });

    it('merges inline tool sanitize config when provided', () => {
      const { tool, options } = createBlockTool();
      const inlineTool = createInlineTool({ b: true });

      tool.inlineTools = new ToolsCollection([ ['inlineTool', inlineTool] ]);

      if (isBlockToolConstructable(options.constructable)) {
        const baseKeys = Object.keys(options.constructable.sanitize ?? {});

        // Check that the result contains base keys merged with inline tool config
        const result = tool.sanitizeConfig;

        expect(result).toBeDefined();

        // The base keys should exist in the result
        baseKeys.forEach((key) => {
          expect(result).toHaveProperty(key);
        });
      }
    });

    it('falls back to inline tools config when constructable sanitize config is empty', () => {
      const { options } = createBlockTool();
      const inlineTool = createInlineTool({ strong: true });
      const inlineTool2 = createInlineTool({ em: true });

      const emptyConstructable = createConstructable();
      (emptyConstructable as unknown as Record<string, unknown>).sanitize = undefined;

      const tool = new BlockToolAdapter({
        ...options,
        constructable: emptyConstructable,
      });

      tool.inlineTools = new ToolsCollection([
        ['inlineTool', inlineTool],
        ['inlineTool2', inlineTool2],
      ]);

      expect(tool.sanitizeConfig).toEqual({
        ...inlineTool.sanitizeConfig,
        ...inlineTool2.sanitizeConfig,
      });
    });

    it('returns empty object when no sanitize configuration is provided', () => {
      const { options } = createBlockTool();

      const emptyConstructable = createConstructable();
      (emptyConstructable as unknown as Record<string, unknown>).sanitize = undefined;

      const tool = new BlockToolAdapter({
        ...options,
        constructable: emptyConstructable,
      });

      expect(tool.sanitizeConfig).toEqual({});
    });
  });

  describe('type helpers', () => {
    it('identifies block tool type correctly', () => {
      const { tool } = createBlockTool();

      expect(tool.isBlock()).toBe(true);
      expect(tool.isInline()).toBe(false);
      expect(tool.isTune()).toBe(false);
    });
  });

  describe('capabilities', () => {
    it('reports read-only support', () => {
      const { tool, options } = createBlockTool();

      if (isBlockToolConstructable(options.constructable)) {
        expect(tool.isReadOnlySupported).toBe(options.constructable.isReadOnlySupported);
      } else {
        expect(tool.isReadOnlySupported).toBe(false);
      }
    });

    it('reports line breaks support', () => {
      const { tool, options } = createBlockTool();

      if (isBlockToolConstructable(options.constructable)) {
        const constructable = options.constructable;
        const enableLineBreaks = (constructable as unknown as Record<string, unknown>)[InternalBlockToolSettings.IsEnabledLineBreaks] ?? false;
        expect(tool.isLineBreaksEnabled).toBe(enableLineBreaks);
      } else {
        expect(tool.isLineBreaksEnabled).toBe(false);
      }
    });
  });

  describe('configuration getters', () => {
    it('exposes conversion config', () => {
      const { tool, options } = createBlockTool();

      if (isBlockToolConstructable(options.constructable)) {
        expect(tool.conversionConfig).toEqual(options.constructable.conversionConfig);
      } else {
        expect(tool.conversionConfig).toBeUndefined();
      }
    });

    it('exposes paste config from constructable', () => {
      const { tool, options } = createBlockTool();

      if (isBlockToolConstructable(options.constructable)) {
        expect(tool.pasteConfig).toEqual(options.constructable.pasteConfig);
      } else {
        expect(tool.pasteConfig).toEqual({});
      }
    });

    it('returns constructable paste config when set to false', () => {
      const { options } = createBlockTool();

      const customConstructable = createConstructable({
        pasteConfig: false,
      });

      const tool = new BlockToolAdapter({
        ...options,
        constructable: customConstructable,
      });

      expect(tool.pasteConfig).toBe(false);
    });

    it('returns empty object when paste config is not provided', () => {
      const { options } = createBlockTool();

      const customConstructable = createConstructable();
      (customConstructable as unknown as Record<string, unknown>).pasteConfig = undefined;

      const tool = new BlockToolAdapter({
        ...options,
        constructable: customConstructable,
      });

      expect(tool.pasteConfig).toEqual({});
    });

    it('returns enabled inline tools or true by default', () => {
      const { tool, options } = createBlockTool();

      expect(tool.enabledInlineTools).toEqual(options.config.inlineToolbar);

      const { tool: fallbackTool } = createBlockTool({
        config: {
          inlineToolbar: undefined,
        },
      });

      // Defaults to true when not specified
      expect(fallbackTool.enabledInlineTools).toBe(true);
    });

    it('returns enabled block tunes from config', () => {
      const { tool, options } = createBlockTool();

      expect(tool.enabledBlockTunes).toEqual(options.config.tunes);
    });
  });

  describe('toolbox configuration', () => {
    it('returns user defined toolbox config wrapped in array', () => {
      const { tool, options } = createBlockTool();

      expect(tool.toolbox).toEqual([ options.config.toolbox ]);
    });

    it('falls back to constructable toolbox config when user config is not provided', () => {
      const { options } = createBlockTool();

      const tool = new BlockToolAdapter({
        ...options,
        config: {
          ...options.config,
          toolbox: undefined,
        },
      });

      if (isBlockToolConstructable(options.constructable)) {
        expect(tool.toolbox).toEqual([ options.constructable.toolbox ]);
      } else {
        expect(tool.toolbox).toBeUndefined();
      }
    });

    it('merges constructable and user toolbox configs when both are objects', () => {
      const { options } = createBlockTool();

      const tool = new BlockToolAdapter({
        ...options,
        config: {
          ...options.config,
          toolbox: {
            title: 'Custom title',
          },
        },
      });

      const expected: ToolboxConfigEntry[] = [];

      if (isBlockToolConstructable(options.constructable)) {
        expected.push({
          ...(options.constructable.toolbox ?? {}),
          title: 'Custom title',
        });
      }

      expect(tool.toolbox).toEqual(expected);
    });

    it('replaces constructable toolbox array with user object', () => {
      const { options } = createBlockTool();
      const toolboxEntries = [
        { title: 'Toolbox entry 1' },
        { title: 'Toolbox entry 2' },
      ];
      // Get the icon from the base constructable's toolbox
      const toolboxIcon = isBlockToolConstructable(options.constructable) && options.constructable.toolbox
        ? (options.constructable.toolbox as unknown as Record<string, unknown>).icon
        : undefined;
      const baseIcon = (typeof toolboxIcon === 'string' ? toolboxIcon : '') ?? '';

      const userConfig = {
        title: 'User title',
        icon: baseIcon,
      };

      const customConstructable = createConstructable({
        toolbox: toolboxEntries,
      });

      const tool = new BlockToolAdapter({
        ...options,
        constructable: customConstructable,
        config: {
          ...options.config,
          toolbox: userConfig,
        },
      });

      expect(tool.toolbox).toEqual([ userConfig ]);
    });

    it('uses user provided toolbox array when constructable config is object', () => {
      const { options } = createBlockTool();
      const userConfig = [
        { title: 'Toolbox entry 1' },
        { title: 'Toolbox entry 2' },
      ];

      const tool = new BlockToolAdapter({
        ...options,
        config: {
          ...options.config,
          toolbox: userConfig,
        },
      });

      expect(tool.toolbox).toEqual(userConfig);
    });

    it('merges toolbox arrays by index', () => {
      const { options } = createBlockTool();
      const toolboxEntries = [
        { title: 'Toolbox entry 1' },
      ];
      const userConfig = [
        { icon: 'Icon 1' },
        { icon: 'Icon 2',
          title: 'Toolbox entry 2' },
      ];

      const customConstructable = createConstructable({
        toolbox: toolboxEntries,
      });

      const tool = new BlockToolAdapter({
        ...options,
        constructable: customConstructable,
        config: {
          ...options.config,
          toolbox: userConfig,
        },
      });

      expect(tool.toolbox).toEqual([
        {
          ...toolboxEntries[0],
          ...userConfig[0],
        },
        userConfig[1],
      ]);
    });

    it('returns undefined when user disables toolbox', () => {
      const { options } = createBlockTool();

      const tool = new BlockToolAdapter({
        ...options,
        config: {
          ...options.config,
          toolbox: false,
        },
      });

      expect(tool.toolbox).toBeUndefined();
    });

    it('returns undefined when constructable toolbox config is false', () => {
      const { options } = createBlockTool();

      const customConstructable = createConstructable({
        toolbox: false,
      });

      const tool = new BlockToolAdapter({
        ...options,
        constructable: customConstructable,
      });

      expect(tool.toolbox).toBeUndefined();
    });

    it('returns undefined when constructable toolbox config is empty', () => {
      const { options } = createBlockTool();

      const customConstructable = createConstructable({
        toolbox: {},
      });

      const tool = new BlockToolAdapter({
        ...options,
        constructable: customConstructable,
      });

      expect(tool.toolbox).toBeUndefined();
    });
  });

  describe('lifecycle hooks', () => {
    it('calls constructable prepare when defined', async () => {
      const { tool, options } = createBlockTool();
      const prepare = vi.fn();

      (options.constructable as unknown as Record<string, unknown>).prepare = prepare;

      await tool.prepare();

      expect(prepare).toHaveBeenCalledWith({
        toolName: options.name,
        config: tool.settings,
      });
    });

    it('gracefully skips prepare when missing', () => {
      const { tool, options } = createBlockTool();

      (options.constructable as unknown as Record<string, unknown>).prepare = undefined;

      expect(tool.prepare()).toBeUndefined();
    });

    it('calls constructable reset when defined and returns the result', async () => {
      const { tool, options } = createBlockTool();
      const resetResult = { success: true };
      const reset = vi.fn(() => resetResult);

      (options.constructable as unknown as Record<string, unknown>).reset = reset;

      const result = await tool.reset();

      expect(reset).toHaveBeenCalledTimes(1);
      expect(result).toBe(resetResult);
    });

    it('gracefully skips reset when missing', () => {
      const { tool, options } = createBlockTool();

      (options.constructable as unknown as Record<string, unknown>).reset = undefined;

      expect(tool.reset()).toBeUndefined();
    });
  });

  describe('keyboard shortcut', () => {
    it('prefers user defined shortcut', () => {
      const { tool, options } = createBlockTool();

      expect(tool.shortcut).toBe(options.config.shortcut);
    });

    it('falls back to constructable shortcut', () => {
      const { options } = createBlockTool();

      const tool = new BlockToolAdapter({
        ...options,
        config: {
          ...options.config,
          shortcut: undefined,
        },
      });

      if (isBlockToolConstructable(options.constructable)) {
        expect(tool.shortcut).toBe(options.constructable.shortcut);
      } else {
        expect(tool.shortcut).toBeUndefined();
      }
    });
  });

  describe('instance creation', () => {
    it('creates tool instances with provided arguments', () => {
      const { tool, options } = createBlockTool();
      const data = { text: 'text' };
      const blockAPI = {
        method(): void {
          // noop
        },
      } as Partial<BlockAPI> as BlockAPI;

      const instance = tool.create(data, blockAPI, false);

      expect(instance).toBeInstanceOf(options.constructable);

      // Verify instance properties through type narrowing
      const instanceWithProps = instance as unknown as {
        data: BlockToolData;
        block: BlockAPI;
        readonly: boolean;
        api: API;
        config: ToolSettings & { _toolboxEntries?: unknown };
      };

      expect(instanceWithProps.data).toEqual(data);
      expect(instanceWithProps.block).toEqual(blockAPI);
      expect(instanceWithProps.readonly).toBe(false);
      expect(instanceWithProps.api).toEqual(options.api);

      // Config should include original settings plus injected _toolboxEntries
      if (options.config.config !== undefined) {
        expect(instanceWithProps.config).toMatchObject(options.config.config);
      }
      expect(instanceWithProps.config).toHaveProperty('_toolboxEntries');
    });
  });
});
