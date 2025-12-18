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
  methods: object;
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
      api: apiStub.methods,
      isDefault: true,
      defaultPlaceholder: placeholder,
      isInternal: true,
    });
  });
});
