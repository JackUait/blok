import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReadOnlyAPI } from '../../../../../src/components/modules/api/readonly';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../../types';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

type ReadOnlyModuleStub = {
  toggle: ReturnType<typeof vi.fn<(state?: boolean) => Promise<boolean>>>;
  isEnabled: boolean;
};

type BlokStub = {
  ReadOnly: ReadOnlyModuleStub;
};

const createReadOnlyApi = (overrides: Partial<ReadOnlyModuleStub> = {}): {
  readOnlyApi: ReadOnlyAPI;
  blok: BlokStub;
} => {
  const moduleConfig: ModuleConfig = {
    config: {} as BlokConfig,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  };

  const readOnlyApi = new ReadOnlyAPI(moduleConfig);

  const defaultReadOnlyModule: ReadOnlyModuleStub = {
    toggle: vi.fn((_state?: boolean): Promise<boolean> => Promise.resolve(false)),
    isEnabled: false,
  };

  const blok: BlokStub = {
    ReadOnly: {
      ...defaultReadOnlyModule,
      ...overrides,
    },
  };

  readOnlyApi.state = blok as unknown as BlokModules;

  return {
    readOnlyApi,
    blok,
  };
};

describe('ReadOnlyAPI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes toggle via the methods getter', async () => {
    const { readOnlyApi } = createReadOnlyApi();
    const toggleSpy = vi.spyOn(readOnlyApi, 'toggle').mockResolvedValue(true);

    await expect(readOnlyApi.methods.toggle(true)).resolves.toBe(true);
    expect(toggleSpy).toHaveBeenCalledWith(true);
  });

  it('reflects current state via the methods getter', () => {
    const { readOnlyApi, blok } = createReadOnlyApi();

    expect(readOnlyApi.methods.isEnabled).toBe(false);

    blok.ReadOnly.isEnabled = true;

    expect(readOnlyApi.methods.isEnabled).toBe(true);
  });

  it('delegates toggle calls to the Blok module', async () => {
    const { readOnlyApi, blok } = createReadOnlyApi();

    blok.ReadOnly.toggle.mockResolvedValueOnce(true);

    await expect(readOnlyApi.toggle(true)).resolves.toBe(true);
    expect(blok.ReadOnly.toggle).toHaveBeenCalledWith(true);
  });

  it('reads isEnabled from the Blok module', () => {
    const { readOnlyApi, blok } = createReadOnlyApi();

    blok.ReadOnly.isEnabled = true;
    expect(readOnlyApi.isEnabled).toBe(true);

    blok.ReadOnly.isEnabled = false;
    expect(readOnlyApi.isEnabled).toBe(false);
  });
});
