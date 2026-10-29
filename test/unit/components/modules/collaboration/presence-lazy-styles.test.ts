import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as LazyStyles from '../../../../../src/components/utils/lazy-styles';
import { REGISTRY as LAZY_REGISTRY } from '../../../../../src/components/utils/lazy-styles';

const layers = {
  avatars: async (): Promise<void> => {
    const { createAvatarLayer } = await import('../../../../../src/components/modules/collaboration/presence-avatars');

    createAvatarLayer({ resolveHolder: () => null });
  },
  carets: async (): Promise<void> => {
    const { createCaretLayer } = await import('../../../../../src/components/modules/collaboration/presence-carets');

    createCaretLayer({ resolveHolder: () => null, resolveInputs: () => [] });
  },
  'agent markers': async (): Promise<void> => {
    const { createAgentMarkerLayer } = await import('../../../../../src/components/modules/collaboration/agent-marker-layer');

    createAgentMarkerLayer({ resolveHolder: () => null });
  },
};

vi.mock('../../../../../src/styles/lazy/presence.css?inline', () => ({ default: '.presence{}' }));

describe('presence stylesheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    Reflect.deleteProperty(globalThis, LAZY_REGISTRY);
  });

  afterEach(() => {
    vi.doMock('../../../../../src/styles/lazy/presence.css?inline', () => ({ default: '.presence{}' }));
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, LAZY_REGISTRY);
  });

  it.each(Object.entries(layers))('the %s layer loads the presence sheet before anyone is drawn', async (_name, create) => {
    await create();
    await vi.dynamicImportSettled();
    const lazyStyles: typeof LazyStyles = await import('../../../../../src/components/utils/lazy-styles');

    expect(lazyStyles.isSheetLoaded('presence')).toBe(true);
  });

  it.each(Object.entries(layers))('the %s layer still works when the presence chunk fails to load', async (_name, create) => {
    vi.doMock('../../../../../src/styles/lazy/presence.css?inline', () => {
      throw new Error('chunk failed');
    });

    await create();
    await vi.dynamicImportSettled();
    const lazyStyles: typeof LazyStyles = await import('../../../../../src/components/utils/lazy-styles');

    expect(lazyStyles.isSheetLoaded('presence')).toBe(false);
  });
});
