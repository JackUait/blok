import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bindTitleKeyboard, type TitleKeyboardHost } from '../../../../../src/components/modules/pageTitle/title-keyboard';

type HostSpy = { [K in keyof TitleKeyboardHost]: ReturnType<typeof vi.fn> };

const setup = (text: string, caret: number): { title: HTMLElement; host: HostSpy } => {
  const title = document.createElement('h1');

  title.contentEditable = 'true';
  title.textContent = text;
  document.body.appendChild(title);
  title.focus();
  window.getSelection()?.setPosition(title.firstChild, caret);
  const host = { isReadOnly: vi.fn(() => false), split: vi.fn(), toFirstBlock: vi.fn(), undo: vi.fn(), redo: vi.fn(), commit: vi.fn() };

  bindTitleKeyboard(title, host);

  return { title, host };
};

const press = (el: HTMLElement, init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

  el.dispatchEvent(event);

  return event;
};

describe('bindTitleKeyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('Enter splits: text after the caret goes to a new first block', () => {
    const { title, host } = setup('Hello world', 5);

    press(title, { key: 'Enter' });

    expect(title.textContent).toBe('Hello');
    expect(host.split).toHaveBeenCalledWith(' world');
    expect(host.commit).toHaveBeenCalled();
  });

  it('Enter during IME composition does nothing', () => {
    const { title, host } = setup('Hello', 5);
    const event = press(title, { key: 'Enter', isComposing: true });

    expect(host.split).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('Cmd+Z and Cmd+Shift+Z go to the editor history', () => {
    const { title, host } = setup('Hi', 2);

    press(title, { key: 'z', metaKey: true });
    press(title, { key: 'z', metaKey: true, shiftKey: true });
    press(title, { key: 'y', ctrlKey: true });

    expect(host.undo).toHaveBeenCalledTimes(1);
    expect(host.redo).toHaveBeenCalledTimes(2);
  });

  it('paste inserts plain text with newlines as spaces', () => {
    const { title, host } = setup('ab', 1);
    const event = new Event('paste', { bubbles: true, cancelable: true });

    // jsdom has neither ClipboardEvent nor DataTransfer.
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'x\n\ny' } });
    title.dispatchEvent(event);

    expect(title.textContent).toBe('ax yb');
    expect(host.commit).toHaveBeenCalled();
  });

  it('read-only: Enter does not split', () => {
    const { title, host } = setup('Hello', 2);

    host.isReadOnly.mockReturnValue(true);
    press(title, { key: 'Enter' });

    expect(host.split).not.toHaveBeenCalled();
  });

  it.each(['b', 'i', 'u'])('Cmd+%s does not apply native formatting', (key) => {
    const { title } = setup('Hi', 1);

    expect(press(title, { key, metaKey: true }).defaultPrevented).toBe(true);
    expect(press(title, { key, ctrlKey: true }).defaultPrevented).toBe(true);
  });
});
