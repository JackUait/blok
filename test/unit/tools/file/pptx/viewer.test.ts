import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import './helpers/domShims';
import { buildDeck } from './helpers/buildDeck';
import { openDeck } from '../../../../../src/tools/file/pptx/viewer';

/** 9144000 EMU wide = 960 px; 6858000 EMU tall = 720 px. */
const SLIDE_WIDTH = 960;

type ResizeCallback = () => void;

const resizeObservers: Array<{ callback: ResizeCallback; disconnect: ReturnType<typeof vi.fn> }> = [];

class FakeResizeObserver {
  public readonly disconnect = vi.fn();

  constructor(callback: ResizeCallback) {
    resizeObservers.push({ callback, disconnect: this.disconnect });
  }

  public observe(): void {
    // The test fires the callback by hand.
  }
}

const containerOfWidth = (width: number): HTMLElement => {
  const container = document.createElement('div');

  Object.defineProperty(container, 'clientWidth', { configurable: true, get: () => width });
  document.body.appendChild(container);

  return container;
};

const cards = (container: HTMLElement): HTMLElement[] => Array.from(container.children).filter(
  (child): child is HTMLElement => child instanceof HTMLElement
);

describe('openDeck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resizeObservers.length = 0;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows every slide, scaled to the container width', async () => {
    const container = containerOfWidth(SLIDE_WIDTH / 2);

    await openDeck(await buildDeck([{ text: 'First slide' }, { text: 'Second slide' }]), container);

    const slides = cards(container);

    expect(slides).toHaveLength(2);
    expect(slides[0].style.width).toBe('480px');
    expect(slides[0].style.height).toBe('360px');
    expect(slides[0].firstElementChild).toHaveProperty('style.transform', 'scale(0.5)');
    expect(container.textContent).toContain('First slide');
    expect(container.textContent).toContain('Second slide');
  });

  it('refits the slides it already drew when the container width changes', async () => {
    const width = { value: SLIDE_WIDTH / 2 };
    const container = document.createElement('div');

    Object.defineProperty(container, 'clientWidth', { configurable: true, get: () => width.value });
    document.body.appendChild(container);
    await openDeck(await buildDeck([{ text: 'Only slide' }]), container);
    const slide = cards(container)[0].firstElementChild;

    width.value = SLIDE_WIDTH;
    resizeObservers.forEach(({ callback }) => callback());

    expect(cards(container)[0].style.width).toBe('960px');
    expect(cards(container)[0].style.height).toBe('720px');
    expect(cards(container)[0].firstElementChild).toBe(slide);
    expect(slide).toHaveProperty('style.transform', 'scale(1)');
  });

  it('falls back to the slide width when the container has no width yet', async () => {
    const container = containerOfWidth(0);

    await openDeck(await buildDeck([{ text: 'Hidden container' }]), container);

    expect(cards(container)[0].style.width).toBe('960px');
  });

  it('releases pictures, the resize observer and the slides on destroy', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const container = containerOfWidth(SLIDE_WIDTH);
    const deck = await openDeck(await buildDeck([{ text: 'With picture', picture: true }]), container);
    const pictureUrl = container.querySelector('img')?.getAttribute('src') ?? '';

    expect(pictureUrl).toMatch(/^blob:/);
    deck.destroy();

    expect(revoke).toHaveBeenCalledWith(pictureUrl);
    expect(resizeObservers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(container.childElementCount).toBe(0);
  });

  it('stops drawing the rest of a long deck once destroyed', async () => {
    const container = containerOfWidth(SLIDE_WIDTH);
    const frames: Array<() => void> = [];

    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
    const texts = Array.from({ length: 30 }, (_, i) => ({ text: `Slide ${i + 1}` }));
    const deck = await openDeck(await buildDeck(texts), container);

    expect(cards(container).length).toBeGreaterThan(0);
    expect(cards(container).length).toBeLessThan(30);
    deck.destroy();
    frames.splice(0).forEach((frame) => frame());
    await Promise.resolve();

    expect(container.childElementCount).toBe(0);
  });

  it('jumps to the linked slide when a link points inside the deck', async () => {
    const container = containerOfWidth(SLIDE_WIDTH);
    const scrollIntoView = vi.fn();

    Element.prototype.scrollIntoView = scrollIntoView;
    await openDeck(await buildDeck([
      { text: 'Go to the end', link: { target: 'slide2.xml', external: false } },
      { text: 'The end' },
    ]), container);

    const link = Array.from(container.querySelectorAll<HTMLElement>('[title]')).find((el) => el.textContent === 'Go to the end');

    link?.click();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(cards(container)[1]);
  });

  it('opens a linked web page in a new tab without giving it the opener', async () => {
    const container = containerOfWidth(SLIDE_WIDTH);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    await openDeck(await buildDeck([{ text: 'Linked box', shapeLink: 'https://example.com/page' }]), container);
    const box = Array.from(container.querySelectorAll<HTMLElement>('*')).find((el) => el.style.cursor === 'pointer');

    box?.click();

    expect(open).toHaveBeenCalledWith('https://example.com/page', '_blank', 'noopener,noreferrer');
  });

  it('never follows a script link from the deck', async () => {
    const container = containerOfWidth(SLIDE_WIDTH);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    await openDeck(await buildDeck([{ text: 'Bad box', shapeLink: 'javascript:alert(1)' }]), container);
    container.querySelectorAll('*').forEach((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(open).not.toHaveBeenCalled();
  });
});
