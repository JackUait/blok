import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_HEADER_MORPH, flashArrivalRow, holdPageHeight, pageLinkMorph, pageNavMorphs, runPageTransition, waitForPageContent } from '../../../src/playground/page-host';

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

  it.each(['pg-page-title', 'pg-page-icon'])('flies the %s above the arriving page, whose opaque fill would cover it mid-flight', (name) => {
    const zIndex = /z-index:\s*(\d+)/.exec(rule(`html.pg-page-nav::view-transition-group(${name})`));

    expect(Number(zIndex?.[1] ?? 0)).toBeGreaterThan(0);
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

describe('page transition styles from the sidebar', () => {
  const PORTAL = 'html.pg-page-nav[data-pg-page-via="portal"]';

  it('grows the new page out of the clicked point instead of flying parts across the screen', () => {
    const enter = rule(`${PORTAL}::view-transition-new(pg-page-in)`);

    expect(enter).toMatch(/var\(--pg-portal-in\)/);
    expect(enter).toMatch(/var\(--pg-portal-reach\)|var\(--pg-portal-r\)/);
  });

  it('sinks the page being left toward the clicked point', () => {
    expect(rule(`${PORTAL}::view-transition-old(pg-page-out)`)).toMatch(/transform-origin:\s*var\(--pg-portal-out\)/);
  });

  it('paints the bodies opaque, so the two pages never show through each other inside the reveal', () => {
    expect(rule('html.pg-page-nav #tab-editor')).toMatch(/background(?:-color)?:/);
  });
});

describe('page transition styles going back', () => {
  const BACK = 'html.pg-page-nav[data-pg-page-dir="back"]';

  const keyframes = (name: string): string => {
    const match = new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);

    if (match === null) {
      throw new Error(`No keyframes ${name}`);
    }

    return match[1];
  };

  const animationName = (block: string): string => {
    const match = /animation:\s*([\w-]+)/.exec(block);

    if (match === null) {
      throw new Error(`No animation in ${block}`);
    }

    return match[1];
  };

  const scales = (frames: string): number[] => [...frames.matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));

  it('shrinks the page being left away, as if it folds back into its row', () => {
    const leave = keyframes(animationName(rule(`${BACK}::view-transition-old(pg-page-out)`)));

    expect(Math.min(...scales(leave))).toBeLessThan(0.98);
  });

  it('settles the parent page down from slightly larger, like a camera pulling out', () => {
    const enter = keyframes(animationName(rule(`${BACK}::view-transition-new(pg-page-in)`)));

    expect(Math.max(...scales(enter))).toBeGreaterThan(1);
  });

  it('still lets the page being left go before the parent arrives', () => {
    const leave = ms(rule(`${BACK}::view-transition-old(pg-page-out)`), 0);
    const enterDelay = ms(rule(`${BACK}::view-transition-new(pg-page-in)`), 1);

    expect(leave - enterDelay).toBeLessThanOrEqual(40);
  });
});

describe('page title morph', () => {
  const opacityAt = (name: string): Array<[number, number]> => {
    const match = new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);

    if (match === null) {
      throw new Error(`No keyframes ${name}`);
    }

    return [...match[1].matchAll(/(\d+)%\s*\{[^}]*opacity:\s*([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  };

  it('hands the old title over to the new one early, so two copies never smear across the whole flight', () => {
    const named = (side: string): string =>
      new RegExp(`::view-transition-${side}\\(pg-page-title\\)\\s*\\{\\s*animation-name:\\s*([\\w-]+)`).exec(css)?.[1] ?? '';
    const outName = named('old');
    const inName = named('new');
    const gone = opacityAt(outName).find(([, opacity]) => opacity === 0)?.[0];
    const shown = opacityAt(inName).find(([, opacity]) => opacity === 1)?.[0];

    expect(gone).toBeLessThanOrEqual(50);
    expect(shown).toBeLessThanOrEqual(70);
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
    Reflect.deleteProperty(window, 'innerHeight');
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

  it('scales each body around the middle of the viewport, not the middle of a page that may be thousands of pixels tall', async () => {
    document.body.innerHTML = `<div id="tab-editor">${row('go')}</div>`;
    const origins: string[] = [];
    const editor = (): HTMLElement | null => document.getElementById('tab-editor');

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: this.id === 'tab-editor' ? -300 : 0 } as DOMRect;
    });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

    await runPageTransition(async () => {
      origins.push(document.documentElement.style.getPropertyValue('--pg-page-out-origin'));
      editor()?.replaceChildren();
    }, { direction: 'back', from: null, to: null });

    expect(origins[0]).toBe('50% 700px');
  });

  it('opens a page from the point it was clicked, measured against each body', async () => {
    document.body.innerHTML = '<div id="tab-editor"></div>';
    let top = -300;
    const seen: Record<string, string> = {};
    const style = document.documentElement.style;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: this.id === 'tab-editor' ? top : 0, left: this.id === 'tab-editor' ? 10 : 0 } as DOMRect;
    });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });

    await runPageTransition(async () => {
      seen.via = document.documentElement.getAttribute('data-pg-page-via') ?? '';
      seen.out = style.getPropertyValue('--pg-portal-out');
      seen.reach = style.getPropertyValue('--pg-portal-reach');
      top = 81;
    }, { direction: 'forward', from: null, to: null, origin: { x: 110, y: 200 } });

    expect(seen.via).toBe('portal');
    expect(seen.out).toBe('100px 500px');
    expect(seen.reach).toBe(`${Math.ceil(Math.hypot(890, 600))}px`);
    expect(document.documentElement.hasAttribute('data-pg-page-via')).toBe(false);
    expect(style.getPropertyValue('--pg-portal-out')).toBe('');
    expect(style.getPropertyValue('--pg-portal-in')).toBe('');
    Reflect.deleteProperty(window, 'innerWidth');
  });

  it('places the arriving reveal against the new body, after its scroll is restored', async () => {
    document.body.innerHTML = '<div id="tab-editor"></div>';
    let top = -300;
    const style = document.documentElement.style;
    let arriving = '';

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: this.id === 'tab-editor' ? top : 0, left: 0 } as DOMRect;
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (update: () => Promise<void>) => {
        const done = update().then(() => {
          arriving = style.getPropertyValue('--pg-portal-in');
        });

        return { updateCallbackDone: done, finished: done };
      },
    });

    await runPageTransition(async () => {
      top = 81;
    }, { direction: 'forward', from: null, to: null, origin: { x: 110, y: 200 } });

    expect(arriving).toBe('110px 119px');
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

