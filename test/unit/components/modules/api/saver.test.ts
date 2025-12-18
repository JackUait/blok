import { afterEach, describe, expect, it, vi } from 'vitest';

import { SaverAPI } from '../../../../../src/components/modules/api/saver';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import * as utils from '../../../../../src/components/utils';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig, OutputData } from '../../../../../types';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

const READ_ONLY_ERROR_TEXT = 'Blok\'s content can not be saved in read-only mode';
const SAVE_FALLBACK_ERROR_TEXT = 'Blok\'s content can not be saved because collecting data failed';

type SaverSaveMock = ReturnType<typeof vi.fn<() => Promise<OutputData | undefined>>>;
type SaverLastErrorMock = ReturnType<typeof vi.fn<() => unknown>>;

type BlokStub = {
  ReadOnly: { isEnabled: boolean };
  Saver: {
    save: SaverSaveMock;
    getLastSaveError?: SaverLastErrorMock;
  };
};

type BlokStubOverrides = {
  ReadOnly?: Partial<BlokStub['ReadOnly']>;
  Saver?: Partial<BlokStub['Saver']>;
};

const createSaverApi = (overrides: BlokStubOverrides = {}): { saverApi: SaverAPI; blok: BlokStub } => {
  const moduleConfig: ModuleConfig = {
    config: {} as BlokConfig,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  };

  const saverApi = new SaverAPI(moduleConfig);

  const blok: BlokStub = {
    ReadOnly: {
      isEnabled: false,
    },
    Saver: {
      save: vi.fn((): Promise<OutputData | undefined> => Promise.resolve({ blocks: [] })),
      getLastSaveError: vi.fn(),
    },
  };

  if (overrides.ReadOnly) {
    Object.assign(blok.ReadOnly, overrides.ReadOnly);
  }

  if (overrides.Saver) {
    Object.assign(blok.Saver, overrides.Saver);
  }

  saverApi.state = blok as unknown as BlokModules;

  return { saverApi,
    blok };
};

describe('SaverAPI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes a save method that proxies to the class method', async () => {
    const { saverApi } = createSaverApi();
    const saveSpy = vi.spyOn(saverApi, 'save').mockResolvedValue({ blocks: [] });

    await saverApi.methods.save();

    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('throws and logs when blok is in read-only mode', async () => {
    const logSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);
    const { saverApi, blok } = createSaverApi({
      ReadOnly: { isEnabled: true },
    });

    await expect(saverApi.save()).rejects.toThrow(READ_ONLY_ERROR_TEXT);
    expect(blok.Saver.save).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(READ_ONLY_ERROR_TEXT, 'warn');
  });

  it('returns saved data when saver succeeds', async () => {
    const output: OutputData = {
      blocks: [
        {
          id: 'paragraph-1',
          type: 'paragraph',
          data: { text: 'Hello' },
        },
      ],
    };
    const { saverApi, blok } = createSaverApi();

    blok.Saver.save.mockResolvedValueOnce(output);

    await expect(saverApi.save()).resolves.toEqual(output);
    expect(blok.Saver.save).toHaveBeenCalledTimes(1);
  });

  it('rethrows the last saver error when it is an Error instance', async () => {
    const lastError = new Error('save crashed');
    const { saverApi, blok } = createSaverApi();

    blok.Saver.save.mockResolvedValueOnce(undefined);
    blok.Saver.getLastSaveError = vi.fn().mockReturnValue(lastError);

    await expect(saverApi.save()).rejects.toBe(lastError);
  });

  it('converts non-error last error values to strings', async () => {
    const { saverApi, blok } = createSaverApi();

    blok.Saver.save.mockResolvedValueOnce(undefined);
    blok.Saver.getLastSaveError = vi.fn().mockReturnValue(404);

    await expect(saverApi.save()).rejects.toThrow('404');
  });

  it('throws a fallback error when saver returns undefined without details', async () => {
    const { saverApi, blok } = createSaverApi();

    blok.Saver.save.mockResolvedValueOnce(undefined);
    blok.Saver.getLastSaveError = undefined;

    await expect(saverApi.save()).rejects.toThrow(SAVE_FALLBACK_ERROR_TEXT);
  });
});


