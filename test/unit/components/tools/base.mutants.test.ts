import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { BlockToolAdapter } from '../../../../src/components/tools/block';

import type { ToolOptions } from '../../../../src/components/tools/base';
import type { API as ApiMethods } from '@/types';

/**
 * Mutant notes for src/components/tools/base.ts
 *
 * KILLABLE, DELIBERATELY NOT KILLED — BooleanLiteral at line 212,
 * `isInternal = false` in the constructor destructuring.
 * The only way to observe the default is to construct an adapter with
 * `isInternal` absent, and `ConstructorOptions.isInternal` is a REQUIRED
 * boolean. The single call site in src (ToolsFactory) applies its own
 * `isInternal = false` default before it builds the options object, and the
 * adapter classes are not exported from any runtime entry — `types/tools/
 * adapters/base-tool-adapter.d.ts` publishes an interface with no constructor,
 * so no consumer can reach the parameter default either. Killing it needs an
 * out-of-contract stub that omits a required option.
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

describe('BaseToolAdapter settings', () => {
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