describe('waitForPageContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const settled = async (promise: Promise<void>): Promise<boolean> => {
    let done = false;

    void promise.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    return done;
  };

  it('waits while the editor is still empty, so the incoming snapshot is not a blank page', async () => {
    const holder = document.createElement('div');

    document.body.append(holder);

    expect(await settled(waitForPageContent(holder, 1000))).toBe(false);
  });

  it('waits while the loading skeleton still owns the editor', async () => {
    const holder = document.createElement('div');

    holder.innerHTML = '<div data-blok-loading><div data-blok-element></div></div>';
    document.body.append(holder);

    expect(await settled(waitForPageContent(holder, 1000))).toBe(false);
  });

  it('lets go as soon as the blocks are in and the skeleton is gone', async () => {
    const holder = document.createElement('div');
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-loading', '');
    holder.append(wrapper);
    document.body.append(holder);

    const wait = waitForPageContent(holder, 1000);

    wrapper.innerHTML = '<div data-blok-element></div>';
    wrapper.removeAttribute('data-blok-loading');

    expect(await settled(wait)).toBe(true);
  });

  it('gives up at the limit, so a slow page never stalls navigation', async () => {
    const holder = document.createElement('div');

    document.body.append(holder);

    const wait = waitForPageContent(holder, 1000);

    await vi.advanceTimersByTimeAsync(1000);

    expect(await settled(wait)).toBe(true);
  });
});

describe('pageNavMorphs', () => {
  const parents: Record<string, string | null> = { child: 'parent', parent: null, grandchild: 'child' };
  const parentOf = (id: string): string | null | undefined => parents[id];

  it('morphs the row into the page header going down', () => {
    expect(pageNavMorphs({ back: false, from: null, target: 'parent', parentOf })).toEqual({ from: pageLinkMorph('parent'), to: PAGE_HEADER_MORPH });
  });

  it('morphs the page header back into its row going up to the direct parent', () => {
    expect(pageNavMorphs({ back: true, from: 'child', target: 'parent', parentOf })).toEqual({ from: PAGE_HEADER_MORPH, to: pageLinkMorph('child') });
  });

  it('morphs into the row on the root document too', () => {
    expect(pageNavMorphs({ back: true, from: 'parent', target: null, parentOf })).toEqual({ from: PAGE_HEADER_MORPH, to: pageLinkMorph('parent') });
  });

  it('morphs nothing when jumping past the parent, where the page has no row', () => {
    expect(pageNavMorphs({ back: true, from: 'grandchild', target: 'parent', parentOf })).toEqual({ from: null, to: null });
  });

  it('morphs nothing when the page is gone for good', () => {
    expect(pageNavMorphs({ back: true, from: 'deleted', target: null, parentOf })).toEqual({ from: null, to: null });
  });
});

describe('flashArrivalRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const mount = (): { link: HTMLElement; animate: ReturnType<typeof vi.fn> } => {
    document.body.innerHTML = '<a data-blok-testid="page-link" href="/editor/page/go"><span data-blok-testid="page-title">Go</span></a>';

    const link = document.querySelector<HTMLElement>('[data-blok-testid="page-link"]');

    if (link === null) {
      throw new Error('no link');
    }

    const animate = vi.fn();

    Object.defineProperty(link, 'animate', { configurable: true, value: animate });

    return { link, animate };
  };

  it('fades a gray tint off the row you came back from, never a blue one', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) });
    const { animate } = mount();

    flashArrivalRow('go');

    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes] = animate.mock.calls[0] as [Array<Record<string, string>>];

    expect(keyframes[0].backgroundColor).toBe('var(--blok-item-hover-bg)');
    expect(keyframes[keyframes.length - 1].backgroundColor).toBe('transparent');
  });

  it('stays still when the user asked for reduced motion', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
    const { animate } = mount();

    flashArrivalRow('go');

    expect(animate).not.toHaveBeenCalled();
  });
});
