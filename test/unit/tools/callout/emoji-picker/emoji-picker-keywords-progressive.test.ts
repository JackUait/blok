import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProcessedEmoji } from '../../../../../src/components/utils/emoji/emoji-data';
import type { EmojiPicker } from '../../../../../src/tools/callout/emoji-picker';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

vi.mock('../../../../../src/components/utils/emoji/emoji-locale', () => ({
  loadEmojiLocale: vi.fn().mockResolvedValue(null),
  getTranslatedName: vi.fn().mockReturnValue(null),
}));

const mockLoadEmojiGrid = vi.fn();
const mockLoadEmojiData = vi.fn();

vi.mock('../../../../../src/components/utils/emoji/emoji-data', () => ({
  loadEmojiGrid: (...args: unknown[]): unknown => mockLoadEmojiGrid(...args),
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

/** Grid-only fixtures: `keywords` stays empty until the keywords file lands. */
function gridEmojis(): ProcessedEmoji[] {
  return [
    { native: '💡', skins: ['💡'], id: 'bulb', name: 'Light Bulb', keywords: [], category: 'objects' },
    { native: '😀', skins: ['😀'], id: 'grinning', name: 'Grinning Face', keywords: [], category: 'people' },
    { native: '✅', skins: ['✅'], id: 'check', name: 'Check Mark', keywords: [], category: 'symbols' },
  ];
}

/** Fills keywords in place, as the real loader does. */
function fillKeywords(emojis: ProcessedEmoji[]): ProcessedEmoji[] {
  const byId: Record<string, string[]> = { bulb: ['idea'], grinning: ['happy'], check: ['done'] };

  for (const emoji of emojis) {
    emoji.keywords = byId[emoji.id] ?? [];
  }

  return emojis;
}

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

describe('EmojiPicker progressive keywords', () => {
  let container: HTMLElement;
  let anchor: HTMLElement;
  let emojis: ProcessedEmoji[];
  let keywords: Deferred<ProcessedEmoji[]>;

  beforeEach(() => {
    vi.clearAllMocks();
    emojis = gridEmojis();
    keywords = deferred<ProcessedEmoji[]>();
    mockLoadEmojiGrid.mockResolvedValue(emojis);
    mockLoadEmojiData.mockReturnValue(keywords.promise);
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

  async function createPicker(inline = false): Promise<EmojiPicker> {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline });

    container.appendChild(picker.getElement());

    return picker;
  }

  function searchInput(picker: EmojiPicker): HTMLInputElement {
    const input = picker.getElement().querySelector('input');

    if (input === null) {
      throw new Error('no search input');
    }

    return input;
  }

  function landKeywords(): Promise<void> {
    keywords.resolve(fillKeywords(emojis));

    return flush();
  }

  it('shows the grid while the keywords are still loading', async () => {
    const picker = await createPicker();

    void picker.open(anchor);
    await flush();

    const root = picker.getElement();

    expect(findButton(root, '💡')).toBeDefined();
    expect(root.hidden).toBe(false);
  });

  it('starts loading keywords on open, before the user types', async () => {
    const picker = await createPicker();

    await picker.open(anchor);

    expect(mockLoadEmojiData).toHaveBeenCalled();
  });

  it('re-runs an active search when the keywords land, so keyword matches appear', async () => {
    const picker = await createPicker();

    await picker.open(anchor);
    searchInput(picker).focus();
    picker.setQuery('idea');

    const root = picker.getElement();

    expect(findButton(root, '💡')).toBeUndefined();

    await landKeywords();

    expect(findButton(root, '💡')).toBeDefined();
  });

  it('keeps the focused search result when the keywords land while the user arrows through results', async () => {
    const picker = await createPicker();

    await picker.open(anchor);
    picker.setQuery('light');

    const focused = findButton(picker.getElement(), '💡');

    if (focused === undefined) {
      throw new Error('no button for 💡');
    }

    focused.focus();
    await landKeywords();

    expect(focused).toHaveFocus();
    expect(focused.isConnected).toBe(true);
  });

  it('inline mode keeps the filtered buttons the ":" composer highlights when the keywords land', async () => {
    const picker = await createPicker(true);

    await picker.open(anchor);
    picker.setQuery('light');

    const highlighted = findButton(picker.getElement(), '💡');

    await landKeywords();

    expect(highlighted).toBeDefined();
    expect(highlighted?.isConnected).toBe(true);
    expect(findButton(picker.getElement(), '💡')).toBe(highlighted);
  });
});
