import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

    const press = (wrapper: HTMLElement, testid: string): void => {
      wrapper.querySelector<HTMLElement>(`[data-blok-testid="${testid}"]`)?.click();
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
});
