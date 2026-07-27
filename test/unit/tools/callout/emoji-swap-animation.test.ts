// test/unit/tools/callout/emoji-swap-animation.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { CalloutData, CalloutConfig } from '../../../../src/tools/callout/types';
import { CalloutTool } from '../../../../src/tools/callout';

vi.mock('../../../../src/tools/callout/emoji-picker/emoji-data', () => ({
  loadEmojiData: vi.fn().mockResolvedValue([]),
  searchEmojis: vi.fn().mockReturnValue([]),
  groupEmojisByCategory: vi.fn().mockReturnValue(new Map()),
  CURATED_CALLOUT_EMOJIS: [],
}));

const createMockAPI = (): API => ({
  styles: { block: 'ce-block', inlineToolbar: '', inlineToolButton: '', inlineToolButtonActive: '', settingsButton: '', settingsButtonActive: '', selected: '' },
  i18n: { t: (k: string) => k, has: vi.fn().mockReturnValue(false), getLocale: vi.fn().mockReturnValue('en'), getEnglishTranslation: vi.fn().mockReturnValue('') },
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  blocks: {
    insertInsideParent: vi.fn().mockReturnValue({ id: 'child-id', holder: document.createElement('div') }),
    convert: vi.fn(),
    getBlockIndex: vi.fn().mockReturnValue(0),
    getChildren: vi.fn().mockReturnValue([]),
    update: vi.fn(),
    delete: vi.fn(),
  },
  caret: { setToBlock: vi.fn(), isAtStart: vi.fn().mockReturnValue(false) },
  toolbar: { toggleBlockSettings: vi.fn() },
} as unknown as API);

const createOptions = (
  data: Partial<CalloutData> = {}
): BlockToolConstructorOptions<CalloutData, CalloutConfig> => ({
  data: { emoji: '💡', textColor: null, backgroundColor: null, ...data },
  config: {},
  api: createMockAPI(),
  readOnly: false,
  block: { id: 'callout-block-id' } as never,
});

/**
 * Renders a callout wired to a stub picker and returns a `pick(emoji)` driver
 * plus the emoji button — the harness every test in this file goes through.
 */
function renderCalloutWithPicker(
  data: Partial<CalloutData> = {}
): { button: HTMLButtonElement; pick: (emoji: string) => void } {
  const customPicker = vi.fn();
  const options = createOptions(data);

  (options as unknown as { config: CalloutConfig }).config = { emojiPicker: customPicker };

  const tool = new CalloutTool(options);
  const wrapper = tool.render();
  const button = wrapper.querySelector('[data-blok-testid="callout-emoji-btn"]') as HTMLButtonElement;

  button.click();
  const [onSelect] = customPicker.mock.calls[0] as [(emoji: string) => void];

  return { button, pick: onSelect };
}

const getFace = (button: HTMLButtonElement): HTMLElement | null =>
  button.querySelector('[data-blok-testid="callout-emoji-face"]');

const getGhost = (button: HTMLButtonElement): HTMLElement | null =>
  button.querySelector('[data-blok-testid="callout-emoji-ghost"]');

describe('callout emoji swap animation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('picking a different emoji swaps the face text and plays the jump-in animation on it', async () => {
    const { button, pick } = renderCalloutWithPicker({ emoji: '🔑' });

    pick('☝️');

    const face = getFace(button);

    expect(face).not.toBeNull();
    expect(face!.textContent).toBe('☝️');
    expect(face!.className).toContain('blok-callout-emoji-jump-in');
    expect(button.textContent).toContain('☝️');
  });

  it('spawns a ghost of the previous emoji that plays the knock-out animation', async () => {
    const { button, pick } = renderCalloutWithPicker({ emoji: '🔑' });

    pick('☝️');

    const ghost = getGhost(button);

    expect(ghost).not.toBeNull();
    expect(ghost!.textContent).toBe('🔑');
    expect(ghost!.getAttribute('aria-hidden')).toBe('true');
    expect(ghost!.className).toContain('blok-callout-emoji-knock-out');
  });

  it('removes the ghost once its animation ends', async () => {
    const { button, pick } = renderCalloutWithPicker({ emoji: '🔑' });

    pick('☝️');

    const ghost = getGhost(button);

    ghost!.dispatchEvent(new Event('animationend'));

    expect(getGhost(button)).toBeNull();
  });

  it('removes the jump-in class from the face once its animation ends', async () => {
    const { button, pick } = renderCalloutWithPicker({ emoji: '🔑' });

    pick('☝️');

    const face = getFace(button);

    face!.dispatchEvent(new Event('animationend'));

    expect(face!.className).not.toContain('blok-callout-emoji-jump-in');
  });

  it('does not animate when the same emoji is picked again', async () => {
    const { button, pick } = renderCalloutWithPicker({ emoji: '🔑' });

    pick('🔑');

    expect(getGhost(button)).toBeNull();
    expect(getFace(button)!.className).not.toContain('blok-callout-emoji-jump-in');
  });

  it('plays only the jump-in when there was no previous emoji', async () => {
    const { button, pick } = renderCalloutWithPicker({ emoji: '' });

    pick('🎉');

    expect(getGhost(button)).toBeNull();
    expect(getFace(button)!.className).toContain('blok-callout-emoji-jump-in');
  });

  it('plays only the knock-out when the emoji is removed', async () => {
    const { button, pick } = renderCalloutWithPicker({ emoji: '🔑' });

    pick('');

    const ghost = getGhost(button);

    expect(ghost).not.toBeNull();
    expect(ghost!.textContent).toBe('🔑');
    expect(getFace(button)!.textContent).toBe('');
    expect(getFace(button)!.className).not.toContain('blok-callout-emoji-jump-in');
  });

  it('replaces a still-animating ghost when emojis are picked in quick succession', async () => {
    const { button, pick } = renderCalloutWithPicker({ emoji: '🔑' });

    pick('☝️');
    pick('✂️');

    const ghosts = button.querySelectorAll('[data-blok-testid="callout-emoji-ghost"]');

    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].textContent).toBe('☝️');
    expect(getFace(button)!.textContent).toBe('✂️');
  });

  it('swaps without any animation when prefers-reduced-motion is set', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
      })),
    });

    const { button, pick } = renderCalloutWithPicker({ emoji: '🔑' });

    pick('☝️');

    expect(getFace(button)!.textContent).toBe('☝️');
    expect(getGhost(button)).toBeNull();
    expect(getFace(button)!.className).not.toContain('blok-callout-emoji-jump-in');
  });
});
