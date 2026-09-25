// test/unit/tools/callout/emoji-picker/emoji-picker-locale-progressive.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProcessedEmoji } from '../../../../../src/components/utils/emoji/emoji-data';
import type { EmojiLocaleData } from '../../../../../src/components/utils/emoji/emoji-locale';
import type { EmojiPicker } from '../../../../../src/tools/callout/emoji-picker';

const mockOnHover = vi.fn();

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: (...args: unknown[]): unknown => mockOnHover(...args),
  hide: vi.fn(),
}));

const mockLoadEmojiLocale = vi.fn();

vi.mock('../../../../../src/components/utils/emoji/emoji-locale', () => ({
  loadEmojiLocale: (...args: unknown[]): unknown => mockLoadEmojiLocale(...args),
  getTranslatedName: vi.fn().mockReturnValue(null),
}));

const EMOJIS: ProcessedEmoji[] = [
  { native: '💡', skins: ['💡'], id: 'bulb', name: 'Light Bulb', keywords: ['light'], category: 'objects' },
  { native: '😀', skins: ['😀'], id: 'grinning', name: 'Grinning Face', keywords: ['face'], category: 'people' },
  { native: '✅', skins: ['✅'], id: 'check', name: 'Check Mark', keywords: ['done'], category: 'symbols' },
];

const RU: EmojiLocaleData = {
  '💡': { n: 'Лампочка', k: ['идея'] },
  '😀': { n: 'Улыбка', k: ['радость'] },
};

const mockLoadEmojiData = vi.fn();

vi.mock('../../../../../src/components/utils/emoji/emoji-data', () => ({
  loadEmojiData: (...args: unknown[]): unknown => mockLoadEmojiData(...args),
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(r => {
    resolve = r;
  });

  return { promise, resolve };
}

const flush = (): Promise<void> => new Promise(r => setTimeout(r, 0));

function createAnchor(): HTMLElement {
  const anchor = document.createElement('button');

  anchor.getBoundingClientRect = (): DOMRect => ({
    top: 100, bottom: 120, left: 40, right: 80,
    width: 40, height: 20, x: 40, y: 100, toJSON: () => ({}),
  });

  return anchor;
}

/** Matches by attribute value in JS: jsdom's selector engine misses emoji in `[attr="…"]`. */
function findButton(root: HTMLElement, native: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('[data-emoji-native]')]
    .find(btn => btn.getAttribute('data-emoji-native') === native);
}

function button(root: HTMLElement, native: string): HTMLButtonElement {
  const btn = findButton(root, native);

  if (btn === undefined) {
    throw new Error(`no button for ${native}`);
  }

  return btn;
}

/** Text of the latest tooltip binding for `el`. */
function lastTooltip(el: HTMLElement): unknown {
  const calls = mockOnHover.mock.calls.filter(call => call[0] === el);

  return calls.at(-1)?.[1];
}

describe('EmojiPicker progressive locale', () => {
  let container: HTMLElement;
  let anchor: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadEmojiData.mockResolvedValue(EMOJIS);
    mockLoadEmojiLocale.mockResolvedValue(null);
    container = document.createElement('div');
    document.body.appendChild(container);
    anchor = createAnchor();
    container.appendChild(anchor);

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
  });

  async function createPicker(locale: string): Promise<EmojiPicker> {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale });

    container.appendChild(picker.getElement());

    return picker;
  }

  it('shows the grid before the locale file lands, then localizes labels and tooltips', async () => {
    const locale = deferred<EmojiLocaleData | null>();

    mockLoadEmojiLocale.mockReturnValue(locale.promise);

    const picker = await createPicker('ru');

    void picker.open(anchor);
    await flush();

    const root = picker.getElement();

    expect(root.querySelectorAll('[data-emoji-native]').length).toBeGreaterThan(0);
    expect(root.hidden).toBe(false);
    expect(button(root, '💡').getAttribute('aria-label')).toBe('light bulb');

    locale.resolve(RU);
    await flush();

    const bulb = button(root, '💡');

    expect(bulb.getAttribute('aria-label')).toBe('лампочка');
    expect(lastTooltip(bulb)).toBe('лампочка');
    expect(button(root, '✅').getAttribute('aria-label')).toBe('check mark');
  });

  it('starts the locale load at the same time as the dataset load', async () => {
    const data = deferred<ProcessedEmoji[]>();
    const locale = deferred<EmojiLocaleData | null>();

    mockLoadEmojiData.mockReturnValue(data.promise);
    mockLoadEmojiLocale.mockReturnValue(locale.promise);

    const picker = await createPicker('ru');

    void picker.open(anchor);

    expect(mockLoadEmojiData).toHaveBeenCalled();
    expect(mockLoadEmojiLocale).toHaveBeenCalledWith('ru');
  });

  it('localizes on the first render when the locale is already cached', async () => {
    mockLoadEmojiLocale.mockResolvedValue(RU);

    const picker = await createPicker('ru');

    await picker.open(anchor);

    const bulb = button(picker.getElement(), '💡');

    expect(mockOnHover).not.toHaveBeenCalledWith(bulb, 'light bulb', { placement: 'bottom' });
    expect(bulb.getAttribute('aria-label')).toBe('лампочка');
  });

  it('stays English without crashing when the locale load fails', async () => {
    mockLoadEmojiLocale.mockResolvedValue(null);

    const picker = await createPicker('ru');

    await picker.open(anchor);
    await flush();

    const bulb = button(picker.getElement(), '💡');

    expect(bulb.getAttribute('aria-label')).toBe('light bulb');
    expect(lastTooltip(bulb)).toBe('light bulb');
  });

  it('does not load a locale for English', async () => {
    const picker = await createPicker('en');

    await picker.open(anchor);

    expect(mockLoadEmojiLocale).not.toHaveBeenCalled();
  });

  it('re-runs an active search when the locale lands, so localized matches appear', async () => {
    const locale = deferred<EmojiLocaleData | null>();

    mockLoadEmojiLocale.mockReturnValue(locale.promise);

    const picker = await createPicker('ru');

    void picker.open(anchor);
    await flush();
    picker.setQuery('лампоч');

    const root = picker.getElement();

    expect(findButton(root, '💡')).toBeUndefined();

    locale.resolve(RU);
    await flush();

    expect(findButton(root, '💡')).toBeDefined();
  });

  it('keeps localized labels on a reopen when the picker closed before the locale landed', async () => {
    const locale = deferred<EmojiLocaleData | null>();

    mockLoadEmojiLocale.mockReturnValue(locale.promise);

    const picker = await createPicker('ru');

    void picker.open(anchor);
    await flush();
    picker.close();

    locale.resolve(RU);
    await flush();
    await picker.open(anchor);

    expect(button(picker.getElement(), '💡').getAttribute('aria-label')).toBe('лампочка');
    expect(mockLoadEmojiLocale).toHaveBeenCalledTimes(1);
  });
});
