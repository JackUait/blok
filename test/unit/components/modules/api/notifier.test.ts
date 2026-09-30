import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// Mock the dynamic import of the built-in notifier module
vi.mock('../../../../../src/components/utils/notifier/index', () => ({
  show: vi.fn(),
  dismiss: vi.fn(),
  resolve: vi.fn(),
  isClosed: vi.fn(() => false),
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

  it('dismisses a built-in toast by the options it was shown with', async () => {
    const { dismiss: builtInDismiss } = await import('../../../../../src/components/utils/notifier/index');
    const api = new NotifierAPI(makeConfig());
    const options: NotifierOptions = { message: 'm' };

    api.dismiss(options);
    await new Promise(r => setTimeout(r, 0));

    expect(builtInDismiss).toHaveBeenCalledWith(options);
  });

  it('cannot dismiss for a custom notifier and does not reach the built-in one', async () => {
    const { dismiss: builtInDismiss } = await import('../../../../../src/components/utils/notifier/index');
    const api = new NotifierAPI(makeConfig(vi.fn()));

    api.dismiss({ message: 'm' });
    await new Promise(r => setTimeout(r, 0));

    expect(builtInDismiss).not.toHaveBeenCalled();
  });

  it('resolves a built-in card by the options it was shown with', async () => {
    const { resolve: builtInResolve } = await import('../../../../../src/components/utils/notifier/index');
    const api = new NotifierAPI(makeConfig());
    const options: NotifierOptions = { message: 'm' };

    api.resolve(options, 'Image restored');
    await new Promise(r => setTimeout(r, 0));

    expect(builtInResolve).toHaveBeenCalledWith(options, 'Image restored');
  });

  it('does not resolve through the built-in notifier when a custom one is set', async () => {
    const { resolve: builtInResolve } = await import('../../../../../src/components/utils/notifier/index');
    const api = new NotifierAPI(makeConfig(vi.fn()));

    api.resolve({ message: 'm' }, 'Image restored');
    await new Promise(r => setTimeout(r, 0));

    expect(builtInResolve).not.toHaveBeenCalled();
  });

  it('resolves and dismisses the very object the built-in notifier was shown', async () => {
    const notifierModule = await import('../../../../../src/components/utils/notifier/index');
    const api = new NotifierAPI(makeConfig());
    const { state } = makeTranslatorState({});
    api.state = state;
    const options: NotifierOptions = { message: 'm', actions: [ { label: 'Retry', onClick: vi.fn() } ] };

    api.show(options);
    api.resolve(options, 'Image restored');
    api.dismiss(options);
    await new Promise(r => setTimeout(r, 0));
    const [ [ shown ] ] = vi.mocked(notifierModule.show).mock.calls;

    expect(vi.mocked(notifierModule.resolve).mock.calls[0][0]).toBe(shown);
    expect(vi.mocked(notifierModule.dismiss).mock.calls[0][0]).toBe(shown);
  });

  it('asks the built-in notifier about the very object it was shown', async () => {
    const notifierModule = await import('../../../../../src/components/utils/notifier/index');
    const api = new NotifierAPI(makeConfig());
    const { state } = makeTranslatorState({});
    api.state = state;
    const options: NotifierOptions = { message: 'm', actions: [ { label: 'Retry', onClick: vi.fn() } ] };

    api.show(options);
    await new Promise(r => setTimeout(r, 0));
    vi.mocked(notifierModule.isClosed).mockReturnValueOnce(true);
    const [ [ shown ] ] = vi.mocked(notifierModule.show).mock.calls;

    expect(api.isClosed(options)).toBe(true);
    expect(notifierModule.isClosed).toHaveBeenCalledWith(shown);
  });

  it('treats a custom notifier\'s toast as closed, since it cannot be closed or shown again from here', () => {
    const api = new NotifierAPI(makeConfig(vi.fn()));

    expect(api.isClosed({ message: 'm' })).toBe(true);
  });

  it('fills a localized close label for toasts with actions', async () => {
    const { show: builtInShow } = await import('../../../../../src/components/utils/notifier/index');
    const api = new NotifierAPI(makeConfig());
    const { state } = makeTranslatorState({ 'notifier.dismiss': 'Schließen' });
    api.state = state;
    const options: NotifierOptions = { message: 'm', actions: [ { label: 'Retry', onClick: vi.fn() } ] };

    api.show(options);
    await new Promise(r => setTimeout(r, 0));

    expect(builtInShow).toHaveBeenCalledWith({ ...options, dismissText: 'Schließen' }, expect.anything());
    expect(options).not.toHaveProperty('dismissText');
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
