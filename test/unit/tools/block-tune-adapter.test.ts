import { describe, expect, it } from 'vitest';
import BlockTuneAdapter from '../../../src/components/tools/tune';
import { UserSettings } from '../../../src/components/tools/base';
import { ToolType } from '@/types/tools/adapters/tool-type';
import type { ToolOptions } from '../../../src/components/tools/base';
import type { API, BlockAPI, ToolConfig } from '@/types';
import type { BlockTuneConstructable } from '@/types/block-tunes/block-tune';
import type { BlockTuneData } from '@/types/block-tunes/block-tune-data';

type BlockTuneCtorPayload = {
  api: API;
  config?: ToolConfig;
  block: BlockAPI;
  data: BlockTuneData;
};

interface ConstructableDouble {
  constructable: BlockTuneConstructable;
  classRef: new (payload: BlockTuneCtorPayload) => unknown;
  calls: BlockTuneCtorPayload[];
}

/**
 * Creates a lightweight BlockTune stub that records constructor payloads.
 */
const createConstructableDouble = (): ConstructableDouble => {
  const calls: BlockTuneCtorPayload[] = [];

  /**
   * Minimal tune implementation used for adapter instantiation tests.
   */
  class TestBlockTune {
    public static isTune = true;

    /**
     * @param payload constructor arguments captured for assertions
     */
    constructor(payload: BlockTuneCtorPayload) {
      calls.push(payload);
    }

    /**
     *
     */
    public render(): HTMLElement {
      return document.createElement('div');
    }
  }

  return {
    constructable: TestBlockTune as unknown as BlockTuneConstructable,
    classRef: TestBlockTune,
    calls,
  };
};

type AdapterOverrides = Partial<{
  constructable: BlockTuneConstructable;
  config: ToolOptions;
  api: API;
  name: string;
  isDefault: boolean;
  isInternal: boolean;
  defaultPlaceholder: string | false;
}>;

const setupAdapter = (overrides: AdapterOverrides = {}): {
  adapter: BlockTuneAdapter;
  constructableDouble: ConstructableDouble;
} => {
  const constructableDouble = createConstructableDouble();

  const adapter = new BlockTuneAdapter({
    name: overrides.name ?? 'testTune',
    constructable: overrides.constructable ?? constructableDouble.constructable,
    config: overrides.config ?? {
      [UserSettings.Config]: {
        option: 'value',
      },
    },
    api: overrides.api ?? {} as API,
    isDefault: overrides.isDefault ?? false,
    isInternal: overrides.isInternal ?? false,
    defaultPlaceholder: overrides.defaultPlaceholder,
  });

  return {
    adapter,
    constructableDouble,
  };
};

describe('BlockTuneAdapter', () => {
  const createBlock = (): BlockAPI => ({
    id: 'block-id',
  }) as BlockAPI;

  const createData = (): BlockTuneData => ({
    alignment: 'center',
  }) as BlockTuneData;

  it('reports tune type metadata', () => {
    const { adapter } = setupAdapter();

    expect(adapter.type).toBe(ToolType.Tune);
    expect(adapter.isTune()).toBe(true);
    expect(adapter.isBlock()).toBe(false);
    expect(adapter.isInline()).toBe(false);
  });

  it('instantiates tune constructable with expected payload', () => {
    const api = {
      i18n: {
        t: (phrase: string) => phrase,
      },
    } as unknown as API;
    const config: ToolOptions = {
      [UserSettings.Config]: {
        appearance: 'compact',
      },
    };
    const { adapter, constructableDouble } = setupAdapter({ api,
      config });
    const block = createBlock();
    const data = createData();

    const instance = adapter.create(data, block);

    expect(constructableDouble.calls).toHaveLength(1);
    const payload = constructableDouble.calls[0];

    expect(payload.api).toBe(api);
    expect(payload.block).toBe(block);
    expect(payload.data).toBe(data);
    expect(payload.config).toBe(adapter.settings);
    expect(instance).toBeInstanceOf(constructableDouble.classRef);
  });

  it('propagates default placeholder into settings when tune is default', () => {
    const config = {
      [UserSettings.Shortcut]: 'CMD+T',
    } as ToolOptions;
    const defaultPlaceholder = 'Toggle alignment';
    const { adapter, constructableDouble } = setupAdapter({
      config,
      isDefault: true,
      defaultPlaceholder,
    });

    const instance = adapter.create(createData(), createBlock());
    const payload = constructableDouble.calls[0];

    expect(instance).toBeInstanceOf(constructableDouble.classRef);
    expect(payload.config).toStrictEqual({ placeholder: defaultPlaceholder });
  });
});
