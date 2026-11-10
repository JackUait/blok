import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

vi.mock('../../../../../src/components/utils/emoji/emoji-locale', () => ({
  loadEmojiLocale: vi.fn().mockResolvedValue(null),
  getTranslatedName: vi.fn().mockReturnValue(null),
}));

interface FixtureEmoji {
  id: string;
  name: string;
  keywords: string[];
  skins: { native: string; unified: string }[];
  version: number;
}

const emojis: Record<string, FixtureEmoji> = {};
const ids = { people: [] as string[], objects: [] as string[], nature: [] as string[] };

/** Adds `count` emoji whose ids start with `prefix`, each with its own glyph. */
function add(category: keyof typeof ids, prefix: string, count: number, firstCodePoint: number): void {
  for (const index of Array.from({ length: count }, (_, i) => i)) {
    const id = `${prefix}_${index}`;
    const codePoint = firstCodePoint + index;

    emojis[id] = { id, name: id, keywords: [], skins: [{ native: String.fromCodePoint(codePoint), unified: codePoint.toString(16) }], version: 1 };
    ids[category].push(id);
  }
}

// "sun" matches 35 emoji in two categories and "sun_obj" 15. "moon" matches exactly 30 and "star" 31.
add('people', 'sun_face', 20, 0x1f600);
add('objects', 'sun_obj', 15, 0x1f4a0);
add('nature', 'leaf', 3, 0x1f330);
add('nature', 'moon', 30, 0x1f400);
add('objects', 'star', 31, 0x1f500);

const FIXTURE = {
  categories: [
    { id: 'people', emojis: ids.people },
    { id: 'nature', emojis: ids.nature },
    { id: 'objects', emojis: ids.objects },
  ],
  emojis,
  aliases: {},
};

vi.mock('../../../../../src/components/utils/emoji/emoji-grid.json', async () => (await import('../../../components/utils/emoji/emoji-data.fixture')).emojiGridModule(FIXTURE));
vi.mock('../../../../../src/components/utils/emoji/emoji-keywords.json', async () => (await import('../../../components/utils/emoji/emoji-data.fixture')).emojiKeywordsModule(FIXTURE));

