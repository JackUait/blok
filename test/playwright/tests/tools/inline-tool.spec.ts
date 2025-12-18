 
import { expect, test } from '@playwright/test';
import { InlineToolAdapter } from '../../../../src/components/tools/inline';
import { ToolType } from '../../../../types/tools/adapters/tool-type';
import type { ToolConfig, ToolSettings } from '../../../../types';

const createInlineToolOptions = (): any => {
  class Constructable {
    public static sanitize = {
      rule1: 'rule1',
    };

    public static title = 'Title';

    public static reset?: () => void | Promise<void>;
    public static prepare?: (data: { toolName: string; config: ToolConfig }) => void | Promise<void>;

    public static shortcut = 'CTRL+N';
    public static isReadOnlySupported = true;

    public api: object;
    public config: ToolSettings;

    constructor({ api, config }: { api: object; config: ToolSettings }) {
      this.api = api;
      this.config = config;
    }
  }

  return {
    name: 'inlineTool',
    constructable: Constructable,
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
    },
    isDefault: false,
    isInternal: false,
    defaultPlaceholder: 'Default placeholder',
  };
};

test.describe('inlineToolAdapter', () => {
  test('.type returns ToolType.Inline', () => {
    const options = createInlineToolOptions();
    const tool = new InlineToolAdapter(options as any);

    expect(tool.type).toBe(ToolType.Inline);
  });

  test('.name returns correct value', () => {
    const options = createInlineToolOptions();
    const tool = new InlineToolAdapter(options as any);

    expect(tool.name).toBe(options.name);
  });

  test('.isInternal returns correct value', () => {
    const options = createInlineToolOptions();

    const tool1 = new InlineToolAdapter(options as any);
    const tool2 = new InlineToolAdapter({
      ...options,
      isInternal: true,
    } as any);

    expect(tool1.isInternal).toBe(false);
    expect(tool2.isInternal).toBe(true);
  });

  test('.settings returns correct value', () => {
    const options = createInlineToolOptions();
    const tool = new InlineToolAdapter(options as any);

    expect(tool.settings).toStrictEqual(options.config.config);
  });

  test('.sanitizeConfig returns correct value', () => {
    const options = createInlineToolOptions();
    const tool = new InlineToolAdapter(options as any);

    expect(tool.sanitizeConfig).toStrictEqual(options.constructable.sanitize);
  });

  test('.isBlock() returns false', () => {
    const options = createInlineToolOptions();
    const tool = new InlineToolAdapter(options as any);

    expect(tool.isBlock()).toBe(false);
  });

  test('.isInline() returns true', () => {
    const options = createInlineToolOptions();
    const tool = new InlineToolAdapter(options as any);

    expect(tool.isInline()).toBe(true);
  });

  test('.isTune() returns false', () => {
    const options = createInlineToolOptions();
    const tool = new InlineToolAdapter(options as any);

    expect(tool.isTune()).toBe(false);
  });

  test.describe('.prepare()', () => {
    test('calls Tool prepare method', async () => {
      const options = createInlineToolOptions();
      const calls: Array<{ toolName: string; config: ToolConfig }> = [];

      options.constructable.prepare = (data: { toolName: string; config: ToolConfig }) => {
        calls.push(data);
      };

      const tool = new InlineToolAdapter(options as any);

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
        constructable: {},
      } as any);

      const result = await tool.prepare();

      expect(result).toBeUndefined();
    });
  });

  test.describe('.reset()', () => {
    test('calls Tool reset method', async () => {
      const options = createInlineToolOptions();
      let callCount = 0;

      options.constructable.reset = () => {
        callCount += 1;
      };

      const tool = new InlineToolAdapter(options as any);

      await tool.reset();

      expect(callCount).toBe(1);
    });

    test('does not fail if Tool reset method does not exist', async () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter({
        ...options,
        constructable: {},
      } as any);

      const result = await tool.reset();

      expect(result).toBeUndefined();
    });
  });

  test.describe('.getMissingMethods()', () => {
    test('returns all required methods when constructable prototype is missing', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter({
        ...options,
        constructable: {} as typeof options.constructable,
      } as any);
      const requiredMethods = [ 'render' ];

      expect(tool.getMissingMethods(requiredMethods)).toStrictEqual(requiredMethods);
    });

    test('returns only methods that are not implemented on the prototype', () => {
      const options = createInlineToolOptions();
      const Parent = options.constructable;

      class ConstructableWithRender extends Parent {
        public render(): object {
          return {};
        }
      }

      const tool = new InlineToolAdapter({
        ...options,
        constructable: ConstructableWithRender,
      } as any);
      const requiredMethods = ['render', 'fakeMethod'];

      expect(tool.getMissingMethods(requiredMethods)).toStrictEqual([ 'fakeMethod' ]);
    });

    test('returns an empty array when all required methods are implemented', () => {
      const options = createInlineToolOptions();
      const Parent = options.constructable;

      class ConstructableWithAllMethods extends Parent {
        public render(): object {
          return {};
        }
        public surround(): void {}
      }

      const tool = new InlineToolAdapter({
        ...options,
        constructable: ConstructableWithAllMethods,
      } as any);
      const requiredMethods = [ 'render' ];

      expect(tool.getMissingMethods(requiredMethods)).toStrictEqual([]);
    });
  });

  test.describe('.shortcut', () => {
    test('returns user provided shortcut', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter(options as any);

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
      } as any);

      expect(tool.shortcut).toBe(options.constructable.shortcut);
    });
  });

  test.describe('.create()', () => {
    test('returns Tool instance', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter(options as any);

      expect(tool.create()).toBeInstanceOf(options.constructable);
    });

    test('returns Tool instance with passed API object', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter(options as any);

      const instance = tool.create() as any;

      expect(instance.api).toStrictEqual(options.api);
    });

    test('returns Tool instance with passed config', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter(options as any);

      const instance = tool.create() as any;

      expect(instance.config).toStrictEqual(options.config.config);
    });
  });

  test.describe('.isReadOnlySupported', () => {
    test('returns Tool provided value', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter(options as any);

      expect(tool.isReadOnlySupported).toBe(options.constructable.isReadOnlySupported);
    });

    test('returns false if Tool provided value does not exist', () => {
      const options = createInlineToolOptions();
      const tool = new InlineToolAdapter({
        ...options,
        constructable: {},
      } as any);

      expect(tool.isReadOnlySupported).toBe(false);
    });
  });
});


