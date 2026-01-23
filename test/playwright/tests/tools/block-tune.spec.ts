
import { expect, test } from '@playwright/test';
import { BlockTuneAdapter } from '../../../../src/components/tools/tune';
import { ToolType } from '../../../../types/tools/adapters/tool-type';
import type { API, ToolConfig } from '../../../../types';
import type { BlockAPI } from '../../../../types/api';
import type { BlockTune, BlockTuneConstructable } from '../../../../types/block-tunes';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';

/**
 * Mock BlockTune class for testing
 * We create our own constructable since mocking the exact BlockTuneConstructable
 * interface is complex due to API and BlockAPI dependencies
 */
class MockBlockTune implements BlockTune {
  public static isTune = true;

  public static reset?: () => void | Promise<void>;
  public static prepare?: (
    data: { toolName: string; config: ToolConfig }
  ) => void | Promise<void>;

  public api: API;
  public config: ToolConfig;
  public data: BlockTuneData;
  public block: BlockAPI;

  constructor({
    api,
    config,
    block,
    data,
  }: {
    api: API;
    config: ToolConfig;
    block: BlockAPI;
    data: BlockTuneData;
  }) {
    this.api = api;
    this.config = config;
    this.block = block;
    this.data = data;
  }

  public render(): HTMLElement {
    return document.createElement('div');
  }
}

/**
 * Helper function to create mock BlockTune options
 * We cast to BlockTuneConstructable since our mock matches the interface structure
 * The TypeScript compiler can't verify class static methods match an interface,
 * so we need to assert the type for test purposes
 */
const createBlockTuneOptions = (): {
  name: string;
  constructable: BlockTuneConstructable;
  config: Record<string, unknown>;
  api: API;
  isDefault: boolean;
  isInternal: boolean;
  defaultPlaceholder: string;
} => {
  // Test mock: class structure matches BlockTuneConstructable interface
  const constructable = MockBlockTune as unknown as BlockTuneConstructable;

  return {
    name: 'blockTune',
    constructable,
    config: {
      config: {
        option1: 'option1',
        option2: 'option2',
      },
      shortcut: 'CMD+SHIFT+B',
    },
    // Test mock: partial API object for testing
    api: ({
      prop1: 'prop1',
      prop2: 'prop2',
    }) as unknown as API,
    isDefault: false,
    isInternal: false,
    defaultPlaceholder: 'Default placeholder',
  };
};

test.describe('blockTuneAdapter', () => {
  test('.type returns ToolType.Tune', () => {
    const options = createBlockTuneOptions();
    const tool = new BlockTuneAdapter(options);

    expect(tool.type).toBe(ToolType.Tune);
  });

  test('.name returns correct value', () => {
    const options = createBlockTuneOptions();
    const tool = new BlockTuneAdapter(options);

    expect(tool.name).toBe(options.name);
  });

  test('.isInternal returns correct value', () => {
    const options = createBlockTuneOptions();

    const tool1 = new BlockTuneAdapter(options);
    const tool2 = new BlockTuneAdapter({
      ...options,
      isInternal: true,
    });

    expect(tool1.isInternal).toBe(false);
    expect(tool2.isInternal).toBe(true);
  });

  test('.settings returns correct value', () => {
    const options = createBlockTuneOptions();
    const tool = new BlockTuneAdapter(options);

    expect(tool.settings).toStrictEqual(options.config.config);
  });

  test('.isBlock() returns false', () => {
    const options = createBlockTuneOptions();
    const tool = new BlockTuneAdapter(options);

    expect(tool.isBlock()).toBe(false);
  });

  test('.isInline() returns false', () => {
    const options = createBlockTuneOptions();
    const tool = new BlockTuneAdapter(options);

    expect(tool.isInline()).toBe(false);
  });

  test('.isTune() returns true', () => {
    const options = createBlockTuneOptions();
    const tool = new BlockTuneAdapter(options);

    expect(tool.isTune()).toBe(true);
  });

  test.describe('.prepare()', () => {
    test('calls Tool prepare method', async () => {
      const options = createBlockTuneOptions();
      const calls: Array<{ toolName: string; config: ToolConfig }> = [];

      options.constructable.prepare = (data: {
        toolName: string;
        config: ToolConfig;
      }) => {
        calls.push(data);
      };

      const tool = new BlockTuneAdapter(options);

      await tool.prepare();

      expect(calls).toStrictEqual([
        {
          toolName: tool.name,
          config: tool.settings,
        },
      ]);
    });

    test('does not fail if Tool prepare method does not exist', async () => {
      const options = createBlockTuneOptions();
      const tool = new BlockTuneAdapter({
        ...options,
        // Test mock: empty constructable to test missing prepare method
        constructable: {} as unknown as BlockTuneConstructable,
      });

      const result = await tool.prepare();

      expect(result).toBeUndefined();
    });
  });

  test.describe('.reset()', () => {
    test('calls Tool reset method', async () => {
      const options = createBlockTuneOptions();
      let callCount = 0;

      options.constructable.reset = () => {
        callCount += 1;
      };

      const tool = new BlockTuneAdapter(options);

      await tool.reset();

      expect(callCount).toBe(1);
    });

    test('does not fail if Tool reset method does not exist', async () => {
      const options = createBlockTuneOptions();
      const tool = new BlockTuneAdapter({
        ...options,
        // Test mock: empty constructable to test missing reset method
        constructable: {} as unknown as BlockTuneConstructable,
      });

      const result = await tool.reset();

      expect(result).toBeUndefined();
    });
  });

  test.describe('.create()', () => {
    // Helper to create mock BlockAPI for testing
    const createMockBlockApi = (): BlockAPI => {
      // Test mock: partial BlockAPI object for testing
      return ({
        method(): void {},
      }) as unknown as BlockAPI;
    };

    test('returns Tool instance', () => {
      const options = createBlockTuneOptions();
      const tool = new BlockTuneAdapter(options);
      const data: BlockTuneData = { text: 'text' };
      const blockApi = createMockBlockApi();

      expect(tool.create(data, blockApi)).toBeInstanceOf(
        // Test: checking instance of mock class, cast to class type
        options.constructable as unknown as typeof MockBlockTune
      );
    });

    test('returns Tool instance with passed data', () => {
      const options = createBlockTuneOptions();
      const tool = new BlockTuneAdapter(options);
      const data: BlockTuneData = { text: 'text' };
      const blockApi = createMockBlockApi();

      const instance = tool.create(data, blockApi) as MockBlockTune;

      expect(instance.data).toStrictEqual(data);
    });

    test('returns Tool instance with passed BlockAPI object', () => {
      const options = createBlockTuneOptions();
      const tool = new BlockTuneAdapter(options);
      const data: BlockTuneData = { text: 'text' };
      const blockApi = createMockBlockApi();

      const instance = tool.create(data, blockApi) as MockBlockTune;

      expect(instance.block).toStrictEqual(blockApi);
    });

    test('returns Tool instance with passed API object', () => {
      const options = createBlockTuneOptions();
      const tool = new BlockTuneAdapter(options);
      const data: BlockTuneData = { text: 'text' };
      const blockApi = createMockBlockApi();

      const instance = tool.create(data, blockApi) as MockBlockTune;

      expect(instance.api).toStrictEqual(options.api);
    });

    test('returns Tool instance with passed settings', () => {
      const options = createBlockTuneOptions();
      const tool = new BlockTuneAdapter(options);
      const data: BlockTuneData = { text: 'text' };
      const blockApi = createMockBlockApi();

      const instance = tool.create(data, blockApi) as MockBlockTune;

      expect(instance.config).toStrictEqual(options.config.config);
    });
  });
});

