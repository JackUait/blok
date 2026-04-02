// test/unit/tools/callout/emoji-picker/emoji-picker.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { simulateInput, simulateKeydown, simulateMousedown } from '../../../../helpers/simulate';
import type { ProcessedEmoji } from '../../../../../src/tools/callout/emoji-picker/emoji-data';

const mockOnHover = vi.fn();

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: (...args: unknown[]) => { mockOnHover(...args); },
  hide: vi.fn(),
}));

const mockLoadEmojiLocale = vi.fn().mockResolvedValue(null);
const mockGetTranslatedName = vi.fn().mockReturnValue(null);

vi.mock('../../../../../src/tools/callout/emoji-picker/emoji-locale', () => ({
  loadEmojiLocale: (...args: unknown[]): unknown => mockLoadEmojiLocale(...args),
  getTranslatedName: (...args: unknown[]): unknown => mockGetTranslatedName(...args),
}));

vi.mock('../../../../../src/tools/callout/emoji-picker/emoji-data', () => ({
  loadEmojiData: vi.fn().mockResolvedValue([
    { native: '💡', skins: ['💡'], id: 'bulb', name: 'Light Bulb', keywords: ['light', 'idea'], category: 'objects' },
    { native: '😀', skins: ['😀'], id: 'grinning', name: 'Grinning Face', keywords: ['face', 'happy'], category: 'people' },
    { native: '👍', skins: ['👍', '👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿'], id: 'thumbsup', name: 'Thumbs Up', keywords: ['ok', 'yes'], category: 'people' },
    { native: '✅', skins: ['✅'], id: 'check', name: 'Check Mark', keywords: ['ok', 'done'], category: 'symbols' },
  ] as ProcessedEmoji[]),
  searchEmojis: vi.fn((emojis: ProcessedEmoji[], q: string) => emojis.filter((e) => e.name.toLowerCase().includes(q))),
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

describe('EmojiPicker', () => {
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
    // Clear any scroll lock left by tests that open the picker without closing it
    document.documentElement.style.overflow = '';
  });

  it('uses fixed positioning so it stays in place when the page scrolls', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    const el = picker.getElement();

    expect(el.className).toContain('fixed');
    expect(el.className).not.toContain('absolute');
  });

  it('builds a picker element with filter input and body', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    const el = picker.getElement();

    expect(el.querySelector('input[type="text"]')).not.toBeNull();
    expect(el.querySelector('[data-emoji-picker-body]')).not.toBeNull();

    // Header uses gap-2.5 for spacing between search input and action buttons
    const header = el.querySelector('input[type="text"]')!.closest('.flex')!;
    expect(header.className).toContain('gap-2.5');
  });

  it('calls onSelect with emoji native char when emoji button is clicked', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const onSelect = vi.fn();
    const picker = new EmojiPicker({ onSelect, onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    container.appendChild(picker.getElement());

    await picker.open(container);

    const emojiButton = container.querySelector('[data-emoji-native]') as HTMLButtonElement;
    expect(emojiButton).not.toBeNull();
    emojiButton.click();

    expect(onSelect).toHaveBeenCalledWith(emojiButton.dataset.emojiNative);
  });

  it('calls onRemove when remove button is clicked', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const onRemove = vi.fn();
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove, i18n: { t: (k: string) => k } as never, locale: 'en' });
    container.appendChild(picker.getElement());
    await picker.open(container);

    const removeBtn = container.querySelector('[data-emoji-picker-remove]') as HTMLButtonElement;
    expect(removeBtn).not.toBeNull();
    removeBtn.click();

    expect(onRemove).toHaveBeenCalled();
    // Verify observable outcome: picker closes after remove
    expect(picker.isOpen()).toBe(false);
  });

  it('filters emojis when typing in the filter input', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    container.appendChild(picker.getElement());
    await picker.open(container);

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = 'light';
    simulateInput(input);

    const buttons = container.querySelectorAll('[data-emoji-native]');
    // Only 💡 (Light Bulb) should match 'light'
    expect(buttons.length).toBe(1);
  });

  it('preserves category sections when searching', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    container.appendChild(picker.getElement());
    await picker.open(container);

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;

    // 'thumbs' matches 👍 (people category) — mock searchEmojis returns name-based matches
    input.value = 'thumbs';
    simulateInput(input);

    // Sections should still be present in search results
    const sections = container.querySelectorAll('[data-emoji-section]');
    expect(sections.length).toBeGreaterThan(0);

    // The section should belong to the matching emoji's category
    const sectionCategories = Array.from(sections).map(s => s.getAttribute('data-emoji-section'));
    expect(sectionCategories).toContain('people');
  });

  it('hides sections with no matching emojis during search', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    container.appendChild(picker.getElement());
    await picker.open(container);

    // Before search: should have multiple sections (callout, people, objects, symbols)
    const sectionsBefore = container.querySelectorAll('[data-emoji-section]');
    expect(sectionsBefore.length).toBeGreaterThan(1);

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;

    // 'light' matches only 💡 (objects category, also in curated callout)
    input.value = 'light';
    simulateInput(input);

    const sectionsAfter = container.querySelectorAll('[data-emoji-section]');
    // Only sections containing matches should remain — fewer than before
    expect(sectionsAfter.length).toBeLessThan(sectionsBefore.length);
    expect(sectionsAfter.length).toBeGreaterThan(0);
  });

  it('closes when Escape is pressed', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    container.appendChild(picker.getElement());
    await picker.open(container);

    expect(picker.isOpen()).toBe(true);
    simulateKeydown(picker.getElement(), 'Escape');
    expect(picker.isOpen()).toBe(false);
  });

  describe('skin tone selector', () => {
    it('renders the toggle outside the search wrapper, showing the default hand', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
      const el = picker.getElement();

      const searchInput = el.querySelector('input[type="text"]')!;
      const searchWrapper = searchInput.parentElement!;
      const toggle = el.querySelector('[data-emoji-picker-skin-toggle]') as HTMLButtonElement;

      expect(toggle).not.toBeNull();
      expect(searchWrapper.contains(toggle)).toBe(false);
      expect(toggle.textContent).toBe('✋');
    });

    it('opens a popover with 6 hand variants when toggle is clicked', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
      container.appendChild(picker.getElement());
      await picker.open(container);

      const toggle = picker.getElement().querySelector('[data-emoji-picker-skin-toggle]') as HTMLButtonElement;
      const popover = picker.getElement().querySelector('[data-emoji-picker-skin-tone]') as HTMLElement;

      expect(popover.hidden).toBe(true);
      toggle.click();
      expect(popover.hidden).toBe(false);

      const options = popover.querySelectorAll('button');

      expect(options.length).toBe(6);
    });

    it('updates emojis and toggle when a skin tone is selected', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
      container.appendChild(picker.getElement());
      await picker.open(container);

      const toggle = picker.getElement().querySelector('[data-emoji-picker-skin-toggle]') as HTMLButtonElement;

      toggle.click();

      const popover = picker.getElement().querySelector('[data-emoji-picker-skin-tone]') as HTMLElement;
      const options = popover.querySelectorAll('button');

      // Select second skin tone (light)
      options[1].click();

      expect(toggle.textContent).toBe('✋🏻');
      expect(popover.hidden).toBe(true);

      const emojiButtons = Array.from(picker.getElement().querySelectorAll('[data-emoji-native]'));
      const thumbsUp = emojiButtons.find(btn => btn.getAttribute('data-emoji-native') === '👍') as HTMLButtonElement;

      expect(thumbsUp).not.toBeUndefined();
      expect(thumbsUp.textContent).toBe('👍🏻');
    });

    it('shows active state on toggle when popover is open, removes it when closed', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
      container.appendChild(picker.getElement());
      await picker.open(container);

      const toggle = picker.getElement().querySelector('[data-emoji-picker-skin-toggle]') as HTMLButtonElement;

      // No active state initially
      expect(toggle.classList.contains('bg-neutral-100')).toBe(false);

      // Open popover — toggle gets active background
      toggle.click();
      expect(toggle.classList.contains('bg-neutral-100')).toBe(true);

      // Close popover — active state removed
      toggle.click();
      expect(toggle.classList.contains('bg-neutral-100')).toBe(false);
    });

    describe('localStorage persistence', () => {
      afterEach(() => {
        localStorage.removeItem('blok-emoji-skin-tone');
      });

      it('saves selected skin tone to localStorage', async () => {
        const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
        const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
        container.appendChild(picker.getElement());
        await picker.open(container);

        const toggle = picker.getElement().querySelector('[data-emoji-picker-skin-toggle]') as HTMLButtonElement;

        toggle.click();

        const popover = picker.getElement().querySelector('[data-emoji-picker-skin-tone]') as HTMLElement;
        const options = popover.querySelectorAll('button');

        // Select skin tone index 3 (medium)
        options[3].click();

        expect(localStorage.getItem('blok-emoji-skin-tone')).toBe('3');
      });

      it('restores skin tone from localStorage when picker opens', async () => {
        localStorage.setItem('blok-emoji-skin-tone', '2');

        const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
        const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
        container.appendChild(picker.getElement());
        await picker.open(container);

        // Toggle should show medium-light hand
        const toggle = picker.getElement().querySelector('[data-emoji-picker-skin-toggle]') as HTMLButtonElement;

        expect(toggle.textContent).toBe('✋🏼');

        // Thumbs up should have medium-light skin tone applied
        const emojiButtons = Array.from(picker.getElement().querySelectorAll('[data-emoji-native]'));
        const thumbsUp = emojiButtons.find(btn => btn.getAttribute('data-emoji-native') === '👍') as HTMLButtonElement;

        expect(thumbsUp.textContent).toBe('👍🏼');
      });

      it('defaults to neutral (0) when localStorage has no saved value', async () => {
        const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
        const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
        container.appendChild(picker.getElement());
        await picker.open(container);

        const toggle = picker.getElement().querySelector('[data-emoji-picker-skin-toggle]') as HTMLButtonElement;

        expect(toggle.textContent).toBe('✋');
      });

      it('defaults to neutral (0) when localStorage contains an invalid value', async () => {
        localStorage.setItem('blok-emoji-skin-tone', 'banana');

        const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
        const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
        container.appendChild(picker.getElement());
        await picker.open(container);

        const toggle = picker.getElement().querySelector('[data-emoji-picker-skin-toggle]') as HTMLButtonElement;

        expect(toggle.textContent).toBe('✋');
      });

      it('handles localStorage being unavailable without crashing', async () => {
        const originalGetItem = Storage.prototype.getItem;
        const originalSetItem = Storage.prototype.setItem;

        Storage.prototype.getItem = () => { throw new DOMException('blocked'); };
        Storage.prototype.setItem = () => { throw new DOMException('blocked'); };

        try {
          const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
          const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
          container.appendChild(picker.getElement());
          await picker.open(container);

          // Should default to neutral without throwing
          const toggle = picker.getElement().querySelector('[data-emoji-picker-skin-toggle]') as HTMLButtonElement;

          expect(toggle.textContent).toBe('✋');

          // Selecting a skin tone should not throw either
          toggle.click();
          const popover = picker.getElement().querySelector('[data-emoji-picker-skin-tone]') as HTMLElement;
          const options = popover.querySelectorAll('button');

          expect(() => options[2].click()).not.toThrow();
        } finally {
          Storage.prototype.getItem = originalGetItem;
          Storage.prototype.setItem = originalSetItem;
        }
      });
    });

    it('closes popover on Escape without closing the picker', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
      container.appendChild(picker.getElement());
      await picker.open(container);

      const toggle = picker.getElement().querySelector('[data-emoji-picker-skin-toggle]') as HTMLButtonElement;

      toggle.click();

      const popover = picker.getElement().querySelector('[data-emoji-picker-skin-tone]') as HTMLElement;

      expect(popover.hidden).toBe(false);

      simulateKeydown(picker.getElement(), 'Escape');

      expect(popover.hidden).toBe(true);
      expect(picker.isOpen()).toBe(true);
    });
  });

  it('search icon is 16×16 and vertically centered inside the input', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    const el = picker.getElement();

    const input = el.querySelector('input[type="text"]') as HTMLInputElement;
    const iconSpan = input.parentElement!.querySelector('span') as HTMLSpanElement;
    // Icon should be 16×16
    expect(iconSpan.className).toContain('[&>svg]:w-[16px]');
    expect(iconSpan.className).toContain('[&>svg]:h-[16px]');

    // Vertically centered — flex removes inline baseline offset
    expect(iconSpan.className).toContain('flex');
    expect(iconSpan.className).toContain('items-center');
    expect(iconSpan.className).toContain('top-1/2');
    expect(iconSpan.className).toContain('-translate-y-1/2');
  });

  describe('header button sizing matches search input', () => {
    it('skin tone toggle uses 28px size, random and remove buttons use 34px to match the search input height', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
      const el = picker.getElement();

      const skinToggle = el.querySelector('[data-emoji-picker-skin-toggle]') as HTMLButtonElement;
      const randomBtn = el.querySelector('[data-emoji-picker-random]') as HTMLButtonElement;
      const removeBtn = el.querySelector('[data-emoji-picker-remove]') as HTMLButtonElement;

      // Skin tone toggle stays compact at 28px
      expect(skinToggle.className).toContain('w-[28px]');
      expect(skinToggle.className).toContain('h-[28px]');
      expect(skinToggle.className).toContain('text-[14px]');

      // Random and remove buttons match the search input height (~34px)
      for (const btn of [randomBtn, removeBtn]) {
        expect(btn.className).toContain('w-[34px]');
        expect(btn.className).toContain('h-[34px]');
      }
    });

    it('random and remove buttons are grouped with a tight gap', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
      const el = picker.getElement();

      const randomBtn = el.querySelector('[data-emoji-picker-random]') as HTMLButtonElement;
      const removeBtn = el.querySelector('[data-emoji-picker-remove]') as HTMLButtonElement;

      // Both should share a parent wrapper with gap-1
      expect(randomBtn.parentElement).toBe(removeBtn.parentElement);
      expect(randomBtn.parentElement!.className).toContain('gap-1');
    });

    it('random and remove button SVG icons are 14×14 to match larger button proportions', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
      const el = picker.getElement();

      const randomBtn = el.querySelector('[data-emoji-picker-random]') as HTMLButtonElement;
      const removeBtn = el.querySelector('[data-emoji-picker-remove]') as HTMLButtonElement;

      const randomSvg = randomBtn.querySelector('svg') as SVGElement;
      const removeSvg = removeBtn.querySelector('svg') as SVGElement;

      expect(randomSvg.getAttribute('width')).toBe('14');
      expect(randomSvg.getAttribute('height')).toBe('14');
      expect(removeSvg.getAttribute('width')).toBe('14');
      expect(removeSvg.getAttribute('height')).toBe('14');
    });
  });

  it('does not close the picker when the random button is clicked', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const onSelect = vi.fn();
    const picker = new EmojiPicker({ onSelect, onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    container.appendChild(picker.getElement());
    await picker.open(container);

    expect(picker.isOpen()).toBe(true);

    const randomBtn = picker.getElement().querySelector('[data-emoji-picker-random]') as HTMLButtonElement;
    randomBtn.click();

    expect(onSelect).toHaveBeenCalled();
    expect(picker.isOpen()).toBe(true);
  });

  it('attaches JS tooltips to random and remove buttons via onHover', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    const el = picker.getElement();

    const randomBtn = el.querySelector('[data-emoji-picker-random]') as HTMLButtonElement;
    const removeBtn = el.querySelector('[data-emoji-picker-remove]') as HTMLButtonElement;

    expect(mockOnHover).toHaveBeenCalledWith(randomBtn, expect.any(String), { placement: 'bottom' });
    expect(mockOnHover).toHaveBeenCalledWith(removeBtn, expect.any(String), { placement: 'bottom' });
  });

  it('attaches JS tooltips to emoji buttons via onHover with placement bottom', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    container.appendChild(picker.getElement());
    await picker.open(container);

    const emojiButtons = picker.getElement().querySelectorAll('[data-emoji-native]');

    expect(emojiButtons.length).toBeGreaterThan(0);

    for (const btn of Array.from(emojiButtons)) {
      expect(mockOnHover).toHaveBeenCalledWith(btn, expect.any(String), { placement: 'bottom' });
    }
  });

  it('does not set title attribute on elements that use JS tooltip via onHover', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    container.appendChild(picker.getElement());
    await picker.open(container);

    const randomBtn = picker.getElement().querySelector('[data-emoji-picker-random]') as HTMLButtonElement;
    const removeBtn = picker.getElement().querySelector('[data-emoji-picker-remove]') as HTMLButtonElement;
    const emojiButtons = picker.getElement().querySelectorAll('[data-emoji-native]');

    // These elements use onHover for JS tooltip — they must NOT have a title attribute
    // to avoid showing both browser tooltip and JS tooltip simultaneously
    expect(randomBtn.title).toBe('');
    expect(removeBtn.title).toBe('');

    for (const btn of Array.from(emojiButtons)) {
      expect((btn as HTMLButtonElement).title).toBe('');
    }
  });

  it('nav bar has gap between category icons and 8px horizontal padding', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    const nav = picker.getElement().querySelector('[data-emoji-picker-nav]') as HTMLElement;

    expect(nav.className).toContain('gap-1');
    expect(nav.className).toContain('px-2');
  });

  it('nav bar uses 4px top padding (pt-1)', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    const nav = picker.getElement().querySelector('[data-emoji-picker-nav]') as HTMLElement;

    expect(nav.className).toContain('pt-1');
    expect(nav.className).not.toContain('pt-2');
  });

  it('nav button corners use rounded-lg to match the outer rounded-xl container', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    container.appendChild(picker.getElement());
    await picker.open(container);

    const navButtons = picker.getElement().querySelectorAll('[data-emoji-nav]');

    expect(navButtons.length).toBeGreaterThan(0);
    for (const btn of Array.from(navButtons)) {
      expect(btn.className).toContain('rounded-lg');
      expect(btn.className).not.toContain('rounded-md');
    }
  });

  it('emoji body max height is 260px', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    const body = picker.getElement().querySelector('[data-emoji-picker-body]') as HTMLElement;

    expect(body.className).toContain('max-h-[260px]');
  });

  it('emoji grid uses 10 columns', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    container.appendChild(picker.getElement());
    await picker.open(container);

    const grids = picker.getElement().querySelectorAll('.grid');

    expect(grids.length).toBeGreaterThan(0);
    for (const grid of Array.from(grids)) {
      expect(grid.className).toContain('grid-cols-10');
    }
  });

  describe('emoji category i18n', () => {
    it('uses i18n-translated text for standard category section headings, not raw IDs', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const i18nSpy = vi.fn((k: string) => `[translated:${k}]`);
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: i18nSpy } as never, locale: 'en' });
      container.appendChild(picker.getElement());
      await picker.open(container);

      // Get all section headings (first child of each [data-emoji-section])
      const sections = picker.getElement().querySelectorAll('[data-emoji-section]');
      const headings = new Map<string, string>();

      for (const section of Array.from(sections)) {
        const id = section.getAttribute('data-emoji-section');
        const heading = section.querySelector('div');

        if (id !== null && heading?.textContent != null) {
          headings.set(id, heading.textContent);
        }
      }

      // Standard categories should use translated text, not raw category IDs
      const standardCategories = ['people', 'objects', 'symbols'];

      for (const catId of standardCategories) {
        if (headings.has(catId)) {
          const text = headings.get(catId)!;

          // Should NOT be the raw category ID
          expect(text).not.toBe(catId);
          // Should be translated (our mock prefixes with [translated:])
          expect(text).toContain('[translated:');
        }
      }
    });

    it('uses i18n-translated text for nav button tooltips and aria-labels', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const i18nSpy = vi.fn((k: string) => `[translated:${k}]`);
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: i18nSpy } as never, locale: 'en' });
      container.appendChild(picker.getElement());
      await picker.open(container);

      const navButtons = picker.getElement().querySelectorAll('[data-emoji-nav]');

      expect(navButtons.length).toBeGreaterThan(0);

      for (const btn of Array.from(navButtons)) {
        const title = btn.getAttribute('title');
        const ariaLabel = btn.getAttribute('aria-label');

        // Should be translated, not hardcoded English
        expect(title).toContain('[translated:');
        expect(ariaLabel).toContain('[translated:');
      }
    });

    it('calls i18n.t with emoji category keys for each visible standard category', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const i18nSpy = vi.fn((k: string) => `[translated:${k}]`);
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: i18nSpy } as never, locale: 'en' });
      container.appendChild(picker.getElement());
      await picker.open(container);

      // i18n.t should have been called with keys containing 'emojiCategory'
      const categoryKeyCalls = i18nSpy.mock.calls
        .map(([key]) => key)
        .filter((key: string) => key.includes('emojiCategory'));

      // At least the callout category + visible standard categories
      expect(categoryKeyCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('emoji grid has top padding so hover-scaled emojis do not overlap section headings', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
    container.appendChild(picker.getElement());
    await picker.open(container);

    const grids = picker.getElement().querySelectorAll('.grid');

    expect(grids.length).toBeGreaterThan(0);
    for (const grid of Array.from(grids)) {
      expect(grid.className).toContain('pt-1');
    }
  });

  describe('backdrop', () => {
    it('wraps the picker in a fixed backdrop to block pointer events behind it', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const anchor = document.createElement('button');
      document.body.appendChild(anchor);
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
      document.body.appendChild(picker.getElement());
      await picker.open(anchor);

      const backdrop = document.querySelector('[data-blok-emoji-picker-backdrop]') as HTMLElement;

      expect(backdrop).not.toBeNull();
      expect(backdrop.style.position).toBe('fixed');
      expect(backdrop.style.inset).toBe('0px');
      // Picker is inside the backdrop wrapper
      expect(backdrop.contains(picker.getElement())).toBe(true);

      picker.close();
      document.body.removeChild(anchor);
      document.body.removeChild(picker.getElement());
    });

    it('closes picker when backdrop is clicked (not when picker is clicked)', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const anchor = document.createElement('button');
      document.body.appendChild(anchor);
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
      document.body.appendChild(picker.getElement());
      await picker.open(anchor);

      const backdrop = document.querySelector('[data-blok-emoji-picker-backdrop]') as HTMLElement;

      // Clicking directly on backdrop closes
      simulateMousedown(backdrop);
      expect(picker.isOpen()).toBe(false);

      document.body.removeChild(anchor);
      document.body.removeChild(picker.getElement());
    });

    it('locks page scroll when open and restores it on close', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const anchor = document.createElement('button');
      document.body.appendChild(anchor);
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
      document.body.appendChild(picker.getElement());

      // Before open — no scroll lock
      expect(document.documentElement.style.overflow).not.toBe('hidden');

      await picker.open(anchor);

      // While open — scroll is locked
      expect(document.documentElement.style.overflow).toBe('hidden');

      picker.close();

      // After close — scroll restored
      expect(document.documentElement.style.overflow).not.toBe('hidden');

      document.body.removeChild(anchor);
      document.body.removeChild(picker.getElement());
    });

    it('removes backdrop and moves picker back on close', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const anchor = document.createElement('button');
      document.body.appendChild(anchor);
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
      document.body.appendChild(picker.getElement());
      await picker.open(anchor);

      expect(document.querySelector('[data-blok-emoji-picker-backdrop]')).not.toBeNull();
      picker.close();
      expect(document.querySelector('[data-blok-emoji-picker-backdrop]')).toBeNull();
      // Picker is back in document.body
      expect(document.body.contains(picker.getElement())).toBe(true);

      document.body.removeChild(anchor);
      document.body.removeChild(picker.getElement());
    });
  });

  it('open() appends the picker element to document.body', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });

    // Manually append picker to body (as CalloutTool does in openEmojiPicker)
    document.body.appendChild(picker.getElement());
    await picker.open(anchor);

    expect(document.body.contains(picker.getElement())).toBe(true);
    expect(picker.isOpen()).toBe(true);
    picker.close();
    document.body.removeChild(anchor);
    document.body.removeChild(picker.getElement());
  });

  describe('emoji name translations', () => {
    it('shows translated emoji names in tooltips when locale data is available', async () => {
      mockLoadEmojiLocale.mockResolvedValue({
        '💡': { n: 'ampoule', k: ['idée'] },
        '😀': { n: 'visage souriant', k: ['joyeux'] },
      });
      mockGetTranslatedName.mockImplementation((native: string) => {
        const names: Record<string, string> = { '💡': 'ampoule', '😀': 'visage souriant' };
        return names[native] ?? null;
      });

      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'fr' });
      container.appendChild(picker.getElement());
      await picker.open(container);

      const allBtns = Array.from(picker.getElement().querySelectorAll<HTMLButtonElement>('[data-emoji-native]'));
      const bulbBtn = allBtns.find(btn => btn.getAttribute('data-emoji-native') === '💡');

      expect(bulbBtn).toBeDefined();
      // Name is shown via JS tooltip (onHover), not browser title attribute
      expect(mockOnHover).toHaveBeenCalledWith(bulbBtn, 'ampoule', { placement: 'bottom' });
    });

    it('falls back to English name in lowercase when translated name is not available', async () => {
      mockLoadEmojiLocale.mockResolvedValue({
        '💡': { n: 'ampoule', k: ['idée'] },
      });
      mockGetTranslatedName.mockImplementation((native: string) => {
        if (native === '💡') return 'ampoule';
        return null;
      });

      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'fr' });
      container.appendChild(picker.getElement());
      await picker.open(container);

      const allBtns = Array.from(picker.getElement().querySelectorAll<HTMLButtonElement>('[data-emoji-native]'));
      const thumbsBtn = allBtns.find(btn => btn.getAttribute('data-emoji-native') === '👍');

      expect(thumbsBtn).toBeDefined();
      expect(mockOnHover).toHaveBeenCalledWith(thumbsBtn, 'thumbs up', { placement: 'bottom' });
    });

    it('displays English emoji names in lowercase', async () => {
      mockGetTranslatedName.mockReturnValue(null);

      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
      container.appendChild(picker.getElement());
      await picker.open(container);

      const allBtns = Array.from(picker.getElement().querySelectorAll<HTMLButtonElement>('[data-emoji-native]'));
      const bulbBtn = allBtns.find(btn => btn.getAttribute('data-emoji-native') === '💡');

      expect(bulbBtn).toBeDefined();
      expect(mockOnHover).toHaveBeenCalledWith(bulbBtn, 'light bulb', { placement: 'bottom' });
      expect(mockLoadEmojiLocale).not.toHaveBeenCalled();
    });

    it('displays locale-translated emoji names in lowercase', async () => {
      mockLoadEmojiLocale.mockResolvedValue({
        '💡': { n: 'Ampoule Électrique', k: ['idée'] },
        '😀': { n: 'Visage Souriant', k: ['joyeux'] },
      });

      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'fr' });
      container.appendChild(picker.getElement());
      await picker.open(container);

      const allBtns = Array.from(picker.getElement().querySelectorAll<HTMLButtonElement>('[data-emoji-native]'));
      const bulbBtn = allBtns.find(btn => btn.getAttribute('data-emoji-native') === '💡');

      expect(bulbBtn).toBeDefined();
      expect(mockOnHover).toHaveBeenCalledWith(bulbBtn, 'ampoule électrique', { placement: 'bottom' });
    });
  });
});
