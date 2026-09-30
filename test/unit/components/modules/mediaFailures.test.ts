import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaFailures, COALESCE_MS } from '../../../../src/components/modules/mediaFailures';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import { BlockChanged } from '../../../../src/components/events';
import type { BlokEventMap } from '../../../../src/components/events';
import { BlockRemovedMutationType } from '../../../../types/events/block/BlockRemoved';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../types';
import type { NotifierOptions } from '../../../../types/configs/notifier';

const created: MediaFailures[] = [];

const setup = (config: Partial<BlokConfig> = {}, readOnly = false): {
  module: MediaFailures;
  eventsDispatcher: EventsDispatcher<BlokEventMap>;
  show: ReturnType<typeof vi.fn<(o: NotifierOptions) => void>>;
  dismiss: ReturnType<typeof vi.fn<(o: NotifierOptions) => void>>;
  resolve: ReturnType<typeof vi.fn<(o: NotifierOptions, message: string) => void>>;
  scrollToBlock: ReturnType<typeof vi.fn<(id: string) => void>>;
} => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const show = vi.fn<(o: NotifierOptions) => void>();
  const dismiss = vi.fn<(o: NotifierOptions) => void>();
  const resolve = vi.fn<(o: NotifierOptions, message: string) => void>();
  const scrollToBlock = vi.fn<(id: string) => void>();
  const module = new MediaFailures({ config, eventsDispatcher });

  created.push(module);

  module.state = {
    NotifierAPI: { show, dismiss, resolve },
    BlocksAPI: { scrollToBlock },
    ReadOnly: { isEnabled: readOnly },
    I18n: { t: (key: string, vars?: Record<string, string | number>) => (vars ? `${key}:${String(vars.count)}` : key) },
  } as unknown as BlokModules;

  return { module, eventsDispatcher, show, dismiss, resolve, scrollToBlock };
};

const input = (blockId: string, kind: 'upload' | 'load' = 'load', retry = vi.fn()): { blockId: string; tool: string; kind: 'upload' | 'load'; url: string; retry: () => void } =>
  ({ blockId, tool: 'image', kind, url: `https://x.test/${blockId}.png`, retry });

const actionsOf = (options: NotifierOptions | undefined): NonNullable<NotifierOptions['actions']> => options?.actions ?? [];

const unloadPrevented = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });

  window.dispatchEvent(event);

  return event.defaultPrevented;
};

