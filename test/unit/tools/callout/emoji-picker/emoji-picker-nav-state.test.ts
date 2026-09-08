/**
 * The nav-less layout (search results borrow the footer's height) is CSS that
 * keys off an attribute on the picker root. The root may not be a `:has()`
 * anchor: it holds every emoji button, so a `:has()` there makes each glyph
 * text swap invalidate the whole subtree — see
 * test/unit/styles/emoji-picker-has-invalidation.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiPicker } from '../../../../../src/tools/callout/emoji-picker';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

vi.mock('@emoji-mart/data', () => ({
  default: {
    categories: [{ id: 'people', emojis: ['grinning', 'wave'] }],
    emojis: {
      grinning: { id: 'grinning', name: 'Grinning Face', keywords: ['happy'], skins: [{ native: '😀', unified: '1f600' }], version: 1 },
      wave: { id: 'wave', name: 'Waving Hand', keywords: ['hello'], skins: [{ native: '👋', unified: '1f44b' }, { native: '👋🏻', unified: '1f44b-1f3fb' }], version: 1 },
    },
    aliases: {},
  },
}));

describe('EmojiPicker nav-less state', () => {
  let picker: EmojiPicker;
  let anchor: HTMLButtonElement;
  let element: HTMLElement;

  const nav = (): HTMLElement => {
    const node = element.querySelector<HTMLElement>('[data-emoji-picker-nav]');

    if (node === null) {
      throw new Error('Missing picker nav');
    }

    return node;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('publishes the hidden nav as a root attribute while searching', async () => {
    await picker.open(anchor);

    expect(element.hasAttribute('data-emoji-picker-navless')).toBe(false);

    picker.setQuery('wave');

    expect(nav().hidden).toBe(true);
    expect(element.hasAttribute('data-emoji-picker-navless')).toBe(true);

    picker.setQuery('');

    expect(nav().hidden).toBe(false);
    expect(element.hasAttribute('data-emoji-picker-navless')).toBe(false);
  });

  it('clears the attribute when a search that found nothing is cleared', async () => {
    await picker.open(anchor);
    picker.setQuery('zzzzz');

    expect(element.hasAttribute('data-emoji-picker-navless')).toBe(true);

    picker.setQuery('');

    expect(element.hasAttribute('data-emoji-picker-navless')).toBe(false);
  });
});
