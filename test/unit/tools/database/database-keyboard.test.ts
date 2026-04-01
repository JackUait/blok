import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseKeyboard } from '../../../../src/tools/database/database-keyboard';
import type { DatabaseKeyboardOptions } from '../../../../src/tools/database/database-keyboard';

const createOptions = (overrides: Partial<DatabaseKeyboardOptions> = {}): DatabaseKeyboardOptions => ({
  wrapper: document.createElement('div'),
  onEscape: vi.fn(),
  ...overrides,
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
});
