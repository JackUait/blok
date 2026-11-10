/**
 * The skin-tone Arc: a half dial of six tone segments under a toggle that shows
 * the current tone as a dot. Choosing folds the dial shut and flies the chosen
 * tone into the dot as a circle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiPicker } from '../../../../../src/tools/callout/emoji-picker';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

const EMOJI_MART_FIXTURE = {
  categories: [{ id: 'people', emojis: ['wave', 'grinning'] }],
  emojis: {
    wave: { id: 'wave', name: 'Waving Hand', keywords: ['hello'], skins: [
      { native: '👋', unified: '1f44b' }, { native: '👋🏻', unified: '1f44b-1f3fb' }, { native: '👋🏼', unified: '1f44b-1f3fc' },
      { native: '👋🏽', unified: '1f44b-1f3fd' }, { native: '👋🏾', unified: '1f44b-1f3fe' }, { native: '👋🏿', unified: '1f44b-1f3ff' },
    ], version: 1 },
    grinning: { id: 'grinning', name: 'Grinning Face', keywords: ['happy'], skins: [{ native: '😀', unified: '1f600' }], version: 1 },
  },
  aliases: {},
};

vi.mock('../../../../../src/components/utils/emoji/emoji-grid.json', async () => (await import('../../../components/utils/emoji/emoji-data.fixture')).emojiGridModule(EMOJI_MART_FIXTURE));
vi.mock('../../../../../src/components/utils/emoji/emoji-keywords.json', async () => (await import('../../../components/utils/emoji/emoji-data.fixture')).emojiKeywordsModule(EMOJI_MART_FIXTURE));

/** jsdom has no Web Animations; these fakes finish when the test says so. */
interface FakeAnimation { finished: Promise<unknown>; cancel: () => void; finish: () => void; onfinish: null; target?: Element; cancelled?: boolean }

const animations: FakeAnimation[] = [];
const started: FakeAnimation[] = [];

