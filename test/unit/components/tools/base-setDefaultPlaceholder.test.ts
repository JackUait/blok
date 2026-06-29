import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BlockToolAdapter } from '../../../../src/components/tools/block';

const makeAdapter = (defaultPlaceholder: string | false): BlockToolAdapter => {
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
    name: 'paragraph',
    constructable: StubTool as never,
    config: {},
    api: { methods: {} } as never,
    isDefault: true,
    isInternal: false,
    defaultPlaceholder,
  });
};

describe('BaseToolAdapter.setDefaultPlaceholder', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('updates the placeholder used by the settings getter for default tools', () => {
    const adapter = makeAdapter('Old');
    expect(adapter.settings.placeholder).toBe('Old');

    adapter.setDefaultPlaceholder('New');
    expect(adapter.settings.placeholder).toBe('New');
  });

  it('drops the placeholder from settings when set to false', () => {
    const adapter = makeAdapter('Old');
    adapter.setDefaultPlaceholder(false);
    expect('placeholder' in adapter.settings).toBe(false);
  });
});
