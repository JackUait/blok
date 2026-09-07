import { getByRole, queryByAttribute } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlokEventMap } from '../../../../../src/components/events';
import { BlockEvents } from '../../../../../src/components/modules/blockEvents';
import { KeyboardController } from '../../../../../src/components/modules/uiControllers/controllers/keyboard';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import { EmojiPicker } from '../../../../../src/tools/callout/emoji-picker';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { createBlock, createBlokModules, setCaret } from '../../../components/modules/blockEvents/composers/emojiTrigger.fixture';

vi.mock('@emoji-mart/data', () => ({
  default: {
    categories: [{ id: 'people', emojis: ['fire'] }],
    emojis: {
      fire: { id: 'fire', name: 'Fire', keywords: ['hot'], skins: [{ native: '\u{1f525}', unified: '1f525' }], version: 1 },
    },
    aliases: {},
  },
}));

describe('EmojiPicker keyboard ownership', () => {
  let wrapper: HTMLElement;
  let anchor: HTMLElement;
  let inlineMenu: HTMLElement;
  let blockEvents: BlockEvents;
  let controller: KeyboardController;
  let modalPicker: EmojiPicker | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    const block = createBlock(':fi');
    const input = block.currentInput;

    if (input === undefined) {
      throw new Error('Missing block input');
    }

    anchor = input;
    anchor.tabIndex = 0;
    wrapper = document.createElement('div');
    wrapper.setAttribute('data-blok-testid', 'blok-editor');
    wrapper.appendChild(block.holder);
    document.body.appendChild(wrapper);
    anchor.focus();
    setCaret(block, 3);

    const eventsDispatcher = new EventsDispatcher<BlokEventMap>();

    blockEvents = new BlockEvents({ config: {}, eventsDispatcher });
    const blok = {
      ...createBlokModules(block),
      BlockEvents: blockEvents,
      BlockSelection: { navigationModeEnabled: false },
      Toolbar: { toolbox: { opened: false } },
    } as unknown as BlokModules;

    blockEvents.state = blok;
    controller = new KeyboardController({ config: {}, eventsDispatcher, someToolbarOpened: () => false });
    controller.state = blok;
    controller.setRedactorElement(wrapper);
    controller.setWrapperElement(wrapper);
    controller.enable();

    await blockEvents.emojiTrigger.handleInput(new InputEvent('input', { inputType: 'insertText', data: 'i' }));
    const menu = queryByAttribute('data-blok-testid', document.body, 'emoji-menu');

    if (menu === null) {
      throw new Error('Missing inline emoji menu');
    }

    inlineMenu = menu;
  });

  afterEach(() => {
    controller.disable();
    modalPicker?.close();
    modalPicker?.getElement().remove();
    modalPicker = undefined;
    blockEvents.emojiTrigger.destroy();
    wrapper.remove();
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('closes the inline menu through the editor when Escape starts in its skin-tone toggle', () => {
    // Inline mode hides the search field, random button and remove button
    // (see EmojiPicker's `_inline` branch) — the skin-tone toggle is the
    // only focusable control the inline menu still renders, so it stands
    // in for "focus starts inside the menu".
    const skinToneToggle = inlineMenu.querySelector<HTMLButtonElement>('[data-emoji-picker-skin-toggle]');

    if (skinToneToggle === null) {
      throw new Error('Missing skin tone toggle button');
    }

    skinToneToggle.focus();
    expect(skinToneToggle).toHaveFocus();
    expect(inlineMenu).toBeVisible();
    skinToneToggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(inlineMenu).not.toBeVisible();
    expect(blockEvents.emojiTrigger.opened).toBe(false);
    expect(anchor).not.toHaveAttribute('aria-expanded');
  });

  it('lets a modal picker close itself without closing the editor-owned inline menu', async () => {
    modalPicker = new EmojiPicker({
      onSelect: vi.fn(), onRemove: vi.fn(),
      i18n: { t: (key: string) => key }, locale: 'en',
    });
    document.body.appendChild(modalPicker.getElement());
    await modalPicker.open(anchor);
    const search = getByRole(modalPicker.getElement(), 'searchbox');

    expect(search).toHaveFocus();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(inlineMenu).toBeVisible();
    expect(blockEvents.emojiTrigger.opened).toBe(true);
    expect(modalPicker.getElement()).not.toBeVisible();
    expect(modalPicker.isOpen()).toBe(false);
    expect(anchor).toHaveFocus();
  });
});
