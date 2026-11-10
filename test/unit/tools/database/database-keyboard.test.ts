import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseKeyboard, isHistoryKey } from '../../../../src/tools/database/database-keyboard';
import type * as BrowserModule from '../../../../src/components/utils/browser';
import type { DatabaseKeyboardOptions } from '../../../../src/tools/database/database-keyboard';

const createOptions = (overrides: Partial<DatabaseKeyboardOptions> = {}): DatabaseKeyboardOptions => ({
  wrapper: document.createElement('div'),
  onEscape: vi.fn(() => true),
  ...overrides,
});

const macOS = vi.hoisted(() => ({ value: false }));

vi.mock('../../../../src/components/utils/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof BrowserModule>();

  return { ...actual, getUserOS: () => ({ win: !macOS.value, mac: macOS.value, x11: false, linux: false }) };
});

describe('isHistoryKey (the keys a drag holds back from the editor)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    macOS.value = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const keydown = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init);

  it('on macOS includes Cmd+Y, which redoes', () => {
    macOS.value = true;

    expect(isHistoryKey(keydown({ key: 'y', code: 'KeyY', metaKey: true }))).toBe(true);
  });

  it('on Windows and Linux excludes Meta+Y', () => {
    expect(isHistoryKey(keydown({ key: 'y', code: 'KeyY', metaKey: true }))).toBe(false);
    expect(isHistoryKey(keydown({ key: 'y', code: 'KeyY', ctrlKey: true }))).toBe(true);
  });
});

describe('DatabaseKeyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onEscape when Escape is pressed on the wrapper element', () => {
    const onEscape = vi.fn();
    const options = createOptions({ onEscape });
    const keyboard = new DatabaseKeyboard(options);

    keyboard.attach();

    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    options.wrapper.dispatchEvent(escapeEvent);

    expect(onEscape).toHaveBeenCalledOnce();
  });

  it('cleans up listeners on destroy() — Escape after destroy does NOT call onEscape', () => {
    const onEscape = vi.fn();
    const options = createOptions({ onEscape });
    const keyboard = new DatabaseKeyboard(options);

    keyboard.attach();

    keyboard.destroy();

    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    options.wrapper.dispatchEvent(escapeEvent);

    expect(onEscape).not.toHaveBeenCalled();
  });

  it('stops propagation of Escape event when onEscape returns true', () => {
    const onEscape = vi.fn(() => true);
    const options = createOptions({ onEscape });
    const keyboard = new DatabaseKeyboard(options);

    keyboard.attach();

    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    const stopPropagationSpy = vi.spyOn(escapeEvent, 'stopPropagation');

    options.wrapper.dispatchEvent(escapeEvent);

    expect(stopPropagationSpy).toHaveBeenCalledOnce();
  });

  it('does not stop propagation when onEscape returns false', () => {
    const onEscape = vi.fn(() => false);
    const options = createOptions({ onEscape });
    const keyboard = new DatabaseKeyboard(options);

    keyboard.attach();

    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    const stopPropagationSpy = vi.spyOn(escapeEvent, 'stopPropagation');

    options.wrapper.dispatchEvent(escapeEvent);

    expect(stopPropagationSpy).not.toHaveBeenCalled();
  });
});
