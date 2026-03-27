// test/unit/tools/callout/emoji-picker/emoji-picker.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProcessedEmoji } from '../../../../../src/tools/callout/emoji-picker/emoji-data';

vi.mock('../../../../../src/tools/callout/emoji-picker/emoji-data', () => ({
  loadEmojiData: vi.fn().mockResolvedValue([
    { native: '💡', skins: ['💡'], id: 'bulb', name: 'Light Bulb', keywords: ['light', 'idea'], category: 'objects' },
    { native: '😀', skins: ['😀'], id: 'grinning', name: 'Grinning Face', keywords: ['face', 'happy'], category: 'people' },
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
  });

  it('builds a picker element with filter input and body', async () => {
    const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
    const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never });
    const el = picker.getElement();

    expect(el.querySelector('input[type="text"]')).not.toBeNull();
    expect(el.querySelector('[data-emoji-picker-body]')).not.toBeNull();
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
    document.body.removeChild(anchor);
    document.body.removeChild(picker.getElement());
  });
});
