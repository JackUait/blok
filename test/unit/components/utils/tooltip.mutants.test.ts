import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTR, TOOLTIP_INTERFACE_VALUE } from '../../../../src/components/constants';
import { TOP_LAYER_MARKER_ATTR } from '../../../../src/components/utils/top-layer';
import { destroy, hide, onHover, show } from '../../../../src/components/utils/tooltip';

/**
 * Placement math reads `window.innerWidth/innerHeight` directly, so every
 * anchor below is positioned against these two numbers. They are pinned (not
 * read from jsdom's defaults) so an environment change cannot silently turn a
 * flip fixture into a no-flip fixture.
 */
const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

/** Mirrors DEFAULT_OFFSET in the module: every space calculation subtracts it. */
const ANCHOR_OFFSET = 10;

const TOOLTIP_SELECTOR = `[${DATA_ATTR.interface}="${TOOLTIP_INTERFACE_VALUE}"]`;

const HOVER_EVENT_NAMES = [
  'pointerenter',
  'pointerdown',
  'mouseenter',
  'mouseleave',
  'focusin',
  'focusout',
] as const;

type AnchorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const createAnchor = ({ left, top, width, height }: AnchorRect): HTMLElement => {
  const element = document.createElement('button');
  const rect = {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
  };

  Object.defineProperty(element, 'clientWidth', { configurable: true,
    value: width });
  Object.defineProperty(element, 'clientHeight', { configurable: true,
    value: height });
  element.getBoundingClientRect = vi.fn(() => ({ ...rect,
    toJSON: () => rect }));

  document.body.appendChild(element);

  return element;
};

const requireWrapper = (): HTMLElement => {
  const wrapper = document.querySelector<HTMLElement>(TOOLTIP_SELECTOR);

  if (wrapper === null) {
    throw new Error('Tooltip wrapper should exist');
  }

  return wrapper;
};

const setWrapperSize = (wrapper: HTMLElement, width: number, height: number): void => {
  for (const prop of [ 'offsetWidth', 'clientWidth' ]) {
    Object.defineProperty(wrapper, prop, { configurable: true,
      value: width });
  }
  for (const prop of [ 'offsetHeight', 'clientHeight' ]) {
    Object.defineProperty(wrapper, prop, { configurable: true,
      value: height });
  }
};

/**
 * The wrapper only exists after the singleton is built, and every placement
 * decision reads its measured box — which is 0×0 in jsdom until it is stubbed.
 * A zero-sized bubble fits everywhere, so no flip and no clamp is ever
 * reachable; this seeds the wrapper and gives it a real box first.
 */
const seedSizedWrapper = (width: number, height: number): HTMLElement => {
  const seed = createAnchor({ left: 0,
    top: 0,
    width: 10,
    height: 10 });

  show(seed, 'seed');

  const wrapper = requireWrapper();

  setWrapperSize(wrapper, width, height);

  return wrapper;
};

/** MutationObserver records are delivered on a microtask; a macrotask drains them. */
const flushObserver = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

const dispatchHover = (element: HTMLElement, pointerType: string): void => {
  element.dispatchEvent(new PointerEvent('pointerenter', { pointerType,
    bubbles: true }));
  element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
};

const hasCaptureOption = (options: boolean | EventListenerOptions | undefined): boolean => {
  return typeof options === 'object' && options !== null && options.capture === true;
};