function fakeAnimate(this: Element): FakeAnimation {
  let resolve: (value: unknown) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const animation: FakeAnimation = {
    finished: new Promise((ok, fail) => { resolve = ok; reject = fail; }),
    cancel: () => {
      animation.cancelled = true;
      reject(new DOMException('cancelled', 'AbortError'));
    },
    finish: () => resolve(animation),
    onfinish: null,
    target: this,
  };

  animation.finished.catch(() => undefined);
  animations.push(animation);
  started.push(animation);

  return animation;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 12; round++) {
    animations.splice(0).forEach(animation => animation.finish());
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

describe('EmojiPicker skin-tone Arc', () => {
  let picker: EmojiPicker;
  let anchor: HTMLButtonElement;
  let element: HTMLElement;

  const query = <T extends Element = HTMLElement>(selector: string): T => {
    const node = element.querySelector<T>(selector);

    if (node === null) {
      throw new Error(`Missing ${selector}`);
    }

    return node;
  };
  const toggle = (): HTMLButtonElement => query<HTMLButtonElement>('[data-emoji-picker-skin-toggle]');
  const dial = (): HTMLElement => query('[data-emoji-picker-skin-tone]');
  const segments = (): HTMLButtonElement[] => [...dial().querySelectorAll<HTMLButtonElement>('button')];
  const stubMotion = (reduce: boolean): void => {
    vi.stubGlobal('matchMedia', vi.fn((media: string) => ({ matches: reduce && media.includes('reduce') })));
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    animations.length = 0;
    started.length = 0;
    stubMotion(true);
    localStorage.clear();
    anchor = document.createElement('button');
    anchor.getBoundingClientRect = () => new DOMRect(40, 100, 30, 24);
    document.body.appendChild(anchor);
    picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), curated: false, i18n: { t: (value: string) => value }, locale: 'en' });
    element = picker.getElement();
    document.body.appendChild(element);
    await picker.open(anchor);
  });

  afterEach(() => {
    picker.close();
    element.remove();
    anchor.remove();
    Reflect.deleteProperty(Element.prototype, 'animate');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('shows the current tone on the toggle as a coloured dot, not a hand', () => {
    const dot = toggle().querySelector<HTMLElement>('[data-emoji-skin-dot]');

    expect(dot).not.toBeNull();
    expect(toggle().textContent).toBe('');
    expect(toggle().getAttribute('data-emoji-skin-current')).toBe('0');
    expect(toggle().getAttribute('aria-label')).toBe('tools.callout.skinTone');
  });

  it('offers the six tones as dial segments, each a named button in its tone colour', () => {
    toggle().click();

    expect(dial().hidden).toBe(false);
    expect(segments().map(button => button.getAttribute('aria-label'))).toEqual(
      [1, 2, 3, 4, 5, 6].map(n => `tools.callout.skinTone ${n}`)
    );
    expect(segments().map(button => button.textContent)).toEqual(['', '', '', '', '', '']);
    expect(segments().every(button => button.style.getPropertyValue('--emoji-tone-color') !== '')).toBe(true);
    expect(segments().every(button => button.style.getPropertyValue('--emoji-tone-shape').startsWith('path('))).toBe(true);
    expect(segments()[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('gives the chosen segment a longer shape, so it stands out without a border', () => {
    toggle().click();

    const [chosen] = segments();
    const rest = chosen.style.getPropertyValue('--emoji-tone-shape');
    const on = chosen.style.getPropertyValue('--emoji-tone-shape-on');

    expect(on.startsWith('path(')).toBe(true);
    expect(on).not.toBe(rest);
  });

  it('chooses a tone, repaints the dot and the grid, and closes at once with reduced motion', () => {
    toggle().click();
    segments()[3].click();

    expect(dial().hidden).toBe(true);
    expect(toggle().getAttribute('data-emoji-skin-current')).toBe('3');
    expect(localStorage.getItem('blok-emoji-skin-tone')).toBe('3');
    // jsdom misses astral emoji in attribute selectors, so match by reading the attribute.
    const wave = [...element.querySelectorAll('[data-emoji-native]')].find(node => node.getAttribute('data-emoji-native') === '👋');

    expect(wave?.textContent).toBe('👋🏽');
  });

  it('folds the dial and flies the chosen tone into the dot as a circle, then cleans up', async () => {
    stubMotion(false);
    Element.prototype.animate = vi.fn(fakeAnimate) as unknown as Element['animate'];
    toggle().click();
    await settle();
    segments()[4].click();
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(element.querySelector('[data-emoji-skin-blob]')).not.toBeNull();

    await settle();

    expect(element.querySelector('[data-emoji-skin-blob]')).toBeNull();
    expect(dial().hidden).toBe(true);
    expect(toggle().getAttribute('data-emoji-skin-current')).toBe('4');
  });

  it('lets the dot finish its landing pop after the dial closes', async () => {
    stubMotion(false);
    Element.prototype.animate = vi.fn(fakeAnimate) as unknown as Element['animate'];
    toggle().click();
    await settle();
    segments()[4].click();

    for (let round = 0; round < 12 && !dial().hidden; round++) {
      animations.splice(0).forEach(animation => animation.finish());
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    const pop = started.find(animation => animation.target?.hasAttribute('data-emoji-skin-dot') === true);

    expect(dial().hidden).toBe(true);
    expect(pop).toBeDefined();
    expect(pop?.cancelled).not.toBe(true);
  });

  it('shifts the dial back inside the picker when its toggle sits at the edge', () => {
    element.getBoundingClientRect = () => new DOMRect(0, 0, 300, 360);
    dial().getBoundingClientRect = () => new DOMRect(250, 40, 140, 88);
    toggle().click();

    expect(dial().style.getPropertyValue('--emoji-skin-shift')).toBe('-94px');
  });

  it('stops a running landing when the picker closes, leaving no flying circle behind', async () => {
    stubMotion(false);
    Element.prototype.animate = vi.fn(fakeAnimate) as unknown as Element['animate'];
    toggle().click();
    await settle();
    segments()[2].click();
    await new Promise(resolve => setTimeout(resolve, 200));
    picker.close();

    expect(element.querySelector('[data-emoji-skin-blob]')).toBeNull();
    expect(dial().hidden).toBe(true);
    expect(toggle().getAttribute('data-emoji-skin-current')).toBe('2');
  });

  it('reopens cleanly when the toggle is clicked during the closing fold', async () => {
    stubMotion(false);
    Element.prototype.animate = vi.fn(fakeAnimate) as unknown as Element['animate'];
    toggle().click();
    await settle();
    toggle().click();
    toggle().click();

    expect(dial().hidden).toBe(false);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(segments()).toHaveLength(6);
  });
});
