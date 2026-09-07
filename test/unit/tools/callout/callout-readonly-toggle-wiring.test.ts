// test/unit/tools/callout/callout-readonly-toggle-wiring.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { CalloutData, CalloutConfig } from '../../../../src/tools/callout/types';
import { CalloutTool } from '../../../../src/tools/callout';

const openedPickers: string[] = [];
const prefetchSpy = vi.fn();

/**
 * The real picker opens asynchronously and mounts on `document.body`, which
 * leaks between cases; the wiring under test only needs to know the trigger
 * reached it.
 */
vi.mock('../../../../src/tools/callout/emoji-picker', () => {
  class MockEmojiPicker {
    private readonly el = document.createElement('div');

    public getElement(): HTMLElement {
      return this.el;
    }

    public open(): Promise<void> {
      openedPickers.push('open');

      return Promise.resolve();
    }

    public close(): void {}
  }

  return {
    EmojiPicker: MockEmojiPicker,
    prefetchEmojiPickerData: (locale: string): void => prefetchSpy(locale),
  };
});

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
  overrides: { readOnly?: boolean } = {}
): BlockToolConstructorOptions<CalloutData, CalloutConfig> => ({
  data: { emoji: '💡', textColor: null, backgroundColor: null },
  config: {},
  api: createMockAPI(),
  readOnly: overrides.readOnly ?? false,
  block: { id: 'callout-block-id' } as never,
});

function emojiButtonOf(wrapper: HTMLElement): HTMLButtonElement {
  const button = wrapper.querySelector<HTMLButtonElement>('[data-blok-testid="callout-emoji-btn"]');

  expect(button).not.toBeNull();

  return button as HTMLButtonElement;
}

/**
 * A collaboration session boots read-only whatever the host asked for
 * (`ReadOnly.prepare()`), so on every reload a callout first renders read-only
 * and is switched to editable in place. These pin that the switch restores the
 * interaction `render()` skipped — otherwise the icon stays dead all session.
 */
describe('CalloutTool read-only toggle rewires interaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openedPickers.length = 0;
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('opens the emoji picker on click after a read-only render is toggled editable', () => {
    const tool = new CalloutTool(createOptions({ readOnly: true }));
    const wrapper = tool.render();

    document.body.appendChild(wrapper);
    tool.setReadOnly(false);

    emojiButtonOf(wrapper).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(openedPickers).toHaveLength(1);
  });

  it('opens the emoji picker on Enter after a read-only render is toggled editable', () => {
    const tool = new CalloutTool(createOptions({ readOnly: true }));
    const wrapper = tool.render();

    document.body.appendChild(wrapper);
    tool.setReadOnly(false);

    emojiButtonOf(wrapper).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(openedPickers).toHaveLength(1);
  });

  it('warms the emoji dataset from the trigger after a read-only render is toggled editable', () => {
    const tool = new CalloutTool(createOptions({ readOnly: true }));
    const wrapper = tool.render();

    document.body.appendChild(wrapper);
    tool.setReadOnly(false);

    emojiButtonOf(wrapper).dispatchEvent(new Event('pointerenter'));

    expect(prefetchSpy).toHaveBeenCalledWith('en');
  });

  it('stops opening the emoji picker once an editable render is toggled read-only', () => {
    const tool = new CalloutTool(createOptions());
    const wrapper = tool.render();

    document.body.appendChild(wrapper);
    tool.setReadOnly(true);

    emojiButtonOf(wrapper).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(openedPickers).toHaveLength(0);
  });

  it('does not stack duplicate listeners when told it is already editable', () => {
    const tool = new CalloutTool(createOptions());
    const wrapper = tool.render();

    document.body.appendChild(wrapper);
    tool.setReadOnly(false);
    tool.setReadOnly(false);

    emojiButtonOf(wrapper).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(openedPickers).toHaveLength(1);
  });
});
