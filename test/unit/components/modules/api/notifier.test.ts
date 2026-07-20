import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// Mock the dynamic import of the built-in notifier module
vi.mock('../../../../../src/components/utils/notifier/index', () => ({
  show: vi.fn(),
}));

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions } from '../../../../../types/configs/notifier';
import { NotifierAPI } from '../../../../../src/components/modules/api/notifier';

const makeConfig = (notifierOverride?: (opts: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions) => void): ModuleConfig => ({
  config: {
    notifier: notifierOverride,
  },
  eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as never,
});

const makeTranslatorState = (translations: Record<string, string>): {
  state: BlokModules;
  t: ReturnType<typeof vi.fn>;
} => {
  const t = vi.fn((key: string) => translations[key] ?? key);

  return {
    state: {
      I18n: { t },
    } as unknown as BlokModules,
    t,
  };
};

describe('NotifierAPI', () => {
  beforeEach(() => { vi.clearAllMocks(); });
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

    expect(builtInShow).toHaveBeenCalledWith(options, expect.anything());
  });

  it('forwards ConfirmNotifierOptions to custom notifier', () => {
    const customNotifier = vi.fn();
    const api = new NotifierAPI(makeConfig(customNotifier));
    const options: ConfirmNotifierOptions = {
      message: 'Are you sure?',
      type: 'confirm',
      okText: 'Yes',
      cancelText: 'No',
      okHandler: vi.fn(),
    };

    api.show(options);

    expect(customNotifier).toHaveBeenCalledWith(options);
  });

  it('uses localized defaults for the built-in confirm buttons', async () => {
    const { show: builtInShow } = await import('../../../../../src/components/utils/notifier/index');
    const api = new NotifierAPI(makeConfig());
    const { state, t } = makeTranslatorState({
      'notifier.confirm': 'Bestätigen',
      'notifier.cancel': 'Abbrechen',
    });
    api.state = state;
    const options: ConfirmNotifierOptions = {
      message: 'Fortfahren?',
      type: 'confirm',
      okHandler: vi.fn(),
    };

    api.show(options);
    await new Promise(r => setTimeout(r, 0));

    expect(builtInShow).toHaveBeenCalledWith({
      ...options,
      okText: 'Bestätigen',
      cancelText: 'Abbrechen',
    }, expect.anything());
    expect(t).toHaveBeenCalledWith('notifier.confirm');
    expect(t).toHaveBeenCalledWith('notifier.cancel');
    expect(options).not.toHaveProperty('okText');
    expect(options).not.toHaveProperty('cancelText');
  });

  it('uses localized defaults for the built-in prompt buttons', async () => {
    const { show: builtInShow } = await import('../../../../../src/components/utils/notifier/index');
    const api = new NotifierAPI(makeConfig());
    const { state, t } = makeTranslatorState({
      'notifier.ok': 'OK',
      'notifier.cancel': 'Annuler',
    });
    api.state = state;
    const options: PromptNotifierOptions = {
      message: 'Nom ?',
      type: 'prompt',
      okHandler: vi.fn(),
    };

    api.show(options);
    await new Promise(r => setTimeout(r, 0));

    expect(builtInShow).toHaveBeenCalledWith({
      ...options,
      okText: 'OK',
      cancelText: 'Annuler',
    }, expect.anything());
    expect(t).toHaveBeenCalledWith('notifier.ok');
    expect(t).toHaveBeenCalledWith('notifier.cancel');
  });

  it('preserves consumer-supplied built-in dialog labels', async () => {
    const { show: builtInShow } = await import('../../../../../src/components/utils/notifier/index');
    const api = new NotifierAPI(makeConfig());
    const { state, t } = makeTranslatorState({
      'notifier.confirm': 'Confirm localized',
      'notifier.cancel': 'Cancel localized',
    });
    api.state = state;
    const options: ConfirmNotifierOptions = {
      message: 'Continue?',
      type: 'confirm',
      okText: 'Proceed',
      cancelText: 'Go back',
      okHandler: vi.fn(),
    };

    api.show(options);
    await new Promise(r => setTimeout(r, 0));

    expect(builtInShow).toHaveBeenCalledWith(options, expect.anything());
    expect(t).not.toHaveBeenCalled();
  });
});
