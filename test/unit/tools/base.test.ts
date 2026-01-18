import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tool, ToolConstructable } from '@/types/tools';
import type { API } from '@/types';
import type { ToolOptions } from '../../../src/components/tools/base';
import { BaseToolAdapter, CommonInternalSettings, UserSettings } from '../../../src/components/tools/base';
import { ToolType } from '@/types/tools/adapters/tool-type';

interface AdapterOptions {
  name: string;
  constructable: ToolConstructable;
  config: ToolOptions;
  api: API;
  isDefault: boolean;
  isInternal: boolean;
  defaultPlaceholder?: string | false;
}

interface TestToolAdapterOptions extends AdapterOptions {
  toolType?: ToolType;
}

/**
 * Test-friendly adapter that lets specs interact with the base implementation.
 */
class TestToolAdapter extends BaseToolAdapter<ToolType, Tool> {
  public type: ToolType;

  /**
   * Creates a tool adapter instance preloaded with the supplied test options.
   * @param options configuration bundle used to build the adapter for a spec
   */
  constructor(options: TestToolAdapterOptions) {
    super(options);
    this.type = options.toolType ?? ToolType.Block;
  }

  /**
   *
   */
  public create(): Tool {
    return {} as Tool;
  }
}

const createConstructable = (
  overrides: Record<string, unknown> = {}
): ToolConstructable & Record<string, unknown> => {
  /**
   *
   */
  class Constructable {}

  Object.assign(Constructable, overrides);

  return Constructable as unknown as ToolConstructable & Record<string, unknown>;
};

const createToolOptions = (overrides: Partial<ToolOptions> = {}): ToolOptions => {
  return {
    [UserSettings.Config]: {
      option1: 'value1',
    },
    [UserSettings.Shortcut]: 'CTRL+SHIFT+B',
    ...overrides,
  };
};

const createTool = (
  overrides: Partial<TestToolAdapterOptions> = {}
): {
  tool: TestToolAdapter;
  options: TestToolAdapterOptions;
} => {
  const options: TestToolAdapterOptions = {
    name: overrides.name ?? 'baseTool',
    constructable: overrides.constructable ?? createConstructable(),
    config: overrides.config ?? createToolOptions(),
    api: overrides.api ?? {} as API,
    isDefault: overrides.isDefault ?? false,
    isInternal: overrides.isInternal ?? false,
    defaultPlaceholder: overrides.defaultPlaceholder ?? 'Default placeholder',
    toolType: overrides.toolType ?? ToolType.Block,
  };

  return {
    tool: new TestToolAdapter(options),
    options,
  };
};

describe('BaseToolAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('settings', () => {
    it('returns user configuration as-is', () => {
      const customConfig: ToolOptions = {
        [UserSettings.Config]: {
          foo: 'bar',
        },
        [UserSettings.Shortcut]: 'CMD+ALT+1',
      };
      const { tool } = createTool({
        config: customConfig,
      });

      expect(tool.settings).toStrictEqual(customConfig[UserSettings.Config]);
    });

    it('adds default placeholder when default tool lacks placeholder', () => {
      const { tool } = createTool({
        isDefault: true,
        config: {
          [UserSettings.Shortcut]: 'CMD+ALT+2',
        } as ToolOptions,
      });

      expect(tool.settings).toStrictEqual({
        placeholder: 'Default placeholder',
      });
    });

    it('does not override user-defined placeholder', () => {
      const placeholder = 'Custom placeholder';
      const { tool } = createTool({
        isDefault: true,
        config: {
          [UserSettings.Config]: {
            placeholder,
          },
          [UserSettings.Shortcut]: 'CMD+ALT+3',
        } as ToolOptions,
      });

      expect(tool.settings).toStrictEqual({
        placeholder,
      });
    });
  });

  describe('lifecycle hooks', () => {
    it('delegates prepare to constructable with tool context', async () => {
      const prepare = vi.fn();
      const { tool } = createTool({
        constructable: createConstructable({
          prepare,
        }),
      });

      await tool.prepare();

      expect(prepare).toHaveBeenCalledWith({
        toolName: 'baseTool',
        config: tool.settings,
      });
    });

    it('skips prepare when constructable method is absent', async () => {
      const { tool } = createTool({
        constructable: createConstructable(),
      });

      const result = await tool.prepare();

      expect(result).toBeUndefined();
    });

    it('delegates reset to constructable when available', async () => {
      const resetReturnValue = { success: true };
      const reset = vi.fn().mockResolvedValue(resetReturnValue);
      const { tool } = createTool({
        constructable: createConstructable({
          reset,
        }),
      });

      const result = await tool.reset();

      expect(reset).toHaveBeenCalledTimes(1);
      expect(result).toBe(resetReturnValue);
    });

    it('skips reset when constructable method is absent', async () => {
      const { tool } = createTool({
        constructable: createConstructable(),
      });

      const result = await tool.reset();

      expect(result).toBeUndefined();
    });
  });

  describe('shortcut', () => {
    it('prefers user-defined shortcut value', () => {
      const config: ToolOptions = {
        [UserSettings.Config]: {},
        [UserSettings.Shortcut]: 'CMD+ALT+4',
      };
      const { tool } = createTool({
        config,
      });

      expect(tool.shortcut).toBe(config[UserSettings.Shortcut]);
    });

    it('falls back to constructable shortcut', () => {
      const constructableShortcut = 'CTRL+K';
      const { tool } = createTool({
        config: {
          [UserSettings.Config]: {},
        } as ToolOptions,
        constructable: createConstructable({
          [CommonInternalSettings.Shortcut]: constructableShortcut,
        }),
      });

      expect(tool.shortcut).toBe(constructableShortcut);
    });
  });

  describe('sanitizeConfig', () => {
    it('returns constructable sanitize configuration when provided', () => {
      const sanitizeConfig = {
        paragraph: {
          b: true,
        },
      };
      const { tool } = createTool({
        constructable: createConstructable({
          [CommonInternalSettings.SanitizeConfig]: sanitizeConfig,
        }),
      });

      expect(tool.sanitizeConfig).toBe(sanitizeConfig);
    });

    it('returns empty object when sanitize configuration is missing', () => {
      const { tool } = createTool({
        constructable: createConstructable(),
      });

      expect(tool.sanitizeConfig).toEqual({});
    });
  });

  describe('type guards', () => {
    it('identifies tool type correctly', () => {
      const blockTool = createTool({
        toolType: ToolType.Block,
      }).tool;
      const inlineTool = createTool({
        toolType: ToolType.Inline,
      }).tool;
      const tuneTool = createTool({
        toolType: ToolType.Tune,
      }).tool;

      expect(blockTool.isBlock()).toBe(true);
      expect(blockTool.isInline()).toBe(false);
      expect(blockTool.isTune()).toBe(false);

      expect(inlineTool.isInline()).toBe(true);
      expect(inlineTool.isBlock()).toBe(false);
      expect(inlineTool.isTune()).toBe(false);

      expect(tuneTool.isTune()).toBe(true);
      expect(tuneTool.isBlock()).toBe(false);
      expect(tuneTool.isInline()).toBe(false);
    });
  });
});

