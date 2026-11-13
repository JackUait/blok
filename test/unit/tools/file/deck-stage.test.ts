import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { openDeckStage } from '../../../../src/tools/file/deck-stage';
import { detachedChrome, type PreviewChrome } from '../../../../src/tools/file/preview-chrome';
import type { DeckOptions, DeckView } from '../../../../src/tools/file/pptx/viewer';

const W = 960;
const H = 540;

interface Fake {
  open: (buf: ArrayBuffer, container: HTMLElement, isCancelled?: () => boolean, options?: DeckOptions) => Promise<DeckView>;
  destroy: ReturnType<typeof vi.fn>;
  options: () => DeckOptions;
  slides: HTMLElement[];
  linkClicks: ReturnType<typeof vi.fn>;
}

/** Stands in for the pptx viewer: `count` slides, each "Slide n" with a link on it. */
function fakeDeck(count: number): Fake {
  const destroy = vi.fn();
  const linkClicks = vi.fn();
  const slides: HTMLElement[] = [];
  const held: { options: DeckOptions } = { options: {} };

  return {
    destroy, linkClicks, slides,
    options: () => held.options,
    open: async (_buf, container, _isCancelled, options = {}) => {
      held.options = options;
      Array.from({ length: count }, (_, index) => {
        const card = document.createElement('div');
        const slide = document.createElement('div');
        slide.style.transform = 'scale(0.1)';
        slide.innerHTML = `<p>Slide ${index + 1}</p><span role="link">more</span>`;
        slide.querySelector('[role="link"]')?.addEventListener('click', () => {
          linkClicks(index);
        });
        card.appendChild(slide);
        slides.push(slide);
        container.appendChild(options.wrap?.(card, index) ?? card);

        return card;
      });

      return { destroy, count, width: W, height: H };
    },
  };
}

interface Harness {
  container: HTMLElement;
  keys: Array<(event: KeyboardEvent) => void>;
  deck: DeckView;
  frame: HTMLElement;
  stageText: () => string;
  thumbs: () => HTMLElement[];
  current: () => Array<string | null>;
  key: (key: string) => void;
}

async function harness(fake: Fake, stageSize = { width: W + 48, height: H + 40 }): Promise<Harness> {
  const body = document.createElement('div');
  const container = document.createElement('div');
  body.appendChild(container);
  document.body.appendChild(body);
  // The stage is created inside openDeckStage; size every stage element the same.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function clientWidth(this: HTMLElement) {
    return this.getAttribute('data-role') === 'file-preview-stage' ? stageSize.width : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function clientHeight(this: HTMLElement) {
    return this.getAttribute('data-role') === 'file-preview-stage' ? stageSize.height : 0;
  });
  const keys: Array<(event: KeyboardEvent) => void> = [];
  const chrome: PreviewChrome = {
    ...detachedChrome(body),
    onKey: (handler) => keys.push(handler),
  };
  const deck = await openDeckStage(new ArrayBuffer(4), container, chrome, fake.open);
  const frame = container.querySelector<HTMLElement>('[data-role="file-preview-stage-frame"]');
  if (frame === null) {
    throw new Error('no frame');
  }
  const thumbs = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>('[data-role="file-preview-thumb"]'));

  return {
    container, keys, deck, frame, thumbs,
    stageText: () => frame.querySelector('p')?.textContent ?? '',
    current: () => thumbs().map((thumb) => thumb.getAttribute('aria-current')),
    key: (key) => keys.forEach((handler) => handler(new KeyboardEvent('keydown', { key }))),
  };
}

