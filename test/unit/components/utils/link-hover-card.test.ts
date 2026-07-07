import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkHoverCard } from '../../../../src/components/utils/link-hover-card';

const CARD_SELECTOR = '[data-blok-testid="link-hover-card"]';

const createAnchor = (href: string): HTMLAnchorElement => {
  const anchor = document.createElement('a');

  anchor.href = href;
  anchor.textContent = 'link text';
  anchor.getBoundingClientRect = vi.fn(() => ({
    left: 10,
    right: 110,
    top: 20,
    bottom: 40,
    width: 100,
    height: 20,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  })) as unknown as HTMLElement['getBoundingClientRect'];

  document.body.appendChild(anchor);

  return anchor;
};

const getCard = (): HTMLElement | null => document.querySelector(CARD_SELECTOR);

describe('LinkHoverCard', () => {
  let card: LinkHoverCard;
  let onCopy: ReturnType<typeof vi.fn>;
  let onEdit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    onCopy = vi.fn();
    onEdit = vi.fn();
    card = new LinkHoverCard({
      labels: { copy: 'Copy', edit: 'Edit' },
      callbacks: { onCopy, onEdit },
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

    card.show(anchor);

    const shown = getCard();

    expect(shown).not.toBeNull();
    expect(shown?.textContent).toContain('https://youtube.com/');
  });

  it('copies the href when the copy button is clicked', () => {
    const anchor = createAnchor('https://youtube.com/');

    card.show(anchor);
    getCard()
      ?.querySelector<HTMLElement>('[data-blok-testid="link-hover-card-copy"]')
      ?.click();

    expect(onCopy).toHaveBeenCalledWith('https://youtube.com/');
  });

  it('invokes onEdit with the anchor when the edit button is clicked', () => {
    const anchor = createAnchor('https://youtube.com/');

    card.show(anchor);
    getCard()
      ?.querySelector<HTMLElement>('[data-blok-testid="link-hover-card-edit"]')
      ?.click();

    expect(onEdit).toHaveBeenCalledWith(anchor);
  });

  it('hides the edit button when editing is not allowed', () => {
    card.destroy();
    card = new LinkHoverCard({
      labels: { copy: 'Copy', edit: 'Edit' },
      callbacks: { onCopy, onEdit },
      canEdit: () => false,
    });

    const anchor = createAnchor('https://youtube.com/');

    card.show(anchor);

    const editButton = getCard()?.querySelector<HTMLElement>('[data-blok-testid="link-hover-card-edit"]');

    expect(editButton?.hidden).toBe(true);
  });

  it('keeps the card open when the pointer moves onto it', () => {
    const anchor = createAnchor('https://youtube.com/');

    card.show(anchor);
    card.scheduleHide();
    // Pointer reaches the card before the grace timer fires.
    getCard()?.dispatchEvent(new Event('mouseenter'));
    vi.runAllTimers();

    expect(getCard()).not.toBeNull();
  });

  it('hides after the grace period once the pointer leaves', () => {
    const anchor = createAnchor('https://youtube.com/');

    card.show(anchor);
    card.scheduleHide();
    vi.runAllTimers();

    expect(getCard()).toBeNull();
  });

  it('removes the card element on destroy', () => {
    const anchor = createAnchor('https://youtube.com/');

    card.show(anchor);
    card.destroy();

    expect(getCard()).toBeNull();
  });
});
