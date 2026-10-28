import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import './helpers/domShims';
import { buildDeck } from './helpers/buildDeck';
import type * as SlideRendererModule from '../../../../../src/tools/file/pptx/renderer/SlideRenderer';
import type { SlideHandle } from '../../../../../src/tools/file/pptx/renderer/SlideRenderer';

vi.mock('../../../../../src/tools/file/pptx/renderer/SlideRenderer', async (importOriginal) => {
  const actual = await importOriginal<typeof SlideRendererModule>();

  return { ...actual, renderSlide: vi.fn(actual.renderSlide) };
});

import { renderSlide } from '../../../../../src/tools/file/pptx/renderer/SlideRenderer';
import { openDeck } from '../../../../../src/tools/file/pptx/viewer';

const { renderSlide: realRenderSlide } = await vi.importActual<typeof SlideRendererModule>(
  '../../../../../src/tools/file/pptx/renderer/SlideRenderer'
);

/** 9144000 EMU wide = 960 px. */
const SLIDE_WIDTH = 960;

const resizeObservers: Array<() => void> = [];

class FakeResizeObserver {
  constructor(callback: () => void) {
    resizeObservers.push(callback);
  }

  public observe(): void {
    // The test fires the callback by hand.
  }

  public disconnect(): void {
    // Nothing to release.
  }
}

const frames: Array<() => void> = [];

const runAllFrames = async (): Promise<void> => {
  while (frames.length > 0) {
    frames.splice(0).forEach((frame) => frame());
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const containerOf = (width: { value: number }): HTMLElement => {
  const container = document.createElement('div');

  Object.defineProperty(container, 'clientWidth', { configurable: true, get: () => width.value });
  document.body.appendChild(container);

  return container;
};

const cards = (container: HTMLElement): HTMLElement[] => Array.from(container.children).filter(
  (child): child is HTMLElement => child instanceof HTMLElement
);

const slideTexts = (count: number): Array<{ text: string }> => Array.from({ length: count }, (_, i) => ({ text: `Slide ${i + 1}` }));

/** Makes the second slide of every deck fail to draw. */
const breakSecondSlide = (): void => {
  vi.mocked(renderSlide).mockImplementation((presentation, slide, options) => {
    if (slide === presentation.slides[1]) {
      throw new Error('broken slide');
    }

    return realRenderSlide(presentation, slide, options);
  });
};

describe('openDeck with real decks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(renderSlide).mockImplementation(realRenderSlide);
    resizeObservers.length = 0;
    frames.length = 0;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('refuses a zip with more entries than an upload may have', async () => {
    const zip = await JSZip.loadAsync(await buildDeck([{ text: 'Only slide' }]));
    const present = Object.values(zip.files).filter((file) => !file.dir).length;

    Array.from({ length: 4_001 - present }, (_, i) => zip.file(`ppt/padding/${i}.txt`, 'x'));
    const buf = await zip.generateAsync({ type: 'arraybuffer' });

    await expect(openDeck(buf, containerOf({ value: SLIDE_WIDTH }))).rejects.toThrow(/zip limit exceeded: entries/);
  });

  it('draws every slide of a deck longer than one batch', async () => {
    const container = containerOf({ value: SLIDE_WIDTH });

    await openDeck(await buildDeck(slideTexts(30)), container);
    await runAllFrames();

    expect(cards(container)).toHaveLength(30);
    expect(cards(container)[29].textContent).toContain('Slide 30');
  });

  it('keeps the other slides when one slide cannot be drawn', async () => {
    breakSecondSlide();
    const container = containerOf({ value: SLIDE_WIDTH / 2 });

    await openDeck(await buildDeck(slideTexts(3)), container);
    const [first, second, third] = cards(container);

    expect(cards(container)).toHaveLength(3);
    expect(second.textContent).toBe('');
    expect(second.style.width).toBe('480px');
    expect(second.style.height).toBe('360px');
    expect(first.textContent).toContain('Slide 1');
    expect(third.textContent).toContain('Slide 3');
  });

  it('refits a slide that could not be drawn when the width changes', async () => {
    breakSecondSlide();
    const width = { value: SLIDE_WIDTH / 2 };
    const container = containerOf(width);

    await openDeck(await buildDeck(slideTexts(3)), container);
    width.value = SLIDE_WIDTH;
    resizeObservers.forEach((callback) => callback());

    expect(cards(container)[1].style.width).toBe('960px');
    expect(cards(container)[1].style.height).toBe('720px');
    expect(cards(container)[0].style.width).toBe('960px');
  });

  it('releases every slide on destroy', async () => {
    const handles: SlideHandle[] = [];

    vi.mocked(renderSlide).mockImplementation((presentation, slide, options) => {
      const handle = realRenderSlide(presentation, slide, options);

      vi.spyOn(handle, 'dispose');
      handles.push(handle);

      return handle;
    });
    const deck = await openDeck(await buildDeck(slideTexts(3)), containerOf({ value: SLIDE_WIDTH }));

    deck.destroy();

    expect(handles).toHaveLength(3);
    handles.forEach((handle) => expect(handle.dispose).toHaveBeenCalledTimes(1));
  });

  it('never opens a script link, even one the slide renderer lets through', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const navigate: Array<(target: { url?: string }) => void> = [];

    vi.mocked(renderSlide).mockImplementation((presentation, slide, options) => {
      if (options?.onNavigate !== undefined) {
        navigate.push(options.onNavigate);
      }

      return realRenderSlide(presentation, slide, options);
    });
    await openDeck(await buildDeck(slideTexts(1)), containerOf({ value: SLIDE_WIDTH }));

    navigate.forEach((go) => go({ url: 'javascript:alert(1)' }));
    expect(open).not.toHaveBeenCalled();

    navigate.forEach((go) => go({ url: 'https://example.com/' }));
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
  });

  it('draws nothing when the preview closed while the deck was parsing', async () => {
    const container = containerOf({ value: SLIDE_WIDTH });
    const before = document.createElement('p');

    container.appendChild(before);
    const deck = await openDeck(await buildDeck(slideTexts(3)), container, () => true);

    expect(renderSlide).not.toHaveBeenCalled();
    expect(resizeObservers).toHaveLength(0);
    expect(frames).toHaveLength(0);
    expect(container.firstChild).toBe(before);
    expect(() => deck.destroy()).not.toThrow();
  });

  it('draws the deck when the preview is still open', async () => {
    const container = containerOf({ value: SLIDE_WIDTH });

    await openDeck(await buildDeck(slideTexts(2)), container, () => false);

    expect(cards(container)).toHaveLength(2);
  });
});
