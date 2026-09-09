import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { BlockToolAdapter } from '../../../../src/components/tools/block';

import type { ToolOptions } from '../../../../src/components/tools/base';
import type { API as ApiMethods } from '@/types';

/**
 * Mutant notes for src/components/tools/base.ts
 *
 * The `isInternal = false` default in the constructor destructuring is only
 * observable from an off-contract caller: `ConstructorOptions.isInternal` is a
 * REQUIRED boolean, the single call site in src (ToolsFactory) applies its own
 * default first, and the adapter classes have no runtime export. The test
 * below builds the options without it deliberately — the default is what keeps
 * a host-registered tool from being filed as one of Blok's own, and nothing
 * else in the file pins it.
 */

/** The adapter only stores the api object; nothing exercised here reads it. */
const stubApi = {} as ApiMethods;

/** Flat tool keys are the whole point of the settings getter, so widen once. */
type FlatOptions = ToolOptions & Record<string, unknown>;

const makeAdapter = (
  config: FlatOptions,
  isDefault = false,
  defaultPlaceholder?: string | false,
): BlockToolAdapter => {
  class StubTool {
    public static get isReadOnlySupported(): boolean {
      return true;
    }
    public render(): HTMLElement {
      return document.createElement('div');
    }
    public save(): unknown {
      return {};
    }
  }

  return new BlockToolAdapter({
    name: 'stub',
    constructable: StubTool as never,
    config,
    api: stubApi,
    isDefault,
    isInternal: false,
    defaultPlaceholder,
  });
};

/**
 * ConstructorOptions declares `isInternal` required, so only an off-contract
 * caller reaches the parameter default. The default is what keeps a tool the
 * host registered from being filed as one of Blok's own.
 */
const makeAdapterWithoutInternalFlag = (): BlockToolAdapter => {
  class StubTool {
    public render(): HTMLElement {
      return document.createElement('div');
    }
    public save(): unknown {
      return {};
    }
  }

  const options = {
    name: 'stub',
    constructable: StubTool as never,
    config: {},
    api: stubApi,
    isDefault: false,
  };

  return new BlockToolAdapter(options as unknown as ConstructorParameters<typeof BlockToolAdapter>[0]);
};

describe('BaseToolAdapter settings', () => {
  it('files a tool whose options omit the internal flag as not internal', () => {
    expect(makeAdapterWithoutInternalFlag().isInternal).toBe(false);
  });

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('merges flat tool keys over the nested config and drops Blok-level keys', () => {
    const adapter = makeAdapter({
      inlineToolbar: true,
      tunes: ['moveUp'],
      shortcut: 'CMD+B',
      toolbox: { title: 'Stub' },
      config: {
        nestedOnly: 'nested-only',
        shared: 'from-nested',
      },
      shared: 'from-flat',
      levels: [1, 2],
    });

    expect(adapter.settings).toStrictEqual({
      nestedOnly: 'nested-only',
      shared: 'from-flat',
      levels: [1, 2],
    });
  });

  it('returns an empty config when every key is a Blok-level setting', () => {
    const adapter = makeAdapter({
      inlineToolbar: false,
      tunes: false,
      toolbox: false,
    });

    expect(adapter.settings).toStrictEqual({});
  });

  it('keeps a flat key whose value is undefined', () => {
    const adapter = makeAdapter({ placeholderHint: undefined });

    expect(adapter.settings).toStrictEqual({ placeholderHint: undefined });
  });

  it('updates the default placeholder used by later settings reads', () => {
    const adapter = makeAdapter({}, true, 'Old');

    expect(adapter.settings).toStrictEqual({ placeholder: 'Old' });

    adapter.setDefaultPlaceholder('New');

    expect(adapter.settings).toStrictEqual({ placeholder: 'New' });

    adapter.setDefaultPlaceholder(false);

    expect(adapter.settings).toStrictEqual({});
  });
});
