// test/unit/tools/callout/emoji-picker/emoji-picker.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProcessedEmoji } from '../../../../../src/tools/callout/emoji-picker/emoji-data';

const mockOnHover = vi.fn();

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: (...args: unknown[]) => mockOnHover(...args),
  hide: vi.fn(),
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
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
    const el = picker.getElement();

    expect(el.className).toContain('fixed');
    expect(el.className).not.toContain('absolute');
  });

  it('builds a picker element with filter input and body', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
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
    const picker = new EmojiPicker({ onSelect, onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
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
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove, i18n: { t: (k: string) => k } as never });
    container.appendChild(picker.getElement());
    await picker.open(container);

    const removeBtn = container.querySelector('[data-emoji-picker-remove]') as HTMLButtonElement;
    expect(removeBtn).not.toBeNull();
    removeBtn.click();

    expect(onRemove).toHaveBeenCalled();
  });

  it('filters emojis when typing in the filter input', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
    container.appendChild(picker.getElement());
    await picker.open(container);

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = 'light';
    input.dispatchEvent(new Event('input'));

    const buttons = container.querySelectorAll('[data-emoji-native]');
    // Only 💡 (Light Bulb) should match 'light'
    expect(buttons.length).toBe(1);
  });

  it('closes when Escape is pressed', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
    container.appendChild(picker.getElement());
    await picker.open(container);

    expect(picker.isOpen()).toBe(true);
    picker.getElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(picker.isOpen()).toBe(false);
  });

  describe('skin tone selector', () => {
    it('renders the toggle outside the search wrapper, showing the default hand', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
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
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
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
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
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
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
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

    it('closes popover on Escape without closing the picker', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
      container.appendChild(picker.getElement());
      await picker.open(container);

      const toggle = picker.getElement().querySelector('[data-emoji-picker-skin-toggle]') as HTMLButtonElement;

      toggle.click();

      const popover = picker.getElement().querySelector('[data-emoji-picker-skin-tone]') as HTMLElement;

      expect(popover.hidden).toBe(false);

      picker.getElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(popover.hidden).toBe(true);
      expect(picker.isOpen()).toBe(true);
    });
  });

  it('search icon is 16×16 and vertically centered inside the input', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
    const el = picker.getElement();

    const input = el.querySelector('input[type="text"]') as HTMLInputElement;
    const iconSpan = input.parentElement!.querySelector('span') as HTMLSpanElement;
    const svg = iconSpan.querySelector('svg') as SVGElement;

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
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
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
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
      const el = picker.getElement();

      const randomBtn = el.querySelector('[data-emoji-picker-random]') as HTMLButtonElement;
      const removeBtn = el.querySelector('[data-emoji-picker-remove]') as HTMLButtonElement;

      // Both should share a parent wrapper with gap-1
      expect(randomBtn.parentElement).toBe(removeBtn.parentElement);
      expect(randomBtn.parentElement!.className).toContain('gap-1');
    });

    it('random and remove button SVG icons are 14×14 to match larger button proportions', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
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

  it('attaches JS tooltips to random and remove buttons via onHover', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
    const el = picker.getElement();

    const randomBtn = el.querySelector('[data-emoji-picker-random]') as HTMLButtonElement;
    const removeBtn = el.querySelector('[data-emoji-picker-remove]') as HTMLButtonElement;

    expect(mockOnHover).toHaveBeenCalledWith(randomBtn, randomBtn.getAttribute('title'), { placement: 'bottom' });
    expect(mockOnHover).toHaveBeenCalledWith(removeBtn, removeBtn.getAttribute('title'), { placement: 'bottom' });
  });

  it('attaches JS tooltips to emoji buttons via onHover with placement top', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
    container.appendChild(picker.getElement());
    await picker.open(container);

    const emojiButtons = picker.getElement().querySelectorAll('[data-emoji-native]');

    expect(emojiButtons.length).toBeGreaterThan(0);

    // Each emoji button should have onHover called with (button, name, { placement: 'top' })
    for (const btn of emojiButtons) {
      expect(mockOnHover).toHaveBeenCalledWith(btn, btn.getAttribute('title'), { placement: 'bottom' });
    }
  });

  it('nav bar uses 4px top padding (pt-1)', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
    const nav = picker.getElement().querySelector('[data-emoji-picker-nav]') as HTMLElement;

    expect(nav.className).toContain('pt-1');
    expect(nav.className).not.toContain('pt-2');
  });

  it('nav button corners use rounded-lg to match the outer rounded-xl container', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
    container.appendChild(picker.getElement());
    await picker.open(container);

    const navButtons = picker.getElement().querySelectorAll('[data-emoji-nav]');

    expect(navButtons.length).toBeGreaterThan(0);
    for (const btn of navButtons) {
      expect(btn.className).toContain('rounded-lg');
      expect(btn.className).not.toContain('rounded-md');
    }
  });

  it('emoji grid has top padding so hover-scaled emojis do not overlap section headings', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
    container.appendChild(picker.getElement());
    await picker.open(container);

    const grids = picker.getElement().querySelectorAll('.grid');

    expect(grids.length).toBeGreaterThan(0);
    for (const grid of grids) {
      expect(grid.className).toContain('pt-1');
    }
  });

  describe('backdrop', () => {
    it('wraps the picker in a fixed backdrop to block pointer events behind it', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const anchor = document.createElement('button');
      document.body.appendChild(anchor);
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
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
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
      document.body.appendChild(picker.getElement());
      await picker.open(anchor);

      const backdrop = document.querySelector('[data-blok-emoji-picker-backdrop]') as HTMLElement;

      // Clicking directly on backdrop closes
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(picker.isOpen()).toBe(false);

      document.body.removeChild(anchor);
      document.body.removeChild(picker.getElement());
    });

    it('locks page scroll when open and restores it on close', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const anchor = document.createElement('button');
      document.body.appendChild(anchor);
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
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
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
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
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });

    // Manually append picker to body (as CalloutTool does in openEmojiPicker)
    document.body.appendChild(picker.getElement());
    await picker.open(anchor);

    expect(document.body.contains(picker.getElement())).toBe(true);
    expect(picker.isOpen()).toBe(true);
    picker.close();
    document.body.removeChild(anchor);
    document.body.removeChild(picker.getElement());
  });
});
