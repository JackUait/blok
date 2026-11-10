import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GestureController } from '../../../../../../src/components/modules/uiControllers/controllers/gesture';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { ModuleConfig } from '../../../../../../src/types-internal/module-config';

describe('GestureController', () => {
  let wrapper: HTMLElement;
  let input: HTMLElement;
  let controller: GestureController;
  let yjs: { beginGesture: ReturnType<typeof vi.fn>; holdCapture: ReturnType<typeof vi.fn>; releaseCapture: ReturnType<typeof vi.fn> };
  let selectedBlocks: boolean;
  let lineBreaks: boolean;

  const key = (init: KeyboardEventInit): void => {
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  };

  const caretAt = (offset: number): void => {
    const text = input.firstChild;

    if (text === null) {
      throw new Error('empty input');
    }
    window.getSelection()?.collapse(text, offset);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    selectedBlocks = false;
    lineBreaks = false;
    wrapper = document.createElement('div');
    wrapper.setAttribute('data-blok-editor', '');
    input = document.createElement('div');
    input.contentEditable = 'true';
    input.textContent = 'Hello';
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);

    yjs = { beginGesture: vi.fn(), holdCapture: vi.fn(), releaseCapture: vi.fn() };
    controller = new GestureController({ config: {}, eventsDispatcher: {} } as unknown as ModuleConfig);
    controller.state = {
      YjsManager: yjs,
      BlockSelection: { get anyBlockSelected() {
        return selectedBlocks;
      } },
      BlockManager: { getBlockByChildNode: () => ({ inputs: [input], tool: { isLineBreaksEnabled: lineBreaks } }) },
    } as unknown as BlokModules;
    controller.setWrapperElement(wrapper);
    controller.enable();
    caretAt(2);
  });

  afterEach(() => {
    controller.disable();
    wrapper.remove();
    vi.restoreAllMocks();
  });

  it('treats a printable key as typing', () => {
    key({ key: 'a' });

    expect(yjs.beginGesture).toHaveBeenCalledWith('typing');
  });

  it('treats a printable key over a block selection as discrete', () => {
    selectedBlocks = true;
    key({ key: 'a' });

    expect(yjs.beginGesture).toHaveBeenCalledWith('discrete');
  });

  describe('a key on the page body in navigation mode (focus left the editor)', () => {
    const bodyKey = (init: KeyboardEventInit): void => {
      window.getSelection()?.removeAllRanges();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    };

    it('starts a gesture when this editor has blocks selected', () => {
      selectedBlocks = true;
      bodyKey({ key: 'Backspace' });

      expect(yjs.beginGesture).toHaveBeenCalledWith('discrete');
    });

    it('starts none when this editor has no blocks selected', () => {
      bodyKey({ key: 'Backspace' });

      expect(yjs.beginGesture).not.toHaveBeenCalled();
    });

    it('starts none for a key typed into a field mounted on the body (a menu search)', () => {
      const field = document.createElement('input');

      document.body.appendChild(field);
      selectedBlocks = true;
      window.getSelection()?.removeAllRanges();
      field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
      field.remove();

      expect(yjs.beginGesture).not.toHaveBeenCalled();
    });

    it('leaves a key from another editor to that editor', () => {
      const other = document.createElement('div');
      const otherInput = document.createElement('div');

      other.setAttribute('data-blok-editor', '');
      other.appendChild(otherInput);
      wrapper.appendChild(other);
      selectedBlocks = true;
      window.getSelection()?.removeAllRanges();
      otherInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Backspace' }));

      expect(yjs.beginGesture).not.toHaveBeenCalled();
    });
  });

  it('treats a shortcut as discrete', () => {
    key({ key: 'b', metaKey: true });

    expect(yjs.beginGesture).toHaveBeenCalledWith('discrete');
  });

  it('treats Backspace inside the text as typing and at its start as a merge', () => {
    key({ key: 'Backspace' });
    caretAt(0);
    key({ key: 'Backspace' });

    expect(yjs.beginGesture.mock.calls).toEqual([['typing'], ['merge']]);
  });

  it('treats Delete inside the text as typing and at its end as discrete', () => {
    key({ key: 'Delete' });
    caretAt(5);
    key({ key: 'Delete' });

    expect(yjs.beginGesture.mock.calls).toEqual([['typing'], ['discrete']]);
  });

  it('treats Enter in a block that takes line breaks (code) as typing', () => {
    lineBreaks = true;
    key({ key: 'Enter' });

    expect(yjs.beginGesture).toHaveBeenCalledWith('typing');
  });

  it('treats Enter in a text block as a split and Shift+Enter there as typing (Notion U032, U044)', () => {
    key({ key: 'Enter' });
    key({ key: 'Enter', shiftKey: true });

    expect(yjs.beginGesture.mock.calls).toEqual([['split'], ['typing']]);
  });

  it('keeps Shift+Enter in code as discrete', () => {
    lineBreaks = true;
    key({ key: 'Enter', shiftKey: true });

    expect(yjs.beginGesture).toHaveBeenCalledWith('discrete');
  });

  it('keeps Enter and Backspace with a selection or a modifier discrete', () => {
    key({ key: 'Enter', altKey: true });
    window.getSelection()?.setBaseAndExtent(input.firstChild as Node, 0, input.firstChild as Node, 2);
    key({ key: 'Enter' });
    key({ key: 'Backspace' });

    expect(yjs.beginGesture.mock.calls).toEqual([['discrete'], ['discrete'], ['discrete']]);
  });

  it('treats a soft line break the browser inserts as typing', () => {
    input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertLineBreak' }));

    expect(yjs.beginGesture).toHaveBeenCalledWith('typing');
  });

  it('ignores caret moves, modifiers and composition keys', () => {
    key({ key: 'ArrowLeft' });
    key({ key: 'Shift' });
    key({ key: 'a', isComposing: true });

    expect(yjs.beginGesture).not.toHaveBeenCalled();
  });

  it('ignores gestures outside the editor while the caret is elsewhere', () => {
    const outside = document.createElement('button');

    document.body.appendChild(outside);
    window.getSelection()?.removeAllRanges();
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(yjs.beginGesture).not.toHaveBeenCalled();
    outside.remove();
  });

  it('takes a pointer press on a toolbar outside the editor while the caret is inside', () => {
    const toolbar = document.createElement('button');

    document.body.appendChild(toolbar);
    toolbar.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(yjs.beginGesture).toHaveBeenCalledWith('discrete');
    expect(yjs.holdCapture).not.toHaveBeenCalled();
    toolbar.remove();
  });

  it('holds the step through a pointer press inside the editor until release', () => {
    input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(yjs.holdCapture).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('pointerup'));
    document.dispatchEvent(new Event('pointerup'));

    expect(yjs.releaseCapture).toHaveBeenCalledTimes(1);
  });

  it('does not hold the step for a right-button press, which may never get its pointerup', () => {
    input.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true,
      button: 2 }));

    expect(yjs.beginGesture).toHaveBeenCalledWith('discrete');
    expect(yjs.holdCapture).not.toHaveBeenCalled();
  });

  it('releases the hold when a context menu opens (Ctrl+click on macOS)', () => {
    input.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true,
      button: 0,
      ctrlKey: true }));
    input.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(yjs.releaseCapture).toHaveBeenCalledTimes(1);
  });

  it('holds the step through an IME composition', () => {
    input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    input.dispatchEvent(new Event('compositionend', { bubbles: true }));

    expect(yjs.beginGesture).toHaveBeenCalledWith('typing');
    expect(yjs.holdCapture).toHaveBeenCalledTimes(1);
    expect(yjs.releaseCapture).toHaveBeenCalledTimes(1);
  });

  it('starts a discrete gesture on paste, cut and drop', () => {
    for (const type of ['paste', 'cut', 'drop']) {
      input.dispatchEvent(new Event(type, { bubbles: true }));
    }

    expect(yjs.beginGesture.mock.calls).toEqual([['discrete'], ['discrete'], ['discrete']]);
  });

  it('lets typing and a pick inside the open block menu continue the step that opened it', () => {
    const popover = document.createElement('div');
    const item = document.createElement('div');

    popover.setAttribute('data-blok-popover', '');
    popover.appendChild(item);
    document.body.appendChild(popover);
    wrapper.setAttribute('data-blok-toolbox-opened', 'true');

    key({ key: 'Enter' });
    item.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(yjs.beginGesture).not.toHaveBeenCalled();
    popover.remove();
  });

  describe('with another editor nested inside (a database card page)', () => {
    let nestedInput: HTMLElement;

    beforeEach(() => {
      const nested = document.createElement('div');

      nested.setAttribute('data-blok-editor', '');
      nestedInput = document.createElement('div');
      nestedInput.contentEditable = 'true';
      nestedInput.textContent = 'body';
      nested.appendChild(nestedInput);
      wrapper.appendChild(nested);
    });

    it('leaves keys, typing and presses in the nested editor to that editor', () => {
      nestedInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
      nestedInput.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText' }));
      nestedInput.dispatchEvent(new Event('pointerdown', { bubbles: true }));

      expect(yjs.beginGesture).not.toHaveBeenCalled();
      expect(yjs.holdCapture).not.toHaveBeenCalled();
    });

    it('leaves a toolbar press to the nested editor while its caret is there', () => {
      const text = nestedInput.firstChild;

      if (text === null) {
        throw new Error('empty input');
      }
      window.getSelection()?.collapse(text, 1);
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

      expect(yjs.beginGesture).not.toHaveBeenCalled();
    });

    it('still takes keys in its own blocks', () => {
      key({ key: 'a' });

      expect(yjs.beginGesture).toHaveBeenCalledWith('typing');
    });
  });

  it('starts a gesture even when an earlier document listener swallows the event', () => {
    // A page-level singleton (the inline tools' shortcut manager) binds its
    // document listeners once, so a later editor's controller registers after it.
    const swallow = (event: Event): void => event.stopImmediatePropagation();

    controller.disable();
    document.addEventListener('keydown', swallow, true);
    document.addEventListener('beforeinput', swallow, true);
    controller.enable();

    try {
      key({ key: 'b', metaKey: true });
      input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'formatBold' }));
    } finally {
      document.removeEventListener('keydown', swallow, true);
      document.removeEventListener('beforeinput', swallow, true);
    }

    expect(yjs.beginGesture.mock.calls).toEqual([['discrete'], ['discrete']]);
  });

  it('starts a gesture in its page title when the title is mounted outside the editor', () => {
    const title = document.createElement('div');

    title.contentEditable = 'true';
    title.textContent = 'Lab';
    document.body.appendChild(title);
    controller.state = {
      YjsManager: yjs,
      BlockSelection: { anyBlockSelected: false },
      BlockManager: { getBlockByChildNode: () => undefined },
      PageTitle: { titleElement: title },
    } as unknown as BlokModules;

    try {
      const text = title.firstChild;

      if (text === null) {
        throw new Error('empty title');
      }
      window.getSelection()?.collapse(text, 1);
      title.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'X' }));
      title.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    } finally {
      title.remove();
    }

    expect(yjs.beginGesture.mock.calls).toEqual([['typing'], ['discrete']]);
  });

  it('releases a hold when disabled mid-press', () => {
    input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    controller.disable();

    expect(yjs.releaseCapture).toHaveBeenCalledTimes(1);
  });
});
