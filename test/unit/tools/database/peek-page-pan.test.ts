import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PeekPagePan } from '../../../../src/tools/database/peek-page-pan';

interface Page {
  host: HTMLElement;
  mount: HTMLElement;
  paragraph: HTMLElement;
  /** Moves the mocked rects by the offset the pan applied, as a browser would. */
  follow: () => void;
}

/** An editor wrapper with a 56px gutter and a 720px column, laid out at scroll 0. */
const makePage = (host: { left: number; right: number }, rtl = false): Page => {
  const wrapper = document.createElement('div');
  const redactor = document.createElement('div');
  const holder = document.createElement('div');
  const paragraph = document.createElement('p');
  const mount = document.createElement('div');

  if (rtl) wrapper.dir = 'rtl';
  redactor.setAttribute('data-blok-redactor', '');
  redactor.style.setProperty(rtl ? 'padding-right' : 'padding-left', '56px');
  redactor.style.setProperty('--max-width-content', '720px');
  holder.appendChild(paragraph);
  redactor.appendChild(holder);
  wrapper.append(redactor, mount);
  document.body.appendChild(wrapper);

  const place = (shift: number): void => {
    const rect = new DOMRect(host.left - shift, 0, host.right - host.left, 800);

    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(rect);
    vi.spyOn(redactor, 'getBoundingClientRect').mockReturnValue(rect);
  };

  place(0);

  return {
    host: wrapper,
    mount,
    paragraph,
    follow: () => place(Number.parseFloat(wrapper.style.getPropertyValue('--_blok-peek-offset')) * (rtl ? -1 : 1)),
  };
};

const bar = (): HTMLElement | null => document.querySelector('[data-blok-database-peek-scrollbar]');

