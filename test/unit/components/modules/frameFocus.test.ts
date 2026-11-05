import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FrameFocus } from '../../../../src/components/modules/frameFocus';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';

const created: FrameFocus[] = [];

const setup = (): { module: FrameFocus; wrapper: HTMLElement; paragraph: HTMLElement; frame: HTMLIFrameElement } => {
  const wrapper = document.createElement('div');
  const paragraph = document.createElement('div');
  const embed = document.createElement('div');
  const frame = document.createElement('iframe');

  paragraph.contentEditable = 'true';
  // jsdom does not treat contenteditable as focusable.
  paragraph.tabIndex = 0;
  paragraph.textContent = 'editor';
  embed.setAttribute('data-blok-tool', 'embed');
  embed.append(frame);
  wrapper.append(paragraph, embed);
  document.body.append(wrapper);

  const module = new FrameFocus({ config: {}, eventsDispatcher: new EventsDispatcher<BlokEventMap>() });

  module.state = { UI: { nodes: { wrapper } } } as unknown as BlokModules;
  module.prepare();
  created.push(module);

  return { module, wrapper, paragraph, frame };
};

/** Put the caret in the paragraph after `offset` characters. */
const placeCaret = (paragraph: HTMLElement, offset: number): void => {
  const text = paragraph.firstChild;
  const selection = document.getSelection();

  if (text === null || selection === null) {
    throw new Error('no text or selection');
  }
  paragraph.focus();
  const range = document.createRange();

  range.setStart(text, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

const caretOffset = (): number | null => {
  const selection = document.getSelection();

  return selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).startOffset : null;
};

/** A page inside the frame calls `focus()` on its own field: the parent sees the frame take focus. */
const frameTakesFocus = async (frame: HTMLIFrameElement): Promise<void> => {
  frame.focus();
  window.dispatchEvent(new Event('blur'));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/**
 * The pointer moves over `from` (the element at its last point, as layout
 * reports it now) and then the frame reports it entered.
 */
const pointerEnters = (frame: HTMLIFrameElement, from: Element): void => {
  // jsdom lays nothing out.
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => from });
  document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 50, clientY: 80 }));
  frame.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 50, clientY: 95 }));
};

const moveOnto = (frame: HTMLIFrameElement): void => {
  pointerEnters(frame, document.body);
};

describe('FrameFocus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    created.splice(0).forEach((module) => {
      module.markDestroyed();
      module.destroy();
    });
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'elementFromPoint');
    document.body.innerHTML = '';
  });

  it('gives focus and the caret back to the text when an embedded page takes focus on its own', async () => {
    const { paragraph, frame } = setup();

    placeCaret(paragraph, 3);
    await frameTakesFocus(frame);

    expect(paragraph).toHaveFocus();
    expect(caretOffset()).toBe(3);
  });

  it('gives focus back when the frame only came under a still pointer, as when its focus() scrolls the page', async () => {
    const { paragraph, frame } = setup();

    placeCaret(paragraph, 2);
    // The frame now covers the point of the last move: the page moved, the pointer did not.
    pointerEnters(frame, frame);
    await frameTakesFocus(frame);

    expect(paragraph).toHaveFocus();
  });

  it('lets the frame keep focus when the pointer came onto it from an embed handle drawn over the frame', async () => {
    const { wrapper, paragraph, frame } = setup();
    const handle = document.createElement('div');

    wrapper.append(handle);
    placeCaret(paragraph, 2);
    pointerEnters(frame, handle);
    await frameTakesFocus(frame);

    expect(frame).toHaveFocus();
  });

  it('puts the caret back when the browser dropped it while the frame had focus', async () => {
    const { paragraph, frame } = setup();

    placeCaret(paragraph, 4);
    frame.focus();
    document.getSelection()?.removeAllRanges();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(caretOffset()).toBe(4);
    expect(paragraph).toHaveFocus();
  });

  it('lets a click in the text take focus from a frame that grabbed it before anything had focus', () => {
    const { paragraph, frame } = setup();

    frame.focus();
    paragraph.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(frame).not.toHaveFocus();
  });

  it('gives focus back when the reader typed in the editor after resting the pointer on the frame', async () => {
    const { paragraph, frame } = setup();

    moveOnto(frame);
    placeCaret(paragraph, 1);
    paragraph.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    await frameTakesFocus(frame);

    expect(paragraph).toHaveFocus();
  });

  it('lets the frame keep focus when the reader moved the pointer onto it and clicked inside', async () => {
    const { paragraph, frame } = setup();

    placeCaret(paragraph, 3);
    // A click inside a cross-origin frame never reaches the parent; only the pointer entering it does.
    moveOnto(frame);
    await frameTakesFocus(frame);

    expect(frame).toHaveFocus();
  });

  it('lets the frame keep focus when the reader tabs into it', async () => {
    const { paragraph, frame } = setup();

    placeCaret(paragraph, 3);
    paragraph.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await frameTakesFocus(frame);

    expect(frame).toHaveFocus();
  });

  it('gives focus back after a Tab the editor handled itself', async () => {
    const { paragraph, frame } = setup();

    placeCaret(paragraph, 3);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

    tab.preventDefault();
    paragraph.dispatchEvent(tab);
    await frameTakesFocus(frame);

    expect(paragraph).toHaveFocus();
  });

  it('leaves frames outside its editor alone', async () => {
    const { paragraph } = setup();
    const outside = document.createElement('iframe');

    document.body.append(outside);
    placeCaret(paragraph, 3);
    await frameTakesFocus(outside);

    expect(outside).toHaveFocus();
  });

  it('leaves a frame that another tool in the editor owns alone', async () => {
    const { wrapper, paragraph } = setup();
    const custom = document.createElement('div');
    const own = document.createElement('iframe');

    custom.setAttribute('data-blok-tool', 'custom');
    custom.append(own);
    wrapper.append(custom);
    placeCaret(paragraph, 3);
    await frameTakesFocus(own);

    expect(own).toHaveFocus();
  });

  it('stops guarding once the editor is destroyed', async () => {
    const { module, paragraph, frame } = setup();

    placeCaret(paragraph, 3);
    module.markDestroyed();
    module.destroy();
    await frameTakesFocus(frame);

    expect(frame).toHaveFocus();
  });
});
