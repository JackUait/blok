import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_HEADER_MORPH, holdPageHeight, pageLinkMorph, runPageTransition } from '../../../src/playground/page-host';

const css = readFileSync(resolve(__dirname, '../../../src/playground/playground.css'), 'utf-8');

const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n|,\\s*)${escaped}[^{]*\\{([^}]*)\\}`).exec(css);

  if (match === null) {
    throw new Error(`No rule for ${selector}`);
  }

  return match[1];
};

const ms = (block: string, index: number): number => {
  const animation = /animation:\s*([^;]+);/.exec(block);
  const times = animation === null ? [] : [...animation[1].matchAll(/(\d+)ms/g)].map((m) => Number(m[1]));

  if (times[index] === undefined) {
    throw new Error(`No time #${index} in ${block}`);
  }

  return times[index];
};

describe('page transition styles', () => {
  it.each(['pg-page-title', 'pg-page-icon'])('scales the %s snapshots by height from the start edge, never stretched to the wider box', (name) => {
    for (const side of ['old', 'new']) {
      const block = rule(`html.pg-page-nav::view-transition-${side}(${name})`);

      expect(block).toMatch(/height:\s*100%/);
      expect(block).toMatch(/width:\s*auto/);
    }
  });

  it.each(['pg-page-title', 'pg-page-icon'])('makes a %s with no end on the new page leave with the old page, not linger over it', (name) => {
    const leave = ms(rule('html.pg-page-nav::view-transition-old(pg-page-out)'), 0);
    const orphan = ms(rule(`html.pg-page-nav::view-transition-old(${name}):only-child`), 0);

    expect(orphan).toBeLessThanOrEqual(leave);
  });

  it('keeps the page chrome (the root) crossfading instead of popping in at the new scroll', () => {
    expect(css).not.toMatch(/view-transition-(?:old|new)\(root\)[^{]*\{[^}]*animation:\s*none/);
  });

  it('lets the old page leave before the new page arrives', () => {
    const leave = ms(rule('html.pg-page-nav::view-transition-old(pg-page-out)'), 0);
    const enterDelay = ms(rule('html.pg-page-nav::view-transition-new(pg-page-in)'), 1);

    expect(leave - enterDelay).toBeLessThanOrEqual(40);
  });
});

describe('runPageTransition', () => {
  const sheets: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    sheets.length = 0;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (update: () => Promise<void>) => {
        sheets.push(document.head.querySelector('style')?.textContent ?? '');
        const done = update().then(() => {
          sheets.push(document.head.querySelector('style')?.textContent ?? '');
        });

        return { updateCallbackDone: done, finished: done };
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition');
    Reflect.deleteProperty(window, 'matchMedia');
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const row = (pageId: string): string =>
    `<a data-blok-testid="page-link" href="/editor/page/${pageId}"><span data-blok-testid="page-icon">🚀</span><span data-blok-testid="page-title">Go</span></a>`;
  const header = '<button class="pg-page-icon">🚀</button><h1 id="pg-page-title">Go</h1>';

  it('morphs the row icon into the page icon along with the title', async () => {
    document.body.innerHTML = row('go');

    await runPageTransition(async () => {
      document.body.innerHTML = header;
    }, { direction: 'forward', from: pageLinkMorph('go'), to: PAGE_HEADER_MORPH });

    expect(sheets[0]).toContain('view-transition-name: pg-page-icon');
    expect(sheets[0]).toContain('view-transition-name: pg-page-title');
    expect(sheets[1]).toContain(`${PAGE_HEADER_MORPH.icon} { view-transition-name: pg-page-icon; }`);
    expect(sheets[1]).toContain(`${PAGE_HEADER_MORPH.title} { view-transition-name: pg-page-title; }`);
  });

  it('leaves a part unnamed when two links to the page would share its name', async () => {
    document.body.innerHTML = row('go') + row('go');

    await runPageTransition(async () => {
      document.body.innerHTML = header;
    }, { direction: 'forward', from: pageLinkMorph('go'), to: PAGE_HEADER_MORPH });

    expect(sheets[0]).not.toContain('pg-page-title');
    expect(sheets[0]).not.toContain('pg-page-icon');
  });

  it('snapshots the leaving and arriving bodies under different names, so neither slides by the scroll distance', async () => {
    document.body.innerHTML = row('go');

    await runPageTransition(async () => {
      document.body.innerHTML = header;
    }, { direction: 'forward', from: pageLinkMorph('go'), to: PAGE_HEADER_MORPH });

    expect(sheets[0]).toContain('#tab-editor { view-transition-name: pg-page-out; }');
    expect(sheets[1]).toContain('#tab-editor { view-transition-name: pg-page-in; }');
    expect(sheets[1]).not.toContain('pg-page-out');
  });

  it('removes the naming sheet once the transition ends', async () => {
    document.body.innerHTML = row('go');

    await runPageTransition(async () => {
      document.body.innerHTML = header;
    }, { direction: 'forward', from: pageLinkMorph('go'), to: PAGE_HEADER_MORPH });

    expect(document.head.querySelector('style')).toBeNull();
    expect(document.documentElement.classList.contains('pg-page-nav')).toBe(false);
  });
});

describe('holdPageHeight', () => {
  let resize: () => void = () => undefined;
  let bodyHeight = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    bodyHeight = 900;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        resize = callback;
      }

      observe(): void {}

      disconnect(): void {}
    });
    vi.spyOn(document.body, 'getBoundingClientRect').mockImplementation(() => ({ height: bodyHeight } as DOMRect));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty('min-height');
  });

  it('keeps the document as tall as the page was, so a saved scroll is not clamped while it loads', () => {
    holdPageHeight(7800);

    expect(document.documentElement.style.minHeight).toBe('7800px');
  });

  it('lets go once the content is that tall again', () => {
    holdPageHeight(7800);
    bodyHeight = 7800;
    resize();

    expect(document.documentElement.style.minHeight).toBe('');
  });

  it('keeps holding while the content is still shorter', () => {
    holdPageHeight(7800);
    bodyHeight = 3000;
    resize();

    expect(document.documentElement.style.minHeight).toBe('7800px');
  });

  it('lets go after a while when the page came back shorter than it was', () => {
    holdPageHeight(7800);
    vi.advanceTimersByTime(5000);

    expect(document.documentElement.style.minHeight).toBe('');
  });
});
