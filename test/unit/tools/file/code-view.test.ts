import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

vi.mock('../../../../src/tools/code/prism-loader', () => ({
  tokenizePrism: vi.fn().mockResolvedValue(null),
  isHighlightable: vi.fn().mockReturnValue(false),
}));
vi.mock('../../../../src/tools/code/prism-applier', () => ({
  applyPrismHighlight: vi.fn(),
  ensurePrismStyles: vi.fn(),
}));
vi.mock('../../../../src/tools/code/line-geometry', () => ({
  rowHeight: vi.fn().mockReturnValue(0),
  measureLineRows: vi.fn().mockReturnValue([]),
}));

import { renderCode } from '../../../../src/tools/file/code-view';
import { measureLineRows, rowHeight } from '../../../../src/tools/code/line-geometry';
import { detachedChrome, type PreviewChrome } from '../../../../src/tools/file/preview-chrome';

interface Harness {
  body: HTMLElement;
  pre: HTMLElement;
  bar: HTMLElement;
  facts: string[][];
  map: HTMLElement;
  guides: () => HTMLElement[];
}

async function harness(text: string, extra: Partial<PreviewChrome> = {}): Promise<Harness> {
  const body = document.createElement('div');
  document.body.appendChild(body);
  const slots: { bar: HTMLElement | null } = { bar: null };
  const facts: string[][] = [];
  const chrome: PreviewChrome = {
    ...detachedChrome(body),
    typeName: 'TypeScript',
    setFacts: (next) => facts.push(next),
    setBar: (bar) => { slots.bar = bar; },
    ...extra,
  };
  await renderCode(chrome, text, 'typescript');
  const need = <T>(value: T | null, what: string): T => {
    if (value === null) {
      throw new Error(`no ${what}`);
    }

    return value;
  };

  return {
    body,
    pre: need(body.querySelector<HTMLElement>('[data-role="file-preview-code"]'), 'pre'),
    bar: need(slots.bar, 'bar'),
    facts,
    map: need(body.querySelector<HTMLElement>('[data-role="file-preview-minimap"]'), 'minimap'),
    guides: () => Array.from(body.querySelectorAll<HTMLElement>('[data-role="file-preview-guides"] > *')),
  };
}

