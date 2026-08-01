// test/playwright/tests/font-scale-alignment.spec.ts

import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../src/components/constants';
import { expect, gotoTestPage, test } from './helpers/shared-page';

/**
 * A block that puts an ornament beside its text — the callout's emoji, a
 * bulleted item's marker — has to keep that ornament centred on the FIRST line
 * box of the text at every font size the host can ask for via
 * `config.style.fontSize`.
 *
 * Both ornaments were pinned in absolute units (`text-[1.5rem]` on the emoji
 * button, `font-size: 24px` on the bullet) while the text beside them is sized
 * by the `--blok-*-font-size` tokens. They therefore only lined up at the one
 * font size the numbers were tuned for: at 1.5x the emoji sat 16.5px above the
 * centre of its text line and the bullet 6px above its own.
 *
 * Layout is the only thing that can prove this, so the check runs against the
 * BUILT bundle and measures real line boxes.
 */

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const DATA: OutputData = {
  blocks: [
    { type: 'callout', data: { emoji: '💡', text: 'This is a default callout.' } },
    { type: 'list', data: { style: 'unordered', text: 'A bulleted item', depth: 0 } },
    {
      id: 'callout-with-heading',
      type: 'callout',
      data: { emoji: '📌', text: '' },
      content: ['callout-heading-child'],
    },
    { id: 'callout-heading-child', type: 'header', data: { text: 'Heading in a callout', level: 1 }, parent: 'callout-with-heading' },
    {
      id: 'bookmark-card',
      type: 'bookmark',
      data: {
        url: 'https://github.com/jackuait/blok',
        title: 'Blok — headless block-based rich text editor',
        description: 'Notion-style editor where every content entity is a block.',
        favicon: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
      },
    },
  ],
};

/**
 * Mount a fresh editor whose every text scenario is multiplied by `scale`.
 * `calc(1em * n)` is what a host writes to scale the whole editor uniformly.
 */
