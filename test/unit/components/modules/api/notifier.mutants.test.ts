import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The built-in Notifier lazily imports this module and hands it the position it
// was constructed with, which is how the position reaches an assertion.
vi.mock('../../../../../src/components/utils/notifier/index', () => ({
  show: vi.fn(),
}));

import { NotifierAPI } from '../../../../../src/components/modules/api/notifier';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { BlokEventMap } from '../../../../../src/components/events';
import type { NotifierOptions } from '../../../../../types/configs/notifier';
import type { BlokConfig } from '@/types';

/**
 * Mutant notes for src/components/modules/api/notifier.ts
 *
 * Every recorded mutant is killed; no equivalence claims.
 */

/** Reads the base-class state the constructor is supposed to forward. */
class RtlProbeNotifierAPI extends NotifierAPI {
  public get exposedIsRtl(): boolean {
    return this.isRtl;
  }
}

const makeApi = (config: BlokConfig): NotifierAPI => new NotifierAPI({
  config,
  eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
});

const flushLazyImport = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('NotifierAPI', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('routes the exposed show to the consumer handler', () => {
    const notifier = vi.fn();
    const api = makeApi({ notifier });
    const options: NotifierOptions = { message: 'saved' };

    api.methods.show(options);

    expect(notifier.mock.calls).toStrictEqual([[options]]);
  });

  it('shows the built-in notification at the configured position', async () => {
    const { show } = await import('../../../../../src/components/utils/notifier/index');
    const api = makeApi({ notifierPosition: 'top-right' });
    const options: NotifierOptions = { message: 'saved' };

    api.methods.show(options);
    await flushLazyImport();

    expect(vi.mocked(show).mock.calls).toStrictEqual([[options, 'top-right']]);
  });

  it('falls back to the default position', async () => {
    const { show } = await import('../../../../../src/components/utils/notifier/index');
    const api = makeApi({});
    const options: NotifierOptions = { message: 'saved' };

    api.methods.show(options);
    await flushLazyImport();

    expect(vi.mocked(show).mock.calls).toStrictEqual([[options, 'bottom-center']]);
  });

  it('hands the editor config to the module base class', () => {
    const api = new RtlProbeNotifierAPI({
      config: { i18n: { direction: 'rtl' } },
      eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
    });

    expect(api.exposedIsRtl).toBe(true);
  });
});
