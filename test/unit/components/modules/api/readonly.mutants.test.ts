import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ReadOnlyAPI } from '../../../../../src/components/modules/api/readonly';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * Mutant notes for src/components/modules/api/readonly.ts
 *
 * Every recorded mutant is killed; no equivalence claims.
 */

type ReadOnlyModuleMock = {
  isEnabled: boolean;
  toggle: (state?: boolean) => Promise<boolean>;
  set: (state: boolean, options?: { hideControls?: boolean }) => Promise<boolean>;
};

const makeApi = (): { api: ReadOnlyAPI; readOnly: ReadOnlyModuleMock } => {
  const readOnly: ReadOnlyModuleMock = {
    isEnabled: false,
    toggle: (state?: boolean): Promise<boolean> => {
      readOnly.isEnabled = state ?? !readOnly.isEnabled;

      return Promise.resolve(readOnly.isEnabled);
    },
    set: (state: boolean): Promise<boolean> => {
      readOnly.isEnabled = state;

      return Promise.resolve(readOnly.isEnabled);
    },
  };

  const api = new ReadOnlyAPI({
    config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  // Only the ReadOnly module is reachable from the methods under test.
  api.state = { ReadOnly: readOnly } as unknown as BlokModules;

  return { api,
    readOnly };
};

describe('ReadOnlyAPI methods', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('advertises that read-only toggles in place', () => {
    expect(makeApi().api.methods.togglesInPlace).toBe(true);
  });

  it('reads the live read-only state through the getter', async () => {
    const { api } = makeApi();
    const { methods } = api;

    expect(methods.isEnabled).toBe(false);

    await methods.toggle();

    expect(methods.isEnabled).toBe(true);
  });
});
