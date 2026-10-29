import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../helpers/domShims';
import { buildDeck } from '../helpers/buildDeck';
import { editZip } from '../../docx/build-docx';
import { parseZip, RECOMMENDED_ZIP_LIMITS } from '../../../../../../src/tools/file/pptx/parser/ZipParser';
import { buildPresentation } from '../../../../../../src/tools/file/pptx/model/Presentation';
import type * as SlideRendererModule from '../../../../../../src/tools/file/pptx/renderer/SlideRenderer';

vi.mock('../../../../../../src/tools/file/pptx/renderer/SlideRenderer', async (importOriginal) => {
  const actual = await importOriginal<typeof SlideRendererModule>();

  return { ...actual, renderSlide: vi.fn(actual.renderSlide) };
});

import { renderSlide } from '../../../../../../src/tools/file/pptx/renderer/SlideRenderer';
import { DECK_SHAPE_BUDGET, openDeck } from '../../../../../../src/tools/file/pptx/viewer';

/**
 * Master shapes are drawn again on every slide, so a small deck can ask for
 * millions of DOM nodes. The viewer draws at most DECK_SHAPE_BUDGET shapes
 * across the whole deck.
 */

const MASTER_SHAPES = 1_000;
const SLIDES = 3;
/** A plain filled rect is drawn as three elements. */
const ELEMENTS_PER_RECT = 3;

const rect = (i: number): string => `<p:sp><p:nvSpPr><p:cNvPr id="${i + 10}" name="s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
  + '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="91440" cy="91440"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
  + '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp>';

const heavyMasterDeck = async (): Promise<ArrayBuffer> => {
  const base = await buildDeck(Array.from({ length: SLIDES }, (_, i) => ({ text: `Slide ${i + 1}` })));
  const tree = Array.from({ length: MASTER_SHAPES }, (_, i) => rect(i)).join('');

  return editZip(base, { 'ppt/slideMasters/slideMaster1.xml': (old) => old.replace('</p:spTree>', `${tree}</p:spTree>`) });
};

const frames: Array<() => void> = [];

const runAllFrames = async (): Promise<void> => {
  while (frames.length > 0) {
    frames.splice(0).forEach((frame) => frame());
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const containerOf = (): HTMLElement => {
  const container = document.createElement('div');

  Object.defineProperty(container, 'clientWidth', { configurable: true, get: () => 960 });
  document.body.appendChild(container);

  return container;
};

class FakeResizeObserver {
  public observe(): void {
    // Not needed here.
  }

  public disconnect(): void {
    // Not needed here.
  }
}

describe('a pptx whose master repeats many shapes on every slide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    frames.length = 0;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('draws no more shapes than the budget the slides share', async () => {
    const presentation = buildPresentation(await parseZip(await heavyMasterDeck(), RECOMMENDED_ZIP_LIMITS));
    const shapeBudget = { remaining: 2_500 };
    const mediaUrlCache = new Map<string, string>();
    const slides = presentation.slides.slice(0, 3).map((slide) => renderSlide(presentation, slide, { mediaUrlCache, shapeBudget }).element);
    const drawn = slides.reduce((sum, slide) => sum + slide.querySelectorAll('*').length, 0);

    expect(drawn).toBeLessThanOrEqual(2_500 * ELEMENTS_PER_RECT + 3 * 10);
    expect(shapeBudget.remaining).toBe(0);
    expect(slides[0].textContent).toContain('Slide 1');
  }, 60_000);

  it('gives every slide of a deck the same budget', async () => {
    const container = containerOf();
    const view = await openDeck(await buildDeck([{ text: 'a' }, { text: 'b' }]), container);

    await runAllFrames();
    const budgets = new Set(vi.mocked(renderSlide).mock.calls.map(([, , options]) => options?.shapeBudget));

    expect(budgets.size).toBe(1);
    expect([...budgets][0]?.remaining).toBeLessThan(DECK_SHAPE_BUDGET);
    view.destroy();
  });

  it('draws a real deck in full', async () => {
    const buf = readFileSync(resolve(__dirname, '../../../../../../public/samples/pitch-deck.pptx'));
    const deck = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const presentation = buildPresentation(await parseZip(deck, RECOMMENDED_ZIP_LIMITS));
    const unbounded = presentation.slides
      .map((slide) => renderSlide(presentation, slide, { mediaUrlCache: new Map() }).element.querySelectorAll('*').length + 1)
      .reduce((sum, count) => sum + count, 0);
    const container = containerOf();

    await openDeck(deck, container);
    await runAllFrames();

    expect(container.querySelectorAll('*').length - container.children.length).toBe(unbounded);
  }, 60_000);
});
