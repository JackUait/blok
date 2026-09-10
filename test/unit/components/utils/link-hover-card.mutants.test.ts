import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { IconCopy, IconGlobe } from '../../../../src/components/icons';
import { LinkHoverCard } from '../../../../src/components/utils/link-hover-card';

const SHOW_DELAY = 350;
const GRACE_HIDE_DURATION = 250;
const ANIMATION_DURATION = 150;

interface Harness {
  card: LinkHoverCard;
  link: HTMLAnchorElement;
  other: HTMLAnchorElement;
  onOpen: ReturnType<typeof vi.fn>;
  onCopy: ReturnType<typeof vi.fn>;
  onEdit: ReturnType<typeof vi.fn>;
  canEdit: ReturnType<typeof vi.fn>;
}

const anchorFor = (href: string): HTMLAnchorElement => {
  const link = document.createElement('a');

  link.setAttribute('href', href);
  link.textContent = href;
  document.body.appendChild(link);

  return link;
};

const build = (): Harness => {
  const onOpen = vi.fn();
  const onCopy = vi.fn();
  const onEdit = vi.fn();
  const canEdit = vi.fn(() => true);
  const card = new LinkHoverCard({
    labels: { copy: 'Copy link', edit: 'Edit' },
    callbacks: { onOpen, onCopy, onEdit },
    canEdit,
  });

  return { card, link: anchorFor('https://example.test/a'), other: anchorFor('https://example.test/b'), onOpen, onCopy, onEdit, canEdit };
};

/**
 * The card's wrapper. It is built and body-mounted by the CONSTRUCTOR, so its
 * presence says nothing about whether the card is showing — `inert` and
 * `data-state` do.
 */
const wrapperOf = (): HTMLElement | null =>
  document.body.querySelector('[data-blok-testid="link-hover-card"]');

const runFrames = (): void => {
  vi.advanceTimersByTime(1);
};

/**
 * Frames that land LATER than a show/hide pair, so a test can hold a pending
 * entrance frame across a `hide()`. The default mock fires a frame on the next
 * timer tick, which makes every frame already-spent by the time a card is
 * hidden again.
 */
const deferFrames = (delay: number): void => {
  vi.mocked(globalThis.requestAnimationFrame).mockImplementation((callback) => {
    const id = setTimeout(() => callback(0), delay);

    return id as unknown as number;
  });
};

const press = (wrapper: HTMLElement, testid: string): void => {
  wrapper.querySelector<HTMLElement>(`[data-blok-testid="${testid}"]`)?.click();
};

/**
 * Collects anything jsdom routes to `window`'s error event. A throw inside a
 * DOM listener does not fail the test on its own — reporting to the window is
 * where it goes instead.
 */
const withErrorRecorder = (run: () => void): unknown[] => {
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent): void => {
    errors.push(event.error ?? event.message);
  };

  window.addEventListener('error', onError);

  try {
    run();
  } finally {
    window.removeEventListener('error', onError);
  }

  return errors;
};

