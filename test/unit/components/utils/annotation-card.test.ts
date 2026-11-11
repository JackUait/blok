import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnotationCard } from '../../../../src/components/utils/annotation-card';

const CARD = '[data-blok-testid="annotation-card"]';
const TEXT = '[data-blok-testid="annotation-card-text"]';
const SUBTITLE = '[data-blok-testid="annotation-card-subtitle"]';

const rect = (top: number, bottom: number, left = 100, right = 200): DOMRect => ({
  left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}),
});

const createAnchor = (text: string, subtitle?: string, top = 300): HTMLElement => {
  const anchor = document.createElement('span');

  anchor.setAttribute('data-blok-annotation', text);
  if (subtitle !== undefined) {
    anchor.setAttribute('data-blok-annotation-subtitle', subtitle);
  }
  anchor.textContent = 'phrase';
  anchor.getClientRects = vi.fn(() => [ rect(top, top + 20) ] as unknown as DOMRectList);
  document.body.appendChild(anchor);

  return anchor;
};

const getCard = (): HTMLElement | null => document.querySelector(CARD);
const isOpen = (): boolean => getCard()?.getAttribute('data-state') === 'open';
const press = (target: EventTarget): void => {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
};

describe('AnnotationCard', () => {
  let card: AnnotationCard;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    card = new AnnotationCard({ label: 'Hint' });
  });

  afterEach(() => {
    card.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('hover', () => {
    it('waits the full hint delay before showing', () => {
      const anchor = createAnchor('A quote');

      card.show(anchor);
      vi.advanceTimersByTime(499);

      expect(card.anchor).toBeNull();

      vi.advanceTimersByTime(1);

      expect(card.anchor).toBe(anchor);
      expect(getCard()?.querySelector(TEXT)?.textContent).toBe('A quote');
    });

    it('shows the subtitle under the text', () => {
      card.show(createAnchor('A quote', 'Anna, manager'));
      vi.advanceTimersByTime(500);

      const subtitle = getCard()?.querySelector<HTMLElement>(SUBTITLE);

      expect(subtitle?.textContent).toBe('Anna, manager');
      expect(subtitle?.hidden).toBe(false);
    });

    it('hides the subtitle line when the hint has none', () => {
      card.show(createAnchor('A quote'));
      vi.advanceTimersByTime(500);

      expect(getCard()?.querySelector<HTMLElement>(SUBTITLE)?.hidden).toBe(true);
    });

    it('does not carry a subtitle over from the previous hint', () => {
      card.pin(createAnchor('First', 'Anna'));
      card.pin(createAnchor('Second'));

      expect(getCard()?.querySelector(TEXT)?.textContent).toBe('Second');
      expect(getCard()?.querySelector<HTMLElement>(SUBTITLE)?.hidden).toBe(true);
    });

    it('never shows when the pointer leaves before the delay', () => {
      const anchor = createAnchor('A quote');

      card.show(anchor);
      vi.advanceTimersByTime(300);
      card.scheduleHide();
      vi.advanceTimersByTime(1000);

      expect(card.anchor).toBeNull();
      expect(isOpen()).toBe(false);
    });

    it('hides after the grace period once the pointer leaves', () => {
      card.show(createAnchor('A quote'));
      vi.advanceTimersByTime(500);
      card.scheduleHide();
      vi.advanceTimersByTime(249);

      expect(card.anchor).not.toBeNull();

      vi.advanceTimersByTime(1);

      expect(card.anchor).toBeNull();

      vi.advanceTimersByTime(150);

      expect(getCard()).toBeNull();
    });

    it('stays open while the pointer is over the card', () => {
      const anchor = createAnchor('A quote');

      card.show(anchor);
      vi.advanceTimersByTime(500);
      card.scheduleHide();
      getCard()?.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(1000);

      expect(card.anchor).toBe(anchor);

      getCard()?.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(250);

      expect(card.anchor).toBeNull();
    });

    it('does not show a hint with an empty text', () => {
      card.show(createAnchor(''));
      vi.advanceTimersByTime(500);

      expect(card.anchor).toBeNull();
    });
  });

  describe('pinned', () => {
    it('shows at once and ignores the pointer leaving', () => {
      const anchor = createAnchor('A quote');

      card.pin(anchor);

      expect(card.anchor).toBe(anchor);
      expect(card.pinned).toBe(true);

      card.scheduleHide();
      vi.advanceTimersByTime(1000);

      expect(card.anchor).toBe(anchor);
    });

    it('pins a card that hover already opened', () => {
      const anchor = createAnchor('A quote');

      card.show(anchor);
      vi.advanceTimersByTime(500);
      card.toggle(anchor);
      card.scheduleHide();
      vi.advanceTimersByTime(1000);

      expect(card.anchor).toBe(anchor);
      expect(card.pinned).toBe(true);
    });

    it('closes on a second toggle of the same phrase', () => {
      const anchor = createAnchor('A quote');

      card.toggle(anchor);
      card.toggle(anchor);

      expect(card.anchor).toBeNull();
      expect(card.pinned).toBe(false);
    });

    it('closes on Escape', () => {
      card.pin(createAnchor('A quote'));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(card.anchor).toBeNull();
    });

    it('closes on a press outside the card and the phrase', () => {
      card.pin(createAnchor('A quote'));
      press(document.body);

      expect(card.anchor).toBeNull();
    });

    it('stays open on a press inside the card or on the phrase', () => {
      const anchor = createAnchor('A quote');

      card.pin(anchor);
      press(getCard() as HTMLElement);
      press(anchor);

      expect(card.anchor).toBe(anchor);
    });

    it('stops listening for Escape and outside presses once closed', () => {
      const remove = vi.spyOn(document, 'removeEventListener');

      card.pin(createAnchor('A quote'));
      card.hide();

      expect(remove.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([ 'keydown', 'pointerdown' ]));
    });
  });

  describe('card', () => {
    it('shows markup in the text as plain characters', () => {
      card.pin(createAnchor('<b>bold</b> & "quoted"'));

      const text = getCard()?.querySelector(TEXT);

      expect(text?.textContent).toBe('<b>bold</b> & "quoted"');
      expect(text?.querySelector('b')).toBeNull();
    });

    it('is a named note scoped for Blok styles', () => {
      card.pin(createAnchor('A quote'));

      expect(getCard()?.getAttribute('role')).toBe('note');
      expect(getCard()?.getAttribute('aria-label')).toBe('Hint');
      expect(getCard()?.getAttribute('data-blok-interface')).toBe('annotation-card');
    });

    it('sits above the phrase with an 8px gap', () => {
      card.pin(createAnchor('A quote', undefined, 300));

      expect(getCard()?.style.top).toBe('292px');
    });

    it('drops below the phrase when there is no room above', () => {
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(120);
      card.pin(createAnchor('A quote', undefined, 40));

      expect(getCard()?.style.top).toBe('68px');
    });

    it('centres on the phrase and stays inside the viewport', () => {
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(340);
      card.pin(createAnchor('A quote'));

      // Phrase centre is x=150; a 340px card would start at -20, so it clamps to the margin.
      expect(getCard()?.style.left).toBe('4px');
    });

    it('removes itself on destroy', () => {
      card.pin(createAnchor('A quote'));
      card.destroy();

      expect(getCard()).toBeNull();
      expect(card.anchor).toBeNull();
    });
  });
});
