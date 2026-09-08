import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiPicker } from '../../../../../src/tools/callout/emoji-picker';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

vi.mock('@emoji-mart/data', () => ({
  default: {
    categories: [{ id: 'people', emojis: ['grinning', 'wave', 'smile'] }],
    emojis: {
      grinning: { id: 'grinning', name: 'Grinning Face', keywords: ['happy'], skins: [{ native: '😀', unified: '1f600' }], version: 1 },
      wave: { id: 'wave', name: 'Waving Hand', keywords: ['hello'], skins: [{ native: '👋', unified: '1f44b' }, { native: '👋🏻', unified: '1f44b-1f3fb' }], version: 1 },
      smile: { id: 'smile', name: 'Smiling Face', keywords: ['happy'], skins: [{ native: '😄', unified: '1f604' }], version: 1 },
    },
    aliases: {},
  },
}));

describe('EmojiPicker polish', () => {
  let picker: EmojiPicker;
  let anchor: HTMLButtonElement;
  let element: HTMLElement;
  let reducedMotion: boolean;

  const get = <T extends HTMLElement>(selector: string): T => {
    // jsdom's selector engine needs CSS escapes for non-BMP emoji.
    const escaped = selector.replace(/[\u{10000}-\u{10ffff}]/gu, value => `\\${value.codePointAt(0)?.toString(16)} `);
    const node = element.querySelector<T>(escaped);

    if (node === null) {
      throw new Error(`Missing picker element: ${selector}`);
    }

    return node;
  };

  const key = (node: HTMLElement, value: string): void => {
    node.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  };

  const frame = (): void => {
    vi.advanceTimersByTime(20);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    reducedMotion = false;
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('reduced-motion') && reducedMotion,
    })));
    localStorage.clear();
    anchor = document.createElement('button');
    anchor.getBoundingClientRect = () => new DOMRect(40, 100, 30, 24);
    document.body.appendChild(anchor);
    picker = new EmojiPicker({
      onSelect: vi.fn(), onRemove: vi.fn(),
      i18n: { t: (value: string) => value }, locale: 'en',
    });
    element = picker.getElement();
    document.body.appendChild(element);
  });

  afterEach(() => {
    picker.close();
    element.remove();
    anchor.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('names emoji buttons and moves from search through the grid with arrow keys', async () => {
    await picker.open(anchor);
    const search = get<HTMLInputElement>('input');
    const first = get<HTMLButtonElement>('[data-emoji-native="😀"]');
    const second = get<HTMLButtonElement>('[data-emoji-native="👋"]');

    expect(first).toHaveAccessibleName('grinning face');
    key(search, 'ArrowDown');
    expect(first).toHaveFocus();
    key(first, 'ArrowRight');
    expect(second).toHaveFocus();
    expect(first.tabIndex).toBe(-1);
    expect(second.tabIndex).toBe(0);
    key(second, 'Home');
    expect(first).toHaveFocus();
    key(first, 'ArrowUp');
    expect(search).toHaveFocus();
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])('leaves IME candidate navigation in search for %j', async (composition) => {
    await picker.open(anchor);
    const search = get<HTMLInputElement>('input');
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown', bubbles: true, cancelable: true, ...composition,
    });

    search.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    search.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(search).toHaveFocus();
  });

  it('opens the tone tray at the selected tone and returns focus after keyboard selection', async () => {
    await picker.open(anchor);
    const toggle = get<HTMLButtonElement>('[data-emoji-picker-skin-toggle]');

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    toggle.click();
    const tray = get('[data-emoji-picker-skin-tone]');
    const tones = Array.from(tray.querySelectorAll('button'));
    const first = tones[0];
    const second = tones[1];

    if (first === undefined || second === undefined) {
      throw new Error('Missing skin tones');
    }

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(first).toHaveFocus();
    key(first, 'ArrowRight');
    expect(second).toHaveFocus();
    second.click();
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(get('[data-emoji-native="👋"]')).toHaveTextContent('👋🏻');
    expect(get('[data-emoji-native="👋"] [data-emoji-glyph]')).toBeInTheDocument();
  });

  it('clears a typed query, restores browsing and focus, and hides the clear button on reopen', async () => {
    await picker.open(anchor);
    const search = get<HTMLInputElement>('input');
    const clear = get<HTMLButtonElement>('[data-emoji-picker-clear]');

    expect(clear.hidden).toBe(true);
    search.value = 'wave';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(clear.hidden).toBe(false);
    expect(clear).toHaveAccessibleName('tools.callout.clearEmojiSearch');
    expect(get('[data-emoji-picker-announcer]')).toHaveTextContent('tools.callout.emojiSearchResults');
    clear.click();
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(clear.hidden).toBe(true);
    expect(get('[data-emoji-picker-nav]').hidden).toBe(false);
    expect(get('[data-emoji-native="😀"]')).toBeInTheDocument();

    picker.setQuery('wave');
    picker.close();
    await picker.open(anchor);
    expect(clear.hidden).toBe(true);
    expect(search).toHaveValue('');
  });

  it('provides a way back from an empty search without closing the picker', async () => {
    await picker.open(anchor);
    picker.setQuery('no-such-emoji');
    const back = get<HTMLButtonElement>('[data-emoji-picker-empty] button');

    expect(back).toHaveAccessibleName('tools.callout.clearEmojiSearch');
    expect(get('[data-emoji-picker-hint]')).toHaveTextContent('tools.callout.emojiSearchHint');
    back.click();

    expect(get<HTMLInputElement>('input').value).toBe('');
    expect(get<HTMLInputElement>('input')).toHaveFocus();
    expect(get('[data-emoji-picker-nav]').hidden).toBe(false);
    expect(get('[data-emoji-native="😀"]')).toBeInTheDocument();
    expect(picker.isOpen()).toBe(true);
  });

  it('rolls edge glyphs visibly before clipping, leaving hit targets and central emoji still', async () => {
    await picker.open(anchor);
    const body = get('[data-emoji-picker-body]');
    const buttons = Array.from(body.querySelectorAll<HTMLElement>('[data-emoji-native]'));
    const glyphs = Array.from(body.querySelectorAll<HTMLElement>('[data-emoji-native] [data-emoji-glyph]'));

    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 160 },
    });
    glyphs.forEach((glyph, index) => {
      Object.defineProperties(glyph, {
        offsetTop: { configurable: true, value: index * 40 },
        offsetHeight: { configurable: true, value: 40 },
      });
    });
    body.scrollTop = 20;
    body.dispatchEvent(new Event('scroll'));
    frame();

    const topGlyph = get('[data-emoji-native="😀"] [data-emoji-glyph]');
    const middleGlyph = get('[data-emoji-native="👋"] [data-emoji-glyph]');

    expect(topGlyph.style.transform).toContain('rotateX(50.00deg) scaleX(0.910) scaleY(0.750)');
    expect(topGlyph.style.opacity).toBe('0.68');
    expect(middleGlyph.style.transform).toBe('');
    expect(buttons[0]?.style.transform).toBe('');

    body.scrollTop = 10;
    body.dispatchEvent(new Event('scroll'));
    frame();
    expect(topGlyph.style.transform).toContain('rotateX(37.50deg)');

    body.scrollTop = 0;
    body.dispatchEvent(new Event('scroll'));
    frame();
    expect(topGlyph.style.transform).toBe('');
    expect(get('[data-emoji-native="😄"] [data-emoji-glyph]').style.transform).toContain('rotateX(-50.00deg)');

    reducedMotion = true;
    body.dispatchEvent(new Event('scroll'));
    frame();
    expect(topGlyph.style.transform).toBe('');
    expect(get('[data-emoji-native="😄"] [data-emoji-glyph]').style.transform).toBe('');
  });

  it('marks the active category and skips smooth category scrolling with reduced motion', async () => {
    reducedMotion = true;
    await picker.open(anchor);
    const body = get('[data-emoji-picker-body]');
    const scrollTo = vi.fn();

    body.scrollTo = scrollTo;
    frame();
    const category = get<HTMLButtonElement>('[data-emoji-nav="people"]');

    expect(category).toHaveAttribute('aria-current', 'true');
    category.click();
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'instant' }));
  });

  it('keeps an oversized picker inside the viewport and anchors its opening direction', async () => {
    vi.stubGlobal('innerWidth', 320);
    vi.stubGlobal('innerHeight', 400);
    element.getBoundingClientRect = () => new DOMRect(0, 0, 304, 350);
    anchor.getBoundingClientRect = () => new DOMRect(0, 180, 20, 24);

    await picker.open(anchor);

    expect(Number.parseFloat(element.style.left)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(element.style.top)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(element.style.top) + 350).toBeLessThanOrEqual(392);
    expect(element.style.transformOrigin).toMatch(/(top|bottom)/);
  });
});
