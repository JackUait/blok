 
import { expect, test } from '@playwright/test';
import BlockTuneAdapter from '../../../../src/components/tools/tune';
import { ToolType } from '../../../../types/tools/adapters/tool-type';
import type { ToolSettings } from '../../../../types';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';

const createBlockTuneOptions = (): any => {
  class Constructable {
    public static reset?: () => void | Promise<void>;
    public static prepare?: (
      data: { toolName: string; config: ToolSettings }
    ) => void | Promise<void>;

    public api: object;
    public config: ToolSettings;
    public data: BlockTuneData;
    public block: object;

    constructor({
      api,
      config,
      block,
      data,
    }: {
      api: object;
      config: ToolSettings;
      block: object;
      data: BlockTuneData;
    }) {
      this.api = api;
      this.config = config;
      this.block = block;
      this.data = data;
    }
  }

  return {
    name: 'blockTune',
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

test.describe('blockTuneAdapter', () => {
  test('.type returns ToolType.Tune', () => {
    const options = createBlockTuneOptions();
    const tool = new BlockTuneAdapter(options as any);

    expect(tool.type).toBe(ToolType.Tune);
  });

  test('.name returns correct value', () => {
    const options = createBlockTuneOptions();
    const tool = new BlockTuneAdapter(options as any);

    expect(tool.name).toBe(options.name);
  });

  test('.isInternal returns correct value', () => {
    const options = createBlockTuneOptions();

    const tool1 = new BlockTuneAdapter(options as any);
    const tool2 = new BlockTuneAdapter({
      ...options,
      isInternal: true,
    } as any);

    expect(tool1.isInternal).toBe(false);
    expect(tool2.isInternal).toBe(true);
  });

  test('.settings returns correct value', () => {
    const options = createBlockTuneOptions();
    const tool = new BlockTuneAdapter(options as any);

    expect(tool.settings).toStrictEqual(options.config.config);
  });

  test('.isBlock() returns false', () => {
    const options = createBlockTuneOptions();
    const tool = new BlockTuneAdapter(options as any);

    expect(tool.isBlock()).toBe(false);
  });

  test('.isInline() returns false', () => {
    const options = createBlockTuneOptions();
    const tool = new BlockTuneAdapter(options as any);

    expect(tool.isInline()).toBe(false);
  });

  test('.isTune() returns true', () => {
    const options = createBlockTuneOptions();
    const tool = new BlockTuneAdapter(options as any);

    expect(tool.isTune()).toBe(true);
  });

  test.describe('.prepare()', () => {
    test('calls Tool prepare method', async () => {
      const options = createBlockTuneOptions();
      const calls: Array<{ toolName: string; config: ToolSettings }> = [];

      options.constructable.prepare = (data: {
        toolName: string;
        config: ToolSettings;
      }) => {
        calls.push(data);
      };

      const tool = new BlockTuneAdapter(options as any);

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
        constructable: {},
      } as any);

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

      const tool = new BlockTuneAdapter(options as any);

      await tool.reset();

      expect(callCount).toBe(1);
    });

    test('does not fail if Tool reset method does not exist', async () => {
      const options = createBlockTuneOptions();
      const tool = new BlockTuneAdapter({
        ...options,
        constructable: {},
      } as any);

      const result = await tool.reset();

      expect(result).toBeUndefined();
    });
  });

  test.describe('.create()', () => {
    test('returns Tool instance', () => {
      const options = createBlockTuneOptions();
      const tool = new BlockTuneAdapter(options as any);
      const data: BlockTuneData = { text: 'text' };
      const blockApi = {
        method(): void {},
      };

      expect(tool.create(data, blockApi as any)).toBeInstanceOf(
        options.constructable
      );
    });

    test('returns Tool instance with passed data', () => {
      const options = createBlockTuneOptions();
      const tool = new BlockTuneAdapter(options as any);
      const data: BlockTuneData = { text: 'text' };
      const blockApi = {
        method(): void {},
      };

      const instance = tool.create(data, blockApi as any) as any;

      expect(instance.data).toStrictEqual(data);
    });

    test('returns Tool instance with passed BlockAPI object', () => {
      const options = createBlockTuneOptions();
      const tool = new BlockTuneAdapter(options as any);
      const data: BlockTuneData = { text: 'text' };
      const blockApi = {
        method(): void {},
      };

      const instance = tool.create(data, blockApi as any) as any;

      expect(instance.block).toStrictEqual(blockApi);
    });

    test('returns Tool instance with passed API object', () => {
      const options = createBlockTuneOptions();
      const tool = new BlockTuneAdapter(options as any);
      const data: BlockTuneData = { text: 'text' };
      const blockApi = {
        method(): void {},
      };

      const instance = tool.create(data, blockApi as any) as any;

      expect(instance.api).toStrictEqual(options.api);
    });

    test('returns Tool instance with passed settings', () => {
      const options = createBlockTuneOptions();
      const tool = new BlockTuneAdapter(options as any);
      const data: BlockTuneData = { text: 'text' };
      const blockApi = {
        method(): void {},
      };

      const instance = tool.create(data, blockApi as any) as any;

      expect(instance.config).toStrictEqual(options.config.config);
    });
  });
});