describe('renderCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rowHeight).mockReturnValue(0);
    vi.mocked(measureLineRows).mockReturnValue([]);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('counts the lines for the header and the status bar, next to the language', async () => {
    const h = await harness('a\nb\nc\n');

    expect(h.facts).toEqual([['3 lines']]);
    const texts = Array.from(h.bar.querySelectorAll('.blok-file-preview-bar-text')).map((el) => el.textContent);
    expect(texts).toEqual(['TypeScript', '3 lines']);
  });

  it('adds the size to the status bar when it is known', async () => {
    const h = await harness('a', { size: 2355 });

    const texts = Array.from(h.bar.querySelectorAll('.blok-file-preview-bar-text')).map((el) => el.textContent);
    expect(texts).toEqual(['TypeScript', '1 line', '2.3 KB']);
  });

  it('wraps long lines until Wrap lines is switched off', async () => {
    const h = await harness('a');
    const toggle = h.bar.querySelector<HTMLButtonElement>('[data-action="preview-wrap"]');

    expect(h.pre.getAttribute('data-wrap')).toBe('true');
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');

    toggle?.click();
    expect(h.pre.getAttribute('data-wrap')).toBe('false');
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');

    toggle?.click();
    expect(h.pre.getAttribute('data-wrap')).toBe('true');
  });

  it('copies the whole file and says so for a moment', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const h = await harness('const a = 1;\n');
    const button = h.bar.querySelector<HTMLButtonElement>('[data-action="preview-copy"]');
    const copy = button?.querySelector('.blok-file-preview-bar-label');

    button?.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(writeText).toHaveBeenCalledWith('const a = 1;\n');
    expect(copy?.textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(1400);
    expect(copy?.textContent).toBe('Copy');
  });

  it('draws one indent guide per level, two columns apart for two-space code', async () => {
    const h = await harness('a\n  b\n    c\n\n  d');

    expect(h.guides().map((guide) => guide.style.width)).toEqual(['', '2ch', '4ch', '', '2ch']);
    expect(h.body.querySelector<HTMLElement>('[data-role="file-preview-guides"]')?.style.getPropertyValue('--blok-file-guide-step')).toBe('2ch');
  });

  it('spaces the guides four columns apart for four-space code', async () => {
    const h = await harness('a\n    b\n        c');

    expect(h.guides().map((guide) => guide.style.width)).toEqual(['', '4ch', '8ch']);
    expect(h.body.querySelector<HTMLElement>('[data-role="file-preview-guides"]')?.style.getPropertyValue('--blok-file-guide-step')).toBe('4ch');
  });

  it('counts a tab as one level, two columns wide', async () => {
    const h = await harness('a\n\tb\n\t\tc');

    expect(h.guides().map((guide) => guide.style.width)).toEqual(['', '2ch', '4ch']);
  });

  it('makes a guide as tall as the rows its wrapped line takes', async () => {
    vi.mocked(rowHeight).mockReturnValue(20);
    vi.mocked(measureLineRows).mockReturnValue([1, 3, 1]);
    const h = await harness('a\n  b\n  c');

    expect(h.guides().map((guide) => guide.style.height)).toEqual(['20px', '60px', '20px']);
  });

  it('gives the minimap one bar per line, as long as the line and indented like it', async () => {
    const h = await harness('abcd\n  ab\n\nabcdefgh');
    const bars = Array.from(h.map.querySelectorAll<HTMLElement>('[data-role="file-preview-minimap-bars"] > i'));

    expect(bars).toHaveLength(4);
    expect(parseFloat(bars[3].style.width)).toBeCloseTo(parseFloat(bars[0].style.width) * 2, 5);
    expect(parseFloat(bars[1].style.marginInlineStart)).toBeGreaterThan(0);
    expect(bars[0].style.marginInlineStart).toBe('');
    // A blank line keeps its slot but shows nothing.
    expect(bars[2].style.width).toBe('0px');
  });

  it('moves the minimap window with the scroll', async () => {
    const h = await harness('a\nb\nc\nd');
    Object.defineProperties(h.pre, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 250 },
    });
    h.pre.scrollTop = 500;
    h.pre.dispatchEvent(new Event('scroll'));

    // 4 lines at 4px each: the map is 16px tall.
    const win = h.map.querySelector<HTMLElement>('[data-role="file-preview-minimap-window"]');
    expect(win?.style.top).toBe('8px');
    expect(win?.style.height).toBe('4px');
  });

  it('scrolls the code to where the minimap is pressed or dragged', async () => {
    const h = await harness('a\nb\nc\nd');
    Object.defineProperties(h.pre, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
    });
    const bars = h.map.querySelector<HTMLElement>('[data-role="file-preview-minimap-bars"]');
    if (bars === null) {
      throw new Error('no bars');
    }
    bars.getBoundingClientRect = () => new DOMRect(0, 100, 64, 16);

    // 8px down a 16px map is the middle of the file: 500, minus half a view.
    h.map.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 108, buttons: 1 }));
    expect(h.pre.scrollTop).toBe(400);

    h.map.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 112, buttons: 1 }));
    expect(h.pre.scrollTop).toBe(650);

    h.map.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 100, buttons: 0 }));
    expect(h.pre.scrollTop).toBe(650);
  });

  it('lights the line under the pointer and its number, and clears them when it leaves', async () => {
    const h = await harness('a\nb\nc');
    const numbers = Array.from(h.pre.querySelectorAll<HTMLElement>('[data-role="file-preview-gutter"] > *'));
    Object.defineProperties(numbers[1], {
      offsetTop: { configurable: true, value: 44 },
      offsetHeight: { configurable: true, value: 22 },
    });
    // The gutter starts below the pre's top padding; a line's offset is measured from the gutter.
    Object.defineProperty(numbers[1].parentElement, 'offsetTop', { configurable: true, value: 20 });
    vi.stubGlobal('document', Object.assign(document, { elementFromPoint: () => numbers[1] }));
    const band = h.pre.querySelector<HTMLElement>('[data-role="file-preview-line-hover"]');

    h.pre.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 50 }));
    expect(numbers[1].hasAttribute('data-hover')).toBe(true);
    expect(numbers[0].hasAttribute('data-hover')).toBe(false);
    expect(band?.hidden).toBe(false);
    expect(band?.style.top).toBe('64px');
    expect(band?.style.height).toBe('22px');

    h.pre.dispatchEvent(new MouseEvent('pointerleave'));
    expect(numbers[1].hasAttribute('data-hover')).toBe(false);
    expect(band?.hidden).toBe(true);
  });
});
