import { describe, it, expect, beforeEach, vi } from 'vitest';
import InlineToolbarAPI from '../../../../../src/components/modules/api/inlineToolbar';
import EventsDispatcher from '../../../../../src/components/utils/events';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../types';
import type { BlokEventMap } from '../../../../../src/components/events';

type InlineToolbarBlokMock = {
  InlineToolbar: {
    tryToShow: ReturnType<typeof vi.fn<() => Promise<void>>>;
    close: ReturnType<typeof vi.fn>;
  };
};

describe('InlineToolbarAPI', () => {
  let inlineToolbarApi: InlineToolbarAPI;
  let blokMock: InlineToolbarBlokMock;

  const createInlineToolbarApi = (overrides?: Partial<InlineToolbarBlokMock>): void => {
    const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
    const moduleConfig: ModuleConfig = {
      config: {} as BlokConfig,
      eventsDispatcher,
    };

    inlineToolbarApi = new InlineToolbarAPI(moduleConfig);
    blokMock = {
      InlineToolbar: {
        tryToShow: vi.fn((): Promise<void> => Promise.resolve()),
        close: vi.fn(),
      },
      ...overrides,
    };

    inlineToolbarApi.state = blokMock as unknown as BlokModules;
  };

  beforeEach(() => {
    createInlineToolbarApi();
  });

  it('exposes inline toolbar controls via methods getter', () => {
    const openSpy = vi.spyOn(inlineToolbarApi, 'open').mockImplementation(() => {});
    const closeSpy = vi.spyOn(inlineToolbarApi, 'close').mockImplementation(() => {});

    const { open, close } = inlineToolbarApi.methods;

    open();
    close();

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('opens inline toolbar through Blok module', () => {
    inlineToolbarApi.open();

    expect(blokMock.InlineToolbar.tryToShow).toHaveBeenCalledTimes(1);
  });

  it('closes inline toolbar through Blok module', () => {
    inlineToolbarApi.close();

    expect(blokMock.InlineToolbar.close).toHaveBeenCalledTimes(1);
  });
});
