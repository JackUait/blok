import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadingController, MIN_VISIBLE } from '../../../../src/components/utils/loading-controller';
import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { HANDOFF_DURATION, HANDOFF_STAGGER } from '../../../../src/components/utils/skeleton-handoff';
import type * as SkeletonHandoff from '../../../../src/components/utils/skeleton-handoff';

const { mockRunSkeletonHandoff } = vi.hoisted(() => ({
  mockRunSkeletonHandoff: vi.fn<typeof SkeletonHandoff.runSkeletonHandoff>(),
}));

const { mockAnnounce } = vi.hoisted(() => ({
  mockAnnounce: vi.fn(),
}));

// The real announcer schedules its own timers, which the timer-count checks below would see.
vi.mock('../../../../src/components/utils/announcer', () => ({
  announce: mockAnnounce,
}));

vi.mock('../../../../src/components/utils/skeleton-handoff', async () => {
  const actual = await vi.importActual<typeof SkeletonHandoff>('../../../../src/components/utils/skeleton-handoff');

  return {
    ...actual,
    runSkeletonHandoff: mockRunSkeletonHandoff,
  };
});

const setup = (delay = 150): { wrapper: HTMLElement; content: HTMLElement; controller: LoadingController } => {
  const wrapper = document.createElement('div');
  const content = document.createElement('div');

  wrapper.appendChild(content);
  document.body.appendChild(wrapper);

  const controller = new LoadingController({
    wrapper,
    content,
    config: { enabled: true, skeleton: ['heading', 'paragraph'], delay },
    label: 'Loading content…',
  });

  return { wrapper, content, controller };
};

const skeleton = (wrapper: HTMLElement): Element | null => wrapper.querySelector(`[${DATA_ATTR.loadingSkeleton}]`);

const trackSettled = (promise: Promise<void>): { settled: () => boolean } => {
  const state = { settled: false };

  promise.then(
    () => {
      state.settled = true;
    },
    () => {
      state.settled = true;
    }
  );

  return { settled: () => state.settled };
};

