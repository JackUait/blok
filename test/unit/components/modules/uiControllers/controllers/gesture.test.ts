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
    wrapper = document.createElement('div');
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
      BlockManager: { getBlockByChildNode: () => ({ inputs: [input] }) },
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

  it('treats a shortcut as discrete', () => {
    key({ key: 'b', metaKey: true });

    expect(yjs.beginGesture).toHaveBeenCalledWith('discrete');
  });

  it('treats Backspace inside the text as typing and at its start as discrete', () => {
    key({ key: 'Backspace' });
    caretAt(0);
    key({ key: 'Backspace' });

    expect(yjs.beginGesture.mock.calls).toEqual([['typing'], ['discrete']]);
  });

  it('treats Delete inside the text as typing and at its end as discrete', () => {
    key({ key: 'Delete' });
    caretAt(5);
    key({ key: 'Delete' });

    expect(yjs.beginGesture.mock.calls).toEqual([['typing'], ['discrete']]);
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

  it('releases a hold when disabled mid-press', () => {
    input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    controller.disable();

    expect(yjs.releaseCapture).toHaveBeenCalledTimes(1);
  });
});
