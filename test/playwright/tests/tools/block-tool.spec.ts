import { expect, test } from '@playwright/test';
import type {
  API,
  BlockToolConstructable,
  BlockToolConstructorOptions,
  BlockToolData,
  InlineToolConstructable,
  SanitizerConfig,
  ToolboxConfigEntry
} from '../../../../types';
import { ToolType } from '../../../../types/tools/adapters/tool-type';
import { BlockToolAdapter } from '../../../../src/components/tools/block';
import { InlineToolAdapter } from '../../../../src/components/tools/inline';
import { ToolsCollection } from '../../../../src/components/tools/collection';

type BlockToolAdapterOptions = ConstructorParameters<typeof BlockToolAdapter>[0];
type InlineToolAdapterOptions = ConstructorParameters<typeof InlineToolAdapter>[0];

type ToolUserConfig = {
  option1?: string;
  option2?: string;
  placeholder?: string;
  [key: string]: unknown;
};

type BlockToolOptionsOverride = Partial<Omit<BlockToolAdapterOptions, 'config'>> & {
  config?: Partial<BlockToolAdapterOptions['config']> & {
    config?: ToolUserConfig;
  };
};

type InlineToolOptionsOverride = Partial<Omit<InlineToolAdapterOptions, 'config'>> & {
  config?: Partial<InlineToolAdapterOptions['config']>;
};

type BlockToolCtorOptions = BlockToolConstructorOptions<{ text: string }, ToolUserConfig>;

type Mock<Args extends unknown[] = [], Result = void> = {
  fn: (...args: Args) => Result;
  calls: Args[];
};

type BlockToolStubInstance = {
  data: BlockToolData<{ text: string }>;
  block: BlockToolCtorOptions['block'];
  ['readonly']: boolean;
  api: API;
  config: ToolUserConfig;
};

type BlockToolConstructableWithOptionalDisabling = BlockToolConstructable & {
  toolbox?: ToolboxConfigEntry | ToolboxConfigEntry[] | false;
  pasteConfig?: BlockToolConstructable['pasteConfig'] | false;
};

/**
 * Determines whether provided constructable exposes Block Tool capabilities.
 * @param constructable - Tool constructable candidate.
 */
const isBlockToolConstructable = (
  constructable: BlockToolAdapterOptions['constructable']
): constructable is BlockToolConstructableWithOptionalDisabling => (
  typeof constructable === 'function' && typeof constructable.prototype?.render === 'function'
);

/**
 * Ensures constructable implements the Block Tool interface or throws.
 * @param constructable - Tool constructable candidate.
 */
const ensureBlockToolConstructable = (
  constructable: BlockToolAdapterOptions['constructable']
): BlockToolConstructableWithOptionalDisabling => {
  if (!isBlockToolConstructable(constructable)) {
    throw new Error('Expected block tool constructable for this test scenario');
  }

  return constructable;
};

/**
 * Determines whether the supplied instance matches the block tool stub shape.
 * @param instance - Value to test.
 */
const isBlockToolStubInstance = (instance: unknown): instance is BlockToolStubInstance => {
  if (!instance || typeof instance !== 'object') {
    return false;
  }

  const candidate = instance as Partial<BlockToolStubInstance>;

  return !(
    candidate.data === undefined ||
    candidate.block === undefined ||
    candidate.api === undefined ||
    candidate.config === undefined ||
    candidate['readonly'] === undefined
  );
};

/**
 * Coerces a value to a block tool stub instance or throws.
 * @param instance - Value to assert.
 */
const ensureBlockToolStubInstance = (instance: unknown): BlockToolStubInstance => {
  if (!isBlockToolStubInstance(instance)) {
    throw new Error('Received value is not a block tool stub instance');
  }

  return instance;
};

/**
 * Creates a simple mock function that records every call.
 * @param implementation - Optional implementation executed on each invocation.
 */
