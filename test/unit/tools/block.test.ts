import { describe, it, expect, afterEach, vi } from 'vitest';
import type { BlockAPI, BlockToolData, ToolSettings, BlockToolConstructable, API } from '@/types';
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
  api: object;
  config?: ToolSettings;
}

type ConstructableClass = new (args: ToolConstructorArgs) => {
  data: BlockToolData;
  block: BlockAPI;
  readonly: boolean;
  api: object;
  config: ToolSettings;
};

const createConstructable = (overrides: Record<string, unknown> = {}): ConstructableClass => {
  /**
   *
   */
  class Constructable {
    public static sanitize = {
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

    public data: BlockToolData;
    public block: BlockAPI;
    public readonly: boolean;
    public api: object;
    public config: ToolSettings;

    /**
     *
     * @param root0 - The constructor arguments object
     */
    constructor({ data, block, readOnly, api, config }: ToolConstructorArgs) {
      this.data = data;
      this.block = block;
      this.readonly = readOnly;
      this.api = api;
      this.config = config ?? {};
    }
  }

  Object.assign(Constructable, overrides);

  return Constructable;
};

const createBaseOptions = (): BlockToolAdapterOptions => {
  const constructable = createConstructable();

  return {
    name: 'blockTool',
    constructable: constructable as unknown as BlockToolConstructable,
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
    api: {
      prop1: 'prop1',
      prop2: 'prop2',
    } as unknown as API,
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
  const tool = new BlockToolAdapter(options as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);

  return { tool,
    options };
};

const createInlineTool = (sanitize: Record<string, unknown>): InlineToolAdapter => {
  return new InlineToolAdapter({
    name: `inline-${Math.random()}`,
    constructable: class {
      public static sanitize = sanitize;
    },
    config: {
      config: {},
    },
    api: {},
    isDefault: false,
    isInternal: false,
  } as unknown as ConstructorParameters<typeof InlineToolAdapter>[0]);
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

      expect(tool.sanitizeConfig).toEqual(options.constructable.sanitize);
    });

    it('merges inline tool sanitize config when provided', () => {
      const { tool, options } = createBlockTool();
      const inlineTool = createInlineTool({ b: true });

      tool.inlineTools = new ToolsCollection([ ['inlineTool', inlineTool] ]);

      const expected = Object.fromEntries(
        Object.entries(options.constructable.sanitize as Record<string, Record<string, boolean>>)
          .map(([field, rule]) => [
            field,
            {
              ...(rule ?? {}),
              ...(inlineTool.sanitizeConfig as Record<string, boolean>),
            },
          ])
      );

      expect(tool.sanitizeConfig).toEqual(expected);
    });

    it('falls back to inline tools config when constructable sanitize config is empty', () => {
      const { options } = createBlockTool();
      const inlineTool = createInlineTool({ strong: true });
      const inlineTool2 = createInlineTool({ em: true });
      const tool = new BlockToolAdapter({
        ...options,
        constructable: class {},
      } as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);

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
      const tool = new BlockToolAdapter({
        ...options,
        constructable: class {},
      } as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);

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

      expect(tool.isReadOnlySupported).toBe((options.constructable as BlockToolConstructable).isReadOnlySupported);
    });

    it('reports line breaks support', () => {
      const { tool, options } = createBlockTool();

      expect(tool.isLineBreaksEnabled).toBe((options.constructable as unknown as Record<string, boolean | undefined>)[InternalBlockToolSettings.IsEnabledLineBreaks]);
    });
  });

  describe('configuration getters', () => {
    it('exposes conversion config', () => {
      const { tool, options } = createBlockTool();

      expect(tool.conversionConfig).toEqual((options.constructable as BlockToolConstructable).conversionConfig);
    });

    it('exposes paste config from constructable', () => {
      const { tool, options } = createBlockTool();

      expect(tool.pasteConfig).toEqual((options.constructable as BlockToolConstructable).pasteConfig);
    });

    it('returns constructable paste config when set to false', () => {
      const { options } = createBlockTool();
      const tool = new BlockToolAdapter({
        ...options,
        constructable: class extends (options.constructable as typeof options.constructable) {
          public static pasteConfig = false;
        },
      } as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);

      expect(tool.pasteConfig).toBe(false);
    });

    it('returns empty object when paste config is not provided', () => {
      const { options } = createBlockTool();
      const tool = new BlockToolAdapter({
        ...options,
        constructable: class extends (options.constructable as typeof options.constructable) {
          public static pasteConfig = undefined;
        },
      } as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);

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
      } as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);

      expect(tool.toolbox).toEqual([ (options.constructable as BlockToolConstructable).toolbox ]);
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
      } as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);

      expect(tool.toolbox).toEqual([
        {
          ...(options.constructable as BlockToolConstructable).toolbox,
          title: 'Custom title',
        },
      ]);
    });

    it('replaces constructable toolbox array with user object', () => {
      const { options } = createBlockTool();
      const toolboxEntries = [
        { title: 'Toolbox entry 1' },
        { title: 'Toolbox entry 2' },
      ];
      const userConfig = {
        title: 'User title',
        icon: typeof options.config.toolbox === 'object' && !Array.isArray(options.config.toolbox) ? options.config.toolbox.icon : undefined,
      };
      const tool = new BlockToolAdapter({
        ...options,
        constructable: class extends (options.constructable as typeof options.constructable) {
          public static toolbox = toolboxEntries;
        },
        config: {
          ...options.config,
          toolbox: userConfig,
        },
      } as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);

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
      } as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);

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
      const tool = new BlockToolAdapter({
        ...options,
        constructable: class extends (options.constructable as typeof options.constructable) {
          public static toolbox = toolboxEntries;
        },
        config: {
          ...options.config,
          toolbox: userConfig,
        },
      } as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);

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
      } as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);

      expect(tool.toolbox).toBeUndefined();
    });

    it('returns undefined when constructable toolbox config is false', () => {
      const { options } = createBlockTool();
      const tool = new BlockToolAdapter({
        ...options,
        constructable: class {
          public static toolbox = false;
        },
      } as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);

      expect(tool.toolbox).toBeUndefined();
    });

    it('returns undefined when constructable toolbox config is empty', () => {
      const { options } = createBlockTool();
      const tool = new BlockToolAdapter({
        ...options,
        constructable: class {
          public static toolbox = {};
        },
      } as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);

      expect(tool.toolbox).toBeUndefined();
    });
  });

  describe('lifecycle hooks', () => {
    it('calls constructable prepare when defined', async () => {
      const { tool, options } = createBlockTool();
      const prepare = vi.fn();

      options.constructable.prepare = prepare;
      await tool.prepare();

      expect(prepare).toHaveBeenCalledWith({
        toolName: options.name,
        config: tool.settings,
      });
    });

    it('gracefully skips prepare when missing', () => {
      const { tool, options } = createBlockTool();

      options.constructable.prepare = undefined;

      expect(tool.prepare()).toBeUndefined();
    });

    it('calls constructable reset when defined', async () => {
      const { tool, options } = createBlockTool();
      const reset = vi.fn();

      options.constructable.reset = reset;
      await tool.reset();

      expect(reset).toHaveBeenCalledTimes(1);
    });

    it('gracefully skips reset when missing', () => {
      const { tool, options } = createBlockTool();

      options.constructable.reset = undefined;

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
      } as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);

      expect(tool.shortcut).toBe(options.constructable.shortcut);
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
      } as unknown as BlockAPI;

      const instance = tool.create(data as BlockToolData, blockAPI, false);

      expect(instance).toBeInstanceOf(options.constructable as unknown as { new(...args: unknown[]): object });
      expect((instance as unknown as { data: unknown }).data).toEqual(data);
      expect((instance as unknown as { block: unknown }).block).toEqual(blockAPI);
      expect((instance as unknown as { readonly: boolean }).readonly).toBe(false);
      expect((instance as unknown as { api: unknown }).api).toEqual(options.api);
      // Config should include original settings plus injected _toolboxEntries
      const instanceConfig = (instance as unknown as { config: unknown }).config;

      expect(instanceConfig).toMatchObject(options.config.config as object);
      expect(instanceConfig).toHaveProperty('_toolboxEntries');
    });
  });
});

