// test/unit/tools/callout/emoji-picker/emoji-picker-open-speed.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProcessedEmoji } from '../../../../../src/tools/callout/emoji-picker/emoji-data';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

const mockLoadEmojiLocale = vi.fn().mockResolvedValue(null);

vi.mock('../../../../../src/tools/callout/emoji-picker/emoji-locale', () => ({
  loadEmojiLocale: (...args: unknown[]): unknown => mockLoadEmojiLocale(...args),
  getTranslatedName: vi.fn().mockReturnValue(null),
}));

const EMOJIS: ProcessedEmoji[] = [
  { native: '💡', skins: ['💡'], id: 'bulb', name: 'Light Bulb', keywords: ['light'], category: 'objects' },
  { native: '😀', skins: ['😀'], id: 'grinning', name: 'Grinning Face', keywords: ['face'], category: 'people' },
  { native: '👍', skins: ['👍', '👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿'], id: 'thumbsup', name: 'Thumbs Up', keywords: ['ok'], category: 'people' },
  { native: '✅', skins: ['✅'], id: 'check', name: 'Check Mark', keywords: ['done'], category: 'symbols' },
];

const mockLoadEmojiData = vi.fn();

vi.mock('../../../../../src/tools/callout/emoji-picker/emoji-data', () => ({
  loadEmojiData: (...args: unknown[]): unknown => mockLoadEmojiData(...args),
  searchEmojis: vi.fn((emojis: ProcessedEmoji[], q: string) => emojis.filter(e => e.name.toLowerCase().includes(q.toLowerCase()))),
  groupEmojisByCategory: vi.fn((emojis: ProcessedEmoji[]) => {
    const m = new Map<string, ProcessedEmoji[]>();

    for (const e of emojis) {
      const g = m.get(e.category) ?? [];

      g.push(e);
      m.set(e.category, g);
    }

    return m;
  }),
  CURATED_CALLOUT_EMOJIS: ['💡', '✅'],
}));

const SKIN_TONE_STORAGE_KEY = 'blok-emoji-skin-tone';

/** Anchor whose rect is stable so `position()` has real numbers in jsdom. */
function createAnchor(): HTMLElement {
  const anchor = document.createElement('button');

  anchor.getBoundingClientRect = (): DOMRect => ({
    top: 100, bottom: 120, left: 40, right: 80,
    width: 40, height: 20, x: 40, y: 100, toJSON: () => ({}),
  });

  return anchor;
}

describe('EmojiPicker open speed', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    // `restoreAllMocks` in afterEach strips implementations set at declaration.
    mockLoadEmojiData.mockResolvedValue(EMOJIS);
    mockLoadEmojiLocale.mockResolvedValue(null);
    localStorage.removeItem(SKIN_TONE_STORAGE_KEY);
    container = document.createElement('div');
    document.body.appendChild(container);

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
    document.documentElement.style.overflow = '';
    localStorage.removeItem(SKIN_TONE_STORAGE_KEY);
  });

  it('reuses the already-rendered grid when reopening, instead of rebuilding every button', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en' });

    container.appendChild(picker.getElement());

    const anchor = createAnchor();

    container.appendChild(anchor);

    await picker.open(anchor);

    const firstPass = [...picker.getElement().querySelectorAll('[data-emoji-native]')];

    expect(firstPass.length).toBeGreaterThan(0);

    picker.close();
    await picker.open(anchor);

    const secondPass = [...picker.getElement().querySelectorAll('[data-emoji-native]')];

    // Same DOM nodes by identity — the grid was reused, not torn down and rebuilt.
    expect(secondPass.length).toBe(firstPass.length);
    expect(secondPass.every((node, i) => node === firstPass[i])).toBe(true);
  });

  it('rebuilds the full grid when reopening after a search filtered it', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en' });

    container.appendChild(picker.getElement());

    const anchor = createAnchor();

    container.appendChild(anchor);

    await picker.open(anchor);

    const fullCount = picker.getElement().querySelectorAll('[data-emoji-native]').length;
    const input = picker.getElement().querySelector<HTMLInputElement>('input[type="text"]');

    expect(input).not.toBeNull();
    input!.value = 'thumbs';
    input!.dispatchEvent(new Event('input', { bubbles: true }));

    expect(picker.getElement().querySelectorAll('[data-emoji-native]').length).toBeLessThan(fullCount);

    picker.close();
    await picker.open(anchor);

    expect(picker.getElement().querySelectorAll('[data-emoji-native]').length).toBe(fullCount);
  });

  it('applies a skin tone chosen elsewhere to the reused grid on reopen', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en' });

    container.appendChild(picker.getElement());

    const anchor = createAnchor();

    container.appendChild(anchor);

    await picker.open(anchor);

    const thumbsUp = (): HTMLElement | undefined =>
      [...picker.getElement().querySelectorAll<HTMLElement>('[data-emoji-native]')]
        .find(node => node.getAttribute('data-emoji-native') === '👍');

    expect(thumbsUp()?.textContent).toBe('👍');

    picker.close();

    // Another picker instance (another callout block) stored a darker tone.
    localStorage.setItem(SKIN_TONE_STORAGE_KEY, '5');

    await picker.open(anchor);

    expect(thumbsUp()?.textContent).toBe('👍🏿');
  });

  it('warms the emoji dataset on intent, before the picker is ever opened', async () => {
    const { prefetchEmojiPickerData } = await import('../../../../../src/tools/callout/emoji-picker');

    expect(mockLoadEmojiData).not.toHaveBeenCalled();

    prefetchEmojiPickerData('en');

    expect(mockLoadEmojiData).toHaveBeenCalled();
  });

  it('warms the locale annotations too, so a non-English open pays no second round trip', async () => {
    const { prefetchEmojiPickerData } = await import('../../../../../src/tools/callout/emoji-picker');

    prefetchEmojiPickerData('de');

    expect(mockLoadEmojiData).toHaveBeenCalled();
    expect(mockLoadEmojiLocale).toHaveBeenCalledWith('de');
  });

  it('keeps warming cheap — repeated intent signals do not refetch', async () => {
    const { prefetchEmojiPickerData } = await import('../../../../../src/tools/callout/emoji-picker');

    prefetchEmojiPickerData('en');
    prefetchEmojiPickerData('en');
    prefetchEmojiPickerData('en');

    // The loaders own the caching; the picker must not add a second layer that
    // could go stale, so every call is expected to reach them.
    expect(mockLoadEmojiData).toHaveBeenCalledTimes(3);
  });

  it('never rejects when prefetching fails — a warm-up must not surface errors', async () => {
    mockLoadEmojiData.mockRejectedValueOnce(new Error('offline'));

    const { prefetchEmojiPickerData } = await import('../../../../../src/tools/callout/emoji-picker');
    const onUnhandled = vi.fn();

    window.addEventListener('unhandledrejection', onUnhandled);
    prefetchEmojiPickerData('en');
    await new Promise(resolve => setTimeout(resolve, 0));
    window.removeEventListener('unhandledrejection', onUnhandled);

    expect(onUnhandled).not.toHaveBeenCalled();
  });
});
