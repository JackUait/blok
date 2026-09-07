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
