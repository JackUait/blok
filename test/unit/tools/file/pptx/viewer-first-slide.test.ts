import { describe, it, expect, vi, beforeEach } from 'vitest';
import './helpers/domShims';
import { buildDeck } from './helpers/buildDeck';
import type * as SlideRendererModule from '../../../../../src/tools/file/pptx/renderer/SlideRenderer';

vi.mock('../../../../../src/tools/file/pptx/renderer/SlideRenderer', async (importOriginal) => {
  const actual = await importOriginal<typeof SlideRendererModule>();

  return { ...actual, renderSlide: vi.fn(actual.renderSlide) };
});

import { renderSlide } from '../../../../../src/tools/file/pptx/renderer/SlideRenderer';
import { openFirstSlide } from '../../../../../src/tools/file/pptx/viewer';

const texts = (n: number): Array<{ text: string }> => Array.from({ length: n }, (_, i) => ({ text: `Slide ${i + 1}` }));

describe('openFirstSlide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('draws only the first slide of a long deck and reports the deck size', async () => {
    const view = await openFirstSlide(await buildDeck(texts(5)));

    expect(renderSlide).toHaveBeenCalledTimes(1);
    expect(view?.count).toBe(5);
    expect(view?.width).toBe(960);
    expect(view?.element).toBeInstanceOf(HTMLElement);
    view?.destroy();
  });

  it('draws nothing once cancelled', async () => {
    const view = await openFirstSlide(await buildDeck(texts(2)), () => true);

    expect(view).toBeNull();
    expect(renderSlide).not.toHaveBeenCalled();
  });
});
