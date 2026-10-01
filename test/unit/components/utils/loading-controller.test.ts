import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadingController, MIN_VISIBLE } from '../../../../src/components/utils/loading-controller';
import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { HANDOFF_DURATION, HANDOFF_STAGGER } from '../../../../src/components/utils/skeleton-handoff';
import type * as SkeletonHandoff from '../../../../src/components/utils/skeleton-handoff';

const { mockRunSkeletonHandoff } = vi.hoisted(() => ({
  mockRunSkeletonHandoff: vi.fn<typeof SkeletonHandoff.runSkeletonHandoff>(),
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

  it('shows nothing when hidden before the delay', async () => {
    const { wrapper, controller } = setup();

    controller.show();
    expect(wrapper.getAttribute('aria-busy')).toBe('true');
    vi.advanceTimersByTime(149);
    await controller.hide([]);

    expect(skeleton(wrapper)).toBeNull();
    expect(wrapper.hasAttribute(DATA_ATTR.loading)).toBe(false);
    expect(wrapper.hasAttribute('aria-busy')).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(skeleton(wrapper)).toBeNull();
    expect(mockRunSkeletonHandoff).not.toHaveBeenCalled();
  });

  it('shows the skeleton and a polite status after the delay', () => {
    const { wrapper, controller } = setup();

    controller.show();
    vi.advanceTimersByTime(150);

    expect(skeleton(wrapper)).not.toBeNull();
    expect(wrapper.hasAttribute(DATA_ATTR.loading)).toBe(true);
    expect(controller.isVisible).toBe(true);
    expect(wrapper.querySelector('[role="status"]')?.textContent).toBe('Loading content…');
  });

  it('hides the status visually with the same inline style as the announcer', () => {
    const { wrapper, controller } = setup();

    controller.show();

    const status = wrapper.querySelector<HTMLElement>('[role="status"]');

    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.style.position).toBe('absolute');
    expect(status?.style.width).toBe('1px');
    expect(status?.style.height).toBe('1px');
    expect(status?.style.overflow).toBe('hidden');
    expect(status?.style.whiteSpace).toBe('nowrap');
    expect(status?.style.margin).toBe('-1px');
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
    expect(wrapper.querySelector('[role="status"]')).toBeNull();
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

    Object.defineProperty(content, 'getAnimations', { value: () => [{ cancel }], configurable: true });

    controller.show();
    vi.advanceTimersByTime(150);
    const done = controller.hide([]);

    await vi.advanceTimersByTimeAsync(MIN_VISIBLE);
    await done;

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('still tears down when the handoff rejects', async () => {
    const { wrapper, content, controller } = setup();
    const cancel = vi.fn();

    Object.defineProperty(content, 'getAnimations', { value: () => [{ cancel }], configurable: true });
    mockRunSkeletonHandoff.mockRejectedValueOnce(new Error('boom'));

    controller.show();
    vi.advanceTimersByTime(150);
    const done = controller.hide([]);
    const assertion = expect(done).rejects.toThrow('boom');

    await vi.advanceTimersByTimeAsync(MIN_VISIBLE);
    await assertion;

    expect(skeleton(wrapper)).toBeNull();
    expect(wrapper.hasAttribute('aria-busy')).toBe(false);
    expect(wrapper.querySelector('[role="status"]')).toBeNull();
    expect(content.style.opacity).toBe('');
    expect(cancel).toHaveBeenCalledTimes(1);
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
    expect(wrapper.querySelector('[role="status"]')).toBeNull();
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
