import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type Direction = 'ltr' | 'rtl';

const createBlok = async (
  page: Page,
  blocks: OutputData['blocks'],
  direction: Direction,
  style?: Record<string, unknown>
): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks, dir, blokStyle }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.style.width = '800px';
    document.body.appendChild(container);

    const config: Record<string, unknown> = { holder, data: { blocks: blokBlocks }, i18n: { direction: dir } };

    if (blokStyle !== null) {
      config.style = blokStyle;
    }

    const blok = new window.Blok(config);

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks, dir: direction, blokStyle: style ?? null });
};

/**
 * Start / end offsets of each probe, measured from the holder's inline-start /
 * inline-end edges. A correctly mirrored layout gives the same numbers in LTR
 * and RTL.
 */
const measureLogical = async (
  page: Page,
  probes: Record<string, string>
): Promise<Record<string, [number, number]>> => page.evaluate(({ holder, probeMap }) => {
  const frame = document.getElementById(holder);

  if (!frame) {
    throw new Error('no holder');
  }

  const box = frame.getBoundingClientRect();
  const rtl = getComputedStyle(frame.querySelector('[data-blok-interface=blok]') ?? frame).direction === 'rtl';
  const result: Record<string, [number, number]> = {};

  for (const [name, selector] of Object.entries(probeMap)) {
    const el = frame.querySelector(selector);

    if (!el) {
      throw new Error(`probe ${name} not found: ${selector}`);
    }

    const r = el.getBoundingClientRect();
    const start = rtl ? box.right - r.right : r.left - box.left;
    const end = rtl ? r.left - box.left : box.right - r.right;

    result[name] = [ Math.round(start), Math.round(end) ];
  }

  return result;
}, { holder: HOLDER_ID, probeMap: probes });

const editable = (id: string): string => `[data-blok-id="${id}"] [contenteditable="true"]`;

const CONTENT_BLOCKS: OutputData['blocks'] = [
  { id: 'p1', type: 'paragraph', data: { text: 'Parent' }, content: [ 'p2' ] },
  { id: 'p2', type: 'paragraph', data: { text: 'Child' }, parent: 'p1' },
  { id: 'l1', type: 'list', data: { text: 'Bullet root', style: 'unordered', depth: 0 } },
  { id: 'l2', type: 'list', data: { text: 'Bullet nested', style: 'unordered', depth: 1 } },
  { id: 'o1', type: 'list', data: { text: 'Number root', style: 'ordered', depth: 0 } },
  { id: 'o2', type: 'list', data: { text: 'Number nested', style: 'ordered', depth: 1 } },
  { id: 'c1', type: 'list', data: { text: 'Check nested', style: 'checklist', depth: 1, checked: false } },
  { id: 't1', type: 'toggle', data: { text: 'Toggle', isOpen: true }, content: [ 't2' ] },
  { id: 't2', type: 'paragraph', data: { text: 'Inside toggle' }, parent: 't1' },
  { id: 'q', type: 'quote', data: { text: 'Quote' } },
  { id: 'co', type: 'callout', data: { text: 'Callout' } },
  { id: 'h', type: 'header', data: { text: 'Toggle heading', level: 2, isToggleable: true, isOpen: true }, content: [ 'h2c' ] },
  { id: 'h2c', type: 'paragraph', data: { text: 'Under heading' }, parent: 'h' },
];

const CONTENT_PROBES: Record<string, string> = {
  nestedParagraph: editable('p2'),
  bulletRootMarker: '[data-blok-id="l1"] [data-list-marker]',
  bulletRootText: editable('l1'),
  bulletNestedMarker: '[data-blok-id="l2"] [data-list-marker]',
  bulletNestedText: editable('l2'),
  numberRootMarker: '[data-blok-id="o1"] [data-list-marker]',
  numberNestedMarker: '[data-blok-id="o2"] [data-list-marker]',
  numberNestedText: editable('o2'),
  checkbox: '[data-blok-id="c1"] input[type="checkbox"]',
  checkText: editable('c1'),
  toggleTitle: editable('t1'),
  toggleChild: editable('t2'),
  quoteText: editable('q'),
  calloutText: editable('co'),
  headingArrow: '[data-blok-id="h"] [data-blok-toggle-arrow]',
  headingText: '[data-blok-id="h"] h2',
  headingChild: editable('h2c'),
};

