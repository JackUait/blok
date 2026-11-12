import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    it('waits the shortest hint delay before showing, and no longer', () => {
      const anchor = createAnchor('A quote');

      card.show(anchor);
      vi.advanceTimersByTime(299);

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

    it('sits below the phrase with an 11px gap for the stem', () => {
      card.pin(createAnchor('A quote', undefined, 300));

      expect(getCard()?.style.top).toBe('331px');
      expect(getCard()?.getAttribute('data-side')).toBe('bottom');
    });

    it('rises above the phrase when there is no room below', () => {
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(120);
      card.pin(createAnchor('A quote', undefined, window.innerHeight - 60));

      expect(getCard()?.style.top).toBe(`${window.innerHeight - 60 - 11 - 120}px`);
      expect(getCard()?.getAttribute('data-side')).toBe('top');
    });

    it('points its stem at the centre of the phrase', () => {
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(340);
      card.pin(createAnchor('A quote'));

      // The card is clamped to left=4, so the phrase centre (x=150) is 146px into it.
      expect(getCard()?.style.getPropertyValue('--blok-annotation-stem-x')).toBe('146px');
    });

    it('draws a stem between the phrase and the card', () => {
      card.pin(createAnchor('A quote'));

      expect(getCard()?.querySelector('[data-blok-testid="annotation-card-stem"]')).not.toBeNull();
    });

    it('keeps the phrase lit while its card is open', () => {
      const highlights = new Map<string, unknown>();

      vi.stubGlobal('CSS', { highlights });
      vi.stubGlobal('Highlight', class {
        public readonly ranges: Range[];

        constructor(...ranges: Range[]) {
          this.ranges = ranges;
        }
      });

      const anchor = createAnchor('A quote');

      card.pin(anchor);
      expect(highlights.has('blok-annotation-open')).toBe(true);

      card.hide();
      expect(highlights.has('blok-annotation-open')).toBe(false);

      vi.unstubAllGlobals();
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

  describe('stem', () => {
    const STEM = '[data-blok-testid="annotation-card-stem"]';
    const rise = (): string | undefined => getCard()?.style.getPropertyValue('--blok-annotation-stem-rise');
    /** Pretend the browser can measure fonts, and that this one hangs `descent` px under the baseline. */
    const measureFonts = (descent: number): void => {
      vi.stubGlobal('CanvasRenderingContext2D', class {});
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        { font: '', measureText: () => ({ fontBoundingBoxDescent: descent }) } as unknown as CanvasRenderingContext2D
      );
    };

    afterEach(() => vi.unstubAllGlobals());

    it('reaches up to the underline, which sits 2px under the baseline', () => {
      measureFonts(5);
      card.pin(createAnchor('A quote'));

      expect(rise()).toBe('3px');
      expect(getCard()?.querySelector(STEM)?.className).toContain('--blok-annotation-stem-rise');
    });

    it('never starts below the phrase when the font barely hangs under the baseline', () => {
      measureFonts(1);
      card.pin(createAnchor('A quote'));

      expect(rise()).toBe('0px');
    });

    it('starts at the top of the phrase when the card sits above it', () => {
      measureFonts(5);
      vi.stubGlobal('innerHeight', 320);
      card.pin(createAnchor('A quote', undefined, 300));

      expect(getCard()?.getAttribute('data-side')).toBe('top');
      expect(rise()).toBe('0px');
    });

    it('starts at the bottom of the phrase where fonts cannot be measured', () => {
      card.pin(createAnchor('A quote'));

      expect(rise()).toBe('0px');
    });
  });

  describe('entrance timing', () => {
    /** Open-state duration and delay, in ms, read from an element's classes. */
    const openTiming = (el: Element | null | undefined): { duration: number; delay: number } => {
      const read = (name: string): number =>
        Number(new RegExp(`group-data-\\[state=open\\]:${name}-\\[(\\d+)ms\\]`).exec(el?.className ?? '')?.[1] ?? 0);

      return { duration: read('duration'), delay: read('delay') };
    };
    const parts = (): Record<'stem' | 'surface' | 'words', { duration: number; delay: number }> => {
      card.pin(createAnchor('A quote'));
      const words = getCard()?.querySelector(TEXT)?.parentElement;
      const stem = getCard()?.querySelector('[data-blok-testid="annotation-card-stem"]');

      return {
        stem: { duration: Number(/(?:^|\s)duration-\[(\d+)ms\]/.exec(stem?.className ?? '')?.[1] ?? 0), delay: 0 },
        surface: openTiming(words?.parentElement),
        words: openTiming(words),
      };
    };

    it('opens as one piece: the words are sharp from the first frame', () => {
      card.pin(createAnchor('A quote'));
      const words = getCard()?.querySelector(TEXT)?.parentElement;

      expect(words?.className ?? 'missing').not.toMatch(/blur|opacity-0|transition|delay/);
    });

    it('grows a little out of the stem, quickly and without a bounce', () => {
      const { surface } = parts();
      const classes = getCard()?.querySelector(TEXT)?.parentElement?.parentElement?.className ?? '';
      const startScale = Number(/(?:^|\s)scale-\[([\d.]+)\]/.exec(classes)?.[1] ?? 0);
      const curve = /group-data-\[state=open\]:ease-\[cubic-bezier\(([^)]+)\)\]/.exec(classes)?.[1].split(',').map(Number) ?? [ 9, 9, 9, 9 ];

      expect(startScale).toBeGreaterThanOrEqual(0.9);
      expect(startScale).toBeLessThan(1);
      expect(surface.delay + surface.duration).toBeLessThanOrEqual(200);
      // a control point above 1 is what makes a curve overshoot
      expect(Math.max(curve[1], curve[3])).toBeLessThanOrEqual(1);
    });

    it('plays the same two beats as the hint editor', () => {
      const css = readFileSync(resolve(__dirname, '../../../../src/styles/popover-animation.css'), 'utf-8');
      const beat = (name: string): number[] =>
        [...(new RegExp(`animation: ${name} ([^;]+);`).exec(css)?.[1] ?? '').replace(/cubic-bezier\([^)]*\)/, '').matchAll(/(\d+)ms/g)].map((m) => Number(m[1]));
      const { stem, surface } = parts();

      expect(beat('blok-tether-stem-in')).toEqual([stem.duration]);
      expect(beat('blok-tether-menu-in')).toEqual([surface.duration, surface.delay]);
      expect(css).not.toContain('blok-tether-content-in');
      expect(/@keyframes blok-tether-menu-in \{\s*from \{[^}]*scale\(([\d.]+)\)/.exec(css)?.[1]).toBe('0.94');
    });
  });
});
