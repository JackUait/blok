import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { LinkHoverCard } from '../../../../src/components/utils/link-hover-card';

const CARD_SELECTOR = '[data-blok-testid="link-hover-card"]';

const makeRect = (top: number, bottom: number, left = 10, right = 110): DOMRect => ({
  left,
  right,
  top,
  bottom,
  width: right - left,
  height: bottom - top,
  x: left,
  y: top,
  toJSON: () => ({}),
});

const createAnchor = (href: string): HTMLAnchorElement => {
  const anchor = document.createElement('a');

  anchor.href = href;
  anchor.textContent = 'link text';
  anchor.getBoundingClientRect = vi.fn(() => makeRect(20, 40));

  document.body.appendChild(anchor);

  return anchor;
};

const getCard = (): HTMLElement | null => document.querySelector(CARD_SELECTOR);

/**
 * Queue the card for an anchor and advance past the hover-intent show delay so
 * it is actually rendered (the card appears after a short delay, not instantly).
 */
const showCard = (card: LinkHoverCard, anchor: HTMLAnchorElement): void => {
  card.show(anchor);
  vi.advanceTimersByTime(350);
};

describe('LinkHoverCard', () => {
  let card: LinkHoverCard;
  let onOpen: Mock<(href: string) => void>;
  let onCopy: Mock<(href: string) => void>;
  let onEdit: Mock<(anchor: HTMLAnchorElement) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    onOpen = vi.fn<(href: string) => void>();
    onCopy = vi.fn<(href: string) => void>();
    onEdit = vi.fn<(anchor: HTMLAnchorElement) => void>();
    card = new LinkHoverCard({
      labels: { copy: 'Copy', edit: 'Edit' },
      callbacks: { onOpen, onCopy, onEdit },
      canEdit: () => true,
    });
  });

  afterEach(() => {
    card.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows the anchor href in the card', () => {
    const anchor = createAnchor('https://youtube.com/');

    showCard(card, anchor);

    const shown = getCard();

    expect(shown).not.toBeNull();
    expect(shown?.textContent).toContain('https://youtube.com/');
  });

  it('does not render the card content until the hover-intent delay elapses', () => {
    const anchor = createAnchor('https://youtube.com/');

    card.show(anchor);

    expect(card.anchor).toBeNull();

    vi.advanceTimersByTime(350);

    expect(card.anchor).toBe(anchor);
    expect(getCard()?.textContent).toContain('https://youtube.com/');
  });

  it('cancels a queued show when the pointer leaves before the delay', () => {
    const anchor = createAnchor('https://youtube.com/');

    card.show(anchor);
    card.scheduleHide();
    vi.runAllTimers();

    expect(card.anchor).toBeNull();
  });

  it('opens the href when the URL is clicked', () => {
    const anchor = createAnchor('https://youtube.com/');

    showCard(card, anchor);
    getCard()
      ?.querySelector<HTMLElement>('[data-blok-testid="link-hover-card-url"]')
      ?.click();

    expect(onOpen).toHaveBeenCalledWith('https://youtube.com/');
  });

  it('copies the href when the copy button is clicked', () => {
    const anchor = createAnchor('https://youtube.com/');

    showCard(card, anchor);
    getCard()
      ?.querySelector<HTMLElement>('[data-blok-testid="link-hover-card-copy"]')
      ?.click();

    expect(onCopy).toHaveBeenCalledWith('https://youtube.com/');
  });

  it('invokes onEdit with the anchor when the edit button is clicked', () => {
    const anchor = createAnchor('https://youtube.com/');

    showCard(card, anchor);
    getCard()
      ?.querySelector<HTMLElement>('[data-blok-testid="link-hover-card-edit"]')
      ?.click();

    expect(onEdit).toHaveBeenCalledWith(anchor);
  });

  it('hides the edit button when editing is not allowed', () => {
    card.destroy();
    card = new LinkHoverCard({
      labels: { copy: 'Copy', edit: 'Edit' },
      callbacks: { onOpen, onCopy, onEdit },
      canEdit: () => false,
    });

    const anchor = createAnchor('https://youtube.com/');

    showCard(card, anchor);

    const editButton = getCard()?.querySelector<HTMLElement>('[data-blok-testid="link-hover-card-edit"]');

    expect(editButton?.hidden).toBe(true);
  });

  it('keeps the card open when the pointer moves onto it', () => {
    const anchor = createAnchor('https://youtube.com/');

    showCard(card, anchor);
    card.scheduleHide();
    // Pointer reaches the card before the grace timer fires.
    getCard()?.dispatchEvent(new Event('mouseenter'));
    vi.runAllTimers();

    expect(getCard()).not.toBeNull();
  });

  it('hides after the grace period once the pointer leaves', () => {
    const anchor = createAnchor('https://youtube.com/');

    showCard(card, anchor);
    card.scheduleHide();
    vi.runAllTimers();

    expect(getCard()).toBeNull();
  });

  /**
   * The card lives on document.body, outside the editor root. Compiled
   * Tailwind utilities and the preflight reset are scoped to
   * `[data-blok-interface]`/`[data-blok-popover]` roots, so without a bare
   * scope attribute the card renders unstyled in consumer apps (the
   * playground's own Tailwind masks this). See body-mount-scope-law.test.ts.
   * It must be `data-blok-interface` specifically: `data-blok-popover` drags
   * in the Popover COMPONENT's isolation rules (`font-size: initial`,
   * `background: transparent` when [popover]-promoted), which clobber the
   * card's own root-level utilities.
   */
  it('carries the data-blok-interface scope attribute so scoped utilities apply outside the editor', () => {
    expect(getCard()?.matches('[data-blok-interface]')).toBe(true);
    expect(getCard()?.matches('[data-blok-popover]')).toBe(false);
  });

  it('removes the card element on destroy', () => {
    const anchor = createAnchor('https://youtube.com/');

    card.show(anchor);
    card.destroy();

    expect(getCard()).toBeNull();
  });

  it('follows its anchor when a nested scroll container scrolls', () => {
    const scrollContainer = document.createElement('div');
    const anchor = createAnchor('https://youtube.com/');

    scrollContainer.appendChild(anchor);
    document.body.appendChild(scrollContainer);
    showCard(card, anchor);

    expect(getCard()?.style.top).toBe('46px');

    vi.mocked(anchor.getBoundingClientRect).mockReturnValue(makeRect(60, 80));
    scrollContainer.dispatchEvent(new Event('scroll'));

    expect(getCard()?.style.top).toBe('86px');
  });

  describe('cursor-relative positioning', () => {
    let originalOffsetWidth: PropertyDescriptor | undefined;
    let originalOffsetHeight: PropertyDescriptor | undefined;
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;

    beforeEach(() => {
      originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
      originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 200 });
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 40 });
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1000 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 });
    });

    afterEach(() => {
      if (originalOffsetWidth) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
      }
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
      }
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalInnerWidth });
      Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: originalInnerHeight });
    });

    it('centers the card horizontally under the cursor when there is room', () => {
      const anchor = createAnchor('https://youtube.com/');

      card.show(anchor, { x: 500, y: 100 });
      vi.advanceTimersByTime(350);

      const shown = getCard();

      // centered on the cursor: x - width / 2 = 500 - 100
      expect(shown?.style.left).toBe('400px');
      // below the link with a fixed gap: anchor.bottom (40) + gap (10)
      expect(shown?.style.top).toBe('50px');
    });

    it('shifts the card left so it stays on screen near the right edge', () => {
      const anchor = createAnchor('https://youtube.com/');

      // centered would be 950 - 100 = 850, overflowing the right edge; clamped
      // to innerWidth - width - margin = 1000 - 200 - 4 = 796.
      card.show(anchor, { x: 950, y: 100 });
      vi.advanceTimersByTime(350);

      const shown = getCard();

      expect(shown?.style.left).toBe('796px');
    });

    it('shifts the card right so it stays on screen near the left edge', () => {
      const anchor = createAnchor('https://youtube.com/');

      // centered would be 20 - 100 = -80, off the left edge; clamped to margin.
      card.show(anchor, { x: 20, y: 100 });
      vi.advanceTimersByTime(350);

      const shown = getCard();

      expect(shown?.style.left).toBe('4px');
    });

    it('flips anchor-relative placement above when below would overflow', () => {
      const anchor = createAnchor('https://youtube.com/');

      vi.mocked(anchor.getBoundingClientRect).mockReturnValue(makeRect(770, 790));
      showCard(card, anchor);

      // anchor.top - fallback gap - card height = 770 - 6 - 40
      expect(getCard()?.style.top).toBe('724px');
    });
  });
});
