import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  show: vi.fn(),
  hide: vi.fn(),
  onHover: vi.fn(),
}));

import { TooltipAPI } from '../../../../../src/components/modules/api/tooltip';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokConfig } from '@/types';

/**
 * Mutant notes for src/components/modules/api/tooltip.ts
 *
 * Every recorded mutant is killed; no equivalence claims.
 */

/** Reads the base-class state the constructor is supposed to forward. */
class RtlProbeTooltipAPI extends TooltipAPI {
  public get exposedIsRtl(): boolean {
    return this.isRtl;
  }
}

const makeApi = (config: BlokConfig = {}): TooltipAPI => new TooltipAPI({
  config,
  eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
});

describe('TooltipAPI', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('hands the editor config to the module base class', () => {
    const api = new RtlProbeTooltipAPI({
      config: { i18n: { direction: 'rtl' } },
      eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
    });

    expect(api.exposedIsRtl).toBe(true);
  });

  it('shows and hides through the tooltip utility', async () => {
    const { show, hide } = await import('../../../../../src/components/utils/tooltip');
    const element = document.createElement('button');
    const api = makeApi();

    api.methods.show(element, 'Bold', { placement: 'top' });
    api.methods.hide();

    expect(vi.mocked(show).mock.calls).toStrictEqual([[element, 'Bold', { placement: 'top' }]]);
    expect(vi.mocked(hide).mock.calls).toStrictEqual([[]]);
  });
});