const createMock = <Args extends unknown[] = [], Result = void>(
  implementation?: (...args: Args) => Result
): Mock<Args, Result> => {
  const calls: Args[] = [];
  const fn = (...args: Args): Result => {
    calls.push(args);

    if (implementation) {
      return implementation(...args);
    }

    return undefined as Result;
  };

  return {
    fn,
    calls,
  };
};

/**
 * Creates a typed stub for the Blok.js API.
 */
const createApiStub = (): API => ({
  blocks: {} as API['blocks'],
  caret: {} as API['caret'],
  tools: {} as API['tools'],
  events: {} as API['events'],
  listeners: {} as API['listeners'],
  notifier: {} as API['notifier'],
  sanitizer: {} as API['sanitizer'],
  saver: {} as API['saver'],
  selection: {} as API['selection'],
  styles: {} as API['styles'],
  toolbar: {} as API['toolbar'],
  inlineToolbar: {} as API['inlineToolbar'],
  tooltip: {} as API['tooltip'],
  i18n: {} as API['i18n'],
  readOnly: {} as API['readOnly'],
  ui: {} as API['ui'],
});

/**
 * Provides a constructable block tool stub with predefined static metadata.
 */
const createBlockToolConstructable = (): BlockToolConstructable => {
  /**
   * Minimal block tool stub used for adapter tests.
   */
  class BlockTool {
    public static sanitize: SanitizerConfig = {
      rule1: {
        div: true,
      },
    };

    public static toolbox: ToolboxConfigEntry = {
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

    public static reset?: () => void | Promise<void>;

    public static prepare?: (data: { toolName: string; config: ToolUserConfig }) => void | Promise<void>;

    public static shortcut = 'CTRL+N';

    public data: BlockToolData<{ text: string }>;

    public block: BlockToolCtorOptions['block'];

    public ['readonly']: boolean;

    public api: API;

    public config: ToolUserConfig;

    /**
     * @param options - Block tool constructor options supplied by the adapter.
     */
    constructor(options: BlockToolCtorOptions) {
      const { data, block, readOnly, api, config } = options;

      this.data = data;
      this.block = block;
      this.readonly = readOnly;
      this.api = api;
      this.config = config ?? {};
    }

    /**
     * Returns a placeholder element for compliance with the block tool interface.
     */
    public render(): HTMLElement {
      return {} as HTMLElement;
    }
  }

  return BlockTool as unknown as BlockToolConstructable;
};

/**
 * Provides a constructable inline tool stub with supplied sanitize config.
 * @param sanitize - Sanitize configuration exposed by the inline tool.
 */
const createInlineToolConstructable = (
  sanitize: SanitizerConfig = {}
): InlineToolConstructable => {
  /**
   * Minimal inline tool stub used for adapter tests.
   */
  class InlineTool {
    public static isInline = true;

    public static sanitize: SanitizerConfig = sanitize;

    /**
     * Returns a placeholder element for compliance with the inline tool interface.
     */
    public render(): HTMLElement {
      return {} as HTMLElement;
    }
  }

  return InlineTool as unknown as InlineToolConstructable;
};

/**
 * Creates options for instantiating a block tool adapter.
 * @param override - Optional overrides applied to the default block tool options.
 */
const createBlockToolOptions = (override: BlockToolOptionsOverride = {}): BlockToolAdapterOptions => {
  const baseUserConfig: ToolUserConfig = {
    option1: 'option1',
    option2: 'option2',
  };

  const overrideConfig = override.config ?? {};

  const mergedConfig = {
    inlineToolbar: ['link', 'bold'] as BlockToolAdapterOptions['config'] extends { inlineToolbar?: infer T } ? T : string[] | boolean,
    tunes: ['anchor', 'favorites'] as BlockToolAdapterOptions['config'] extends { tunes?: infer T } ? T : string[] | boolean,
    shortcut: 'CMD+SHIFT+B',
    toolbox: {
      title: 'User Block Tool',
      icon: 'User icon',
    } as ToolboxConfigEntry,
    ...overrideConfig,
    config: {
      ...baseUserConfig,
      ...overrideConfig.config,
    },
  } satisfies BlockToolAdapterOptions['config'];

  return {
    name: override.name ?? 'blockTool',
    constructable: override.constructable ?? createBlockToolConstructable(),
    config: mergedConfig,
    api: override.api ?? createApiStub(),
    isDefault: override.isDefault ?? false,
    isInternal: override.isInternal ?? false,
    defaultPlaceholder: override.defaultPlaceholder ?? 'Default placeholder',
  };
};

/**
 * Creates options for instantiating an inline tool adapter.
 * @param override - Optional overrides applied to the default inline tool options.
 */
const createInlineToolOptions = (override: InlineToolOptionsOverride = {}): InlineToolAdapterOptions => ({
  name: override.name ?? 'inlineTool',
  constructable: override.constructable ?? createInlineToolConstructable(),
  config: {
    ...override.config,
  },
  api: override.api ?? createApiStub(),
  isDefault: override.isDefault ?? false,
  isInternal: override.isInternal ?? false,
  defaultPlaceholder: override.defaultPlaceholder,
});

/**
 * Creates an inline tool adapter with a specific sanitize configuration.
 * @param sanitize - Sanitize configuration exposed by the inline tool.
 * @param name - Tool name used when registering the inline tool.
 */
const createInlineToolAdapter = (
  sanitize: SanitizerConfig,
  name: string
): InlineToolAdapter => new InlineToolAdapter(createInlineToolOptions({
  name,
  constructable: createInlineToolConstructable(sanitize),
}));

test.describe('blockToolAdapter', () => {
  test('.type returns ToolType.Block', () => {
    const tool = new BlockToolAdapter(createBlockToolOptions());

    expect(tool.type).toBe(ToolType.Block);
  });

  test('.name returns provided value', () => {
    const options = createBlockToolOptions();
    const tool = new BlockToolAdapter(options);

    expect(tool.name).toBe(options.name);
  });

  test('.isDefault reflects provided flag', () => {
    const defaultTool = new BlockToolAdapter(createBlockToolOptions());
    const overriddenTool = new BlockToolAdapter(createBlockToolOptions({ isDefault: true }));

    expect(defaultTool.isDefault).toBe(false);
    expect(overriddenTool.isDefault).toBe(true);
  });

  test('.isInternal reflects provided flag', () => {
    const externalTool = new BlockToolAdapter(createBlockToolOptions());
    const internalTool = new BlockToolAdapter(createBlockToolOptions({ isInternal: true }));

    expect(externalTool.isInternal).toBe(false);
    expect(internalTool.isInternal).toBe(true);
  });

  test.describe('settings', () => {
    test('returns user configuration', () => {
      const options = createBlockToolOptions();
      const tool = new BlockToolAdapter(options);

      expect(tool.settings).toStrictEqual(options.config?.config);
    });

    test('includes default placeholder when tool is default', () => {
      const options = createBlockToolOptions({ isDefault: true });
      const tool = new BlockToolAdapter(options);

      expect(tool.settings).toMatchObject({
        placeholder: options.defaultPlaceholder,
      });
    });
  });

  test.describe('sanitizeConfig', () => {
    test('returns constructable sanitize config', () => {
      const options = createBlockToolOptions();
      const tool = new BlockToolAdapter(options);

      expect(tool.sanitizeConfig).toStrictEqual(options.constructable.sanitize);
    });

    test('merges inline tool sanitize config when available', () => {
      const options = createBlockToolOptions();
      const tool = new BlockToolAdapter(options);

      const inlineSanitize: SanitizerConfig = {
        b: true,
      };

      const inlineTool = createInlineToolAdapter(inlineSanitize, 'inlineTool');

      tool.inlineTools = new ToolsCollection<InlineToolAdapter>([
        ['inlineTool', inlineTool],
      ]);

      const expected = Object.fromEntries(
        Object
          .entries(options.constructable.sanitize ?? {})
          .map(([field, rules]) => {
            if (typeof rules === 'object' && rules !== null) {
              return [
                field,
                {
                  ...tool.baseSanitizeConfig,
                  ...rules,
                },
              ];
            }

            return [field, rules];
          })
      );

      expect(tool.sanitizeConfig).toStrictEqual(expected);
    });

    test('returns inline tools config when constructable does not provide sanitize config', () => {
      const baseOptions = createBlockToolOptions();

      /**
       * Block tool without sanitize settings for verifying fallback behaviour.
       */
      class WithoutSanitize extends (baseOptions.constructable as BlockToolConstructable) {
        public static override sanitize?: SanitizerConfig;
      }

      const options = createBlockToolOptions({
        constructable: WithoutSanitize,
      });

      const tool = new BlockToolAdapter(options);

      const inlineTool1 = createInlineToolAdapter({
        b: true,
      }, 'inlineTool1');
      const inlineTool2 = createInlineToolAdapter({
        a: true,
      }, 'inlineTool2');

      tool.inlineTools = new ToolsCollection<InlineToolAdapter>([
        ['inlineTool1', inlineTool1],
        ['inlineTool2', inlineTool2],
      ]);

      const expected = {
        ...inlineTool1.sanitizeConfig,
        ...inlineTool2.sanitizeConfig,
      };

      expect(tool.sanitizeConfig).toStrictEqual(expected);
    });

    test('returns empty object when no sanitize config provided', () => {
      /**
       * Block tool without sanitize logic to ensure defaults resolve to an empty object.
       */
      class RenderOnlyBlockTool {
        /**
         * Returns a placeholder element for tests.
         */
        public render(): HTMLElement {
          return {} as HTMLElement;
        }
      }

      const options = createBlockToolOptions({
        constructable: RenderOnlyBlockTool as unknown as BlockToolConstructable,
      });

      const tool = new BlockToolAdapter(options);

      expect(tool.sanitizeConfig).toStrictEqual({});
    });
  });

  test('.isBlock returns true', () => {
    const tool = new BlockToolAdapter(createBlockToolOptions());

    expect(tool.isBlock()).toBe(true);
  });

  test('.isInline returns false', () => {
    const tool = new BlockToolAdapter(createBlockToolOptions());

    expect(tool.isInline()).toBe(false);
  });

  test('.isTune returns false', () => {
    const tool = new BlockToolAdapter(createBlockToolOptions());

    expect(tool.isTune()).toBe(false);
  });

  test('.isReadOnlySupported reflects constructable setting', () => {
    const options = createBlockToolOptions();
    const tool = new BlockToolAdapter(options);

    expect(tool.isReadOnlySupported).toBe(true);
  });

  test('.isLineBreaksEnabled reflects constructable setting', () => {
    const options = createBlockToolOptions();
    const tool = new BlockToolAdapter(options);

    expect(tool.isLineBreaksEnabled).toBe(true);
  });

  test('.conversionConfig returns constructable value', () => {
    const options = createBlockToolOptions();
    const tool = new BlockToolAdapter(options);
    const constructable = ensureBlockToolConstructable(options.constructable);

    expect(tool.conversionConfig).toStrictEqual(constructable.conversionConfig);
  });

  test.describe('pasteConfig', () => {
    test('returns constructable paste config', () => {
      const options = createBlockToolOptions();
      const tool = new BlockToolAdapter(options);
      const constructable = ensureBlockToolConstructable(options.constructable);

      expect(tool.pasteConfig).toStrictEqual(constructable.pasteConfig);
    });

    test('returns false when constructable provides false', () => {
      const baseOptions = createBlockToolOptions();
      const baseConstructable = ensureBlockToolConstructable(baseOptions.constructable);

      /**
       * Block tool stub that explicitly disables paste configuration.
       */
      class WithoutPasteConfig extends baseConstructable {
        public static override pasteConfig: BlockToolConstructableWithOptionalDisabling['pasteConfig'] = false;
      }

      const tool = new BlockToolAdapter(createBlockToolOptions({
        constructable: WithoutPasteConfig,
      }));

      expect(tool.pasteConfig).toBe(false);
    });

    test('returns empty object when paste config is not provided', () => {
      const baseOptions = createBlockToolOptions();
      const baseConstructable = ensureBlockToolConstructable(baseOptions.constructable);

      /**
       * Block tool stub without any paste configuration.
       */
      class UndefinedPasteConfig extends baseConstructable {
        public static override pasteConfig: BlockToolConstructableWithOptionalDisabling['pasteConfig'] = undefined;
      }

      const tool = new BlockToolAdapter(createBlockToolOptions({
        constructable: UndefinedPasteConfig,
      }));

      expect(tool.pasteConfig).toStrictEqual({});
    });
  });

  test.describe('enabledInlineTools', () => {
    test('returns inline toolbar configuration', () => {
      const options = createBlockToolOptions();
      const tool = new BlockToolAdapter(options);

      expect(tool.enabledInlineTools).toStrictEqual(options.config?.inlineToolbar);
    });

    test('returns true when inline toolbar is not configured', () => {
      const options = createBlockToolOptions({
        config: {
          inlineToolbar: undefined,
        },
      });
      const tool = new BlockToolAdapter(options);

      expect(tool.enabledInlineTools).toBe(true);
    });
  });

  test('.enabledBlockTunes returns user configuration', () => {
    const options = createBlockToolOptions();
    const tool = new BlockToolAdapter(options);

    expect(tool.enabledBlockTunes).toStrictEqual(options.config?.tunes);
  });

  test.describe('prepare', () => {
    test('calls constructable prepare method', async () => {
      const options = createBlockToolOptions();
      const constructable = options.constructable as typeof options.constructable & {
        prepare?: (data: { toolName: string; config: ToolUserConfig }) => void;
      };
      const prepareMock = createMock<[ { toolName: string; config: ToolUserConfig } ]>();

      constructable.prepare = prepareMock.fn;

      const tool = new BlockToolAdapter(options);

      await tool.prepare();

      expect(prepareMock.calls).toHaveLength(1);
      expect(prepareMock.calls[0]?.[0]).toMatchObject({
        toolName: tool.name,
        config: tool.settings,
      });
    });

    test('does not throw when prepare is not defined', async () => {
      /**
       * Block tool stub without prepare/reset hooks.
       */
      class MinimalBlockTool {
        /**
         * Returns a placeholder element for tests.
         */
        public render(): HTMLElement {
          return {} as HTMLElement;
        }
      }

      const tool = new BlockToolAdapter(createBlockToolOptions({
        constructable: MinimalBlockTool as unknown as BlockToolConstructable,
      }));

      await expect(Promise.resolve(tool.prepare())).resolves.toBeUndefined();
    });
  });

  test.describe('reset', () => {
    test('calls constructable reset method', async () => {
      const options = createBlockToolOptions();
      const constructable = options.constructable as typeof options.constructable & {
        reset?: () => void;
      };
      const resetMock = createMock();

      constructable.reset = resetMock.fn;

      const tool = new BlockToolAdapter(options);

      await tool.reset();

      expect(resetMock.calls).toHaveLength(1);
    });

    test('does not throw when reset is not defined', async () => {
      /**
       * Block tool stub without reset hook.
       */
      class MinimalBlockToolWithoutReset {
        /**
         * Returns a placeholder element for tests.
         */
        public render(): HTMLElement {
          return {} as HTMLElement;
        }
      }

      const tool = new BlockToolAdapter(createBlockToolOptions({
        constructable: MinimalBlockToolWithoutReset as unknown as BlockToolConstructable,
      }));

      await expect(Promise.resolve(tool.reset())).resolves.toBeUndefined();
    });
  });

  test.describe('shortcut', () => {
    test('prefers user shortcut', () => {
      const options = createBlockToolOptions();
      const tool = new BlockToolAdapter(options);

      expect(tool.shortcut).toBe(options.config?.shortcut);
    });

    test('falls back to constructable shortcut', () => {
      const baseOptions = createBlockToolOptions();

      /**
       * Block tool stub without a shortcut configured.
       */
      class WithoutShortcut extends (baseOptions.constructable as BlockToolConstructable) {
        public static override shortcut = undefined;
      }

      const userlessOptions = createBlockToolOptions({
        constructable: WithoutShortcut,
        config: {
          shortcut: undefined,
        },
      });

      const tool = new BlockToolAdapter({
        ...userlessOptions,
        constructable: baseOptions.constructable,
      });

      expect(tool.shortcut).toBe(baseOptions.constructable.shortcut);
    });
  });

  test.describe('toolbox', () => {
    test('wraps user toolbox config in array', () => {
      const options = createBlockToolOptions();
      const tool = new BlockToolAdapter(options);

      expect(tool.toolbox).toStrictEqual([ options.config?.toolbox ]);
    });

    test('wraps constructable toolbox config when user config is not provided', () => {
      const options = createBlockToolOptions({
        config: {
          toolbox: undefined,
        },
      });
      const tool = new BlockToolAdapter(options);
      const constructable = ensureBlockToolConstructable(options.constructable);

      expect(tool.toolbox).toStrictEqual([ constructable.toolbox ]);
    });

    test('merges constructable toolbox config with user config when both are objects', () => {
      const optionsWithTitleOnly = createBlockToolOptions({
        config: {
          toolbox: {
            title: 'Custom title',
          },
        },
      });
      const optionsWithIconOnly = createBlockToolOptions({
        config: {
          toolbox: {
            icon: 'Custom icon',
          },
        },
      });

      const toolWithTitle = new BlockToolAdapter(optionsWithTitleOnly);
      const toolWithIcon = new BlockToolAdapter(optionsWithIconOnly);
      const constructableWithTitle = ensureBlockToolConstructable(optionsWithTitleOnly.constructable);
      const constructableWithIcon = ensureBlockToolConstructable(optionsWithIconOnly.constructable);

      expect(toolWithTitle.toolbox).toStrictEqual([
        {
          ...constructableWithTitle.toolbox,
          title: 'Custom title',
        },
      ]);

      expect(toolWithIcon.toolbox).toStrictEqual([
        {
          ...constructableWithIcon.toolbox,
          icon: 'Custom icon',
        },
      ]);
    });

    test('replaces constructable toolbox array with user object config', () => {
      const baseOptions = createBlockToolOptions();
      const baseConstructable = ensureBlockToolConstructable(baseOptions.constructable);

      /**
       * Block tool stub with an array-based toolbox configuration.
       */
      class ConstructableWithArray extends baseConstructable {
        public static override toolbox: ToolboxConfigEntry[] = [
          { title: 'Toolbox entry 1' },
          { title: 'Toolbox entry 2' },
        ];
      }

      const userToolbox = {
        icon: 'User icon',
        title: 'User title',
      };

      const tool = new BlockToolAdapter(createBlockToolOptions({
        constructable: ConstructableWithArray,
        config: {
          toolbox: userToolbox,
        },
      }));

      expect(tool.toolbox).toStrictEqual([ userToolbox ]);
    });

    test('replaces constructable toolbox object with user array config', () => {
      const userToolbox = [
        { title: 'Toolbox entry 1' },
        { title: 'Toolbox entry 2' },
      ];

      const tool = new BlockToolAdapter(createBlockToolOptions({
        config: {
          toolbox: userToolbox,
        },
      }));

      expect(tool.toolbox).toStrictEqual(userToolbox);
    });

    test('merges constructable and user arrays preserving user length', () => {
      const baseOptions = createBlockToolOptions();
      const baseConstructable = ensureBlockToolConstructable(baseOptions.constructable);

      /**
       * Block tool stub with limited array-based toolbox configuration.
       */
      class ConstructableWithShortArray extends baseConstructable {
        public static override toolbox: ToolboxConfigEntry[] = [
          { title: 'Toolbox entry 1' },
        ];
      }

      const userToolbox = [
        { icon: 'Icon 1' },
        {
          icon: 'Icon 2',
          title: 'Toolbox entry 2',
        },
      ];

      const tool = new BlockToolAdapter(createBlockToolOptions({
        constructable: ConstructableWithShortArray,
        config: {
          toolbox: userToolbox,
        },
      }));

      const expected = userToolbox.map((entry, index) => {
        const toolEntry = ConstructableWithShortArray.toolbox[index];

        if (toolEntry) {
          return {
            ...toolEntry,
            ...entry,
          };
        }

        return entry;
      });

      expect(tool.toolbox).toStrictEqual(expected);
    });

    test('returns undefined when user explicitly disables toolbox', () => {
      const tool = new BlockToolAdapter(createBlockToolOptions({
        config: {
          toolbox: false,
        },
      }));

      expect(tool.toolbox).toBeUndefined();
    });

    test('returns undefined when constructable disables toolbox', () => {
      const baseOptions = createBlockToolOptions();
      const baseConstructable = ensureBlockToolConstructable(baseOptions.constructable);

      /**
       * Block tool stub that programmatically disables toolbox visibility.
       */
      class ToolboxDisabledConstructable extends baseConstructable {
        public static override toolbox: BlockToolConstructableWithOptionalDisabling['toolbox'] = false;
      }

      const tool = new BlockToolAdapter(createBlockToolOptions({
        constructable: ToolboxDisabledConstructable,
      }));

      expect(tool.toolbox).toBeUndefined();
    });

    test('returns undefined when constructable toolbox config is empty', () => {
      const baseOptions = createBlockToolOptions();
      const baseConstructable = ensureBlockToolConstructable(baseOptions.constructable);

      /**
       * Block tool stub with an empty toolbox configuration.
       */
      class ToolboxEmptyConstructable extends baseConstructable {
        public static override toolbox: ToolboxConfigEntry = {};
      }

      const tool = new BlockToolAdapter(createBlockToolOptions({
        constructable: ToolboxEmptyConstructable,
      }));

      expect(tool.toolbox).toBeUndefined();
    });

    test('filters toolbox entries by toolboxStyles config', () => {
      const baseOptions = createBlockToolOptions();
      const baseConstructable = ensureBlockToolConstructable(baseOptions.constructable);

      /**
       * Block tool stub with multiple toolbox entries containing style data.
       */
      class ToolWithMultipleStyles extends baseConstructable {
        public static override toolbox: ToolboxConfigEntry[] = [
          { title: 'Unordered', data: { style: 'unordered' } },
          { title: 'Ordered', data: { style: 'ordered' } },
          { title: 'Checklist', data: { style: 'checklist' } },
        ];
      }

      const tool = new BlockToolAdapter(createBlockToolOptions({
        constructable: ToolWithMultipleStyles,
        config: {
          toolbox: undefined,
          config: {
            toolboxStyles: ['unordered', 'ordered'],
          },
        },
      }));

      expect(tool.toolbox).toStrictEqual([
        { title: 'Unordered', data: { style: 'unordered' } },
        { title: 'Ordered', data: { style: 'ordered' } },
      ]);
    });

    test('returns all toolbox entries when toolboxStyles is not specified', () => {
      const baseOptions = createBlockToolOptions();
      const baseConstructable = ensureBlockToolConstructable(baseOptions.constructable);

      /**
       * Block tool stub with multiple toolbox entries containing style data.
       */
      class ToolWithMultipleStyles extends baseConstructable {
        public static override toolbox: ToolboxConfigEntry[] = [
          { title: 'Unordered', data: { style: 'unordered' } },
          { title: 'Ordered', data: { style: 'ordered' } },
          { title: 'Checklist', data: { style: 'checklist' } },
        ];
      }

      const tool = new BlockToolAdapter(createBlockToolOptions({
        constructable: ToolWithMultipleStyles,
        config: {
          toolbox: undefined,
        },
      }));

      expect(tool.toolbox).toStrictEqual([
        { title: 'Unordered', data: { style: 'unordered' } },
        { title: 'Ordered', data: { style: 'ordered' } },
        { title: 'Checklist', data: { style: 'checklist' } },
      ]);
    });

    test('keeps entries without style data when filtering by toolboxStyles', () => {
      const baseOptions = createBlockToolOptions();
      const baseConstructable = ensureBlockToolConstructable(baseOptions.constructable);

      /**
       * Block tool stub with mixed toolbox entries (some with style, some without).
       */
      class ToolWithMixedEntries extends baseConstructable {
        public static override toolbox: ToolboxConfigEntry[] = [
          { title: 'Default' },
          { title: 'Unordered', data: { style: 'unordered' } },
          { title: 'Ordered', data: { style: 'ordered' } },
        ];
      }

      const tool = new BlockToolAdapter(createBlockToolOptions({
        constructable: ToolWithMixedEntries,
        config: {
          toolbox: undefined,
          config: {
            toolboxStyles: ['ordered'],
          },
        },
      }));

      expect(tool.toolbox).toStrictEqual([
        { title: 'Default' },
        { title: 'Ordered', data: { style: 'ordered' } },
      ]);
    });
  });

  test.describe('create', () => {
    const data: BlockToolData<{ text: string }> = { text: 'text' };
    const blockApi = {} as BlockToolCtorOptions['block'];

    test('returns tool instance of constructable', () => {
      const options = createBlockToolOptions();
      const tool = new BlockToolAdapter(options);

      const instance = tool.create(data, blockApi, false);

      expect(instance).toBeInstanceOf(options.constructable);
    });

    test('passes provided data to tool instance', () => {
      const options = createBlockToolOptions();
      const tool = new BlockToolAdapter(options);
      const instance = ensureBlockToolStubInstance(tool.create(data, blockApi, false));

      expect(instance.data).toStrictEqual(data);
    });

    test('passes provided BlockAPI to tool instance', () => {
      const options = createBlockToolOptions();
      const tool = new BlockToolAdapter(options);
      const instance = ensureBlockToolStubInstance(tool.create(data, blockApi, false));

      expect(instance.block).toBe(blockApi);
    });

    test('passes readOnly flag to tool instance', () => {
      const options = createBlockToolOptions();
      const tool = new BlockToolAdapter(options);
      const writableInstance = ensureBlockToolStubInstance(tool.create(data, blockApi, false));
      const readonlyInstance = ensureBlockToolStubInstance(tool.create(data, blockApi, true));

      expect(writableInstance.readonly).toBe(false);
      expect(readonlyInstance.readonly).toBe(true);
    });

    test('passes API object to tool instance', () => {
      const options = createBlockToolOptions();
      const tool = new BlockToolAdapter(options);
      const instance = ensureBlockToolStubInstance(tool.create(data, blockApi, false));

      expect(instance.api).toBe(options.api);
    });

    test('passes tool settings to tool instance', () => {
      const options = createBlockToolOptions();
      const tool = new BlockToolAdapter(options);
      const instance = ensureBlockToolStubInstance(tool.create(data, blockApi, false));

      expect(instance.config).toMatchObject(options.config?.config ?? {});
      expect(instance.config).toHaveProperty('_toolboxEntries');
    });
  });
});


