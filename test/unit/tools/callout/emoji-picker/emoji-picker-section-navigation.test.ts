import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmojiPicker } from '../../../../../src/tools/callout/emoji-picker';

const SECTION_TOPS: Readonly<Record<string, number>> = {
  callout: 0,
  people: 300,
  nature: 600,
  foods: 900,
  activity: 1200,
  places: 1500,
  objects: 1800,
  symbols: 2100,
  flags: 2400,
};

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);

  if (element === null) {
    throw new Error(`Missing picker element: ${selector}`);
  }

  return element;
}

describe('EmojiPicker section navigation', () => {
  let picker: EmojiPicker;
  let container: HTMLElement;
  let anchor: HTMLButtonElement;
  let body: HTMLElement;
  let reducedMotion: boolean;
  let scrollRequests: ScrollToOptions[];

  function nav(category: string): HTMLButtonElement {
    return requireElement(picker.getElement(), `[data-emoji-nav="${category}"]`);
  }

  function activeCategory(): string | null {
    return picker.getElement().querySelector('[data-emoji-nav][aria-current="true"]')?.getAttribute('data-emoji-nav') ?? null;
  }

  function scrollTo(top: number): void {
    body.scrollTop = top;
    body.dispatchEvent(new Event('scroll'));
    vi.advanceTimersToNextFrame();
  }

  function measureSections(): void {
    for (const section of body.querySelectorAll<HTMLElement>('[data-emoji-section]')) {
      const category = section.getAttribute('data-emoji-section') ?? '';
      const top = SECTION_TOPS[category];

      if (top === undefined) {
        throw new Error(`Unexpected emoji category: ${category}`);
      }

      vi.spyOn(section, 'offsetTop', 'get').mockReturnValue(top);
      vi.spyOn(section, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 100 + top - body.scrollTop, 400, 300));
    }

    for (const [index, button] of [...picker.getElement().querySelectorAll<HTMLElement>('[data-emoji-nav]')].entries()) {
      vi.spyOn(button, 'offsetWidth', 'get').mockReturnValue(30);
      vi.spyOn(button, 'offsetLeft', 'get').mockReturnValue(8 + index * 34);
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    reducedMotion = false;
    scrollRequests = [];
    vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({
      matches: query === '(prefers-reduced-motion: reduce)' && reducedMotion,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn().mockReturnValue(true),
    }));
    container = document.createElement('div');
    anchor = document.createElement('button');
    picker = new EmojiPicker({
      onSelect: vi.fn(),
      onRemove: vi.fn(),
      i18n: { t: (key: string) => key },
      locale: 'en',
    });
    container.append(anchor, picker.getElement());
    document.body.appendChild(container);
    body = requireElement(picker.getElement(), '[data-emoji-picker-body]');
    vi.spyOn(body, 'clientHeight', 'get').mockReturnValue(260);
    vi.spyOn(body, 'scrollHeight', 'get').mockReturnValue(2500);
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 400, 260));
    body.scrollTo = (options?: ScrollToOptions | number): void => {
      if (typeof options !== 'object') {
        throw new Error('Expected scroll options');
      }

      scrollRequests.push(options);

      if (options.behavior === 'instant') {
        body.scrollTop = Math.max(0, Math.min(options.top ?? 0, 2240));
        body.dispatchEvent(new Event('scroll'));
      }
    };
    await picker.open(anchor);
    measureSections();
    vi.advanceTimersToNextFrame();
  });

  afterEach(() => {
    picker.close();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('selects the clicked category and moves its indicator before scrolling starts', () => {
    nav('symbols').click();

    expect(activeCategory()).toBe('symbols');
    expect(nav('callout')).toHaveAttribute('aria-current', 'false');
    const indicator = requireElement<HTMLElement>(picker.getElement(), '[data-emoji-nav-indicator]');

    expect(indicator.style.transform).toBe('translateX(246px)');
    expect(indicator.style.width).toBe('30px');
    expect(body.scrollTop).toBe(0);
    expect(scrollRequests).toEqual([{ top: 2100, behavior: 'smooth' }]);
  });

  it('keeps the destination selected while smooth scrolling passes other sections', () => {
    nav('symbols').click();

    for (const top of [300, 600, 900, 1200, 1500, 1800]) {
      scrollTo(top);

      expect(activeCategory()).toBe('symbols');
    }
  });

  it('retargets immediately when another category is clicked during scrolling', () => {
    nav('symbols').click();
    scrollTo(1200);
    nav('people').click();

    expect(activeCategory()).toBe('people');
    expect(scrollRequests.at(-1)).toEqual({ top: 300, behavior: 'smooth' });
    scrollTo(900);
    expect(activeCategory()).toBe('people');
    scrollTo(600);
    expect(activeCategory()).toBe('people');
    scrollTo(300);
    scrollTo(600);
    expect(activeCategory()).toBe('nature');
  });

  it('resumes ordinary section tracking after the destination is reached', () => {
    nav('symbols').click();
    scrollTo(1800);
    expect(activeCategory()).toBe('symbols');

    scrollTo(2100);
    expect(activeCategory()).toBe('symbols');
    scrollTo(1800);
    expect(activeCategory()).toBe('objects');
  });

  it.each(['wheel', 'touchstart', 'pointerdown'])('resumes section tracking when %s interrupts a category scroll', (type) => {
    nav('symbols').click();
    scrollTo(600);
    expect(activeCategory()).toBe('symbols');

    body.dispatchEvent(new Event(type, { bubbles: true }));
    vi.advanceTimersToNextFrame();
    expect(activeCategory()).toBe('nature');
    scrollTo(900);
    expect(activeCategory()).toBe('foods');
  });

  it.each(['ArrowDown', 'PageDown', 'Home', 'End', ' '])('resumes section tracking when %s interrupts with the keyboard', (key) => {
    nav('symbols').click();
    scrollTo(600);
    expect(activeCategory()).toBe('symbols');

    body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    scrollTo(900);
    expect(activeCategory()).toBe('foods');
  });

  it('keeps the destination selected on an unrelated keypress', () => {
    nav('symbols').click();
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
    scrollTo(600);

    expect(activeCategory()).toBe('symbols');
  });

  it('clears the pending destination when search is cleared', () => {
    nav('symbols').click();
    scrollTo(600);
    expect(activeCategory()).toBe('symbols');

    picker.setQuery('light');
    requireElement<HTMLButtonElement>(picker.getElement(), '[data-emoji-picker-clear]').click();
    measureSections();
    vi.advanceTimersToNextFrame();
    expect(activeCategory()).toBe('callout');
    scrollTo(900);
    expect(activeCategory()).toBe('foods');
  });

  it('clears the pending destination when closed and reopened', async () => {
    nav('symbols').click();
    scrollTo(600);
    expect(activeCategory()).toBe('symbols');

    picker.close();
    await picker.open(anchor);
    vi.advanceTimersToNextFrame();
    expect(activeCategory()).toBe('callout');
    scrollTo(900);
    expect(activeCategory()).toBe('foods');
  });

  it('uses instant scrolling with reduced motion and does not leave navigation locked', () => {
    reducedMotion = true;
    nav('symbols').click();

    expect(activeCategory()).toBe('symbols');
    expect(body.scrollTop).toBe(2100);
    expect(scrollRequests).toEqual([{ top: 2100, behavior: 'instant' }]);
    vi.advanceTimersToNextFrame();
    scrollTo(600);
    expect(activeCategory()).toBe('nature');
  });

  it('releases the destination at the clamped final section', () => {
    nav('flags').click();
    scrollTo(2100);
    expect(activeCategory()).toBe('flags');

    scrollTo(2240);
    expect(activeCategory()).toBe('flags');
    scrollTo(1800);
    expect(activeCategory()).toBe('objects');
  });

  it('does not lock navigation when the selected section is already at the destination', () => {
    nav('callout').click();
    vi.advanceTimersToNextFrame();
    scrollTo(600);

    expect(activeCategory()).toBe('nature');
  });
});
