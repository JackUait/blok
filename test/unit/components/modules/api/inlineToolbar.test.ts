import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InlineToolbarAPI } from '../../../../../src/components/modules/api/inlineToolbar';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokEventMap } from '../../../../../src/components/events';

type InlineToolbarBlokMock = {
  InlineToolbar: {
    tryToShow: ReturnType<typeof vi.fn<() => Promise<void>>>;
    close: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
    clearDismissal: ReturnType<typeof vi.fn>;
  };
};

describe('InlineToolbarAPI', () => {
  let inlineToolbarApi: InlineToolbarAPI;
  let blokMock: InlineToolbarBlokMock;

  const createInlineToolbarApi = (overrides?: Partial<InlineToolbarBlokMock>): void => {
    const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
    const moduleConfig: ModuleConfig = {
      config: {},
      eventsDispatcher,
    };

    inlineToolbarApi = new InlineToolbarAPI(moduleConfig);
    blokMock = {
      InlineToolbar: {
        tryToShow: vi.fn((): Promise<void> => Promise.resolve()),
        close: vi.fn(),
        dismiss: vi.fn(),
        clearDismissal: vi.fn(),
      },
      ...overrides,
    };

    inlineToolbarApi.state = blokMock as unknown as BlokModules;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    createInlineToolbarApi();
  });

  it('exposes inline toolbar controls via methods getter', () => {
    const { open, close } = inlineToolbarApi.methods;

    open();
    close();

    expect(blokMock.InlineToolbar.tryToShow).toHaveBeenCalledWith();
    expect(blokMock.InlineToolbar.dismiss).toHaveBeenCalledWith();
  });

  it('opens inline toolbar even for a selection it was closed for', () => {
    inlineToolbarApi.open();

    expect(blokMock.InlineToolbar.clearDismissal).toHaveBeenCalledTimes(1);
    expect(blokMock.InlineToolbar.tryToShow).toHaveBeenCalledWith();
    expect(blokMock.InlineToolbar.clearDismissal.mock.invocationCallOrder[0])
      .toBeLessThan(blokMock.InlineToolbar.tryToShow.mock.invocationCallOrder[0]);
  });

  it('closes inline toolbar so a queued selectionchange cannot reopen it', () => {
    inlineToolbarApi.close();

    expect(blokMock.InlineToolbar.dismiss).toHaveBeenCalledWith();
    expect(blokMock.InlineToolbar.close).not.toHaveBeenCalled();
  });
});
