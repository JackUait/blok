import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import { editorRoot, makeAnchor, makeEditorContext, makeProperty, press, pressOutside } from './helpers';

const field = (): HTMLInputElement | HTMLTextAreaElement => {
  const el = editorRoot()?.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-blok-database-cell-input]');

  if (el === null || el === undefined) {
    throw new Error('no editor field');
  }

  return el;
};

const type = (value: string): void => {
  const el = field();

  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('cell text editors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens a field holding the current value, marked as owning its keyboard', () => {
    openCellEditor(makeProperty('text'), 'hello', makeAnchor(), makeEditorContext());

    expect(field().value).toBe('hello');
    expect(editorRoot()?.hasAttribute('data-blok-keyboard-owner')).toBe(true);
  });

  it('Enter commits the typed text and closes', () => {
    const ctx = makeEditorContext();
    const handle = openCellEditor(makeProperty('text'), 'a', makeAnchor(), ctx);

    type('changed');
    press(field(), 'Enter');

    expect(ctx.onCommit).toHaveBeenCalledWith('changed');
    expect(handle.isOpen).toBe(false);
    expect(editorRoot()).toBeNull();
    expect(ctx.onClose).toHaveBeenCalledTimes(1);
  });

  it('Shift+Enter in text does not commit, so the newline stays', () => {
    const ctx = makeEditorContext();

    openCellEditor(makeProperty('text'), 'a', makeAnchor(), ctx);
    const event = press(field(), 'Enter', { shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(ctx.onCommit).not.toHaveBeenCalled();
    expect(field().tagName).toBe('TEXTAREA');
  });

  it('Enter while an IME is composing does not commit', () => {
    const ctx = makeEditorContext();

    openCellEditor(makeProperty('text'), 'a', makeAnchor(), ctx);
    type('b');
    press(field(), 'Enter', { isComposing: true });

    expect(ctx.onCommit).not.toHaveBeenCalled();
  });

  it('Escape cancels: nothing is written', () => {
    const ctx = makeEditorContext();
    const handle = openCellEditor(makeProperty('text'), 'a', makeAnchor(), ctx);

    type('changed');
    const event = press(field(), 'Escape');

    expect(ctx.onCommit).not.toHaveBeenCalled();
    expect(ctx.onCancel).toHaveBeenCalledTimes(1);
    expect(handle.isOpen).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('one Escape closes only the editor: a document listener below never sees it', () => {
    const below = vi.fn();

    document.addEventListener('keydown', below);
    openCellEditor(makeProperty('text'), 'a', makeAnchor(), makeEditorContext());
    press(field(), 'Escape');
    document.removeEventListener('keydown', below);

    expect(below).not.toHaveBeenCalled();
  });

  it('a click outside commits the draft', async () => {
    const ctx = makeEditorContext();

    openCellEditor(makeProperty('text'), 'a', makeAnchor(), ctx);
    type('outside');
    pressOutside();
    await Promise.resolve();

    expect(ctx.onCommit).toHaveBeenCalledWith('outside');
    expect(editorRoot()).toBeNull();
  });

  it('closing with the value unchanged cancels instead of writing the same value', () => {
    const ctx = makeEditorContext();

    openCellEditor(makeProperty('text'), 'same', makeAnchor(), ctx);
    press(field(), 'Enter');

    expect(ctx.onCommit).not.toHaveBeenCalled();
    expect(ctx.onCancel).toHaveBeenCalledTimes(1);
  });

  it('handle.close() commits a pending draft', () => {
    const ctx = makeEditorContext();
    const handle = openCellEditor(makeProperty('title'), '', makeAnchor(), ctx);

    type('Named');
    handle.close();

    expect(ctx.onCommit).toHaveBeenCalledWith('Named');
    expect(field.bind(null)).toThrow();
  });

  it('title and url edit on one line', () => {
    openCellEditor(makeProperty('url'), '', makeAnchor(), makeEditorContext());

    expect(field().tagName).toBe('INPUT');
  });

  it('does nothing when read-only', () => {
    const ctx = makeEditorContext({ readOnly: true });
    const handle = openCellEditor(makeProperty('text'), 'a', makeAnchor(), ctx);

    expect(handle.isOpen).toBe(false);
    expect(editorRoot()).toBeNull();
  });

  describe('number', () => {
    it('commits a number, not a string', () => {
      const ctx = makeEditorContext();

      openCellEditor(makeProperty('number'), 1, makeAnchor(), ctx);
      type('42.5');
      press(field(), 'Enter');

      expect(ctx.onCommit).toHaveBeenCalledWith(42.5);
    });

    it('rejects an entry that is not a number and stays open', () => {
      const ctx = makeEditorContext();
      const handle = openCellEditor(makeProperty('number'), 1, makeAnchor(), ctx);

      type('12abc');
      press(field(), 'Enter');

      expect(ctx.onCommit).not.toHaveBeenCalled();
      expect(handle.isOpen).toBe(true);
      expect(field().getAttribute('aria-invalid')).toBe('true');
    });

    it('a click outside with an invalid entry cancels', () => {
      const ctx = makeEditorContext();

      openCellEditor(makeProperty('number'), 1, makeAnchor(), ctx);
      type('Infinity');
      pressOutside();

      expect(ctx.onCommit).not.toHaveBeenCalled();
      expect(ctx.onCancel).toHaveBeenCalledTimes(1);
    });

    it('an empty entry clears the value to null', () => {
      const ctx = makeEditorContext();

      openCellEditor(makeProperty('number'), 7, makeAnchor(), ctx);
      type('  ');
      press(field(), 'Enter');

      expect(ctx.onCommit).toHaveBeenCalledWith(null);
    });
  });
});

describe('checkbox cell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('flips the value at once, with no popover', () => {
    const ctx = makeEditorContext();
    const handle = openCellEditor(makeProperty('checkbox'), false, makeAnchor(), ctx);

    expect(ctx.onCommit).toHaveBeenCalledWith(true);
    expect(ctx.onClose).toHaveBeenCalledTimes(1);
    expect(handle.isOpen).toBe(false);
    expect(editorRoot()).toBeNull();
  });

  it('unchecks a checked box, and treats a missing value as unchecked', () => {
    const ctx = makeEditorContext();

    openCellEditor(makeProperty('checkbox'), true, makeAnchor(), ctx);
    openCellEditor(makeProperty('checkbox'), undefined, makeAnchor(), ctx);

    expect(ctx.onCommit).toHaveBeenNthCalledWith(1, false);
    expect(ctx.onCommit).toHaveBeenNthCalledWith(2, true);
  });

  it('does nothing when read-only', () => {
    const ctx = makeEditorContext({ readOnly: true });

    openCellEditor(makeProperty('checkbox'), false, makeAnchor(), ctx);

    expect(ctx.onCommit).not.toHaveBeenCalled();
  });
});
