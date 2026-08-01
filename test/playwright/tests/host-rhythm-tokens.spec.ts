// test/playwright/tests/host-rhythm-tokens.spec.ts

import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../src/components/constants';
import { expect, gotoTestPage, test } from './helpers/shared-page';

/**
 * The docs tell read-only hosts to tighten block rhythm by overriding
 * `--blok-block-padding-top/-bottom/-inline` on any ancestor. That override
 * must retune the space BETWEEN blocks without touching the callout panel's
 * own box inset (`--blok-callout-padding-block`, 5px default) and without
 * knocking the emoji off the first text line — the emoji deliberately keeps
 * tracking the rhythm tokens because the child text does.
 *
 * When the wrapper's inset rode the rhythm tokens, the documented override
 * collapsed the panel onto its text, and no host-side restore could fix panel
 * and emoji with one token. Only layout can prove the split works, so this
 * runs against the BUILT bundle and measures computed padding and line boxes.
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
    { id: 'plain-paragraph', type: 'paragraph', data: { text: 'A plain paragraph.' } },
    { id: 'callout-1', type: 'callout', data: { emoji: '💡', text: 'Callout body text.' } },
  ],
};

const CALLOUT_WRAPPER = '[data-blok-tool="callout"]';
const CALLOUT_EMOJI = '[data-blok-tool="callout"] [data-blok-testid="callout-emoji-face"]';
const CALLOUT_TEXT = '[data-blok-tool="callout"] [data-blok-tool="paragraph"]';
const PLAIN_PARAGRAPH = '[data-blok-id="plain-paragraph"] [data-blok-tool="paragraph"]';

const createBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder, initialData }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: initialData });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: DATA });
};

/** The documented compact-rendering override, applied where the docs say: any ancestor. */
const applyRhythmOverride = async (page: Page): Promise<void> => {
  await page.evaluate((holder) => {
    const container = document.getElementById(holder);

    container?.style.setProperty('--blok-block-padding-top', '0');
    container?.style.setProperty('--blok-block-padding-bottom', '0.2em');
    container?.style.setProperty('--blok-block-padding-inline', '0');
  }, HOLDER_ID);
};

const verticalPadding = async (page: Page, selector: string): Promise<{ top: number; bottom: number }> =>
  page.evaluate(({ root, target }) => {
    const el = document.querySelector(root)?.querySelector(target);

    if (!(el instanceof HTMLElement)) {
      throw new Error(`missing element: ${target}`);
    }
    const style = getComputedStyle(el);

    return { top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom) };
  }, { root: BLOK_INTERFACE_SELECTOR, target: selector });

/** Emoji box centre minus the text's first-line-box centre (padding + line-height, not glyph rects). */
const emojiCentreOffset = async (page: Page): Promise<number> =>
  page.evaluate(({ root, emojiSelector, textSelector }) => {
    const scope = document.querySelector(root);
    const emojiEl = scope?.querySelector(emojiSelector);
    const textEl = scope?.querySelector(textSelector);

    if (!(emojiEl instanceof HTMLElement) || !(textEl instanceof HTMLElement)) {
      throw new Error(`missing element: ${emojiSelector} / ${textSelector}`);
    }
    const emojiRect = emojiEl.getBoundingClientRect();
    const textStyle = getComputedStyle(textEl);
    const textCentre = textEl.getBoundingClientRect().top
      + parseFloat(textStyle.paddingTop)
      + (parseFloat(textStyle.lineHeight) / 2);

    return (emojiRect.top + (emojiRect.height / 2)) - textCentre;
  }, { root: BLOK_INTERFACE_SELECTOR, emojiSelector: CALLOUT_EMOJI, textSelector: CALLOUT_TEXT });

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('the documented rhythm override tightens blocks without collapsing the callout panel', async ({ page }) => {
  await createBlok(page);

  const restingOffset = await emojiCentreOffset(page);

  await applyRhythmOverride(page);

  // The override reaches block rhythm: the plain paragraph tightens.
  const paragraph = await verticalPadding(page, PLAIN_PARAGRAPH);

  expect(paragraph.top).toBe(0);
  expect(paragraph.bottom).toBeCloseTo(3.2, 1);

  // The callout panel's box inset is not rhythm — it keeps its 5px default.
  const wrapper = await verticalPadding(page, CALLOUT_WRAPPER);

  expect(wrapper.top).toBe(5);
  expect(wrapper.bottom).toBe(5);

  // The emoji keeps riding the rhythm tokens with the child text, so its
  // resting offset (-1px, from the paragraph's mt-px) must not move.
  const tightOffset = await emojiCentreOffset(page);

  expect(Math.abs(tightOffset - restingOffset)).toBeLessThanOrEqual(0.5);
});

test('a host retunes the callout panel inset through --blok-callout-padding-block', async ({ page }) => {
  await createBlok(page);

  await page.evaluate((holder) => {
    document.getElementById(holder)?.style.setProperty('--blok-callout-padding-block', '12px');
  }, HOLDER_ID);

  const wrapper = await verticalPadding(page, CALLOUT_WRAPPER);

  expect(wrapper.top).toBe(12);
  expect(wrapper.bottom).toBe(12);
});
