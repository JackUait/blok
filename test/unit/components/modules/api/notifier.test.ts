import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock the dynamic import of the built-in notifier module
vi.mock('../../../../../src/components/utils/notifier/index', () => ({
  show: vi.fn(),
}));

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions } from '../../../../../types/configs/notifier';
import { NotifierAPI } from '../../../../../src/components/modules/api/notifier';

const makeConfig = (notifierOverride?: (opts: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions) => void): ModuleConfig => ({
  config: {
    notifier: notifierOverride,
  } as never,
  eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as never,
});

describe('NotifierAPI', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('calls config.notifier instead of built-in when provided', () => {
    const customNotifier = vi.fn();
    const api = new NotifierAPI(makeConfig(customNotifier));
    const options: NotifierOptions = { message: 'hello', style: 'success' };

    api.show(options);

    expect(customNotifier).toHaveBeenCalledWith(options);
  });

  it('uses built-in notifier when config.notifier is not provided', async () => {
    const { show: builtInShow } = await import('../../../../../src/components/utils/notifier/index');
    const api = new NotifierAPI(makeConfig());
    const options: NotifierOptions = { message: 'world' };

    api.show(options);
    // flush microtask (lazy dynamic import inside Notifier.show)
    await new Promise(r => setTimeout(r, 0));

    expect(builtInShow).toHaveBeenCalled();
  });
});