describe('PeekPagePan', () => {
  let pan: PeekPagePan;

  beforeEach(() => {
    vi.clearAllMocks();
    pan = new PeekPagePan();
  });

  afterEach(() => {
    pan.release();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('moves the page into the free space at its start, then lets a bar pan the rest out', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
    const page = makePage({ left: 0, right: 1000 });

    pan.fit(page.host, page.mount, 756, false);

    // The drawer covers x 244..1000, so 756px of the page is under it. The column
    // can move from 168 to 96, which leaves 684px for the bar.
    expect(page.host.style.getPropertyValue('--_blok-peek-offset')).toBe('72px');
    expect(bar()?.style.getPropertyValue('--_blok-peek-travel')).toBe('684px');
    expect(bar()?.style.getPropertyValue('--_blok-peek-width')).toBe('756px');
  });

  it('shows no bar when the free space alone clears the drawer', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1600);
    const page = makePage({ left: 300, right: 1000 });

    pan.fit(page.host, page.mount, 756, false);

    // 156px is under the drawer; the 644px box holds a 644px column at 356, so it has 260px to spare.
    expect(page.host.style.getPropertyValue('--_blok-peek-offset')).toBe('156px');
    expect(bar()).toBeNull();
  });

  it('leaves a page that ends before the drawer where it is', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1600);
    const page = makePage({ left: 0, right: 600 });

    pan.fit(page.host, page.mount, 756, false);

    expect(page.host.style.getPropertyValue('--_blok-peek-offset')).toBe('0px');
    expect(bar()).toBeNull();
  });

  it('mirrors in RTL, where the drawer sits on the left', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
    const page = makePage({ left: 0, right: 1000 }, true);
    pan.fit(page.host, page.mount, 756, true);

    // The column's start is its right edge, 168px from the window's right.
    expect(page.host.style.getPropertyValue('--_blok-peek-offset')).toBe('72px');
    expect(bar()?.style.getPropertyValue('--_blok-peek-travel')).toBe('684px');
  });

  it('pans the page with the bar', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
    const page = makePage({ left: 0, right: 1000 });

    pan.fit(page.host, page.mount, 756, false);
    const scrollbar = bar();

    if (scrollbar === null) throw new Error('no bar');
    scrollbar.scrollLeft = 200;
    scrollbar.dispatchEvent(new Event('scroll'));

    expect(page.host.style.getPropertyValue('--_blok-peek-offset')).toBe('272px');
  });

  it('keeps its shift and travel when a resize drag re-measures a panned page', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
    const page = makePage({ left: 0, right: 1000 });

    pan.fit(page.host, page.mount, 756, false);
    const scrollbar = bar();

    if (scrollbar === null) throw new Error('no bar');
    scrollbar.scrollLeft = 200;
    scrollbar.dispatchEvent(new Event('scroll'));
    page.follow();
    pan.fit(page.host, page.mount, 756, false);

    expect(page.host.style.getPropertyValue('--_blok-peek-offset')).toBe('272px');
    expect(bar()?.style.getPropertyValue('--_blok-peek-travel')).toBe('684px');
  });

  describe('a horizontal wheel over the page', () => {
    const wheel = (target: Element, init: WheelEventInit): WheelEvent => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });

      target.dispatchEvent(event);

      return event;
    };

    const fitted = (): Page => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
      const page = makePage({ left: 0, right: 1000 });

      pan.fit(page.host, page.mount, 756, false);

      return page;
    };

    it('scrolls the bar', () => {
      const page = fitted();
      const event = wheel(page.paragraph, { deltaX: 100 });

      expect(bar()?.scrollLeft).toBe(100);
      expect(event.defaultPrevented).toBe(true);
    });

    it('reads Shift with a vertical wheel as horizontal', () => {
      const page = fitted();

      wheel(page.paragraph, { deltaY: 60, shiftKey: true });

      expect(bar()?.scrollLeft).toBe(60);
    });

    it('leaves a vertical wheel to the page', () => {
      const page = fitted();
      const event = wheel(page.paragraph, { deltaY: 60 });

      expect(bar()?.scrollLeft).toBe(0);
      expect(event.defaultPrevented).toBe(false);
    });

    it('leaves it to a child that can still scroll that way, like a board', () => {
      const page = fitted();
      const board = document.createElement('div');
      const card = document.createElement('div');

      board.style.overflowX = 'auto';
      Object.defineProperty(board, 'scrollWidth', { value: 1200 });
      Object.defineProperty(board, 'clientWidth', { value: 600 });
      board.appendChild(card);
      page.paragraph.appendChild(board);

      const event = wheel(card, { deltaX: 100 });

      expect(bar()?.scrollLeft).toBe(0);
      expect(event.defaultPrevented).toBe(false);
    });

    it('pans over the bar itself, whose own wheel scrolling the browser may not deliver', () => {
      fitted();
      const scrollbar = bar();

      if (scrollbar === null) throw new Error('no bar');
      scrollbar.style.overflowX = 'auto';
      Object.defineProperty(scrollbar, 'scrollWidth', { value: 928 });
      Object.defineProperty(scrollbar, 'clientWidth', { value: 244 });

      const event = wheel(scrollbar, { deltaX: 100 });

      expect(scrollbar.scrollLeft).toBe(100);
      expect(event.defaultPrevented).toBe(true);
    });

    it('does not take it over the drawer', () => {
      const page = fitted();
      const drawer = document.createElement('div');

      drawer.setAttribute('data-blok-database-drawer', '');
      page.mount.appendChild(drawer);

      const event = wheel(drawer, { deltaX: 100 });

      expect(bar()?.scrollLeft).toBe(0);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  it('puts the page back and removes the bar when the peek leaves', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
    const page = makePage({ left: 0, right: 1000 });

    pan.fit(page.host, page.mount, 756, false);
    pan.leave();

    expect(page.host.style.getPropertyValue('--_blok-peek-offset')).toBe('0px');
    expect(bar()).toBeNull();

    // A wheel after leaving is the page's own.
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 100 });

    page.paragraph.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
