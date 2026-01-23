
import { expect, test } from '@playwright/test';
import { InlineToolAdapter } from '../../../../src/components/tools/inline';
import { ToolType } from '../../../../types/tools/adapters/tool-type';
import type { API, InlineToolConstructable, ToolConfig, ToolSettings } from '../../../../types';
import type { SanitizerConfig } from '../../../../types/configs';
import type { ToolConstructable, ToolSettings as ImportedToolSettings } from '../../../../types/tools';

interface TestInlineToolInstance {
  api: Record<string, unknown>;
  config: ToolSettings;
}

type ToolOptions = Omit<ImportedToolSettings, 'class'>;

interface ConstructorOptions {
  name: string;
  constructable: ToolConstructable;
  config: ToolOptions;
  api: API;
  isDefault: boolean;
  isInternal: boolean;
  defaultPlaceholder?: string | false;
}

const createInlineToolOptions = (): ConstructorOptions => {
  class Constructable {
    public static sanitize: SanitizerConfig = {
      b: true,
    };

    public static title = 'Title';

    public static reset?: () => void | Promise<void>;
    public static prepare?: (data: { toolName: string; config: ToolConfig }) => void | Promise<void>;

    public static shortcut = 'CTRL+N';
    public static isReadOnlySupported = true;

    public api: Record<string, unknown>;
    public config: ToolSettings;

    constructor({ api, config }: { api: API; config?: ToolConfig }) {
      this.api = api as unknown as Record<string, unknown>;
      this.config = config as ToolSettings;
    }

    public render(): Record<string, unknown> {
      return {};
    }
  }

  return {
    name: 'inlineTool',
    constructable: Constructable as unknown as ToolConstructable,
    config: {
      config: {
        option1: 'option1',
        option2: 'option2',
      },
      shortcut: 'CMD+SHIFT+B',
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

test.describe('inlineToolAdapter', () => {
  test('.type returns ToolType.Inline', () => {
    const options = createInlineToolOptions();
    const tool = new InlineToolAdapter(options);

    expect(tool.type).toBe(ToolType.Inline);
  });

  test('.name returns correct value', () => {
    const options = createInlineToolOptions();
    const tool = new InlineToolAdapter(options);

    expect(tool.name).toBe(options.name);
  });

  test('.isInternal returns correct value', () => {
    const options = createInlineToolOptions();

    const tool1 = new InlineToolAdapter(options);
    const tool2 = new InlineToolAdapter({
      ...options,
      isInternal: true,
    });

    expect(tool1.isInternal).toBe(false);
    expect(tool2.isInternal).toBe(true);
  });

  test('.settings returns correct value', () => {
    const options = createInlineToolOptions();
    const tool = new InlineToolAdapter(options);

    expect(tool.settings).toStrictEqual(options.config.config);
  });

  test('.sanitizeConfig returns correct value', () => {
    const options = createInlineToolOptions();
    const tool = new InlineToolAdapter(options);

    const constructable = options.constructable as { sanitize: SanitizerConfig };
    expect(tool.sanitizeConfig).toStrictEqual(constructable.sanitize);
  });

  test('.isBlock() returns false', () => {
    const options = createInlineToolOptions();
    const tool = new InlineToolAdapter(options);

    expect(tool.isBlock()).toBe(false);
  });

  test('.isInline() returns true', () => {
    const options = createInlineToolOptions();
    const tool = new InlineToolAdapter(options);

    expect(tool.isInline()).toBe(true);
  });

  test('.isTune() returns false', () => {
    const options = createInlineToolOptions();
    const tool = new InlineToolAdapter(options);

    expect(tool.isTune()).toBe(false);
  });

  test.describe('.prepare()', () => {
    test('calls Tool prepare method', async () => {
      const options = createInlineToolOptions();
      const calls: Array<{ toolName: string; config: ToolConfig }> = [];

      const constructable = options.constructable as InlineToolConstructable;
      constructable.prepare = (data: { toolName: string; config: ToolConfig }) => {
        calls.push(data);
      };

      const tool = new InlineToolAdapter(options);

      await tool.prepare();

      expect(calls).toStrictEqual([
        {
          toolName: tool.name,
          config: tool.settings,
        },
      ]);
    });

    test('does not fail if Tool prepare method does not exist', async () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter({
        ...options,
        constructable: {} as ToolConstructable,
      });

      const result = await tool.prepare();

      expect(result).toBeUndefined();
    });
  });

  test.describe('.reset()', () => {
    test('calls Tool reset method', async () => {
      const options = createInlineToolOptions();
      let callCount = 0;

      const constructable = options.constructable as InlineToolConstructable;
      constructable.reset = () => {
        callCount += 1;
      };

      const tool = new InlineToolAdapter(options);

      await tool.reset();

      expect(callCount).toBe(1);
    });

    test('does not fail if Tool reset method does not exist', async () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter({
        ...options,
        constructable: {} as ToolConstructable,
      });

      const result = await tool.reset();

      expect(result).toBeUndefined();
    });
  });

  test.describe('.getMissingMethods()', () => {
    test('returns all required methods when constructable prototype is missing', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter({
        ...options,
        constructable: {} as ToolConstructable,
      });
      const requiredMethods = [ 'render' ];

      expect(tool.getMissingMethods(requiredMethods)).toStrictEqual(requiredMethods);
    });

    test('returns only methods that are not implemented on the prototype', () => {
      const options = createInlineToolOptions();
      const BaseConstructable = options.constructable as unknown as new (api: { api: API; config?: ToolConfig }) => { api: Record<string, unknown>; config: ToolSettings; render(): Record<string, unknown> };

      const constructableWithRenderClass = class extends BaseConstructable {
        public render(): Record<string, unknown> {
          return {};
        }
      };

      const tool = new InlineToolAdapter({
        ...options,
        constructable: constructableWithRenderClass as unknown as ToolConstructable,
      });
      const requiredMethods = ['render', 'fakeMethod'];

      expect(tool.getMissingMethods(requiredMethods)).toStrictEqual([ 'fakeMethod' ]);
    });

    test('returns an empty array when all required methods are implemented', () => {
      const options = createInlineToolOptions();
      const BaseConstructable = options.constructable as unknown as new (api: { api: API; config?: ToolConfig }) => { api: Record<string, unknown>; config: ToolSettings; render(): Record<string, unknown> };

      const constructableWithAllMethodsClass = class extends BaseConstructable {
        public render(): Record<string, unknown> {
          return {};
        }
        public surround(): void {}
      };

      const tool = new InlineToolAdapter({
        ...options,
        constructable: constructableWithAllMethodsClass as unknown as ToolConstructable,
      });
      const requiredMethods = [ 'render' ];

      expect(tool.getMissingMethods(requiredMethods)).toStrictEqual([]);
    });
  });

  test.describe('.shortcut', () => {
    test('returns user provided shortcut', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter(options);

      expect(tool.shortcut).toBe(options.config.shortcut);
    });

    test('falls back to Tool provided shortcut when user shortcut is not specified', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter({
        ...options,
        config: {
          ...options.config,
          shortcut: undefined,
        },
      });

      const constructable = options.constructable as { shortcut: string };
      expect(tool.shortcut).toBe(constructable.shortcut);
    });
  });

  test.describe('.create()', () => {
    test('returns Tool instance', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter(options);

      expect(tool.create()).toBeInstanceOf(options.constructable as { new(): unknown });
    });

    test('returns Tool instance with passed API object', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter(options);

      const instance = tool.create() as unknown as TestInlineToolInstance;

      expect(instance.api).toStrictEqual(options.api);
    });

    test('returns Tool instance with passed config', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter(options);

      const instance = tool.create() as unknown as TestInlineToolInstance;

      expect(instance.config).toStrictEqual(options.config.config);
    });
  });

  test.describe('.isReadOnlySupported', () => {
    test('returns Tool provided value', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter(options);

      const constructable = options.constructable as { isReadOnlySupported: boolean };
      expect(tool.isReadOnlySupported).toBe(constructable.isReadOnlySupported);
    });

    test('returns false if Tool provided value does not exist', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter({
        ...options,
        constructable: {} as ToolConstructable,
      });

      expect(tool.isReadOnlySupported).toBe(false);
    });
  });
});