describe('EmojiPicker — inline search layout', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
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
    document.body.removeChild(container);
  });

  async function openPicker(inline: boolean): Promise<{ el: HTMLElement; setQuery: (query: string) => void; close: () => void; reopen: () => Promise<void> }> {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = document.createElement('div');

    anchor.contentEditable = 'true';
    container.appendChild(anchor);

    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline });

    container.appendChild(picker.getElement());
    await picker.open(anchor);

    return { el: picker.getElement(), setQuery: query => picker.setQuery(query), close: () => picker.close(), reopen: () => picker.open(anchor) };
  }

  const navButton = (el: HTMLElement, category: string): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>(`[data-emoji-nav="${category}"]`);
  const nav = (el: HTMLElement): HTMLElement | null => el.querySelector<HTMLElement>('[data-emoji-picker-nav]');
  const natives = (el: HTMLElement): (string | null)[] =>
    [...el.querySelectorAll('[data-emoji-native]')].map(button => button.getAttribute('data-emoji-native'));

  it('keeps the category bar while a search has more than 30 matches', async () => {
    const { el, setQuery, close } = await openPicker(true);

    setQuery('sun');

    expect(nav(el)?.hidden).toBe(false);
    expect(el.hasAttribute('data-emoji-picker-navless')).toBe(false);
    expect(el.hasAttribute('data-emoji-picker-flat')).toBe(false);
    expect(el.querySelectorAll('[data-emoji-section-title]')).toHaveLength(2);
    expect(natives(el)).toHaveLength(35);

    close();
  });

  it('disables the bar buttons of categories with no match, and keeps the others usable', async () => {
    const { el, setQuery, close } = await openPicker(true);

    setQuery('sun');

    expect(navButton(el, 'nature')?.disabled).toBe(true);
    expect(navButton(el, 'people')?.disabled).toBe(false);
    expect(navButton(el, 'objects')?.disabled).toBe(false);

    close();
  });

  it('shows 30 or fewer matches as one block: no category names, no bar', async () => {
    const { el, setQuery, close } = await openPicker(true);

    setQuery('sun_obj');

    expect(el.hasAttribute('data-emoji-picker-flat')).toBe(true);
    expect(el.querySelectorAll('[data-emoji-section-title]')).toHaveLength(0);
    expect(nav(el)?.hidden).toBe(true);
    expect(el.hasAttribute('data-emoji-picker-navless')).toBe(true);
    expect(natives(el)).toEqual(ids.objects.filter(id => id.startsWith('sun_obj')).map(id => emojis[id].skins[0].native));

    close();
  });

  it('treats exactly 30 matches as a short list and 31 as a long one', async () => {
    const { el, setQuery, close } = await openPicker(true);

    setQuery('moon');
    expect(natives(el)).toHaveLength(30);
    expect(el.hasAttribute('data-emoji-picker-flat')).toBe(true);

    setQuery('star');
    expect(natives(el)).toHaveLength(31);
    expect(el.hasAttribute('data-emoji-picker-flat')).toBe(false);

    close();
  });

  it('brings the full grid, its names and every bar button back when the search is cleared', async () => {
    const { el, setQuery, close } = await openPicker(true);

    setQuery('sun_obj');
    setQuery('');

    expect(el.hasAttribute('data-emoji-picker-flat')).toBe(false);
    expect(nav(el)?.hidden).toBe(false);
    expect(el.querySelectorAll('[data-emoji-section-title]')).toHaveLength(3);
    expect(navButton(el, 'nature')?.disabled).toBe(false);

    close();
  });

  it('opens on the full grid again after it was closed on a short list', async () => {
    const { el, setQuery, close, reopen } = await openPicker(true);

    setQuery('sun_obj');
    close();
    await reopen();

    expect(el.hasAttribute('data-emoji-picker-flat')).toBe(false);
    expect(nav(el)?.hidden).toBe(false);
    expect(el.querySelectorAll('[data-emoji-section-title]')).toHaveLength(3);

    close();
  });

  it('leaves the long layout for the empty state when nothing matches', async () => {
    const { el, setQuery, close } = await openPicker(true);

    setQuery('sun');
    setQuery('zzzq');

    expect(el.querySelector('[data-emoji-picker-empty]')).not.toBeNull();
    expect(nav(el)?.hidden).toBe(true);
    expect(el.hasAttribute('data-emoji-picker-flat')).toBe(false);

    close();
  });

  it('has no skin tone control, on the full grid, in a long list or in a short one', async () => {
    const { el, setQuery, close } = await openPicker(true);

    expect(el.querySelector('[data-emoji-picker-skin-toggle]')).toBeNull();

    setQuery('sun');
    expect(el.querySelector('[data-emoji-picker-skin-toggle]')).toBeNull();

    setQuery('sun_obj');
    expect(el.querySelector('[data-emoji-picker-skin-toggle]')).toBeNull();

    close();
  });

  it('does not change the full picker: a short search keeps its category names and hides the chips', async () => {
    const { el, setQuery, close } = await openPicker(false);

    setQuery('sun_obj');

    expect(el.hasAttribute('data-emoji-picker-flat')).toBe(false);
    expect(el.querySelectorAll('[data-emoji-section-title]')).toHaveLength(1);
    expect(nav(el)?.hidden).toBe(true);
    expect(el.querySelector('[data-emoji-picker-skin-toggle]')).not.toBeNull();

    close();
  });

  it('does not change the full picker: a long search still hides the chips', async () => {
    const { el, setQuery, close } = await openPicker(false);

    setQuery('sun');

    expect(nav(el)?.hidden).toBe(true);

    close();
  });
});