test.describe('RTL block content mirrors LTR', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('nesting, lists, toggles, quote, callout and toggle headings mirror', async ({ page }) => {
    await createBlok(page, CONTENT_BLOCKS, 'ltr');
    const ltr = await measureLogical(page, CONTENT_PROBES);

    await createBlok(page, CONTENT_BLOCKS, 'rtl');
    const rtl = await measureLogical(page, CONTENT_PROBES);

    // Sanity: nesting really indents in LTR, so equality below is meaningful.
    expect(ltr.bulletNestedMarker[0]).toBeGreaterThan(ltr.bulletRootMarker[0]);
    expect(ltr.toggleChild[0]).toBeGreaterThan(ltr.toggleTitle[0] - 1);

    for (const name of Object.keys(CONTENT_PROBES)) {
      expect.soft(rtl[name], name).toEqual(ltr[name]);
    }
  });

  test('bookmark and audio rows mirror', async ({ page }) => {
    const favicon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>')}`;
    const blocks: OutputData['blocks'] = [
      { id: 'bm', type: 'bookmark', data: { url: 'https://example.com', title: 'Example', description: 'Desc', favicon, domain: 'example.com' } },
      { id: 'au', type: 'audio', data: { url: 'https://example.com/a.mp3', title: 'Song', artist: 'Artist' } },
    ];
    const probes = {
      favicon: '[data-blok-id="bm"] .blok-bookmark__favicon',
      bookmarkUrl: '[data-blok-id="bm"] .blok-bookmark__url',
      play: '[data-blok-id="au"] [data-role="audio-play"]',
      time: '[data-blok-id="au"] .blok-audio-controls__time',
    };

    await createBlok(page, blocks, 'ltr');
    await expect(page.locator(probes.time)).toBeVisible();
    const ltr = await measureLogical(page, probes);

    await createBlok(page, blocks, 'rtl');
    await expect(page.locator(probes.time)).toBeVisible();
    const rtl = await measureLogical(page, probes);

    for (const name of Object.keys(probes)) {
      expect.soft(rtl[name], name).toEqual(ltr[name]);
    }
  });

  test('stub, spacer readout, code language chevron and media empty state mirror', async ({ page }) => {
    const blocks: OutputData['blocks'] = [
      { id: 'st', type: 'not-a-registered-tool', data: { text: 'x' } },
      { id: 'sp', type: 'spacer', data: { height: 40 } },
      { id: 'cd', type: 'code', data: { code: 'a', language: 'javascript' } },
      { id: 'im', type: 'image', data: {} },
    ];
    const probes = {
      mediaEmptyLabel: '[data-blok-id="im"] .blok-media-empty__label',
      mediaEmptyTabs: '[data-blok-id="im"] .blok-media-empty__tabs',
      stubInfo: '[data-blok-id="st"] [data-blok-stub-info]',
      spacerReadout: '[data-blok-id="sp"] [data-blok-spacer-readout]',
      codeChevron: '[data-blok-id="cd"] [data-blok-testid="code-language-chevron"]',
      codeLanguage: '[data-blok-id="cd"] [data-blok-testid="code-language-name"]',
    };

    await createBlok(page, blocks, 'ltr');
    const ltr = await measureLogical(page, probes);

    await createBlok(page, blocks, 'rtl');
    const rtl = await measureLogical(page, probes);

    for (const name of Object.keys(probes)) {
      expect.soft(rtl[name], name).toEqual(ltr[name]);
    }
  });

  test('quote rule sits on the inline-start side', async ({ page }) => {
    const read = async (): Promise<{ left: string; right: string }> => page.evaluate(() => {
      const el = document.querySelector('[data-blok-id="q"] [contenteditable="true"]')?.closest('blockquote')
        ?? document.querySelector('[data-blok-id="q"] [contenteditable="true"]');

      if (!el) {
        throw new Error('no quote');
      }

      const cs = getComputedStyle(el);

      return { left: cs.borderLeftWidth, right: cs.borderRightWidth };
    });

    await createBlok(page, CONTENT_BLOCKS, 'ltr');
    expect(await read()).toEqual({ left: '3px', right: '0px' });

    await createBlok(page, CONTENT_BLOCKS, 'rtl');
    expect(await read()).toEqual({ left: '0px', right: '3px' });
  });

  test('collapsed toggle chevron points toward the inline end (left in RTL)', async ({ page }) => {
    const blocks: OutputData['blocks'] = [
      { id: 'tc', type: 'toggle', data: { text: 'Closed', isOpen: false } },
      { id: 'to', type: 'toggle', data: { text: 'Open', isOpen: true } },
    ];
    // Direction the chevron tip points, from the svg's transform matrix: +1 right, -1 left, 0 down.
    const read = async (): Promise<{ closed: number; open: number }> => page.evaluate(() => {
      const xOf = (id: string): number => {
        const svg = document.querySelector(`[data-blok-id="${id}"] svg`);

        if (!svg) {
          throw new Error(`no svg in ${id}`);
        }

        const matrix = new DOMMatrix(getComputedStyle(svg).transform === 'none' ? undefined : getComputedStyle(svg).transform);

        return Math.round(matrix.a);
      };

      return { closed: xOf('tc'), open: xOf('to') };
    });

    await createBlok(page, blocks, 'ltr');
    expect(await read()).toEqual({ closed: 1, open: 0 });

    await createBlok(page, blocks, 'rtl');
    expect(await read()).toEqual({ closed: -1, open: 0 });

    // An LTR block inside the RTL editor keeps the LTR chevron. Polled: the
    // svg transitions its transform.
    await page.evaluate(() => {
      document.querySelector('[data-blok-id="tc"]')?.setAttribute('dir', 'ltr');
    });
    await expect.poll(read).toEqual({ closed: 1, open: 0 });
  });

  test('code body stays LTR with the gutter on the left', async ({ page }) => {
    const blocks: OutputData['blocks'] = [
      { id: 'cd', type: 'code', data: { code: 'const a = 1;', language: 'javascript' } },
    ];
    const read = async (): Promise<{ direction: string; gutterLeftOfCode: boolean }> => page.evaluate(() => {
      const code = document.querySelector('[data-blok-id="cd"] [data-blok-testid="code-content"]');
      const gutter = document.querySelector('[data-blok-id="cd"] [data-blok-testid="code-gutter"]');

      if (!code || !gutter) {
        throw new Error('no code parts');
      }

      return {
        direction: getComputedStyle(code).direction,
        gutterLeftOfCode: gutter.getBoundingClientRect().right <= code.getBoundingClientRect().left + 1,
      };
    });

    await createBlok(page, blocks, 'ltr');
    expect(await read()).toEqual({ direction: 'ltr', gutterLeftOfCode: true });

    await createBlok(page, blocks, 'rtl');
    expect(await read()).toEqual({ direction: 'ltr', gutterLeftOfCode: true });
  });
  for (const contentAlign of [ 'left', 'right' ] as const) {
    test(`contentAlign '${contentAlign}' means the inline ${contentAlign === 'left' ? 'start' : 'end'}`, async ({ page }) => {
      const blocks: OutputData['blocks'] = [ { id: 'p1', type: 'paragraph', data: { text: 'Aligned' } } ];
      const probes = { column: '[data-blok-id="p1"] [data-blok-element-content]' };

      await createBlok(page, blocks, 'ltr', { contentAlign });
      const ltr = await measureLogical(page, probes);

      await createBlok(page, blocks, 'rtl', { contentAlign });
      const rtl = await measureLogical(page, probes);

      // The column is narrower than the holder, so alignment is observable.
      expect(ltr.column[0]).not.toBe(ltr.column[1]);
      expect(rtl.column).toEqual(ltr.column);
    });
  }
});