describe('openDeckStage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('shows the first slide on the stage and every slide in the filmstrip', async () => {
    const h = await harness(fakeDeck(3));

    expect(h.stageText()).toBe('Slide 1');
    expect(h.thumbs().map((thumb) => thumb.getAttribute('aria-label'))).toEqual(['Slide 1', 'Slide 2', 'Slide 3']);
    expect(h.thumbs().map((thumb) => thumb.querySelector('[data-role="file-preview-thumb-number"]')?.textContent)).toEqual(['1', '2', '3']);
    expect(h.current()).toEqual(['true', 'false', 'false']);
  });

  it('puts a copy on the stage and leaves the slide itself in the filmstrip', async () => {
    const fake = fakeDeck(2);
    const h = await harness(fake);

    expect(h.thumbs()[0].contains(fake.slides[0])).toBe(true);
    expect(h.frame.contains(fake.slides[0])).toBe(false);
    // A slide in the strip is a picture of itself: it takes no clicks and no focus.
    expect(fake.slides[0].parentElement?.hasAttribute('inert')).toBe(true);
  });

  it('fits the slide to the stage, by width or by height, whichever is tighter', async () => {
    const wide = await harness(fakeDeck(1));
    expect(wide.frame.style.width).toBe('960px');
    expect(wide.frame.style.height).toBe('540px');
    document.body.replaceChildren();
    vi.restoreAllMocks();

    // (528 - 48) / 960 = 0.5 by width; (1040 - 40) / 540 would allow more.
    const narrow = await harness(fakeDeck(1), { width: 528, height: 1040 });
    expect(narrow.frame.style.width).toBe('480px');
    expect(narrow.frame.style.height).toBe('270px');
    expect(narrow.frame.querySelector<HTMLElement>('[data-role="file-preview-stage-sheet"] > *')?.style.transform).toBe('scale(0.5)');
    document.body.replaceChildren();
    vi.restoreAllMocks();

    // (310 - 40) / 540 = 0.5 by height.
    const short = await harness(fakeDeck(1), { width: 2000, height: 310 });
    expect(short.frame.style.width).toBe('480px');
  });

  it('goes to the slide whose thumbnail is pressed', async () => {
    const h = await harness(fakeDeck(3));
    h.thumbs()[2].click();

    expect(h.stageText()).toBe('Slide 3');
    expect(h.current()).toEqual(['false', 'false', 'true']);
  });

  it('activates a thumbnail from the keyboard with Enter or Space', async () => {
    const h = await harness(fakeDeck(3));

    h.thumbs()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(h.stageText()).toBe('Slide 2');

    h.thumbs()[2].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(h.stageText()).toBe('Slide 3');
  });

  it('steps with the arrow keys and stops at both ends', async () => {
    const h = await harness(fakeDeck(2));

    h.key('ArrowLeft');
    expect(h.stageText()).toBe('Slide 1');
    h.key('ArrowRight');
    expect(h.stageText()).toBe('Slide 2');
    h.key('ArrowRight');
    expect(h.stageText()).toBe('Slide 2');
    h.key('ArrowLeft');
    expect(h.stageText()).toBe('Slide 1');
  });

  it('goes forward on a click in the right half of the slide and back in the left half', async () => {
    const h = await harness(fakeDeck(3));
    h.frame.getBoundingClientRect = () => new DOMRect(100, 0, 960, 540);

    h.frame.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100 + 481 }));
    expect(h.stageText()).toBe('Slide 2');

    h.frame.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100 + 479 }));
    expect(h.stageText()).toBe('Slide 1');
  });

  it('passes a click on a link in the copy to the same link on the real slide', async () => {
    const fake = fakeDeck(3);
    const h = await harness(fake);
    h.frame.getBoundingClientRect = () => new DOMRect(0, 0, 960, 540);

    h.frame.querySelector<HTMLElement>('[role="link"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 900 }));

    expect(fake.linkClicks).toHaveBeenCalledWith(0);
    // The link got the click; the slide did not also turn.
    expect(h.stageText()).toBe('Slide 1');
  });

  it('follows a link that points at another slide of the deck', async () => {
    const fake = fakeDeck(3);
    const h = await harness(fake);

    fake.options().onGoToSlide?.(2);

    expect(h.stageText()).toBe('Slide 3');
    expect(h.current()).toEqual(['false', 'false', 'true']);
  });

  it('asks the viewer for thumbnail-sized slides', async () => {
    const fake = fakeDeck(1);
    await harness(fake);

    expect(fake.options().fitWidth?.()).toBe(112);
  });

  it('redraws the copy when the real slide changes, as when a picture lands late', async () => {
    const fake = fakeDeck(1);
    const h = await harness(fake);
    const text = fake.slides[0].querySelector('p');
    if (text === null) {
      throw new Error('no text');
    }

    text.textContent = 'Slide 1, loaded';
    await vi.waitFor(() => expect(h.stageText()).toBe('Slide 1, loaded'));
  });

  it('destroys the deck and empties its container', async () => {
    const fake = fakeDeck(2);
    const h = await harness(fake);

    h.deck.destroy();

    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(h.container.childElementCount).toBe(0);
  });
});
