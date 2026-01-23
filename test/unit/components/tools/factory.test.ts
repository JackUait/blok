import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlokConfig } from '@/types';
import type { ToolConstructable, ToolSettings } from '@/types/tools';
import { ToolsFactory } from '../../../../src/components/tools/factory';
import {
  InternalInlineToolSettings,
  InternalTuneSettings,
  type ToolOptions
} from '../../../../src/components/tools/base';
import type { API as ApiModule } from '../../../../src/components/modules/api';
import { BlockToolAdapter } from '../../../../src/components/tools/block';

type ToolAdapterOptions = {
  name: string;
  constructable: ToolConstructable;
  config: ToolOptions;
  api: unknown;
  isDefault: boolean;
  defaultPlaceholder?: string | false;
  isInternal: boolean;
};

type ToolAdapterMockInstance = { options: ToolAdapterOptions };

type ToolAdapterMockControl = {
  instances: ToolAdapterMockInstance[];
  reset(): void;
};

const createMockControl = (): ToolAdapterMockControl => {
  const control: ToolAdapterMockControl = {
    instances: [],
    reset() {
      control.instances = [];
    },
  };

  return control;
};

const inlineAdapterMockControl = createMockControl();
const blockAdapterMockControl = createMockControl();
const tuneAdapterMockControl = createMockControl();

vi.mock('../../../../src/components/tools/inline', () => {
  /**
   *
   */
  class InlineToolAdapterMockImpl {
    public static instances: ToolAdapterMockInstance[] = [];

    public options: ToolAdapterOptions;

    /**
     * @param options - bundle passed by the factory under test
     */
    constructor(options: ToolAdapterOptions) {
      this.options = options;
      InlineToolAdapterMockImpl.instances.push(this);
      inlineAdapterMockControl.instances.push(this);
    }

    /**
     *
     */
    public static reset(): void {
      InlineToolAdapterMockImpl.instances = [];
    }
  }

  return {
    InlineToolAdapter: InlineToolAdapterMockImpl,
  };
});

vi.mock('../../../../src/components/tools/block', () => {
  /**
   *
   */
  class BlockToolAdapterMockImpl {
    public static instances: ToolAdapterMockInstance[] = [];

    public options: ToolAdapterOptions;

    /**
     * @param options - bundle passed by the factory under test
     */
    constructor(options: ToolAdapterOptions) {
      this.options = options;
      BlockToolAdapterMockImpl.instances.push(this);
      blockAdapterMockControl.instances.push(this);
    }

    /**
     *
     */
    public static reset(): void {
      BlockToolAdapterMockImpl.instances = [];
    }
  }

  return {
    BlockToolAdapter: BlockToolAdapterMockImpl,
  };
});

vi.mock('../../../../src/components/tools/tune', () => {
  /**
   *
   */
  class BlockTuneAdapterMockImpl {
    public static instances: ToolAdapterMockInstance[] = [];

    public options: ToolAdapterOptions;

    /**
     * @param options - bundle passed by the factory under test
     */
    constructor(options: ToolAdapterOptions) {
      this.options = options;
      BlockTuneAdapterMockImpl.instances.push(this);
      tuneAdapterMockControl.instances.push(this);
    }

    /**
     *
     */
    public static reset(): void {
      BlockTuneAdapterMockImpl.instances = [];
    }
  }

  return {
    BlockTuneAdapter: BlockTuneAdapterMockImpl,
  };
});

type ToolConfigEntry = ToolSettings & { isInternal?: boolean };

type ApiStub = {
  api: ApiModule;
  methods: Record<string, unknown>;
};

const baseBlokConfig: BlokConfig = {
  tools: {},
  defaultBlock: 'paragraph',
  placeholder: 'Type a text',
};

const createApiStub = (): ApiStub => {
  const methods = { name: 'methods' };

  return {
    api: { methods } as unknown as ApiModule,
    methods,
  };
};

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

const createToolConfig = (overrides: Partial<ToolConfigEntry> = {}): ToolConfigEntry => {
  return {
    class: createConstructable(),
    config: {
      config: {},
    },
    ...overrides,
  } as ToolConfigEntry;
};