describe('LoadingController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockRunSkeletonHandoff.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('ends a load shorter than the delay at once, with no handoff and no minimum wait', async () => {
    const { wrapper, controller } = setup();

    controller.show();
    expect(wrapper.getAttribute('aria-busy')).toBe('true');
    vi.advanceTimersByTime(149);
    const done = trackSettled(controller.hide([]));

    await vi.advanceTimersByTimeAsync(0);
    expect(done.settled()).toBe(true);
    expect(skeleton(wrapper)).toBeNull();
    expect(wrapper.hasAttribute(DATA_ATTR.loading)).toBe(false);
    expect(wrapper.hasAttribute('aria-busy')).toBe(false);
    expect(mockRunSkeletonHandoff).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  // Loading is when the main thread is blocked (a big first render), so nothing here may wait on a timer.
  it('mounts the skeleton and flags loading inside show(), without waiting on a timer', () => {
    const { wrapper, controller } = setup();

    controller.show();

    expect(skeleton(wrapper)).not.toBeNull();
    expect(wrapper.hasAttribute(DATA_ATTR.loading)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hands the delay to CSS, so the skeleton fades in only after it', () => {
    const { wrapper, controller } = setup(240);

    controller.show();

    expect((skeleton(wrapper) as HTMLElement | null)?.style.getPropertyValue('--blok-skeleton-delay')).toBe('240ms');
  });

  it('makes the content inert from show() until teardown, on every teardown path', async () => {
    const early = setup();

    early.controller.show();
    expect(early.content.hasAttribute('inert')).toBe(true);
    await early.controller.hide([]);
    expect(early.content.hasAttribute('inert')).toBe(false);

    const destroyed = setup();

    destroyed.controller.show();
    vi.advanceTimersByTime(150);
    destroyed.controller.destroy();
    expect(destroyed.content.hasAttribute('inert')).toBe(false);
  });

  it('is busy from show() until teardown, before the skeleton mounts too', async () => {
    const { controller } = setup();

    expect(controller.isBusy).toBe(false);
    controller.show();
    expect(controller.isBusy).toBe(true);
    expect(controller.isVisible).toBe(false);

    vi.advanceTimersByTime(150);
    const done = controller.hide([]);

    expect(controller.isBusy).toBe(true);
    await vi.advanceTimersByTimeAsync(MIN_VISIBLE);
    await done;
    expect(controller.isBusy).toBe(false);
  });

  it('counts the skeleton as visible once the delay has passed', () => {
    const { wrapper, controller } = setup();

    controller.show();
    vi.advanceTimersByTime(149);
    expect(controller.isVisible).toBe(false);
    vi.advanceTimersByTime(1);

    expect(skeleton(wrapper)).not.toBeNull();
    expect(wrapper.hasAttribute(DATA_ATTR.loading)).toBe(true);
    expect(controller.isVisible).toBe(true);
  });

  // A region inserted with its text set, inside an aria-busy subtree, is often not read out.
  it('announces loading through the shared polite announcer, with no status element of its own', () => {
    const { wrapper, controller } = setup();

    controller.show();

    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).toHaveBeenCalledWith('Loading content…', { politeness: 'polite' });
    expect(wrapper.querySelector('[role="status"]')).toBeNull();
  });

  describe('reserving the overlay height', () => {
    // A read-only or collaboration boot has an empty redactor and no bottom zone, so the absolute overlay would paint over the host's next element.
    const mockOverlayHeight = (height: number): void => {
      const realRect = Element.prototype.getBoundingClientRect;

      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        return this.hasAttribute(DATA_ATTR.loadingSkeleton) ? new DOMRect(0, 0, 600, height) : realRect.call(this);
      });
    };

    it('holds the wrapper at the overlay height from show(), then clears it', async () => {
      mockOverlayHeight(208);
      const { wrapper, controller } = setup();

      controller.show();
      expect(wrapper.style.minHeight).toBe('208px');
      // isolation.css puts `all: initial !important` on the editor wrapper, so a normal inline value loses.
      expect(wrapper.style.getPropertyPriority('min-height')).toBe('important');

      const done = controller.hide([]);

      await vi.advanceTimersByTimeAsync(MIN_VISIBLE);
      await done;
      expect(wrapper.style.minHeight).toBe('');
    });

    it('restores the host inline min-height exactly, on hide and on destroy', async () => {
      mockOverlayHeight(208);
      const hidden = setup();

      hidden.wrapper.style.minHeight = '12rem';
      hidden.controller.show();
      vi.advanceTimersByTime(150);
      expect(hidden.wrapper.style.minHeight).toBe('208px');
      const done = hidden.controller.hide([]);

      await vi.advanceTimersByTimeAsync(MIN_VISIBLE);
      await done;
      expect(hidden.wrapper.style.minHeight).toBe('12rem');
      expect(hidden.wrapper.style.getPropertyPriority('min-height')).toBe('');

      const destroyed = setup();

      destroyed.wrapper.style.setProperty('min-height', '40px', 'important');
      destroyed.controller.show();
      vi.advanceTimersByTime(150);
      destroyed.controller.destroy();
      expect(destroyed.wrapper.style.minHeight).toBe('40px');
      expect(destroyed.wrapper.style.getPropertyPriority('min-height')).toBe('important');
    });

    it('restores the host min-height when the load ends before the delay', async () => {
      mockOverlayHeight(208);
      const { wrapper, controller } = setup();

      wrapper.style.minHeight = '12rem';
      controller.show();
      vi.advanceTimersByTime(100);
      await controller.hide([]);

      expect(wrapper.style.minHeight).toBe('12rem');
    });
  });

  it('stays at least MIN_VISIBLE once shown, even if data lands right after', async () => {
    const { wrapper, controller } = setup();

    controller.show();
    vi.advanceTimersByTime(160);
    const done = controller.hide([]);

    vi.advanceTimersByTime(MIN_VISIBLE - 20);
    expect(skeleton(wrapper)).not.toBeNull();

    await vi.advanceTimersByTimeAsync(20);
    await done;
    expect(skeleton(wrapper)).toBeNull();
    expect(wrapper.hasAttribute('aria-busy')).toBe(false);
  });

  it('counts the time already shown toward MIN_VISIBLE', async () => {
    const { wrapper, controller } = setup();

    controller.show();
    vi.advanceTimersByTime(150);
    vi.advanceTimersByTime(300);
    const done = trackSettled(controller.hide([]));

    await vi.advanceTimersByTimeAsync(MIN_VISIBLE - 300 - 1);
    expect(skeleton(wrapper)).not.toBeNull();
    expect(done.settled()).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(skeleton(wrapper)).toBeNull();
    expect(done.settled()).toBe(true);
  });

  it('hands the skeleton bars, the targets and the content to the handoff', async () => {
    const { wrapper, content, controller } = setup();
    const target = document.createElement('div');

    controller.show();
    vi.advanceTimersByTime(150);

    const bars = Array.from(wrapper.querySelectorAll<HTMLElement>(`[${DATA_ATTR.skeletonBar}]`));
    const done = controller.hide([target]);

    await vi.advanceTimersByTimeAsync(MIN_VISIBLE);
    await done;

    expect(mockRunSkeletonHandoff).toHaveBeenCalledTimes(1);
    expect(mockRunSkeletonHandoff).toHaveBeenCalledWith({ bars, targets: [target], content });
  });

  it('starts the handoff with the content transparent and the loading flag gone', async () => {
    const { wrapper, content, controller } = setup();
    const seen: { opacity: string; loading: boolean }[] = [];

    mockRunSkeletonHandoff.mockImplementation(async () => {
      seen.push({ opacity: content.style.opacity, loading: wrapper.hasAttribute(DATA_ATTR.loading) });
    });

    controller.show();
    vi.advanceTimersByTime(150);
    const done = controller.hide([]);

    await vi.advanceTimersByTimeAsync(MIN_VISIBLE);
    await done;

    expect(seen).toEqual([{ opacity: '0', loading: false }]);
    expect(content.style.opacity).toBe('');
  });

  it('cancels the leftover content animations after the handoff', async () => {
    const { content, controller } = setup();
    const cancel = vi.fn();

    const handoff: { finish: () => void } = { finish: () => undefined };

    Object.defineProperty(content, 'getAnimations', { value: () => [{ cancel }], configurable: true });
    mockRunSkeletonHandoff.mockImplementation(() => new Promise<void>(resolve => {
      handoff.finish = resolve;
    }));

    controller.show();
    vi.advanceTimersByTime(150);
    const done = controller.hide([]);

    await vi.advanceTimersByTimeAsync(MIN_VISIBLE);
    expect(mockRunSkeletonHandoff).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();

    handoff.finish();
    await done;

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('tears down and resolves when the handoff rejects, so the boot does not fail', async () => {
    const { wrapper, content, controller } = setup();
    const cancel = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    Object.defineProperty(content, 'getAnimations', { value: () => [{ cancel }], configurable: true });
    mockRunSkeletonHandoff.mockRejectedValueOnce(new Error('boom'));

    controller.show();
    vi.advanceTimersByTime(150);
    const done = controller.hide([]);
    const assertion = expect(done).resolves.toBeUndefined();

    await vi.advanceTimersByTimeAsync(MIN_VISIBLE);
    await assertion;

    expect(warn).toHaveBeenCalledTimes(1);

    expect(skeleton(wrapper)).toBeNull();
    expect(wrapper.hasAttribute(DATA_ATTR.loading)).toBe(false);
    expect(wrapper.hasAttribute('aria-busy')).toBe(false);
    expect(content.style.opacity).toBe('');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('tears down and resolves when the handoff throws synchronously', async () => {
    const { wrapper, content, controller } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockRunSkeletonHandoff.mockImplementationOnce(() => {
      throw new Error('sync boom');
    });

    controller.show();
    vi.advanceTimersByTime(150);
    const done = controller.hide([]);
    const assertion = expect(done).resolves.toBeUndefined();

    await vi.advanceTimersByTimeAsync(MIN_VISIBLE);
    await assertion;

    expect(skeleton(wrapper)).toBeNull();
    expect(wrapper.hasAttribute(DATA_ATTR.loading)).toBe(false);
    expect(wrapper.hasAttribute('aria-busy')).toBe(false);
    expect(content.style.opacity).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a second hide() waits for the same teardown as the first', async () => {
    const { wrapper, controller } = setup();

    controller.show();
    vi.advanceTimersByTime(150);
    const first = trackSettled(controller.hide([]));
    const second = trackSettled(controller.hide([]));

    await vi.advanceTimersByTimeAsync(0);
    expect(skeleton(wrapper)).not.toBeNull();
    expect(second.settled()).toBe(false);

    await vi.advanceTimersByTimeAsync(MIN_VISIBLE - 1);
    expect(skeleton(wrapper)).not.toBeNull();
    expect(first.settled()).toBe(false);
    expect(second.settled()).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(skeleton(wrapper)).toBeNull();
    expect(first.settled()).toBe(true);
    expect(second.settled()).toBe(true);
    expect(mockRunSkeletonHandoff).toHaveBeenCalledTimes(1);
  });

  it('show() while a hide() is in flight changes nothing', async () => {
    const { wrapper, controller } = setup();

    controller.show();
    vi.advanceTimersByTime(150);
    const done = trackSettled(controller.hide([]));

    controller.show();
    expect(mockAnnounce).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MIN_VISIBLE);
    expect(done.settled()).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    expect(skeleton(wrapper)).toBeNull();
    expect(wrapper.hasAttribute('aria-busy')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up on a handoff that never settles and tears down anyway', async () => {
    const { wrapper, content, controller } = setup();

    mockRunSkeletonHandoff.mockImplementation(() => new Promise<void>(() => undefined));

    controller.show();
    vi.advanceTimersByTime(150);
    const done = trackSettled(controller.hide([]));

    await vi.advanceTimersByTimeAsync(MIN_VISIBLE);
    expect(mockRunSkeletonHandoff).toHaveBeenCalledTimes(1);

    const barCount = mockRunSkeletonHandoff.mock.calls[0][0].bars.length;
    const timeout = barCount * HANDOFF_STAGGER + HANDOFF_DURATION + 250;

    await vi.advanceTimersByTimeAsync(timeout - 1);
    expect(done.settled()).toBe(false);
    expect(skeleton(wrapper)).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(done.settled()).toBe(true);
    expect(skeleton(wrapper)).toBeNull();
    expect(wrapper.hasAttribute('aria-busy')).toBe(false);
    expect(content.style.opacity).toBe('');
  });

  it('leaves no timer behind after a normal handoff', async () => {
    const { controller } = setup();

    controller.show();
    vi.advanceTimersByTime(150);
    const done = controller.hide([]);

    await vi.advanceTimersByTimeAsync(MIN_VISIBLE);
    await done;

    expect(vi.getTimerCount()).toBe(0);
  });

  it('destroy() mid-load cancels the delay and leaves nothing behind', () => {
    const { wrapper, controller } = setup();

    controller.show();
    controller.destroy();
    vi.advanceTimersByTime(1000);

    expect(skeleton(wrapper)).toBeNull();
    expect(wrapper.hasAttribute('aria-busy')).toBe(false);
  });

  it('destroy() during the minimum wait settles the pending hide() at once', async () => {
    const { wrapper, controller } = setup();

    controller.show();
    vi.advanceTimersByTime(150);
    const done = trackSettled(controller.hide([]));

    controller.destroy();
    await vi.advanceTimersByTimeAsync(0);

    expect(done.settled()).toBe(true);
    expect(skeleton(wrapper)).toBeNull();
    expect(wrapper.hasAttribute(DATA_ATTR.loading)).toBe(false);
    expect(mockRunSkeletonHandoff).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('destroy() during a stuck handoff settles the pending hide() at once', async () => {
    const { wrapper, controller } = setup();

    mockRunSkeletonHandoff.mockImplementation(() => new Promise<void>(() => undefined));

    controller.show();
    vi.advanceTimersByTime(150);
    const done = trackSettled(controller.hide([]));

    await vi.advanceTimersByTimeAsync(MIN_VISIBLE);
    expect(mockRunSkeletonHandoff).toHaveBeenCalledTimes(1);

    controller.destroy();
    await vi.advanceTimersByTimeAsync(0);

    expect(done.settled()).toBe(true);
    expect(skeleton(wrapper)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('destroy() can be called twice', () => {
    const { wrapper, controller } = setup();

    controller.show();
    vi.advanceTimersByTime(150);
    controller.destroy();
    controller.destroy();

    expect(skeleton(wrapper)).toBeNull();
    expect(controller.isVisible).toBe(false);
  });

  it('does nothing when disabled', () => {
    const wrapper = document.createElement('div');
    const controller = new LoadingController({
      wrapper,
      content: document.createElement('div'),
      config: { enabled: false, skeleton: ['paragraph'], delay: 0 },
      label: 'x',
    });

    controller.show();
    vi.advanceTimersByTime(10);

    expect(wrapper.hasAttribute('aria-busy')).toBe(false);
    expect(skeleton(wrapper)).toBeNull();
  });
});
