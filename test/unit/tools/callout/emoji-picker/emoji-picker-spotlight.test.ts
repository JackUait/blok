/**
 * The Spotlight + Showcase picker: named category chips under the search, a
 * nine-column grid with a Recent row first, and a stage at the bottom that
 * shows the current icon or the emoji under the pointer or the focus.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiPicker } from '../../../../../src/tools/callout/emoji-picker';
import { onHover } from '../../../../../src/components/utils/tooltip';
import {
  CURRENT_ICON_KEY, EMOJI_CATEGORY_PEOPLE_KEY, EMOJI_CHIP_NATURE_KEY, EMOJI_CHIP_PEOPLE_KEY, RECENT_EMOJIS_KEY,
} from '../../../../../src/tools/callout/constants';
import { IconEmojiNavCat, IconEmojiNavSmile } from '../../../../../src/components/icons';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

const NATURE_IDS = Array.from({ length: 19 }, (_, index) => `plant${index}`);

const EMOJI_MART_FIXTURE = {
  categories: [
    { id: 'people', emojis: ['grinning', 'wave'] },
    { id: 'nature', emojis: NATURE_IDS },
  ],
  emojis: {
    grinning: { id: 'grinning', name: 'Grinning Face', keywords: ['happy'], skins: [{ native: '😀', unified: '1f600' }], version: 1 },
    wave: { id: 'wave', name: 'Waving Hand', keywords: ['hello'], skins: [{ native: '👋', unified: '1f44b' }], version: 1 },
    ...Object.fromEntries(NATURE_IDS.map((id, index) => [id, {
      id, name: `Plant ${index}`, keywords: [], version: 1,
      skins: [{ native: String.fromCodePoint(0x1F330 + index), unified: (0x1F330 + index).toString(16) }],
    }])),
  },
  aliases: {},
};

vi.mock('../../../../../src/components/utils/emoji/emoji-grid.json', async () => (await import('../../../components/utils/emoji/emoji-data.fixture')).emojiGridModule(EMOJI_MART_FIXTURE));
vi.mock('../../../../../src/components/utils/emoji/emoji-keywords.json', async () => (await import('../../../components/utils/emoji/emoji-data.fixture')).emojiKeywordsModule(EMOJI_MART_FIXTURE));

const svgBody = (markup: string): string => {
  const holder = document.createElement('div');

  holder.innerHTML = markup.trim();

  return holder.innerHTML.replace(/\s+/g, ' ');
};

describe('EmojiPicker Spotlight + Showcase layout', () => {
  let picker: EmojiPicker;
  let anchor: HTMLButtonElement;
  let element: HTMLElement;
  let onSelect: ReturnType<typeof vi.fn<(native: string, origin?: DOMRect) => void>>;

  const query = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const node = element.querySelector<T>(selector);

    if (node === null) {
      throw new Error(`Missing ${selector}`);
    }

    return node;
  };
  // Compares the attribute instead of an attribute selector, which jsdom fails to match for astral emoji here.
  const emojiButton = (native: string, scope: ParentNode = element): HTMLButtonElement => {
    const button = [...scope.querySelectorAll<HTMLButtonElement>('[data-emoji-native]')]
      .find(node => node.getAttribute('data-emoji-native') === native);

    if (button === undefined) {
      throw new Error(`Missing emoji ${native}`);
    }

    return button;
  };
  const stageText = (): { glyph: string; kicker: string; name: string } => ({
    glyph: query('[data-emoji-picker-stage-glyph]').textContent ?? '',
    kicker: query('[data-emoji-picker-stage-kicker]').textContent ?? '',
    name: query('[data-emoji-picker-stage-name]').textContent ?? '',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    localStorage.clear();
    anchor = document.createElement('button');
    anchor.getBoundingClientRect = () => new DOMRect(40, 100, 30, 24);
    document.body.appendChild(anchor);
    onSelect = vi.fn<(native: string, origin?: DOMRect) => void>();
    picker = new EmojiPicker({
      onSelect, onRemove: vi.fn(), curated: false,
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

  it('puts named category chips between the search and the grid', async () => {
    await picker.open(anchor);

    const header = query('[data-emoji-picker-header]');
    const footer = query('[data-emoji-picker-footer]');
    const body = query('[data-emoji-picker-body]');

    expect(header.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const people = query('[data-emoji-nav="people"]');
    const nature = query('[data-emoji-nav="nature"]');

    expect(people.querySelector('[data-emoji-nav-label]')?.textContent).toBe(EMOJI_CHIP_PEOPLE_KEY);
    expect(nature.querySelector('[data-emoji-nav-label]')?.textContent).toBe(EMOJI_CHIP_NATURE_KEY);
    expect(people.getAttribute('aria-label')).toBe(EMOJI_CATEGORY_PEOPLE_KEY);
    expect(svgBody(people.querySelector('svg')?.outerHTML ?? '')).toBe(svgBody(IconEmojiNavSmile));
    expect(svgBody(nature.querySelector('svg')?.outerHTML ?? '')).toBe(svgBody(IconEmojiNavCat));
  });

  it('shows no hover hint on a chip, because its name is already on it', async () => {
    await picker.open(anchor);

    const chip = query('[data-emoji-nav="people"]');

    expect(vi.mocked(onHover).mock.calls.some(([target]) => target === chip)).toBe(false);
  });

  it('estimates skipped sections with nine emoji per row', async () => {
    await picker.open(anchor);

    expect(query('[data-emoji-section="nature"]').style.getPropertyValue('--emoji-rows')).toBe('3');
  });

  it('shows the current icon on the stage while nothing is pointed at', async () => {
    await picker.open(anchor, undefined, { onSelect, onRemove: vi.fn(), current: '😀' });

    expect(stageText()).toEqual({ glyph: '😀', kicker: CURRENT_ICON_KEY, name: 'grinning face' });
  });

  it('shows the emoji under the pointer with its section, then returns to the current icon', async () => {
    await picker.open(anchor, undefined, { onSelect, onRemove: vi.fn(), current: '😀' });

    emojiButton('👋').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));

    expect(stageText()).toEqual({ glyph: '👋', kicker: EMOJI_CATEGORY_PEOPLE_KEY, name: 'waving hand' });

    query('[data-emoji-picker-body]').dispatchEvent(new PointerEvent('pointerleave'));

    expect(stageText().glyph).toBe('😀');
  });

  it('shows the focused emoji on the stage for keyboard users', async () => {
    await picker.open(anchor, undefined, { onSelect, onRemove: vi.fn(), current: '😀' });

    emojiButton('👋').focus();

    expect(stageText().glyph).toBe('👋');
  });

  it('hands the picked glyph rect to the host so it can animate from there', async () => {
    await picker.open(anchor);

    const button = emojiButton('👋');
    const glyph = button.firstElementChild as HTMLElement;

    glyph.getBoundingClientRect = () => new DOMRect(120, 200, 22, 22);
    button.click();

    expect(onSelect).toHaveBeenCalledWith('👋', new DOMRect(120, 200, 22, 22));
  });

  it('opens with the last picks in a Recent row, newest first and without repeats', async () => {
    await picker.open(anchor);
    emojiButton('👋').click();
    await picker.open(anchor);
    emojiButton('😀').click();
    await picker.open(anchor);
    emojiButton('👋', query('[data-emoji-section="people"]')).click();
    await picker.open(anchor);

    const recent = query('[data-emoji-section="recent"]');

    expect(element.querySelector('[data-emoji-section]')).toBe(recent);
    expect(recent.querySelector('[data-emoji-section-title]')?.textContent).toBe(RECENT_EMOJIS_KEY);
    expect([...recent.querySelectorAll('[data-emoji-native]')].map(node => node.getAttribute('data-emoji-native'))).toEqual(['👋', '😀']);
  });

  it('keeps the Recent row to one row of nine', async () => {
    for (const id of NATURE_IDS.slice(0, 11)) {
      await picker.open(anchor);
      query(`[data-emoji-section="nature"] [aria-label="${id.replace('plant', 'plant ')}"]`).click();
    }

    await picker.open(anchor);

    expect(query('[data-emoji-section="recent"]').querySelectorAll('[data-emoji-native]')).toHaveLength(9);
  });

  it('leaves the Recent row out of search results', async () => {
    await picker.open(anchor);
    emojiButton('👋').click();
    await picker.open(anchor);
    picker.setQuery('wave');

    expect(element.querySelector('[data-emoji-section="recent"]')).toBeNull();
  });
});