const createScaledBlok = async (page: Page, scale: number): Promise<void> => {
  await page.evaluate(async ({ holder, initialData, textScale }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({
      holder,
      data: initialData,
      style: {
        fontSize: {
          paragraph: `calc(1em * ${textScale})`,
          callout: `calc(1em * ${textScale})`,
          list: { item: `calc(1em * ${textScale})` },
          heading: { 1: `calc(1.875rem * ${textScale})` },
          bookmark: {
            title: `calc(0.875em * ${textScale})`,
            description: `calc(0.75em * ${textScale})`,
            link: `calc(0.75em * ${textScale})`,
          },
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: DATA, textScale: scale });
};

interface Alignment {
  /** Ornament box centre minus the text's first-line-box centre, in px. */
  centreOffset: number;
  ornamentFontSize: number;
  textFontSize: number;
}

/**
 * Vertical offset between the ornament's box and the first line box of the text
 * beside it. Both are pure layout — the text's line box is derived from its
 * padding and line-height rather than a glyph rect, so colour-emoji bitmaps
 * (which snap to their own strike sizes) can't add noise to the reading.
 */
const measure = async (page: Page, ornament: string, text: string): Promise<Alignment> =>
  page.evaluate(({ root, ornamentSelector, textSelector }) => {
    const scope = document.querySelector(root);
    const ornamentEl = scope?.querySelector(ornamentSelector);
    const textEl = scope?.querySelector(textSelector);

    if (!(ornamentEl instanceof HTMLElement) || !(textEl instanceof HTMLElement)) {
      throw new Error(`missing element: ${ornamentSelector} / ${textSelector}`);
    }

    /** Centre of the element's content box — neither ornament has vertical padding. */
    const ornamentRect = ornamentEl.getBoundingClientRect();
    const ornamentCentre = ornamentRect.top + (ornamentRect.height / 2);

    const textStyle = getComputedStyle(textEl);
    const textCentre = textEl.getBoundingClientRect().top
      + parseFloat(textStyle.paddingTop)
      + (parseFloat(textStyle.lineHeight) / 2);

    return {
      centreOffset: ornamentCentre - textCentre,
      ornamentFontSize: parseFloat(getComputedStyle(ornamentEl).fontSize),
      textFontSize: parseFloat(textStyle.fontSize),
    };
  }, { root: BLOK_INTERFACE_SELECTOR, ornamentSelector: ornament, textSelector: text });

const CALLOUT_EMOJI = '[data-blok-tool="callout"] [data-blok-testid="callout-emoji-face"]';
const CALLOUT_TEXT = '[data-blok-tool="callout"] [data-blok-tool="paragraph"]';
const BULLET = '[data-list-style="unordered"] [data-list-marker]';
const BULLET_TEXT = '[data-list-style="unordered"] [data-blok-testid="list-content-container"]';

/** The scales a host reaches for, spanning the slider in the dev playground. */
const SCALES = [1, 1.5, 0.8];

/**
 * How far the offset may move ACROSS scales. The bug is drift, not the offset
 * itself: each ornament keeps its own tuned resting offset (the emoji's is -1px,
 * from the paragraph's `mt-px`), and what broke was that offset changing with
 * the font size — to 16.5px for the emoji and 6px for the bullet at 1.5x.
 */
const DRIFT_TOLERANCE_PX = 0.5;

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('callout body text applies the callout scale once, not once per nesting level', async ({ page }) => {
  await createScaledBlok(page, 1.5);

  /**
   * `--blok-callout-font-size` was applied twice down one inheritance chain:
   * once on the callout wrapper, then again on the child paragraph. A relative
   * token — and `calc(1em * n)` is how a host scales the editor — therefore
   * squared, rendering callout body text at 36px where a plain paragraph got
   * 24px, and leaving the emoji sized off a wrapper the text had outgrown.
   */
  const sizes = await page.evaluate((root) => {
    const scope = document.querySelector(root);
    const sizeOf = (el: Element | null | undefined): number =>
      (el instanceof HTMLElement ? parseFloat(getComputedStyle(el).fontSize) : NaN);

    return {
      calloutBody: sizeOf(scope?.querySelector('[data-blok-tool="callout"] [data-blok-tool="paragraph"]')),
      calloutWrapper: sizeOf(scope?.querySelector('[data-blok-tool="callout"]')),
    };
  }, BLOK_INTERFACE_SELECTOR);

  expect(sizes.calloutBody).toBeCloseTo(24, 0);
  expect(sizes.calloutBody).toBeCloseTo(sizes.calloutWrapper, 0);
});

/** Measure one ornament/text pair at every scale, remounting the editor for each. */
const measureAcrossScales = async (page: Page, ornament: string, text: string): Promise<Alignment[]> => {
  const readings: Alignment[] = [];

  for (const scale of SCALES) {
    await createScaledBlok(page, scale);
    readings.push(await measure(page, ornament, text));
  }

  return readings;
};

const drift = (readings: Alignment[]): number => {
  const offsets = readings.map(reading => reading.centreOffset);

  return Math.max(...offsets) - Math.min(...offsets);
};

test('callout emoji holds its place on the text line as the callout scale changes', async ({ page }) => {
  const readings = await measureAcrossScales(page, CALLOUT_EMOJI, CALLOUT_TEXT);

  for (const reading of readings) {
    expect(reading.ornamentFontSize).toBeCloseTo(reading.textFontSize * 1.5, 0);
  }
  expect(drift(readings)).toBeLessThanOrEqual(DRIFT_TOLERANCE_PX);
});

test('list bullet holds its place on the text line as the item scale changes', async ({ page }) => {
  const readings = await measureAcrossScales(page, BULLET, BULLET_TEXT);

  for (const reading of readings) {
    expect(reading.ornamentFontSize).toBeCloseTo(reading.textFontSize * 1.5, 0);
  }
  expect(drift(readings)).toBeLessThanOrEqual(DRIFT_TOLERANCE_PX);
});

/**
 * A callout whose first child is a heading gets a top margin on the emoji button
 * to drop it onto the heading's taller first line. Those margins were three
 * literals (8.5px / 4.6px / 2px) computed for the default heading sizes against a
 * 24px emoji, so scaling `fontSize.heading.1` or `fontSize.callout` moved both
 * line boxes and left the offsets behind.
 */
/**
 * The bookmark card is a shell built AROUND text the host sizes through
 * `fontSize.bookmark.*`: the content column's padding, the gaps between title,
 * description and link row, the favicon and every line box. All of it was
 * absolute (12px/14px padding, 2px/6px gaps, a 16px favicon, 20px/16px line
 * heights), so the card kept its 14px-tuned proportions while its text grew —
 * at 1.5x the text nearly touched the border and outgrew its own line boxes.
 *
 * Each metric is measured against the font size that governs it; the RATIO is
 * what must hold across scales.
 */
const bookmarkMetrics = async (page: Page): Promise<Record<string, number>> =>
  page.evaluate((root) => {
    const card = document.querySelector(root)?.querySelector('[data-blok-id="bookmark-card"]');
    const pick = (selector: string): CSSStyleDeclaration => {
      const el = card?.querySelector(selector);

      if (!(el instanceof HTMLElement)) {
        throw new Error(`missing bookmark element: ${selector}`);
      }

      return getComputedStyle(el);
    };

    const content = pick('[data-role="bookmark-content"]');
    const title = pick('[data-role="bookmark-title"]');
    const description = pick('[data-role="bookmark-description"]');
    const linkRow = pick('[data-role="bookmark-link-row"]');
    const favicon = pick('[data-role="bookmark-favicon"]');

    const titleSize = parseFloat(title.fontSize);
    const descriptionSize = parseFloat(description.fontSize);
    const linkSize = parseFloat(linkRow.fontSize);

    return {
      contentPaddingTop: parseFloat(content.paddingTop) / titleSize,
      contentPaddingLeft: parseFloat(content.paddingLeft) / titleSize,
      contentMinHeight: parseFloat(content.minHeight) / titleSize,
      titleLineHeight: parseFloat(title.lineHeight) / titleSize,
      descriptionMarginTop: parseFloat(description.marginTop) / descriptionSize,
      descriptionLineHeight: parseFloat(description.lineHeight) / descriptionSize,
      linkRowPaddingTop: parseFloat(linkRow.paddingTop) / linkSize,
      linkRowLineHeight: parseFloat(linkRow.lineHeight) / linkSize,
      faviconHeight: parseFloat(favicon.height) / linkSize,
      faviconMarginRight: parseFloat(favicon.marginRight) / linkSize,
    };
  }, BLOK_INTERFACE_SELECTOR);

test('bookmark card keeps its padding and gaps proportional as the bookmark scale changes', async ({ page }) => {
  const readings: Record<string, number>[] = [];

  for (const scale of SCALES) {
    await createScaledBlok(page, scale);
    readings.push(await bookmarkMetrics(page));
  }

  const [baseline, ...rest] = readings;

  for (const reading of rest) {
    for (const metric of Object.keys(baseline)) {
      expect(
        reading[metric],
        `${metric} drifted relative to its governing font size`
      ).toBeCloseTo(baseline[metric], 2);
    }
  }
});

test('callout emoji holds its place on a heading child as the scale changes', async ({ page }) => {
  const readings = await measureAcrossScales(
    page,
    '[data-blok-id="callout-with-heading"] [data-blok-testid="callout-emoji-face"]',
    '[data-blok-id="callout-with-heading"] [data-blok-tool="header"]'
  );

  expect(drift(readings)).toBeLessThanOrEqual(DRIFT_TOLERANCE_PX);
});
