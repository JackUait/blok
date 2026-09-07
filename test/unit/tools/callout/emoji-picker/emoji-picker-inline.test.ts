// test/unit/tools/callout/emoji-picker/emoji-picker-inline.test.ts
//
// Covers the `inline: true` mode added for the ":" trigger (see
// blockEvents/composers/emojiTrigger.ts) and the switch from `searchEmojis`
// to `searchEmojisRanked`, which affects both modes. The Callout tool's own
// (non-inline) behaviour is covered by emoji-picker.test.ts and must stay
// green untouched.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simulateInput } from '../../../../helpers/simulate';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

vi.mock('../../../../../src/components/utils/emoji/emoji-locale', () => ({
  loadEmojiLocale: vi.fn().mockResolvedValue(null),
  getTranslatedName: vi.fn().mockReturnValue(null),
}));

/**
 * 'light' matches both entries: `bulb` via an exact keyword, `flashlight`
 * only via an id substring. The unranked `searchEmojis` preserves dataset
 * order (flashlight first, since it's listed first below); the ranked
 * search must put the better match, bulb, first — this is what lets the
 * "routes through the ranked search" test tell the two functions apart.
 */
const MOCK_EMOJI_MART_DATA = {
  default: {
    categories: [{ id: 'objects', emojis: ['flashlight', 'bulb'] }],
    emojis: {
      flashlight: { id: 'flashlight', name: 'Flashlight', keywords: ['torch', 'beam'], skins: [{ native: '🔦', unified: '1f526' }], version: 1 },
      bulb: { id: 'bulb', name: 'Light Bulb', keywords: ['light', 'idea'], skins: [{ native: '💡', unified: '1f4a1' }], version: 1 },
    },
    aliases: {},
  },
};

vi.mock('@emoji-mart/data', () => MOCK_EMOJI_MART_DATA);

