import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiPicker } from '../../../../../src/tools/callout/emoji-picker';
import { IconEmojiHeart, IconHash } from '../../../../../src/components/icons';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

vi.mock('@emoji-mart/data', () => ({
  default: {
    categories: [{ id: 'people', emojis: ['wave', 'smile'] }, { id: 'symbols', emojis: ['heart'] }],
    emojis: {
      heart: { id: 'heart', name: 'Red Heart', keywords: ['love'], skins: [{ native: '❤️', unified: '2764-fe0f' }], version: 1 },
      wave: { id: 'wave', name: 'Waving Hand', keywords: ['hello'], skins: [{ native: '👋', unified: '1f44b' }, { native: '👋🏻', unified: '1f44b-1f3fb' }], version: 1 },
      smile: { id: 'smile', name: 'Smiling Face', keywords: ['happy'], skins: [{ native: '😄', unified: '1f604' }], version: 1 },
    },
    aliases: {},
  },
}));

describe('EmojiPicker motion', () => {
  let picker: EmojiPicker;
  let anchor: HTMLDivElement;
  let root: HTMLElement;
  let reducedMotion: boolean;
  const animateDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
  const animated: HTMLElement[] = [];

  const get = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);

    if (element === null) {
      throw new Error(`Missing element: ${selector}`);
    }

    return element;
  };

  const open = async (inline = false): Promise<void> => {
    picker = new EmojiPicker({
      inline, locale: 'en', i18n: { t: key => key },
      onSelect: vi.fn(), onRemove: vi.fn(),
    });
    root = picker.getElement();
    document.body.append(root);
    await picker.open(anchor);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    reducedMotion = false;
    animated.length = 0;
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: function (this: HTMLElement) {
        animated.push(this);

        return { cancel: vi.fn(), onfinish: null };
      },
    });
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('reduced-motion') && reducedMotion,
    })));
    localStorage.clear();
    anchor = document.createElement('div');
    anchor.contentEditable = 'true';
    anchor.tabIndex = 0;
    document.body.append(anchor);
    anchor.focus();
  });

  afterEach(() => {
    picker.close();
    root.remove();
    anchor.remove();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    if (animateDescriptor === undefined) {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    } else {
      Object.defineProperty(HTMLElement.prototype, 'animate', animateDescriptor);
    }
  });

  it('draws the Symbols category with the category family, not the type-set hash', async () => {
    await open();
    const symbols = get('[data-emoji-nav="symbols"]');
    const drawing = (markup: string): string | undefined =>
      new DOMParser().parseFromString(markup, 'text/html').querySelector('svg')?.innerHTML;

    // A hash is a letterform among pictograms: it is the only nav icon a
    // reader sees as text, so it reads as a foreign mark in the row.
    expect(symbols.querySelector('svg')?.innerHTML).not.toBe(drawing(IconHash));
    expect(symbols.querySelector('svg')?.innerHTML).toBe(drawing(IconEmojiHeart));
    expect(symbols).toHaveAttribute('aria-label', 'tools.callout.emojiCategorySymbols');
  });

  it('uses the same optical canvas for category and action icons', async () => {
    await open();
    const category = get('[data-emoji-nav] svg');
    const actions = root.querySelectorAll('[data-emoji-picker-random] svg, [data-emoji-picker-remove] svg');

    expect(actions).toHaveLength(2);

    for (const action of actions) {
      expect(action.getAttribute('viewBox')).toBe(category.getAttribute('viewBox'));
    }
  });

  it('animates only changed, visible skin glyphs without moving the buttons or rebuilding the grid', async () => {
    await open();
    const body = get('[data-emoji-picker-body]');
    const hand = get<HTMLButtonElement>('[data-emoji-native]');
    const smile = body.querySelectorAll('[data-emoji-native]')[1];

    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
    });
    Object.defineProperties(hand, {
      offsetTop: { configurable: true, value: 60 },
      offsetHeight: { configurable: true, value: 36 },
    });
    body.scrollTop = 40;
    get<HTMLButtonElement>('[data-emoji-picker-skin-toggle]').click();
    get('[data-emoji-picker-skin-tone]').querySelectorAll('button')[1]?.click();

    expect(animated.some(glyph => glyph.closest('[data-emoji-native]') === hand)).toBe(true);
    expect(animated).not.toContain(hand);
    expect(animated.some(glyph => glyph.closest('[data-emoji-native]') === smile)).toBe(false);
    expect(get('[data-emoji-native]')).toBe(hand);
    expect(hand.textContent).toBe('👋🏻');
    expect(body.scrollTop).toBe(40);
  });

  it.each([false, true])('updates skin tone without animating hidden glyphs (reduced motion: %s)', async reduce => {
    reducedMotion = reduce;
    await open();
    const body = get('[data-emoji-picker-body]');
    const hand = get<HTMLButtonElement>('[data-emoji-native]');

    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
    });
    Object.defineProperties(hand, {
      offsetTop: { configurable: true, value: reduce ? 20 : 180 },
      offsetHeight: { configurable: true, value: 36 },
    });
    get<HTMLButtonElement>('[data-emoji-picker-skin-toggle]').click();
    get('[data-emoji-picker-skin-tone]').querySelectorAll('button')[1]?.click();

    expect(hand.textContent).toBe('👋🏻');
    expect(animated.some(glyph => glyph.closest('[data-emoji-native]') === hand)).toBe(false);
  });

  it('closes the picker on Escape while the skin-tone tray is animating closed', async () => {
    await open();
    const toggle = get<HTMLButtonElement>('[data-emoji-picker-skin-toggle]');
    const tray = get('[data-emoji-picker-skin-tone]');

    toggle.click();
    get<HTMLButtonElement>('[data-emoji-picker-skin-tone] button[aria-label="tools.callout.skinTone 2"]').click();

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(tray.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(picker.isOpen()).toBe(false);
    expect(root.hidden).toBe(true);
  });

  it('curls section labels at the reel edge without transforming their layout boxes', async () => {
    await open();
    const body = get('[data-emoji-picker-body]');
    const title = get('[data-emoji-section-title]');

    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
    });
    Object.defineProperties(get('[data-emoji-section-title] > span'), {
      offsetTop: { configurable: true, value: 40 },
      offsetHeight: { configurable: true, value: 40 },
    });
    body.scrollTop = 50;
    body.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);

    const label = title.firstElementChild instanceof HTMLElement ? title.firstElementChild : title;

    expect(label.style.transform).toContain('rotateX(');
    expect(label.style.opacity).not.toBe('');
    expect(title.style.transform).toBe('');

    body.scrollTop = 0;
    body.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
    expect(label.style.transform).toBe('');

    body.scrollTop = 50;
    body.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
    picker.close();
    expect(label.style.transform).toBe('');
  });

  it('measures the reel band on the section label, not on its padded heading box', async () => {
    await open();
    const body = get('[data-emoji-picker-body]');
    const title = get('[data-emoji-section-title]');
    const label = get('[data-emoji-section-title] > span');

    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
    });
    // A heading box is mostly padding: 12 units of it sit above the label.
    Object.defineProperties(title, {
      offsetTop: { configurable: true, value: 40 },
      offsetHeight: { configurable: true, value: 35 },
    });
    Object.defineProperties(label, {
      offsetTop: { configurable: true, value: 52 },
      offsetHeight: { configurable: true, value: 18 },
    });

    // Where scrollToSection lands: the heading box meets the top edge while
    // the label still clears it.
    body.scrollTop = 40;
    body.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);

    expect(label.style.transform).toBe('');
    expect(label.style.opacity).toBe('');

    body.scrollTop = 52;
    body.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);

    expect(label.style.transform).toContain('rotateX(');
  });

  it('adds up nested offsets when a heading positions its own label', async () => {
    // Inline mode makes the heading that carries the tone controls a
    // positioned box, so its label measures from the heading, not the body.
    await open(true);
    const body = get('[data-emoji-picker-body]');
    const title = get('[data-emoji-section-title]');
    const label = get('[data-emoji-section-title] > span');

    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
    });
    Object.defineProperties(title, {
      offsetTop: { configurable: true, value: 40 },
      offsetParent: { configurable: true, value: body },
    });
    Object.defineProperties(label, {
      offsetTop: { configurable: true, value: 14 },
      offsetHeight: { configurable: true, value: 18 },
      offsetParent: { configurable: true, value: title },
    });

    body.scrollTop = 54;
    body.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);

    expect(label.style.transform).toContain('rotateX(');

    body.scrollTop = 40;
    body.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);

    expect(label.style.transform).toBe('');
  });

  it('resets curled section labels when reduced motion is enabled', async () => {
    await open();
    const body = get('[data-emoji-picker-body]');
    const title = get('[data-emoji-section-title]');

    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
    });
    Object.defineProperties(get('[data-emoji-section-title] > span'), {
      offsetTop: { configurable: true, value: 40 },
      offsetHeight: { configurable: true, value: 40 },
    });
    body.scrollTop = 50;
    body.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
    const label = title.firstElementChild instanceof HTMLElement ? title.firstElementChild : title;

    expect(label.style.transform).toContain('rotateX(');
    reducedMotion = true;
    body.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
    expect(label.style.transform).toBe('');
    expect(label.style.opacity).toBe('');
  });

  it('keeps inline tone controls in the first scrolling section after filtering and reopening', async () => {
    await open(true);
    const toggle = get<HTMLButtonElement>('[data-emoji-picker-skin-toggle]');

    expect(get('[data-emoji-section-title]')).toContainElement(toggle);
    picker.setQuery('hello');
    expect(get('[data-emoji-section-title]')).toContainElement(toggle);
    toggle.click();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    get('[data-emoji-picker-skin-tone]').querySelectorAll('button')[1]?.click();
    expect(get('[data-emoji-native]').textContent).toBe('👋🏻');

    picker.setQuery('no-such-emoji');
    picker.setQuery('');
    expect(get('[data-emoji-section-title]')).toContainElement(toggle);
    picker.close();
    await picker.open(anchor);
    expect(get('[data-emoji-section-title]')).toContainElement(toggle);
  });

  it('keeps the document caret when opening and choosing a skin tone inline', async () => {
    await open(true);
    get<HTMLButtonElement>('[data-emoji-picker-skin-toggle]').click();

    expect(anchor).toHaveFocus();
    const tones = get('[data-emoji-picker-skin-tone]').querySelectorAll('button');

    tones[1]?.click();
    expect(anchor).toHaveFocus();
    expect(get('[data-emoji-native]').textContent).toBe('👋🏻');
    expect(get('[data-emoji-picker-skin-toggle]').textContent).toBe('✋🏻');
  });

  it('does not offer a clear action that only clears the hidden field in inline mode', async () => {
    await open(true);
    picker.setQuery('no-such-emoji');

    expect(get('[data-emoji-picker-empty]').querySelector('button')).toBeNull();
    expect(anchor).toHaveFocus();
  });

  it('keeps the empty-state illustration decorative and the clear action usable', async () => {
    await open();
    picker.setQuery('no-such-emoji');
    const empty = get('[data-emoji-picker-empty]');

    expect(empty.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    const clear = empty.querySelector('button');

    if (clear === null) {
      throw new Error('Missing clear action');
    }

    clear.click();
    expect(get<HTMLInputElement>('input')).toHaveValue('');
    expect(get<HTMLInputElement>('input')).toHaveFocus();
    expect(get('[data-emoji-native]').textContent).toBe('👋');
  });
});