describe('Tooltip utility — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true,
      value: VIEWPORT_WIDTH });
    Object.defineProperty(window, 'innerHeight', { configurable: true,
      value: VIEWPORT_HEIGHT });
  });

  afterEach(() => {
    // Unconditional: the singleton survives a test that never rendered a
    // wrapper, and a leaked instance would carry its timers into the next test.
    destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('bubble scaffolding', () => {
    it('builds the wrapper and the content node with exactly the documented class lists', () => {
      onHover(createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 }), 'classes');

      const wrapper = requireWrapper();
      const content = wrapper.querySelector<HTMLElement>('[data-blok-testid="tooltip-content"]');

      expect(Array.from(wrapper.classList)).toEqual([
        'fixed',
        'z-overlay',
        'top-0',
        'left-0',
        'bg-tooltip-bg',
        'opacity-0',
        'select-none',
        'rounded-lg',
        'shadow-tooltip',
        'mobile:hidden',
      ]);
      expect(Array.from(content?.classList ?? [])).toEqual([
        'px-2.5',
        'py-1.5',
        'text-tooltip-font',
        'text-xs',
        'text-center',
        'tracking-[0.02em]',
        'leading-[1em]',
      ]);
    });

    it('stamps identity, role and closed state on the bubble before anything is shown', () => {
      onHover(createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 }), 'scaffolding');

      const wrapper = requireWrapper();

      expect(wrapper.id).toBe('blok-tooltip');
      expect(wrapper.getAttribute('role')).toBe('tooltip');
      expect(wrapper.getAttribute('data-blok-testid')).toBe('tooltip');
      expect(wrapper.getAttribute('data-state')).toBe('closed');
      // Written by the visibility sync that prepare() arms — absent if that
      // sync is never wired up.
      expect(wrapper.getAttribute('aria-hidden')).toBe('true');
      expect(wrapper.getAttribute('data-blok-shown')).toBe('false');
    });
  });

  describe('visibility', () => {
    it('writes visibility at normal priority when shown and !important when hidden', () => {
      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      show(anchor, 'visibility');

      const wrapper = requireWrapper();

      expect(wrapper.style.getPropertyValue('visibility')).toBe('visible');
      expect(wrapper.style.getPropertyPriority('visibility')).toBe('');
      expect(wrapper.getAttribute('aria-hidden')).toBe('false');
      expect(wrapper.getAttribute('data-blok-shown')).toBe('true');

      hide();

      expect(wrapper.style.getPropertyValue('visibility')).toBe('hidden');
      // Inline !important is the only thing that outranks the Top-Layer
      // `all: initial !important` reset; drop it and the bubble stays painted.
      expect(wrapper.style.getPropertyPriority('visibility')).toBe('important');
      expect(wrapper.getAttribute('aria-hidden')).toBe('true');
      expect(wrapper.getAttribute('data-blok-shown')).toBe('false');

      show(anchor, 'visibility again');

      // Re-asserted after a real hidden+important value was written: an
      // invalid priority makes setProperty a no-op, which would leave the
      // bubble stuck at hidden rather than clearing anything.
      expect(wrapper.style.getPropertyValue('visibility')).toBe('visible');
      expect(wrapper.style.getPropertyPriority('visibility')).toBe('');
    });

    it('keeps aria-hidden in step with a class change made outside show and hide', async () => {
      onHover(createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 }), 'observed');

      const wrapper = requireWrapper();

      expect(wrapper.getAttribute('aria-hidden')).toBe('true');

      wrapper.classList.add('opacity-100');
      await flushObserver();

      expect(wrapper.getAttribute('aria-hidden')).toBe('false');
      expect(wrapper.getAttribute('data-blok-shown')).toBe('true');

      wrapper.classList.remove('opacity-100');
      await flushObserver();

      expect(wrapper.getAttribute('aria-hidden')).toBe('true');
    });

    it('disconnects the visibility observer on destroy so the detached bubble stops reacting', async () => {
      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      show(anchor, 'observer leak');
      hide();

      const orphaned = requireWrapper();

      destroy();

      orphaned.classList.add('opacity-100');
      await flushObserver();

      expect(orphaned.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('description wiring', () => {
    it('moves aria-describedby to the newest target and clears it on hide', () => {
      const first = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });
      const second = createAnchor({ left: 300,
        top: 20,
        width: 100,
        height: 40 });

      show(first, 'first');

      expect(first.getAttribute('aria-describedby')).toBe('blok-tooltip');

      show(second, 'second');

      // The singleton describes one target at a time: the previous one must be
      // released or screen readers announce a bubble that no longer exists.
      expect(first.getAttribute('aria-describedby')).toBeNull();
      expect(second.getAttribute('aria-describedby')).toBe('blok-tooltip');

      hide();

      expect(second.getAttribute('aria-describedby')).toBeNull();
    });

    it('unlinks the described target on destroy', () => {
      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      show(anchor, 'described');
      destroy();

      expect(anchor.getAttribute('aria-describedby')).toBeNull();
    });

    it('unlinks the described target when a delayed reveal loses its anchor', () => {
      vi.useFakeTimers();

      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      show(anchor, 'delayed', { delay: 100 });

      expect(anchor.getAttribute('aria-describedby')).toBe('blok-tooltip');

      anchor.checkVisibility = vi.fn(() => false);
      vi.advanceTimersByTime(100);

      expect(anchor.getAttribute('aria-describedby')).toBeNull();
    });
  });

  describe('top layer', () => {
    it('returns the wrapper from the Top Layer on hide', () => {
      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      show(anchor, 'promoted');

      const wrapper = requireWrapper();

      expect(wrapper.getAttribute(TOP_LAYER_MARKER_ATTR)).toBe('true');

      hide();

      // A bubble left in the Top Layer keeps painting above every popover.
      expect(wrapper.hasAttribute(TOP_LAYER_MARKER_ATTR)).toBe(false);
    });
  });

  describe('document and window listeners', () => {
    it('registers the scroll listener passively in the capture phase and removes the same one on destroy', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      show(createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 }), 'scroll listener');

      expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { capture: true,
        passive: true });

      const scrollCall = addSpy.mock.calls.find(([ type ]) => type === 'scroll');

      if (scrollCall === undefined) {
        throw new Error('scroll listener was never registered');
      }

      destroy();

      // Same function object and same capture flag, or the listener outlives
      // the editor it belonged to.
      expect(removeSpy).toHaveBeenCalledWith('scroll', scrollCall[1], { capture: true });
    });

    it('arms the Escape listener idempotently and tears it down on hide and on destroy', () => {
      const addSpy = vi.spyOn(document, 'addEventListener');
      const removeSpy = vi.spyOn(document, 'removeEventListener');
      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      show(anchor, 'escape listener');

      const keydownAdd = addSpy.mock.calls.find(([ type ]) => type === 'keydown');

      if (keydownAdd === undefined) {
        throw new Error('keydown listener was never registered');
      }

      const handler = keydownAdd[1];

      expect(addSpy).toHaveBeenCalledWith('keydown', handler, { capture: true });

      const teardowns = (): number => removeSpy.mock.calls
        .filter(([ type, listener, options ]) => type === 'keydown' && listener === handler && hasCaptureOption(options))
        .length;

      // show() removes before adding, so a racing show can never stack a
      // second copy of the same listener.
      expect(teardowns()).toBe(1);

      hide();

      expect(teardowns()).toBe(2);

      destroy();

      expect(teardowns()).toBe(3);
    });

    it('dismisses on Escape from the capture phase even when the target stops propagation', () => {
      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });
      const field = document.createElement('input');

      document.body.appendChild(field);
      field.addEventListener('keydown', (event) => event.stopPropagation());

      show(anchor, 'escape');

      const wrapper = requireWrapper();

      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape',
        bubbles: true }));

      expect(wrapper.getAttribute('data-blok-shown')).toBe('false');
    });

    it('ignores keys other than Escape', () => {
      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      show(anchor, 'other keys');

      const wrapper = requireWrapper();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a',
        bubbles: true }));

      expect(wrapper.getAttribute('data-blok-shown')).toBe('true');
    });

    it('leaves a pending delayed show alone when the page scrolls before it opened', () => {
      vi.useFakeTimers();

      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      show(anchor, 'pending', { delay: 100 });

      window.dispatchEvent(new Event('scroll'));

      // The scroll handler must only act on a bubble that is actually open;
      // hiding here would also drop the pending reveal.
      expect(anchor.getAttribute('aria-describedby')).toBe('blok-tooltip');

      vi.advanceTimersByTime(100);

      expect(requireWrapper().getAttribute('aria-hidden')).toBe('false');
    });
  });

  describe('timers', () => {
    it('drops the timer of a superseded delayed show', () => {
      vi.useFakeTimers();

      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      show(anchor, 'first', { delay: 100 });
      show(anchor, 'second', { delay: 500 });

      vi.advanceTimersByTime(150);

      // Asserted before the second timer can fire: the stale 100ms timer must
      // not reveal a bubble the user already moved away from.
      const wrapper = requireWrapper();

      expect(wrapper.getAttribute('aria-hidden')).toBe('true');

      vi.advanceTimersByTime(350);

      expect(wrapper.getAttribute('aria-hidden')).toBe('false');
      expect(wrapper.textContent).toBe('second');
    });

    it('replaces the grace-hide timer on a second pointer exit instead of stacking it', () => {
      vi.useFakeTimers();

      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      onHover(anchor, 'grace', { delay: 0 });
      dispatchHover(anchor, 'mouse');

      const wrapper = requireWrapper();

      expect(wrapper.getAttribute('aria-hidden')).toBe('false');

      anchor.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      vi.advanceTimersByTime(50);
      anchor.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      vi.advanceTimersByTime(50);

      // The first exit's timer would fire right here if it had not been
      // cancelled, cutting the grace window in half.
      expect(wrapper.getAttribute('aria-hidden')).toBe('false');

      vi.advanceTimersByTime(50);

      expect(wrapper.getAttribute('aria-hidden')).toBe('true');
    });

    it('cancels a grace hide that was armed while the show delay was still running', () => {
      vi.useFakeTimers();

      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      onHover(anchor, 'reveal cancels grace', { delay: 100 });
      dispatchHover(anchor, 'mouse');

      vi.advanceTimersByTime(50);
      anchor.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      vi.advanceTimersByTime(50);

      const wrapper = requireWrapper();

      expect(wrapper.getAttribute('aria-hidden')).toBe('false');

      vi.advanceTimersByTime(60);

      // The grace timer armed at 50ms would land at 150ms; the reveal at 100ms
      // has to disarm it or the bubble blinks out right after opening.
      expect(wrapper.getAttribute('aria-hidden')).toBe('false');
    });

    it('does not re-arm the skip-delay window when hide runs on an already closed bubble', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      show(anchor, 'first', { delay: 0 });
      hide();

      vi.setSystemTime(400);
      hide();

      vi.setSystemTime(500);
      show(anchor, 'cold', { delay: 200 });

      // Only the 0ms hide was real. A second hide that believes the bubble was
      // still open would stamp 400ms and make this show instant.
      expect(requireWrapper().getAttribute('aria-hidden')).toBe('true');
    });

    it('treats the skip-delay window as exclusive at its boundary', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      show(anchor, 'first', { delay: 0 });
      hide();

      vi.setSystemTime(300);
      show(anchor, 'boundary', { delay: 200 });

      const wrapper = requireWrapper();

      expect(wrapper.getAttribute('aria-hidden')).toBe('true');

      vi.advanceTimersByTime(200);

      expect(wrapper.getAttribute('aria-hidden')).toBe('false');
    });

    it('cancels a pending show on destroy so the detached bubble never opens', () => {
      vi.useFakeTimers();

      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      show(anchor, 'destroy during delay', { delay: 100 });

      const orphaned = requireWrapper();

      destroy();
      vi.advanceTimersByTime(150);

      expect(orphaned.getAttribute('data-state')).toBe('closed');
      expect(orphaned.getAttribute('data-blok-shown')).toBe('false');
    });

    it('ignores trigger events that reach the instance after destroy', () => {
      vi.useFakeTimers();

      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      onHover(anchor, 'events after destroy', { delay: 0 });
      dispatchHover(anchor, 'mouse');

      const orphaned = requireWrapper();

      expect(orphaned.getAttribute('data-state')).toBe('open');

      destroy();

      // destroy() leaves the per-trigger handlers bound to the element, and
      // focusout closes over the instance that is already gone.
      anchor.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

      expect(orphaned.getAttribute('data-state')).toBe('open');

      // Same for the deferred path: the exit timer is armed on the dead
      // instance and must not write to the wrapper it no longer owns.
      anchor.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      vi.advanceTimersByTime(150);

      expect(orphaned.getAttribute('data-state')).toBe('open');
    });
  });

  describe('hover binding', () => {
    it('replaces a previous onHover binding instead of stacking a second one', () => {
      vi.useFakeTimers();

      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      onHover(anchor, 'stale', { delay: 0 });
      onHover(anchor, 'fresh', { delay: 100 });

      dispatchHover(anchor, 'mouse');

      const wrapper = requireWrapper();

      // A surviving first binding would open instantly with its own delay of 0
      // and the second show could not close it again.
      expect(wrapper.getAttribute('aria-hidden')).toBe('true');

      vi.advanceTimersByTime(100);

      expect(wrapper.getAttribute('aria-hidden')).toBe('false');
      expect(wrapper.textContent).toBe('fresh');
    });

    it('detaches every listener of the replaced binding by its own event name', () => {
      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });
      const addSpy = vi.spyOn(anchor, 'addEventListener');

      onHover(anchor, 'first binding');

      const added = addSpy.mock.calls.map(([ type, listener ]) => ({ type,
        listener }));
      const removeSpy = vi.spyOn(anchor, 'removeEventListener');

      onHover(anchor, 'second binding');

      expect(added.map(({ type }) => type)).toEqual([ ...HOVER_EVENT_NAMES ]);
      expect(removeSpy.mock.calls.map(([ type ]) => type)).toEqual([ ...HOVER_EVENT_NAMES ]);
      expect(removeSpy.mock.calls.map(([ , listener ]) => listener)).toEqual(added.map(({ listener }) => listener));
    });

    it('suppresses a hover reveal under an open popover unless the trigger lives inside it', () => {
      const outside = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });
      const popover = document.createElement('div');

      popover.setAttribute('data-blok-popover-opened', 'true');
      document.body.appendChild(popover);

      onHover(outside, 'covered', { delay: 0 });
      dispatchHover(outside, 'mouse');

      const wrapper = requireWrapper();

      expect(wrapper.getAttribute('aria-hidden')).toBe('true');

      const inside = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      popover.appendChild(inside);
      onHover(inside, 'inside the menu', { delay: 0 });
      dispatchHover(inside, 'mouse');

      // Items of the open menu still get their tooltips — the guard is about
      // covering a menu, not about muting everything while one is open.
      expect(wrapper.getAttribute('aria-hidden')).toBe('false');
    });

    it('keeps the caller options on the focus path', () => {
      const anchor = createAnchor({ left: 100,
        top: 300,
        width: 100,
        height: 40 });

      onHover(anchor, 'focus placement', { placement: 'right' });
      anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(requireWrapper().getAttribute('data-side')).toBe('right');
    });

    it('treats the touch-focus suppression window as exclusive at its boundary', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      onHover(anchor, 'boundary focus', { delay: 0 });
      anchor.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch',
        bubbles: true }));

      vi.setSystemTime(500);
      anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(requireWrapper().getAttribute('aria-hidden')).toBe('false');
    });

    it('does not arm the touch guard from a mouse pointerdown', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const anchor = createAnchor({ left: 10,
        top: 20,
        width: 100,
        height: 40 });

      onHover(anchor, 'mouse pointerdown', { delay: 0 });
      anchor.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse',
        bubbles: true }));

      vi.setSystemTime(100);
      anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      // Only touch may suppress the focus reveal; a mouse press that also
      // focused the control must still surface the tooltip (WCAG 1.4.13).
      expect(requireWrapper().getAttribute('aria-hidden')).toBe('false');
    });
  });

  describe('placement', () => {
    it('flips a bottom placement to top when only the anchor offset closes the gap', () => {
      const wrapper = seedSizedWrapper(80, 70);
      const anchor = createAnchor({ left: 100,
        top: VIEWPORT_HEIGHT - 108,
        width: 80,
        height: 40 });

      show(anchor, 'flip down to up', { placement: 'bottom' });

      // 58px below the anchor, 650px above it, and a 70px bubble: the offset
      // is subtracted from the free space, never added to it.
      expect(wrapper.getAttribute('data-side')).toBe('top');
      expect(wrapper.style.top).toBe(`${VIEWPORT_HEIGHT - 108 - 70 - ANCHOR_OFFSET}px`);
    });

    it('keeps a bottom placement when the space above is short by the anchor offset', () => {
      const wrapper = seedSizedWrapper(80, 100);
      const anchor = createAnchor({ left: 100,
        top: 100,
        width: 80,
        height: 560 });

      show(anchor, 'no room either side', { placement: 'bottom' });

      // 98px below and 90px above for a 100px bubble: nothing fits, so the
      // requested side wins.
      expect(wrapper.getAttribute('data-side')).toBe('bottom');
    });

    it('flips a top placement to bottom against the viewport top edge', () => {
      const wrapper = seedSizedWrapper(80, 100);
      const anchor = createAnchor({ left: 100,
        top: 5,
        width: 80,
        height: 40 });

      show(anchor, 'flip up to down', { placement: 'top' });

      expect(wrapper.getAttribute('data-side')).toBe('bottom');
      expect(wrapper.style.top).toBe(`${45 + ANCHOR_OFFSET}px`);
    });

    it('resolves a horizontal request on the horizontal axis only', () => {
      const wrapper = seedSizedWrapper(80, 100);
      const anchor = createAnchor({ left: 100,
        top: 5,
        width: 100,
        height: 40 });

      show(anchor, 'right at the top edge', { placement: 'right' });

      // There is no room above and plenty below, but a right-placed bubble is
      // never resolved against the vertical axis.
      expect(wrapper.getAttribute('data-side')).toBe('right');
    });

    it('flips a right placement to left at the viewport right edge', () => {
      const wrapper = seedSizedWrapper(20, 30);
      const anchor = createAnchor({ left: 900,
        top: 300,
        width: 100,
        height: 40 });

      show(anchor, 'flip right to left', { placement: 'right' });

      // 14px to the right of the anchor, 890px to its left, 20px bubble.
      expect(wrapper.getAttribute('data-side')).toBe('left');
      expect(wrapper.getAttribute('data-blok-placement')).toBe('left');
      expect(wrapper.style.left).toBe(`${900 - 20 - ANCHOR_OFFSET}px`);
      expect(wrapper.style.top).toBe('305px');
    });

    it('flips a left placement to right at the viewport left edge', () => {
      const wrapper = seedSizedWrapper(20, 30);
      const anchor = createAnchor({ left: 20,
        top: 300,
        width: 100,
        height: 40 });

      show(anchor, 'flip left to right', { placement: 'left' });

      // 10px to the left of the anchor, 894px to its right, 20px bubble.
      expect(wrapper.getAttribute('data-side')).toBe('right');
      expect(wrapper.getAttribute('data-blok-placement')).toBe('right');
      expect(wrapper.style.left).toBe(`${120 + ANCHOR_OFFSET}px`);
    });

    it('clamps a side placement to the bottom of the viewport', () => {
      const wrapper = seedSizedWrapper(80, 30);
      const anchor = createAnchor({ left: 100,
        top: 740,
        width: 100,
        height: 40 });

      show(anchor, 'bottom clamp', { placement: 'right' });

      // Unclamped this lands at 745px and the bubble hangs off-screen.
      expect(wrapper.style.top).toBe(`${VIEWPORT_HEIGHT - 30}px`);
    });

    it('defaults to bottom, including when placement is passed as undefined', () => {
      const wrapper = seedSizedWrapper(200, 30);
      const anchor = createAnchor({ left: 20,
        top: 300,
        width: 100,
        height: 40 });

      show(anchor, 'implicit default', {});

      // The anchor sits 10px from the left edge: any fallback that is not
      // literally 'bottom' resolves on the horizontal axis and flips to right.
      expect(wrapper.getAttribute('data-side')).toBe('bottom');

      show(anchor, 'explicit undefined', { placement: undefined });

      expect(wrapper.getAttribute('data-side')).toBe('bottom');
    });
  });
});