describe('EmojiPicker — inline mode', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);

    // resolveTheme() calls matchMedia — stub it for jsdom
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.removeChild(container);
    document.documentElement.style.overflow = '';
  });

  /** A contentEditable anchor, matching the block input the ":" trigger anchors on. */
  function createAnchor(rectOverrides: Partial<DOMRect> = {}): HTMLElement {
    const anchor = document.createElement('div');

    anchor.contentEditable = 'true';
    anchor.tabIndex = 0;
    anchor.getBoundingClientRect = (): DOMRect => ({
      top: 200, bottom: 220, left: 50, right: 90, width: 40, height: 20, x: 50, y: 200, toJSON: () => ({}), ...rectOverrides,
    });
    container.appendChild(anchor);

    return anchor;
  }

  it('does not focus the filter input on open, leaving the caret in the anchor', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = createAnchor();

    anchor.focus();

    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline: true });

    container.appendChild(picker.getElement());
    await picker.open(anchor);

    expect(anchor).toHaveFocus();

    picker.close();
  });

  it('does not create a page backdrop or lock document scroll', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = createAnchor();
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline: true });

    container.appendChild(picker.getElement());
    await picker.open(anchor);

    expect(document.querySelector('[data-blok-emoji-picker-backdrop]')).toBeNull();
    expect(document.documentElement.style.overflow).toBe('');

    picker.close();
  });

  it('does not close itself on a document Escape keydown — the caller owns Escape', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = createAnchor();
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline: true });

    container.appendChild(picker.getElement());
    await picker.open(anchor);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(picker.isOpen()).toBe(true);

    picker.close();
  });

  it('does not re-focus the anchor on close, since focus never left it', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = createAnchor();
    const other = document.createElement('input');

    container.appendChild(other);

    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline: true });

    container.appendChild(picker.getElement());
    await picker.open(anchor);

    // Something else — not the anchor — legitimately has focus by the time close() runs.
    other.focus();
    picker.close();

    expect(other).toHaveFocus();
  });

  it('omits dialog role and aria-modal', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline: true });
    const el = picker.getElement();

    expect(el.getAttribute('role')).toBeNull();
    expect(el.getAttribute('aria-modal')).toBeNull();
  });

  it('positions using the anchorRect override passed to open(), not the anchor element\'s own rect', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    // Far from every viewport edge (1024x768 in jsdom) so the assertion below
    // stays true regardless of any viewport-clamping the positioning math
    // does — this test's only job is proving the override rect wins over the
    // anchor's own, not pinning exact clamp behavior.
    const anchor = createAnchor({ top: 500, bottom: 520, left: 500, right: 540 });
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline: true });
    const el = picker.getElement();

    container.appendChild(el);
    el.getBoundingClientRect = (): DOMRect => ({
      top: 0, bottom: 300, left: 0, right: 400, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}),
    });

    const anchorRect: DOMRect = {
      top: 300, bottom: 320, left: 400, right: 440, width: 40, height: 20, x: 400, y: 300, toJSON: () => ({}),
    };

    await picker.open(anchor, anchorRect);

    expect(el.style.top).toBe('324px');
    expect(el.style.left).toBe('392px');

    picker.close();
  });

  it('setQuery mirrors the value into the filter input and filters the grid', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = createAnchor();
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline: true });

    container.appendChild(picker.getElement());
    await picker.open(anchor);

    picker.setQuery('flashlight');

    const input = picker.getElement().querySelector('input[type="text"]') as HTMLInputElement;

    expect(input.value).toBe('flashlight');

    const buttons = picker.getElement().querySelectorAll('[data-emoji-native]');

    expect(buttons.length).toBe(1);
    expect(buttons[0]?.getAttribute('data-emoji-native')).toBe('🔦');

    picker.close();
  });

  it('setQuery runs the same filtering code path as typing directly into the field', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = createAnchor();
    const typedPicker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline: true });
    const setQueryPicker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline: true });

    container.appendChild(typedPicker.getElement());
    container.appendChild(setQueryPicker.getElement());
    await typedPicker.open(anchor);
    await setQueryPicker.open(anchor);

    const typedInput = typedPicker.getElement().querySelector('input[type="text"]') as HTMLInputElement;

    typedInput.value = 'light';
    simulateInput(typedInput);

    setQueryPicker.setQuery('light');

    const typedNatives = Array.from(typedPicker.getElement().querySelectorAll('[data-emoji-native]')).map(b => b.getAttribute('data-emoji-native'));
    const setQueryNatives = Array.from(setQueryPicker.getElement().querySelectorAll('[data-emoji-native]')).map(b => b.getAttribute('data-emoji-native'));

    expect(setQueryNatives).toEqual(typedNatives);

    typedPicker.close();
    setQueryPicker.close();
  });

  it('routes filtering through the ranked search, putting the exact keyword match before the mere substring match', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = createAnchor();
    // Non-inline: this proves the Callout usage is ranked too, not just inline mode.
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en' });

    container.appendChild(picker.getElement());
    await picker.open(anchor);

    const input = picker.getElement().querySelector('input[type="text"]') as HTMLInputElement;

    input.value = 'light';
    simulateInput(input);

    const natives = Array.from(picker.getElement().querySelectorAll('[data-emoji-native]')).map(b => b.getAttribute('data-emoji-native'));

    expect(natives).toEqual(['💡', '🔦']);

    picker.close();
  });

  it('hides the search field, random button and remove button — the caller\'s typed query is the search surface', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = createAnchor();
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline: true });

    container.appendChild(picker.getElement());
    await picker.open(anchor);

    const el = picker.getElement();
    const search = el.querySelector('[data-emoji-picker-search]') as HTMLElement;
    const random = el.querySelector('[data-emoji-picker-random]') as HTMLElement;
    const remove = el.querySelector('[data-emoji-picker-remove]') as HTMLElement;

    expect(search.hidden).toBe(true);
    expect(random.hidden).toBe(true);
    expect(remove.hidden).toBe(true);

    // Skin tone and category nav stay.
    expect(el.querySelector('[data-emoji-picker-skin-toggle]')).not.toBeNull();
    expect(el.querySelectorAll('[data-emoji-nav]').length).toBeGreaterThan(0);

    picker.close();
  });

  it('keeps the search field, random button and remove button for the Callout tool\'s own (non-inline) use', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = createAnchor();
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en' });

    container.appendChild(picker.getElement());
    await picker.open(anchor);

    const el = picker.getElement();
    const search = el.querySelector('[data-emoji-picker-search]') as HTMLElement;
    const random = el.querySelector('[data-emoji-picker-random]') as HTMLElement;
    const remove = el.querySelector('[data-emoji-picker-remove]') as HTMLElement;

    expect(search.hidden).toBe(false);
    expect(random.hidden).toBe(false);
    expect(remove.hidden).toBe(false);

    picker.close();
  });

  it('omits the curated callout section and its star nav button from the full grid, without dropping those emoji from their real category', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = createAnchor();
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline: true });

    container.appendChild(picker.getElement());
    await picker.open(anchor);

    const el = picker.getElement();

    expect(el.querySelector('[data-emoji-section="callout"]')).toBeNull();
    expect(el.querySelector('[data-emoji-nav="callout"]')).toBeNull();

    // 💡 is one of the twenty curated emoji, and here also the only emoji
    // in the "objects" category fixture — it must still render, just inside
    // its real category, not vanish because there is no curated section.
    const objectsSection = el.querySelector('[data-emoji-section="objects"]');

    expect(objectsSection).not.toBeNull();
    expect(Array.from(objectsSection?.querySelectorAll('[data-emoji-native]') ?? []).map(b => b.getAttribute('data-emoji-native')))
      .toEqual(['🔦', '💡']);

    // At least one non-callout nav button remains, so the nav is still usable.
    const navButtons = Array.from(el.querySelectorAll('[data-emoji-nav]'));

    expect(navButtons.length).toBeGreaterThan(0);

    // Scroll-spy must not assume a "callout" section exists.
    const body = el.querySelector('[data-emoji-picker-body]') as HTMLElement;

    expect(() => body.dispatchEvent(new Event('scroll'))).not.toThrow();

    picker.close();
  });

  it('keeps the curated callout section for the Callout tool\'s own (non-inline) use', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = createAnchor();
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en' });

    container.appendChild(picker.getElement());
    await picker.open(anchor);

    const el = picker.getElement();
    const calloutSection = el.querySelector('[data-emoji-section="callout"]');

    expect(calloutSection).not.toBeNull();
    expect(calloutSection?.querySelector('[data-emoji-native]')?.getAttribute('data-emoji-native')).toBe('💡');
    expect(el.querySelector('[data-emoji-nav="callout"]')).not.toBeNull();

    picker.close();
  });

  it('does not let a focused grid button\'s arrow key move native focus — the caret must stay in the document', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = createAnchor();
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline: true });

    container.appendChild(picker.getElement());
    await picker.open(anchor);

    const buttons = Array.from(picker.getElement().querySelectorAll<HTMLButtonElement>('[data-emoji-native]'));

    expect(buttons.length).toBeGreaterThanOrEqual(2);

    const first = buttons[0];
    const second = buttons[1];

    if (first === undefined || second === undefined) {
      throw new Error('fixture needs at least two grid buttons');
    }

    // A plain <button> takes real focus on click in real browsers even
    // though EmojiTrigger never gives it focus itself — model that directly.
    first.focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });

    first.dispatchEvent(event);

    expect(first).toHaveFocus();
    expect(event.defaultPrevented).toBe(false);

    picker.close();
  });

  it('still finds a curated emoji through search in inline mode — only the curated SECTION is gone, not the emoji', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = createAnchor();
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k }, locale: 'en', inline: true });

    container.appendChild(picker.getElement());
    await picker.open(anchor);

    picker.setQuery('light');

    const natives = Array.from(picker.getElement().querySelectorAll('[data-emoji-native]')).map(b => b.getAttribute('data-emoji-native'));

    expect(natives).toContain('💡');

    picker.close();
  });
});
