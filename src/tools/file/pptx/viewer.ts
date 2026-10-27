import { parseZip, RECOMMENDED_ZIP_LIMITS } from './parser/ZipParser';
import { buildPresentation, type PresentationData } from './model/Presentation';
import { renderSlide, type SlideHandle } from './renderer/SlideRenderer';
import { isAllowedExternalUrl } from './utils/urlSafety';

/** An open deck in a container. */
export interface DeckView {
  destroy(): void;
}

/** Slides drawn before yielding a frame, so a long deck does not freeze the page. */
const BATCH_SIZE = 12;

const nextFrame = (): Promise<void> => new Promise((resolve) => {
  requestAnimationFrame(() => resolve());
});

/**
 * Draws every slide of a .pptx into `container`, scaled to its width, and keeps
 * the scale in step with the container's width. Resolves once the deck is
 * parsed and the first slides are on screen; the rest follow frame by frame.
 */
export async function openDeck(buf: ArrayBuffer, container: HTMLElement): Promise<DeckView> {
  const presentation = buildPresentation(await parseZip(buf, RECOMMENDED_ZIP_LIMITS));
  const mediaUrlCache = new Map<string, string>();
  const handles: SlideHandle[] = [];
  const cards: HTMLElement[] = [];
  const state = { destroyed: false };

  const scale = (): number => (container.clientWidth || presentation.width) / presentation.width;

  const fit = (card: HTMLElement, handle: SlideHandle, factor: number): void => {
    Object.assign(card.style, {
      width: `${presentation.width * factor}px`,
      height: `${presentation.height * factor}px`,
    });
    Object.assign(handle.element.style, { transform: `scale(${factor})` });
  };

  const goTo = (target: { slideIndex?: number; url?: string }): void => {
    if (target.slideIndex !== undefined) {
      cards[target.slideIndex]?.scrollIntoView({ block: 'start', behavior: 'smooth' });

      return;
    }
    if (target.url !== undefined && isAllowedExternalUrl(target.url)) {
      window.open(target.url, '_blank', 'noopener,noreferrer');
    }
  };

  const drawSlide = (index: number): HTMLElement => {
    const card = document.createElement('div');

    card.style.position = 'relative';
    card.style.overflow = 'hidden';
    card.style.background = '#fff';
    cards.push(card);
    try {
      const handle = renderSlide(presentation, presentation.slides[index], { mediaUrlCache, onNavigate: goTo });

      handle.element.style.transformOrigin = 'top left';
      handles.push(handle);
      card.appendChild(handle.element);
      fit(card, handle, scale());
    } catch (error) {
      // A slide that cannot be drawn stays a blank card; the rest of the deck still shows.
      console.warn('[blok] Failed to render pptx slide', index + 1, error);
      card.style.width = `${presentation.width * scale()}px`;
      card.style.height = `${presentation.height * scale()}px`;
    }

    return card;
  };

  const refit = (): void => {
    const factor = scale();

    handles.forEach((handle) => {
      const card = handle.element.parentElement;

      if (card !== null) {
        fit(card, handle, factor);
      }
    });
  };

  const observer = new ResizeObserver(refit);

  const destroy = (): void => {
    if (state.destroyed) {
      return;
    }
    state.destroyed = true;
    observer.disconnect();
    handles.forEach((handle) => handle.dispose());
    mediaUrlCache.forEach((url) => URL.revokeObjectURL(url));
    mediaUrlCache.clear();
    container.replaceChildren();
  };

  const drawBatch = (from: number): void => {
    const fragment = document.createDocumentFragment();
    const count = Math.min(BATCH_SIZE, presentation.slides.length - from);

    Array.from({ length: count }, (_, offset) => fragment.appendChild(drawSlide(from + offset)));
    container.appendChild(fragment);
  };

  const drawRest = async (deck: PresentationData, from: number): Promise<void> => {
    if (from >= deck.slides.length) {
      return;
    }
    await nextFrame();
    if (state.destroyed) {
      return;
    }
    drawBatch(from);
    await drawRest(deck, from + BATCH_SIZE);
  };

  container.replaceChildren();
  drawBatch(0);
  observer.observe(container);
  void drawRest(presentation, BATCH_SIZE);

  return { destroy };
}