const createFactory = (
  tools: Record<string, ToolConfigEntry>,
  blokConfigOverrides: Partial<BlokConfig> = {},
  apiStub: ApiStub = createApiStub()
): { factory: ToolsFactory; apiStub: ApiStub } => {
  const blokConfig: BlokConfig = {
    ...baseBlokConfig,
    ...blokConfigOverrides,
  };

  return {
    factory: new ToolsFactory(tools, blokConfig, apiStub.api),
    apiStub,
  };
};

describe('ToolsFactory', () => {
  beforeEach(() => {
    inlineAdapterMockControl.reset();
    blockAdapterMockControl.reset();
    tuneAdapterMockControl.reset();
  });

  it('throws when tool config does not provide a class', () => {
    const toolName = 'brokenTool';
    const toolsConfig = {
      [toolName]: {
        config: {
          config: {},
        },
      } as ToolConfigEntry,
    };
    const { factory } = createFactory(toolsConfig);

    expect(() => factory.get(toolName)).toThrowError('Tool "brokenTool" does not provide a class.');
  });

  it('returns an inline adapter when tool is marked as inline', () => {
    const toolName = 'inlineTool';
    const inlineConstructable = createConstructable({
      [InternalInlineToolSettings.IsInline]: true,
    });
    const toolsConfig = {
      [toolName]: createToolConfig({
        class: inlineConstructable,
      }),
    };
    const { factory } = createFactory(toolsConfig);

    factory.get(toolName);
    expect(inlineAdapterMockControl.instances).toHaveLength(1);
    expect(blockAdapterMockControl.instances).toHaveLength(0);
    expect(tuneAdapterMockControl.instances).toHaveLength(0);
  });

  it('returns a block tune adapter when tool is marked as tune', () => {
    const toolName = 'tuneTool';
    const tuneConstructable = createConstructable({
      [InternalTuneSettings.IsTune]: true,
    });
    const toolsConfig = {
      [toolName]: createToolConfig({
        class: tuneConstructable,
      }),
    };
    const { factory } = createFactory(toolsConfig);

    factory.get(toolName);
    expect(tuneAdapterMockControl.instances).toHaveLength(1);
  });

  it('returns a block adapter when tool is not inline or tune', () => {
    const toolName = 'blockTool';
    const toolsConfig = {
      [toolName]: createToolConfig(),
    };
    const { factory } = createFactory(toolsConfig);

    factory.get(toolName);
    expect(blockAdapterMockControl.instances).toHaveLength(1);
  });

  it('passes full configuration bundle to the adapter constructor', () => {
    const toolName = 'detailedTool';
    const constructable = createConstructable();
    const toolsConfig = {
      [toolName]: createToolConfig({
        class: constructable,
        shortcut: 'CMD+J',
        inlineToolbar: [ 'link' ],
        tunes: [ 'anchor' ],
        toolbox: {
          title: 'Custom',
        },
        isInternal: true,
      }),
    };
    const placeholder = 'Type here';
    const apiStub = createApiStub();
    const { factory } = createFactory(
      toolsConfig,
      {
        defaultBlock: toolName,
        placeholder,
      },
      apiStub
    );

    const tool = factory.get(toolName);
    const instantiatedOptions = blockAdapterMockControl.instances.at(-1)?.options;

    expect(tool).toBeInstanceOf(BlockToolAdapter);
    expect(instantiatedOptions).toBeDefined();
    expect(instantiatedOptions).toMatchObject({
      name: toolName,
      constructable,
      config: {
        shortcut: 'CMD+J',
        inlineToolbar: [ 'link' ],
        tunes: [ 'anchor' ],
        toolbox: {
          title: 'Custom',
        },
        config: {
          config: {},
        },
      },
      isDefault: true,
      defaultPlaceholder: placeholder,
      isInternal: true,
    });

    /**
     * Verify the API object is not the raw stub but a wrapped version.
     * The wrapped API spreads the base API and overrides i18n.
     */
    expect(instantiatedOptions?.api).not.toBe(apiStub.methods);
  });

  describe('i18n namespace wrapping', () => {
    /**
     * Creates an API stub with mock i18n.t() and has() functions that track calls
     * and return translations based on a provided dictionary.
     */
    const createI18nApiStub = (translations: Record<string, string>): ApiStub => {
      const i18n = {
        t: vi.fn((key: string): string => {
          return translations[key] ?? key;
        }),
        has: vi.fn((key: string): boolean => {
          return key in translations;
        }),
      };

      const methods = {
        name: 'methods',
        i18n,
        blocks: {},
        caret: {},
        tools: {},
        events: {},
        history: {},
        listeners: {},
        notifier: {},
        sanitizer: {},
        saver: {},
        selection: {},
        styles: {},
        toolbar: {},
        inlineToolbar: {},
        tooltip: {},
        readOnly: {},
        ui: {},
      };

      return {
        api: { methods } as unknown as ApiModule,
        methods,
      };
    };

    it('wraps i18n.t() to try namespaced key first for EditorJS compatibility', () => {
      const toolName = 'table';
      const translations = {
        'tools.table.Add row': 'Добавить строку',
      };
      const apiStub = createI18nApiStub(translations);

      const toolsConfig = {
        [toolName]: createToolConfig(),
      };
      const { factory } = createFactory(toolsConfig, {}, apiStub);

      factory.get(toolName);

      const instanceApi = blockAdapterMockControl.instances.at(-1)?.options.api as {
        i18n: { t: (key: string) => string };
      };

      /**
       * External EditorJS tools call t('Add row') and expect automatic namespacing.
       */
      const result = instanceApi.i18n.t('Add row');

      expect(result).toBe('Добавить строку');
      expect((apiStub.methods as { i18n: { t: ReturnType<typeof vi.fn> } }).i18n.t).toHaveBeenCalledWith('tools.table.Add row');
    });

    it('falls back to direct key when namespaced key not found', () => {
      const toolName = 'stub';
      const translations = {
        'tools.stub.error': 'Ошибка',
      };
      const apiStub = createI18nApiStub(translations);

      const toolsConfig = {
        [toolName]: createToolConfig(),
      };
      const { factory } = createFactory(toolsConfig, {}, apiStub);

      factory.get(toolName);

      const instanceApi = blockAdapterMockControl.instances.at(-1)?.options.api as {
        i18n: { t: (key: string) => string };
      };

      /**
       * Internal Blok tools use fully-qualified keys like 'tools.stub.error'.
       */
      const result = instanceApi.i18n.t('tools.stub.error');

      expect(result).toBe('Ошибка');
    });

    it('returns original key when no translation exists at all', () => {
      const toolName = 'paragraph';
      const translations = {};
      const apiStub = createI18nApiStub(translations);

      const toolsConfig = {
        [toolName]: createToolConfig(),
      };
      const { factory } = createFactory(toolsConfig, {}, apiStub);

      factory.get(toolName);

      const instanceApi = blockAdapterMockControl.instances.at(-1)?.options.api as {
        i18n: { t: (key: string) => string };
      };

      const result = instanceApi.i18n.t('Unknown key');

      expect(result).toBe('Unknown key');
    });

    it('creates unique i18n wrapper per tool with correct namespace', () => {
      const translations = {
        'tools.table.Add row': 'Table: Add row',
        'tools.list.Add item': 'List: Add item',
      };
      const apiStub = createI18nApiStub(translations);

      const toolsConfig = {
        table: createToolConfig(),
        list: createToolConfig(),
      };
      const { factory } = createFactory(toolsConfig, {}, apiStub);

      factory.get('table');
      factory.get('list');

      const tableApi = blockAdapterMockControl.instances[0]?.options.api as {
        i18n: { t: (key: string) => string };
      };
      const listApi = blockAdapterMockControl.instances[1]?.options.api as {
        i18n: { t: (key: string) => string };
      };

      /**
       * Each tool gets its own namespace prefix.
       */
      expect(tableApi.i18n.t('Add row')).toBe('Table: Add row');
      expect(listApi.i18n.t('Add item')).toBe('List: Add item');
    });
  });
});