describe('LinkHoverCard mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = setTimeout(() => callback(0), 0);

      return id as unknown as number;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    });
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('hover intent', () => {
    it('shows nothing until the delay has passed', () => {
      const { card, link } = build();

      card.show(link);
      vi.advanceTimersByTime(SHOW_DELAY - 1);

      expect(card.anchor).toBeNull();
      expect(wrapperOf()?.inert).toBe(true);

      vi.advanceTimersByTime(1);

      expect(card.anchor).toBe(link);
      expect(wrapperOf()?.inert).toBe(false);
    });

    it('does not restart the timer when the same link is re-queued', () => {
      const { card, link } = build();

      card.show(link);
      vi.advanceTimersByTime(SHOW_DELAY - 50);
      card.show(link);
      vi.advanceTimersByTime(50);

      expect(card.anchor).toBe(link);
    });

    it('re-queues for a different link, dropping the first', () => {
      const { card, link, other } = build();

      card.show(link);
      vi.advanceTimersByTime(SHOW_DELAY - 50);
      card.show(other);
      vi.advanceTimersByTime(SHOW_DELAY);

      expect(card.anchor).toBe(other);
    });

    it('aborts a queued show when the pointer leaves first', () => {
      const { card, link } = build();

      card.show(link);
      card.scheduleHide();
      vi.advanceTimersByTime(SHOW_DELAY * 2);

      expect(card.anchor).toBeNull();
      expect(wrapperOf()?.inert).toBe(true);
    });
  });

  describe('what it shows', () => {
    const shown = (harness: Harness): HTMLElement => {
      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY);

      const wrapper = wrapperOf();

      if (wrapper === null) {
        throw new Error('the card never appeared');
      }

      return wrapper;
    };

    it('shows the href as both the label and the tooltip', () => {
      const harness = build();
      const wrapper = shown(harness);
      const url = wrapper.querySelector('button');

      expect(url?.textContent).toBe('https://example.test/a');
      expect(url?.title).toBe('https://example.test/a');
    });

    it('rises into view on the next frame', () => {
      const harness = build();
      const wrapper = shown(harness);

      expect(wrapper.getAttribute('data-state')).toBe('closed');

      runFrames();

      expect(wrapper.getAttribute('data-state')).toBe('open');
    });

    it('drops the edit affordance in read-only, with display forced past the utility class', () => {
      const harness = build();

      harness.canEdit.mockReturnValue(false);

      const wrapper = shown(harness);
      const edit = wrapper.querySelector<HTMLElement>('button:last-of-type');

      expect(edit?.hidden).toBe(true);
      expect(edit?.style.display).toBe('none');
    });

    it('keeps the edit affordance while editable', () => {
      const harness = build();
      const wrapper = shown(harness);
      const edit = wrapper.querySelector<HTMLElement>('button:last-of-type');

      expect(edit?.hidden).toBe(false);
      expect(edit?.style.display).toBe('');
    });
  });

  describe('leaving', () => {
    const showIt = (harness: Harness): void => {
      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY);
      runFrames();
    };

    it('waits out the grace period before closing', () => {
      const harness = build();

      showIt(harness);
      harness.card.scheduleHide();
      vi.advanceTimersByTime(GRACE_HIDE_DURATION - 1);

      expect(harness.card.anchor).toBe(harness.link);

      vi.advanceTimersByTime(1);

      expect(harness.card.anchor).toBeNull();
    });

    it('stays when the pointer reaches the card in time', () => {
      const harness = build();

      showIt(harness);
      harness.card.scheduleHide();
      vi.advanceTimersByTime(GRACE_HIDE_DURATION - 1);
      harness.card.cancelHide();
      vi.advanceTimersByTime(GRACE_HIDE_DURATION * 2);

      expect(harness.card.anchor).toBe(harness.link);
    });

    it('plays the leave animation before detaching', () => {
      const harness = build();

      showIt(harness);
      harness.card.hide();

      const wrapper = wrapperOf();

      expect(wrapper?.getAttribute('data-state')).toBe('closed');
      expect(wrapper?.isConnected).toBe(true);

      vi.advanceTimersByTime(ANIMATION_DURATION);

      expect(wrapper?.isConnected).toBe(false);
    });

    it('keeps the element when re-shown mid-fade', () => {
      const harness = build();

      showIt(harness);

      const wrapper = wrapperOf();

      harness.card.hide();
      vi.advanceTimersByTime(ANIMATION_DURATION - 50);
      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY + ANIMATION_DURATION);

      expect(wrapper?.isConnected).toBe(true);
      expect(harness.card.anchor).toBe(harness.link);
    });

    it('is inert while hidden and interactive while shown', () => {
      const harness = build();

      showIt(harness);

      const wrapper = wrapperOf();

      expect(wrapper?.inert).toBe(false);

      harness.card.hide();

      expect(wrapper?.inert).toBe(true);
    });

    it('hides only once, however many times it is asked', () => {
      const harness = build();

      showIt(harness);
      const wrapper = wrapperOf();

      harness.card.hide();
      harness.card.hide();
      vi.advanceTimersByTime(ANIMATION_DURATION);

      expect(wrapper?.isConnected).toBe(false);
      expect(harness.card.anchor).toBeNull();
    });
  });

  describe('the three actions', () => {
    const showIt = (harness: Harness): HTMLElement => {
      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY);
      runFrames();

      const wrapper = wrapperOf();

      if (wrapper === null) {
        throw new Error('the card never appeared');
      }

      return wrapper;
    };

    it('opens the destination and closes', () => {
      const harness = build();
      const wrapper = showIt(harness);

      press(wrapper, 'link-hover-card-url');

      expect(harness.onOpen).toHaveBeenCalledWith('https://example.test/a');
      expect(harness.card.anchor).toBeNull();
    });

    it('copies the href and closes', () => {
      const harness = build();
      const wrapper = showIt(harness);

      press(wrapper, 'link-hover-card-copy');

      expect(harness.onCopy).toHaveBeenCalledWith('https://example.test/a');
      expect(harness.card.anchor).toBeNull();
    });

    it('hands the ANCHOR to the editor, not its href', () => {
      const harness = build();
      const wrapper = showIt(harness);

      press(wrapper, 'link-hover-card-edit');

      expect(harness.onEdit).toHaveBeenCalledWith(harness.link);
      expect(harness.card.anchor).toBeNull();
    });

    it('reports the href as authored rather than as resolved', () => {
      const harness = build();

      harness.link.setAttribute('href', '/docs/relative');
      showIt(harness);

      const wrapper = wrapperOf();

      press(wrapper as HTMLElement, 'link-hover-card-copy');

      expect(harness.onCopy).toHaveBeenCalledWith('/docs/relative');
    });

    it('labels the copy button and names the edit one', () => {
      const harness = build();
      const wrapper = showIt(harness);

      expect(wrapper.querySelector('[data-blok-testid="link-hover-card-copy"]')?.getAttribute('aria-label'))
        .toBe('Copy link');
      expect(wrapper.querySelector('[data-blok-testid="link-hover-card-edit"]')?.textContent).toBe('Edit');
    });

    it('stays open while the pointer is over it, and leaves when it goes', () => {
      const harness = build();
      const wrapper = showIt(harness);

      harness.card.scheduleHide();
      wrapper.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(GRACE_HIDE_DURATION * 2);

      expect(harness.card.anchor).toBe(harness.link);

      wrapper.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(GRACE_HIDE_DURATION);

      expect(harness.card.anchor).toBeNull();
    });
  });

  describe('placement', () => {
    const VIEWPORT = { width: 1000, height: 600 };
    const CARD = { width: 200, height: 40 };

    const placeAt = (rect: { top: number; bottom: number; left: number }, cursor?: { x: number; y: number }) => {
      const harness = build();

      vi.spyOn(harness.link, 'getBoundingClientRect').mockReturnValue({
        ...rect,
        right: rect.left + 50,
        width: 50,
        height: rect.bottom - rect.top,
        x: rect.left,
        y: rect.top,
        toJSON: () => rect,
      });

      const wrapper = wrapperOf();

      if (wrapper === null) {
        throw new Error('no wrapper');
      }

      Object.defineProperty(wrapper, 'offsetWidth', { value: CARD.width, configurable: true });
      Object.defineProperty(wrapper, 'offsetHeight', { value: CARD.height, configurable: true });
      Object.defineProperty(window, 'innerWidth', { value: VIEWPORT.width, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: VIEWPORT.height, configurable: true });

      harness.card.show(harness.link, cursor);
      vi.advanceTimersByTime(SHOW_DELAY);

      return { top: parseFloat(wrapper.style.top), left: parseFloat(wrapper.style.left) };
    };

    it('sits below the link, at the anchor gap, when no cursor is given', () => {
      expect(placeAt({ top: 100, bottom: 120, left: 300 })).toStrictEqual({ top: 126, left: 300 });
    });

    it('sits below the link at the wider cursor gap, centred on the pointer', () => {
      expect(placeAt({ top: 100, bottom: 120, left: 300 }, { x: 400, y: 110 }))
        .toStrictEqual({ top: 130, left: 300 });
    });

    it('flips above the link when it would spill past the bottom', () => {
      expect(placeAt({ top: 540, bottom: 560, left: 300 })).toStrictEqual({ top: 494, left: 300 });
    });

    it('never sits closer than the margin to the top edge', () => {
      expect(placeAt({ top: 0, bottom: 4, left: 300 }, { x: 400, y: 2 }).top).toBe(14);
    });

    it('shifts right rather than hanging off the left edge', () => {
      expect(placeAt({ top: 100, bottom: 120, left: 0 }, { x: 10, y: 110 }).left).toBe(4);
    });

    it('shifts left rather than hanging off the right edge', () => {
      expect(placeAt({ top: 100, bottom: 120, left: 980 }, { x: 995, y: 110 }).left).toBe(796);
    });
  });

  describe('while hidden', () => {
    it('keeps the card mounted and closed when it hides before ever showing', () => {
      const harness = build();
      const wrapper = wrapperOf();

      harness.card.hide();
      vi.advanceTimersByTime(ANIMATION_DURATION * 2);

      expect(wrapper?.isConnected).toBe(true);
      expect(wrapper?.getAttribute('data-state')).toBe('closed');
      expect(wrapper?.inert).toBe(true);
      expect(harness.card.anchor).toBeNull();
    });

    it('reports nothing and throws nothing when a button is clicked with no anchor', () => {
      const harness = build();
      const wrapper = wrapperOf();

      if (wrapper === null) {
        throw new Error('the card is mounted by the constructor');
      }

      const errors = withErrorRecorder(() => {
        press(wrapper, 'link-hover-card-url');
        press(wrapper, 'link-hover-card-copy');
        press(wrapper, 'link-hover-card-edit');
      });

      expect(harness.onOpen).not.toHaveBeenCalled();
      expect(harness.onCopy).not.toHaveBeenCalled();
      expect(harness.onEdit).not.toHaveBeenCalled();
      expect(errors).toStrictEqual([]);
    });
  });

  describe('the timer each show arms', () => {
    const showIt = (harness: Harness): HTMLElement => {
      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY);
      runFrames();

      const wrapper = wrapperOf();

      if (wrapper === null) {
        throw new Error('the card never appeared');
      }

      return wrapper;
    };

    it('does not arm a second entrance frame for an anchor already on screen', () => {
      const harness = build();

      showIt(harness);

      const frames = vi.mocked(globalThis.requestAnimationFrame).mock.calls.length;

      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY);

      expect(vi.mocked(globalThis.requestAnimationFrame).mock.calls.length).toBe(frames);
      expect(harness.card.anchor).toBe(harness.link);
    });

    it('cancels the armed hide when the pointer moves onto another link', () => {
      const harness = build();

      showIt(harness);
      harness.card.scheduleHide();
      harness.card.show(harness.other);
      vi.advanceTimersByTime(SHOW_DELAY);

      expect(harness.card.anchor).toBe(harness.other);
    });

    it('drops the timer of a link that was re-queued for another link', () => {
      const harness = build();

      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY - 50);
      harness.card.show(harness.other);
      vi.advanceTimersByTime(50);

      expect(harness.card.anchor).toBeNull();

      vi.advanceTimersByTime(SHOW_DELAY);

      expect(harness.card.anchor).toBe(harness.other);
    });

    it('cancels the armed hide when a queued show fires in the same tick', () => {
      const harness = build();

      showIt(harness);
      harness.card.show(harness.other);
      vi.advanceTimersByTime(100);
      harness.card.scheduleHide();
      vi.advanceTimersByTime(GRACE_HIDE_DURATION);

      expect(harness.card.anchor).toBe(harness.other);
    });

    it('leaves the queued show alone when the pointer comes back to the card', () => {
      const harness = build();
      const wrapper = wrapperOf();

      harness.card.show(harness.link);
      harness.card.scheduleHide();
      vi.advanceTimersByTime(100);
      wrapper?.dispatchEvent(new MouseEvent('mouseenter'));
      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY - 50);

      expect(harness.card.anchor).toBeNull();
    });

    it('keeps the first hide armed when the pointer leaves twice', () => {
      const harness = build();

      showIt(harness);
      harness.card.scheduleHide();
      vi.advanceTimersByTime(100);
      harness.card.scheduleHide();
      vi.advanceTimersByTime(GRACE_HIDE_DURATION - 50);

      expect(harness.card.anchor).toBe(harness.link);

      vi.advanceTimersByTime(50);

      expect(harness.card.anchor).toBeNull();
    });

    it('drops a queued show that was hidden before it fired', () => {
      const harness = build();
      const wrapper = wrapperOf();

      showIt(harness);
      harness.card.show(harness.other);
      harness.card.hide();
      vi.advanceTimersByTime(ANIMATION_DURATION + SHOW_DELAY);

      expect(harness.card.anchor).toBeNull();
      expect(wrapper?.isConnected).toBe(false);
    });

    it('leaves a hidden card closed when its entrance frame lands late', () => {
      deferFrames(400);

      const harness = build();

      showIt(harness);

      const wrapper = wrapperOf();

      harness.card.hide();
      vi.advanceTimersByTime(500);

      expect(wrapper?.getAttribute('data-state')).toBe('closed');
    });

    it('drops the entrance frame of a superseded show', () => {
      deferFrames(400);

      const harness = build();

      showIt(harness);
      harness.card.show(harness.other);
      vi.advanceTimersByTime(SHOW_DELAY);
      vi.advanceTimersByTime(100);

      expect(wrapperOf()?.getAttribute('data-state')).toBe('closed');
    });

    it('removes the card after exactly one hide, however many follow', () => {
      const harness = build();
      const wrapper = wrapperOf();

      showIt(harness);
      harness.card.hide();
      vi.advanceTimersByTime(100);
      harness.card.hide();
      vi.advanceTimersByTime(ANIMATION_DURATION - 100);

      expect(wrapper?.isConnected).toBe(false);
    });
  });

  describe('chrome', () => {
    const ACTION_BUTTON_BASE = [
      'appearance-none border-0 bg-transparent m-0 p-0 box-border font-[inherit] cursor-pointer',
      'inline-flex items-center justify-center h-5 rounded select-none',
      'text-gray-text transition-colors',
      'can-hover:hover:bg-item-hover-bg can-hover:hover:text-text-primary',
    ].join(' ');

    const shown = (): HTMLElement => {
      const harness = build();

      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY);

      const wrapper = wrapperOf();

      if (wrapper === null) {
        throw new Error('the card never appeared');
      }

      return wrapper;
    };

    /** Serializes an icon string the way the DOM does, so the two are comparable. */
    const asDomHtml = (svg: string): string => {
      const host = document.createElement('div');

      host.innerHTML = svg;

      return host.innerHTML;
    };

    it('carries the exact wrapper chrome', () => {
      const wrapper = shown();

      expect(wrapper.className).toBe([
        'fixed z-overlay top-0 left-0',
        'flex items-center',
        'bg-popover-bg rounded-lg',
        'shadow-[0_1px_2px_rgba(13,20,33,0.04),0_8px_22px_-8px_rgba(13,20,33,0.12)]',
        'text-sm leading-none text-text-primary',
        'opacity-0 -translate-y-px transition-[opacity,transform] duration-150 ease-out',
        'data-[state=open]:opacity-100 data-[state=open]:translate-y-0',
        'mobile:hidden',
      ].join(' '));
      expect(wrapper.style.borderWidth).toBe('1px');
      expect(wrapper.style.borderStyle).toBe('solid');
      expect(wrapper.style.borderColor).toBe('var(--blok-popover-border, rgba(13, 20, 33, 0.12))');
      expect(wrapper.style.paddingTop).toBe('0.25rem');
      expect(wrapper.style.paddingBottom).toBe('0.25rem');
      expect(wrapper.style.paddingLeft).toBe('0.625rem');
      expect(wrapper.style.paddingRight).toBe('0.375rem');
      expect(wrapper.getAttribute('data-blok-testid')).toBe('link-hover-card');
      expect(wrapper.getAttribute('data-blok-interface')).toBe('link-hover-card');
    });

    it('carries the exact globe, url and action-button chrome', () => {
      const wrapper = shown();
      const globe = wrapper.querySelector('span');
      const url = wrapper.querySelector<HTMLButtonElement>('[data-blok-testid="link-hover-card-url"]');
      const copy = wrapper.querySelector<HTMLButtonElement>('[data-blok-testid="link-hover-card-copy"]');
      const edit = wrapper.querySelector<HTMLButtonElement>('[data-blok-testid="link-hover-card-edit"]');

      expect(globe?.className).toBe('shrink-0 flex items-center mr-2 text-gray-text [&>svg]:size-4');
      expect(globe?.innerHTML).toBe(asDomHtml(IconGlobe));
      expect(url?.type).toBe('button');
      expect(url?.className).toBe([
        'appearance-none border-0 bg-transparent m-0 p-0 font-[inherit] cursor-pointer',
        'min-w-0 max-w-[280px] truncate text-left text-gray-text',
        'underline-offset-2 can-hover:hover:underline can-hover:hover:text-text-primary',
      ].join(' '));
      expect(copy?.type).toBe('button');
      expect(copy?.className).toBe(`${ACTION_BUTTON_BASE} ml-2 w-5 [&>svg]:size-4`);
      expect(copy?.innerHTML).toBe(asDomHtml(IconCopy));
      expect(edit?.type).toBe('button');
      expect(edit?.className).toBe(`${ACTION_BUTTON_BASE} ml-1 px-1`);
      expect(edit?.textContent).toBe('Edit');
    });

    it('surfaces the href as authored, not as the browser resolves it', () => {
      const harness = build();

      harness.link.setAttribute('href', '/docs/relative');

      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY);

      const url = wrapperOf()?.querySelector<HTMLButtonElement>('[data-blok-testid="link-hover-card-url"]');

      expect(url?.textContent).toBe('/docs/relative');
      expect(url?.title).toBe('/docs/relative');
    });

    it('enters the top layer while shown and leaves it on destroy', () => {
      const harness = build();

      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY);

      const wrapper = wrapperOf();

      expect(wrapper?.getAttribute('data-blok-top-layer')).toBe('true');

      harness.card.destroy();

      expect(wrapper?.getAttribute('data-blok-top-layer')).toBeNull();
    });

    it('does not re-mount a card that is already in the document', () => {
      const harness = build();
      // Appended after the card, so a re-mount is visible as a re-order rather
      // than as "already last". Re-appending a connected element detaches and
      // re-inserts it, which in a browser with the Popover API closes the
      // promoted card.
      const marker = document.createElement('div');

      document.body.appendChild(marker);

      const order = Array.from(document.body.children);

      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY);

      expect(Array.from(document.body.children)).toStrictEqual(order);
      expect(harness.card.anchor).toBe(harness.link);

      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY);

      expect(Array.from(document.body.children)).toStrictEqual(order);
    });
  });

  describe('placement edges', () => {
    const VIEWPORT = { width: 1000, height: 600 };
    const CARD = { width: 200, height: 40 };

    const placeAt = (rect: { top: number; bottom: number; left: number }, cursor?: { x: number; y: number }) => {
      const harness = build();

      vi.spyOn(harness.link, 'getBoundingClientRect').mockReturnValue({
        ...rect,
        right: rect.left + 50,
        width: 50,
        height: rect.bottom - rect.top,
        x: rect.left,
        y: rect.top,
        toJSON: () => rect,
      });

      const wrapper = wrapperOf();

      if (wrapper === null) {
        throw new Error('no wrapper');
      }

      Object.defineProperty(wrapper, 'offsetWidth', { value: CARD.width, configurable: true });
      Object.defineProperty(wrapper, 'offsetHeight', { value: CARD.height, configurable: true });
      Object.defineProperty(window, 'innerWidth', { value: VIEWPORT.width, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: VIEWPORT.height, configurable: true });

      harness.card.show(harness.link, cursor);
      vi.advanceTimersByTime(SHOW_DELAY);

      return { top: parseFloat(wrapper.style.top), left: parseFloat(wrapper.style.left) };
    };

    it('stays below when the card exactly reaches the bottom margin', () => {
      expect(placeAt({ top: 530, bottom: 550, left: 300 })).toStrictEqual({ top: 556, left: 300 });
    });

    it('flips above once the card is one pixel past the bottom margin', () => {
      expect(placeAt({ top: 534, bottom: 554, left: 300 })).toStrictEqual({ top: 488, left: 300 });
    });

    it('clamps a flipped card to the deepest position that keeps the bottom margin', () => {
      expect(placeAt({ top: 700, bottom: 720, left: 300 })).toStrictEqual({ top: 556, left: 300 });
    });

    it('shifts left when the anchor hangs past the right edge without a cursor', () => {
      expect(placeAt({ top: 100, bottom: 120, left: 800 })).toStrictEqual({ top: 126, left: 796 });
    });
  });

  describe('destroy', () => {
    it('detaches at once and cancels every pending timer', () => {
      const harness = build();

      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY);
      harness.card.scheduleHide();
      const wrapper = wrapperOf();

      harness.card.destroy();

      expect(wrapper?.isConnected).toBe(false);
      expect(harness.card.anchor).toBeNull();

      expect(() => vi.advanceTimersByTime(SHOW_DELAY + GRACE_HIDE_DURATION + ANIMATION_DURATION)).not.toThrow();
      expect(wrapper?.isConnected).toBe(false);
    });
  });

  describe('destroy drops what is queued', () => {
    it('cancels a queued show so the card cannot come back', () => {
      const harness = build();

      harness.card.show(harness.link);
      harness.card.destroy();
      vi.advanceTimersByTime(SHOW_DELAY * 2);

      expect(wrapperOf()).toBeNull();
      expect(harness.card.anchor).toBeNull();
    });

    it('cancels a pending entrance frame', () => {
      deferFrames(400);

      const harness = build();

      harness.card.show(harness.link);
      vi.advanceTimersByTime(SHOW_DELAY);

      const wrapper = wrapperOf();

      harness.card.destroy();
      vi.advanceTimersByTime(500);

      expect(wrapper?.getAttribute('data-state')).toBe('closed');
    });
  });
});