describe('MediaFailures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    created.splice(0).forEach((module) => {
      module.markDestroyed();
      module.destroy();
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('groups failures that arrive together into one toast', () => {
    const { module, show } = setup();

    module.report(input('a'));
    module.report(input('b'));
    module.report(input('c'));
    vi.advanceTimersByTime(COALESCE_MS);

    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0].message).toBe('imageFailure.failedMany:3');
  });

  it('names the kind for a single failure', () => {
    const { module, show } = setup();

    module.report(input('a', 'upload'));
    vi.advanceTimersByTime(COALESCE_MS);

    expect(show.mock.calls[0][0].message).toBe('imageFailure.uploadFailed');
  });

  it('Retry retries every failure and Show scrolls to the first', () => {
    const { module, show, scrollToBlock } = setup();
    const retryA = vi.fn();
    const retryB = vi.fn();

    module.report(input('a', 'load', retryA));
    module.report(input('b', 'load', retryB));
    vi.advanceTimersByTime(COALESCE_MS);
    const [ retry, showButton ] = actionsOf(show.mock.calls[0][0]);

    retry.onClick();
    showButton.onClick();

    expect(retryA).toHaveBeenCalledTimes(1);
    expect(retryB).toHaveBeenCalledTimes(1);
    expect(scrollToBlock).toHaveBeenCalledWith('a');
  });

  it('does not toast a failure cleared before the window ends', () => {
    const { module, show } = setup();

    module.report(input('a'));
    module.clear('a');
    vi.advanceTimersByTime(COALESCE_MS);

    expect(show).not.toHaveBeenCalled();
  });

  it('does not toast again for a failure already toasted', () => {
    const { module, show } = setup();

    module.report(input('a'));
    vi.advanceTimersByTime(COALESCE_MS);
    module.report(input('b'));
    vi.advanceTimersByTime(COALESCE_MS);

    expect(show).toHaveBeenCalledTimes(2);
    expect(show.mock.calls[1][0].message).toBe('imageFailure.failedMany:2');
  });

  it('drops a failure when its block is removed', () => {
    const { module, eventsDispatcher } = setup();
    const event = new CustomEvent(BlockRemovedMutationType, { detail: { target: { id: 'a' }, index: 0 } });

    module.report(input('a'));
    eventsDispatcher.emit(BlockChanged, { event } as unknown as BlokEventMap[typeof BlockChanged]);

    expect(module.list()).toEqual([]);
  });

  it('save toast fires once per failure across two saves', () => {
    const { module, show } = setup();

    module.report(input('a', 'upload'));
    module.report(input('b', 'load'));
    vi.advanceTimersByTime(COALESCE_MS);
    show.mockClear();
    module.onSave();
    module.onSave();

    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0].message).toBe('imageFailure.notSaved:1 · imageFailure.notDisplayed:1');
  });

  it('reports on save again after the failure recovers and fails again', () => {
    const { module, show } = setup();

    module.report(input('a', 'upload'));
    module.onSave();
    module.clear('a');
    module.report(input('a', 'upload'));
    show.mockClear();
    module.onSave();

    expect(show).toHaveBeenCalledTimes(1);
  });

  it('skips the save toast in read-only mode', () => {
    const { module, show } = setup({}, true);

    module.report(input('a'));
    vi.advanceTimersByTime(COALESCE_MS);
    show.mockClear();
    module.onSave();

    expect(show).not.toHaveBeenCalled();
  });

  it('lets onImageFailure take over when it returns false', () => {
    const onImageFailure = vi.fn(() => false);
    const { module, show } = setup({ onImageFailure });

    module.report(input('a'));
    vi.advanceTimersByTime(COALESCE_MS);

    expect(onImageFailure).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'fail',
      failures: [ expect.objectContaining({ blockId: 'a', tool: 'image', kind: 'load', url: 'https://x.test/a.png' }) ],
    }));
    expect(show).not.toHaveBeenCalled();
  });

  it('hands the host a scrollTo that reaches the block', () => {
    const onImageFailure = vi.fn(() => false);
    const { module, scrollToBlock } = setup({ onImageFailure });

    module.report(input('a'));
    vi.advanceTimersByTime(COALESCE_MS);
    module.list()[0].scrollTo();

    expect(scrollToBlock).toHaveBeenCalledWith('a');
  });

  it('still shows its toast when onImageFailure throws', () => {
    const { module, show } = setup({ onImageFailure: () => {
      throw new Error('host bug');
    } });

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    module.report(input('a'));
    vi.advanceTimersByTime(COALESCE_MS);

    expect(show).toHaveBeenCalledTimes(1);
  });

  it('draws the card with the picked image, a reason and a busy primary Retry', () => {
    const { module, show } = setup();

    module.report({ ...input('a', 'upload'), preview: 'blob:https://x/a' });
    vi.advanceTimersByTime(COALESCE_MS);
    const [ [ options ] ] = show.mock.calls;
    const [ retry, showButton ] = actionsOf(options);

    expect(options.thumbnails).toEqual([ 'blob:https://x/a' ]);
    expect(options.detail).toBe('imageFailure.uploadDetail');
    expect([ retry.primary, retry.busyOnClick ]).toEqual([ true, true ]);
    expect(showButton.primary).toBeUndefined();
  });

  it('draws one tile per failure and the shared reason when all failed the same way', () => {
    const { module, show } = setup();

    module.report(input('a', 'load'));
    module.report(input('b', 'load'));
    vi.advanceTimersByTime(COALESCE_MS);

    expect(show.mock.calls[0][0].thumbnails).toEqual([ null, null ]);
    expect(show.mock.calls[0][0].detail).toBe('imageFailure.loadDetail');
  });

  it('leaves out the reason when failures differ', () => {
    const { module, show } = setup();

    module.report(input('a', 'load'));
    module.report(input('b', 'upload'));
    vi.advanceTimersByTime(COALESCE_MS);

    expect(show.mock.calls[0][0].detail).toBeUndefined();
  });

  it('shows the restored state when the last failure recovers', () => {
    const { module, show, dismiss, resolve } = setup();

    module.report(input('a'));
    vi.advanceTimersByTime(COALESCE_MS);
    module.clear('a', { recovered: true });

    expect(resolve).toHaveBeenCalledWith(show.mock.calls[0][0], 'imageFailure.restored');
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('counts every image that recovered', () => {
    const { module, resolve } = setup();

    module.report(input('a'));
    module.report(input('b'));
    vi.advanceTimersByTime(COALESCE_MS);
    module.clear('a', { recovered: true });
    module.clear('b', { recovered: true });

    expect(resolve).toHaveBeenCalledWith(expect.anything(), 'imageFailure.restoredMany:2');
  });

  it('closes quietly when the last failure went away without recovering', () => {
    const { module, dismiss, resolve } = setup();

    module.report(input('a'));
    vi.advanceTimersByTime(COALESCE_MS);
    module.clear('a');

    expect(resolve).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('closes its toast once every failure is gone', () => {
    const { module, show, dismiss } = setup();

    module.report(input('a'));
    module.report(input('b'));
    vi.advanceTimersByTime(COALESCE_MS);
    module.clear('a');

    expect(dismiss).not.toHaveBeenCalled();
    module.clear('b');
    expect(dismiss).toHaveBeenCalledWith(show.mock.calls[0][0]);
  });

  it('does not let a throwing notifier break the save that triggered it', () => {
    const { module, show } = setup();

    show.mockImplementation(() => {
      throw new Error('host notifier bug');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    module.report(input('a', 'upload'));

    expect(() => module.onSave()).not.toThrow();
  });

  it('holds beforeunload only while upload failures exist', () => {
    const { module } = setup();

    module.report(input('l', 'load'));
    expect(unloadPrevented()).toBe(false);
    module.report(input('u', 'upload'));
    expect(unloadPrevented()).toBe(true);
    module.clear('u');
    expect(unloadPrevented()).toBe(false);
  });

  it('keeps one editor\'s leave guard when another editor clears', () => {
    const first = setup().module;
    const second = setup().module;

    first.report(input('a', 'upload'));
    second.report(input('b', 'upload'));
    second.clear('b');

    expect(unloadPrevented()).toBe(true);
  });

  it('never holds beforeunload in read-only mode', () => {
    const { module } = setup({}, true);

    module.report(input('u', 'upload'));

    expect(unloadPrevented()).toBe(false);
  });

  it('releases the unload listener and pending toast on destroy', () => {
    const { module, show } = setup();

    module.report(input('u', 'upload'));
    module.markDestroyed();
    module.destroy();
    vi.advanceTimersByTime(COALESCE_MS);

    expect(unloadPrevented()).toBe(false);
    expect(show).not.toHaveBeenCalled();
  });
});

describe('MediaFailures.confirmLeave', () => {
  const click = (id: string): void => {
    document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`)?.click();
  };
  const banner = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-testid="leave-banner"]');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    created.splice(0).forEach((module) => {
      module.markDestroyed();
      module.destroy();
    });
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('resolves true at once with nothing failed', async () => {
    const { module } = setup();

    await expect(module.confirmLeave()).resolves.toBe(true);
    expect(banner()).toBeNull();
  });

  it('resolves true at once in read-only mode', async () => {
    const { module } = setup({}, true);

    module.report(input('a', 'upload'));

    await expect(module.confirmLeave()).resolves.toBe(true);
    expect(banner()).toBeNull();
  });

  it.each([
    [ 'leave-banner-leave', true ],
    [ 'leave-banner-stay', false ],
    [ 'leave-banner-show', false ],
  ])('%s resolves %s and closes the banner', async (id, expected) => {
    const { module } = setup();

    module.report(input('a', 'upload'));
    const answer = module.confirmLeave();

    expect(banner()).not.toBeNull();
    click(id);

    await expect(answer).resolves.toBe(expected);
    expect(banner()).toBeNull();
  });

  it('shows the counts in the banner', () => {
    const { module } = setup();

    module.report(input('a', 'upload'));
    module.report(input('b', 'load'));
    void module.confirmLeave();

    expect(document.querySelector('[data-blok-testid="leave-banner-summary"]')?.textContent).toBe('imageFailure.notSaved:1 · imageFailure.notDisplayed:1');
  });

  it('Show scrolls to the first failure', async () => {
    const { module, scrollToBlock } = setup();

    module.report(input('a'));
    const answer = module.confirmLeave();

    click('leave-banner-show');
    await answer;

    expect(scrollToBlock).toHaveBeenCalledWith('a');
  });

  it('Retry keeps the banner and resolves true once everything recovers', async () => {
    const { module } = setup();
    const retry = vi.fn(() => module.clear('a'));

    module.report(input('a', 'upload', retry));
    const answer = module.confirmLeave();

    click('leave-banner-retry');

    await expect(answer).resolves.toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('Retry keeps the banner open while failures remain', () => {
    const { module } = setup();

    module.report(input('a', 'upload'));
    void module.confirmLeave();
    click('leave-banner-retry');

    expect(banner()).not.toBeNull();
  });

  it('updates the counts as failures clear', () => {
    const { module } = setup();

    module.report(input('a', 'upload'));
    module.report(input('b', 'upload'));
    void module.confirmLeave();
    module.clear('a');

    expect(document.querySelector('[data-blok-testid="leave-banner-summary"]')?.textContent).toBe('imageFailure.notSaved:1');
  });

  it('returns the same promise and one banner when called twice', () => {
    const { module } = setup();

    module.report(input('a'));
    const first = module.confirmLeave();
    const second = module.confirmLeave();

    expect(second).toBe(first);
    expect(document.querySelectorAll('[data-blok-testid="leave-banner"]')).toHaveLength(1);
  });

  it('resolves true without a banner when the host returns false', async () => {
    const onImageFailure = vi.fn(() => false);
    const { module } = setup({ onImageFailure });

    module.report(input('a'));

    await expect(module.confirmLeave()).resolves.toBe(true);
    expect(onImageFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: 'leave' }));
    expect(banner()).toBeNull();
  });

  it('shows the banner when the host throws', () => {
    const { module } = setup({ onImageFailure: () => {
      throw new Error('x');
    } });

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    module.report(input('a'));
    void module.confirmLeave();

    expect(banner()).not.toBeNull();
  });

  it('resolves true and removes the banner on destroy', async () => {
    const { module } = setup();

    module.report(input('a'));
    const answer = module.confirmLeave();

    module.markDestroyed();
    module.destroy();

    await expect(answer).resolves.toBe(true);
    expect(banner()).toBeNull();
  });
});
