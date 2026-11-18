// The database icon pickers (notion-motion.md Round 67 §1, Round 68 §3): focus stays
// in the search field while the arrow keys move a highlight over the grid, Enter
// picks it, and the box is Notion's size.

import { fireEvent } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmojiPicker as EmojiPickerType } from '../../../../../src/tools/callout/emoji-picker';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

vi.mock('../../../../../src/components/utils/emoji/emoji-locale', () => ({
  loadEmojiLocale: vi.fn().mockResolvedValue(null),
  getTranslatedName: vi.fn().mockReturnValue(null),
}));

/** 12 faces in one category: one full row of 10 and two more. */
const FACES = Array.from({ length: 12 }, (_, i) => ({ id: `face${i}`, native: String.fromCodePoint(0x1f600 + i) }));

const FIXTURE = {
  categories: [{ id: 'people', emojis: FACES.map(face => face.id) }],
  emojis: Object.fromEntries(FACES.map((face, i) => [face.id, {
    id: face.id,
    name: i === 11 ? 'Last Face' : `Face ${i}`,
    keywords: ['face'],
    skins: [{ native: face.native, unified: face.native.codePointAt(0)?.toString(16) ?? '' }],
    version: 1,
  }])),
  aliases: {},
};

vi.mock('../../../../../src/components/utils/emoji/emoji-grid.json', async () => (await import('../../../components/utils/emoji/emoji-data.fixture')).emojiGridModule(FIXTURE));
vi.mock('../../../../../src/components/utils/emoji/emoji-keywords.json', async () => (await import('../../../components/utils/emoji/emoji-data.fixture')).emojiKeywordsModule(FIXTURE));

describe('EmojiPicker — keys stay in the search field', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.documentElement.style.overflow = '';
  });

  const setup = async (options: { filterKeys?: boolean; size?: { width: number; height: number } } = { filterKeys: true }): Promise<{
    picker: EmojiPickerType;
    el: HTMLElement;
    input: HTMLInputElement;
    onSelect: ReturnType<typeof vi.fn>;
  }> => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const onSelect = vi.fn();
    const picker = new EmojiPicker({ onSelect, onRemove: vi.fn(), i18n: { t: (key: string) => key }, locale: 'en', curated: false, ...options });
    const anchor = document.createElement('button');

    document.body.append(anchor, picker.getElement());
    await picker.open(anchor);
    const el = picker.getElement();
    const input = el.querySelector<HTMLInputElement>('input[role="searchbox"]');

    if (input === null) throw new Error('no search field');

    return { picker, el, input, onSelect };
  };

  const press = (target: HTMLElement, key: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

    target.dispatchEvent(event);

    return event;
  };

  const highlighted = (el: HTMLElement): string[] =>
    [...el.querySelectorAll('[data-emoji-highlighted]')].map(button => button.getAttribute('data-emoji-native') ?? '');

  const type = (input: HTMLInputElement, value: string): void => {
    fireEvent.input(input, { target: { value } });
  };

  it('opens with the first emoji highlighted and the search field focused', async () => {
    const { el, input } = await setup();

    expect(highlighted(el)).toEqual([FACES[0].native]);
    expect(input).toHaveFocus();
    const id = input.getAttribute('aria-activedescendant');

    expect(id).not.toBeNull();
    expect(el.querySelector(`[id="${id}"]`)?.getAttribute('data-emoji-native')).toBe(FACES[0].native);
  });

  it('moves the highlight with the arrow keys while focus stays in the field', async () => {
    const { el, input } = await setup();

    expect(press(input, 'ArrowRight').defaultPrevented).toBe(true);
    expect(highlighted(el)).toEqual([FACES[1].native]);
    press(input, 'ArrowDown');
    expect(highlighted(el)).toEqual([FACES[11].native]);
    press(input, 'ArrowUp');
    expect(highlighted(el)).toEqual([FACES[1].native]);
    press(input, 'ArrowLeft');
    expect(highlighted(el)).toEqual([FACES[0].native]);
    expect(input).toHaveFocus();
    expect(el.querySelector(`[id="${input.getAttribute('aria-activedescendant') ?? ''}"]`)?.getAttribute('data-emoji-native')).toBe(FACES[0].native);
  });

  it('keeps the highlight in the grid at its edges', async () => {
    const { el, input } = await setup();

    press(input, 'ArrowUp');
    press(input, 'ArrowLeft');
    expect(highlighted(el)).toEqual([FACES[0].native]);
    expect(input).toHaveFocus();
  });

  it('leaves ← and → to the caret once the field has text', async () => {
    const { el, input } = await setup();

    type(input, 'face');

    expect(press(input, 'ArrowRight').defaultPrevented).toBe(false);
    expect(highlighted(el)).toEqual([FACES[0].native]);
  });

  it('picks the highlighted emoji on Enter and closes', async () => {
    const { picker, input, onSelect } = await setup();

    press(input, 'ArrowRight');
    press(input, 'ArrowRight');
    expect(press(input, 'Enter').defaultPrevented).toBe(true);

    expect(onSelect).toHaveBeenCalledWith(FACES[2].native, expect.anything());
    expect(picker.isOpen()).toBe(false);
  });

  it('highlights the best match after typing, and nothing when nothing matches', async () => {
    const { picker, el, input, onSelect } = await setup();

    type(input, 'last');
    expect(highlighted(el)).toEqual([FACES[11].native]);

    type(input, 'zzzz');
    expect(highlighted(el)).toEqual([]);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    press(input, 'Enter');
    expect(onSelect).not.toHaveBeenCalled();
    expect(picker.isOpen()).toBe(true);
  });

  it('carries the column across sections, as from Recent into People', async () => {
    localStorage.setItem('blok-emoji-recent', JSON.stringify([FACES[5].native, FACES[6].native]));
    const { el, input } = await setup();

    press(input, 'ArrowRight');
    expect(highlighted(el)).toEqual([FACES[6].native]);
    press(input, 'ArrowDown');
    expect(highlighted(el)).toEqual([FACES[1].native]);
    press(input, 'ArrowUp');
    expect(highlighted(el)).toEqual([FACES[6].native]);
  });

  it('starts again from the first emoji when reopened', async () => {
    const { picker, el, input } = await setup();

    press(input, 'ArrowRight');
    picker.close();
    const anchor = document.createElement('button');

    document.body.append(anchor);
    await picker.open(anchor);

    expect(highlighted(el)).toEqual([FACES[0].native]);
  });

  it('keeps the old keys without the option: ↓ moves focus into the grid', async () => {
    const { el, input } = await setup({});

    press(input, 'ArrowDown');

    expect(highlighted(el)).toEqual([]);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(document.activeElement?.getAttribute('data-emoji-native')).toBe(FACES[0].native);
  });

  it('takes a fixed box from the size option, and keeps the viewport clamp', async () => {
    const { el } = await setup({ size: { width: 408, height: 390 } });

    expect(el.style.width).toBe('408px');
    expect(el.style.maxWidth).toBe('calc(100vw - 16px)');
    expect(el.style.height).toBe('390px');
  });
});
