import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import { NUMBER_FORMATS, formatNumberValue } from '../../../../../src/tools/database/cells/number-format';
import type { NumberFormat, PropertyDefinition } from '../../../../../src/tools/database/types';
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

  it('Tab is left to the browser unless the host asks the editor to close on it', () => {
    const ctx = makeEditorContext();
    const handle = openCellEditor(makeProperty('text'), 'a', makeAnchor(), ctx);
    const event = press(field(), 'Tab');

    expect(event.defaultPrevented).toBe(false);
    expect(handle.isOpen).toBe(true);
  });

  it('Tab on an editor that closes on it saves and closes', () => {
    const ctx = makeEditorContext({ tabCloses: true });
    const handle = openCellEditor(makeProperty('url'), 'a', makeAnchor(), ctx);

    type('https://b.co');
    const event = press(field(), 'Tab', { shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(ctx.onCommit).toHaveBeenCalledWith('https://b.co');
    expect(handle.isOpen).toBe(false);
  });

  it('Enter while an IME is composing does not commit', () => {
    const ctx = makeEditorContext();

    openCellEditor(makeProperty('text'), 'a', makeAnchor(), ctx);
    type('b');
    press(field(), 'Enter', { isComposing: true });

    expect(ctx.onCommit).not.toHaveBeenCalled();
  });

  // research/30 B20: Notion saves the title on Escape.
  it('Escape on a title saves the typed title and closes', () => {
    const ctx = makeEditorContext();
    const handle = openCellEditor(makeProperty('title'), 'R3', makeAnchor(), ctx);

    type('R3x');
    const event = press(field(), 'Escape');

    expect(ctx.onCommit).toHaveBeenCalledWith('R3x');
    expect(ctx.onCancel).not.toHaveBeenCalled();
    expect(handle.isOpen).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Escape on an untouched title writes nothing', () => {
    const ctx = makeEditorContext();

    openCellEditor(makeProperty('title'), 'R3', makeAnchor(), ctx);
    press(field(), 'Escape');

    expect(ctx.onCommit).not.toHaveBeenCalled();
    expect(ctx.onCancel).toHaveBeenCalledTimes(1);
  });

  // research/22 §3: Notion saves a url, email or phone on Escape.
  it.each([
    ['url', '', 'example.com'],
    ['url', 'example.com', 'example.org'],
    ['email', '', 'a@b.co'],
    ['phone', '', '+1 555 0100'],
  ] as const)('Escape in a %s editor saves the typed value (%j → %j)', (kind, before, typed) => {
    const ctx = makeEditorContext();
    const handle = openCellEditor(makeProperty(kind), before, makeAnchor(), ctx);

    type(typed);
    press(field(), 'Escape');

    expect(ctx.onCommit).toHaveBeenCalledWith(typed);
    expect(handle.isOpen).toBe(false);
    expect(ctx.onClose).toHaveBeenCalledTimes(1);
  });

  // research/22 §3: Notion saves a text or number on Escape too.
  it.each([
    ['text', 'a', 'changed', 'changed'],
    ['richText', 'a', 'changed', 'changed'],
    ['number', 40, '401', 401],
  ] as const)('Escape in a %s editor saves the typed value (%j → %j)', (kind, before, typed, saved) => {
    const ctx = makeEditorContext();
    const handle = openCellEditor(makeProperty(kind), before, makeAnchor(), ctx);

    type(typed);
    const event = press(field(), 'Escape');

    expect(ctx.onCommit).toHaveBeenCalledTimes(1);
    expect(ctx.onCommit).toHaveBeenCalledWith(saved);
    expect(handle.isOpen).toBe(false);
    expect(editorRoot()).toBeNull();
    expect(event.defaultPrevented).toBe(true);
    expect(ctx.onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape with an unchanged text writes nothing and closes', () => {
    const ctx = makeEditorContext();
    const handle = openCellEditor(makeProperty('text'), 'a', makeAnchor(), ctx);

    press(field(), 'Escape');

    expect(ctx.onCommit).not.toHaveBeenCalled();
    expect(ctx.onCancel).toHaveBeenCalledTimes(1);
    expect(handle.isOpen).toBe(false);
  });

  it('Escape on a number that does not parse cancels and still closes', () => {
    const ctx = makeEditorContext();
    const handle = openCellEditor(makeProperty('number'), 40, makeAnchor(), ctx);

    type('abc');
    const event = press(field(), 'Escape');

    expect(ctx.onCommit).not.toHaveBeenCalled();
    expect(ctx.onCancel).toHaveBeenCalledTimes(1);
    expect(handle.isOpen).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  // Place is unmeasured: its address field (a text editor inside) still cancels on Escape.
  it('Escape in a place editor writes nothing', () => {
    const ctx = makeEditorContext();

    openCellEditor(makeProperty('place'), { address: 'Old St 1' }, makeAnchor(), ctx);
    type('New St 2');
    press(field(), 'Escape');

    expect(ctx.onCommit).not.toHaveBeenCalled();
  });

  // research/23 §3c: Notion saves an edited stored email or phone on Escape too.
  it.each([
    ['email', 'a@b.co', 'a@b.com'],
    ['phone', '+1 555 0100', '+1 555 01001'],
  ] as const)('Escape after editing an existing %s saves it', (kind, before, typed) => {
    const ctx = makeEditorContext();

    openCellEditor(makeProperty(kind), before, makeAnchor(), ctx);
    type(typed);
    press(field(), 'Escape');

    expect(ctx.onCommit).toHaveBeenCalledWith(typed);
    expect(ctx.onCancel).not.toHaveBeenCalled();
    expect(editorRoot()).toBeNull();
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

  it('handle.cancel() drops a pending draft', () => {
    const ctx = makeEditorContext();
    const handle = openCellEditor(makeProperty('text'), 'a', makeAnchor(), ctx);

    type('draft');
    handle.cancel();

    expect(ctx.onCommit).not.toHaveBeenCalled();
    expect(ctx.onCancel).toHaveBeenCalledTimes(1);
    expect(handle.isOpen).toBe(false);
  });

  it('title and url edit on one line', () => {
    openCellEditor(makeProperty('url'), '', makeAnchor(), makeEditorContext());

    expect(field().tagName).toBe('INPUT');
  });

  // research/16 §4: Notion's editors are type=url, type=email and type=tel.
  it.each([
    ['url', 'https://example.com', 'url'],
    ['email', 'test@example.com', 'email'],
    ['phone', '+1 555 0100', 'tel'],
  ] as const)('a %s cell opens an input of its own type holding the full value', (propertyType, value, inputType) => {
    openCellEditor(makeProperty(propertyType), value, makeAnchor(), makeEditorContext());

    expect(field().getAttribute('type')).toBe(inputType);
    expect(field().value).toBe(value);
  });

  it('opening and closing an email whose saved value has a stray space writes nothing', () => {
    const ctx = makeEditorContext();
    const handle = openCellEditor(makeProperty('email'), ' a@b.io ', makeAnchor(), ctx);

    handle.close();

    expect(ctx.onCommit).not.toHaveBeenCalled();
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

    // notion-spec-2 §19.7: a formatted number opens as its formatted text and takes typed symbols back.
    describe('formatted', () => {
      const formatted = (format: NumberFormat, decimals?: number): PropertyDefinition =>
        ({ ...makeProperty('number'), number: { format, ...(decimals !== undefined ? { decimals } : {}) } });

      it('US Dollar opens showing "$42.00", caret at the end', () => {
        openCellEditor(formatted('dollar'), 42, makeAnchor(), makeEditorContext());

        expect(field().value).toBe('$42.00');
        expect(field().selectionStart).toBe(6);
        expect(field().selectionEnd).toBe(6);
      });

      it.each([['$1,234.5', 1234.5], ['35.5', 35.5], ['-$3.25', -3.25]])('US Dollar takes "%s" as %s', (text, stored) => {
        const ctx = makeEditorContext();

        openCellEditor(formatted('dollar'), 42, makeAnchor(), ctx);
        type(text);
        press(field(), 'Enter');

        expect(ctx.onCommit).toHaveBeenCalledWith(stored);
      });

      it('Percent opens showing the value as percent points with no thousands separator', () => {
        openCellEditor(formatted('percent'), 35.5, makeAnchor(), makeEditorContext());

        expect(field().value).toBe('3550%');
      });

      it.each(['50', '50%', ' 50 % '])('Percent reads "%s" as percent points and stores 0.5', (text) => {
        const ctx = makeEditorContext();

        openCellEditor(formatted('percent'), 35.5, makeAnchor(), ctx);
        type(text);
        press(field(), 'Enter');

        expect(ctx.onCommit).toHaveBeenCalledWith(0.5);
      });

      // Blok's no-data-loss rule: the shown text is rounded, so leaving it untouched must not write it back.
      it.each(['Enter', 'Escape', 'Tab'])('a value rounded for display is kept when the text is left as shown (%s)', (key) => {
        const ctx = makeEditorContext({ tabCloses: true });

        openCellEditor(formatted('dollar'), 42.123, makeAnchor(), ctx);
        expect(field().value).toBe('$42.12');
        press(field(), key);

        expect(ctx.onCommit).not.toHaveBeenCalled();
      });

      it('a value rounded for display is kept on a click outside', () => {
        const ctx = makeEditorContext();

        openCellEditor(formatted('dollar', 0), 42.5, makeAnchor(), ctx);
        pressOutside();

        expect(ctx.onCommit).not.toHaveBeenCalled();
      });

      it('rejects text that is not a number and stays open', () => {
        const ctx = makeEditorContext();
        const handle = openCellEditor(formatted('dollar'), 42, makeAnchor(), ctx);

        type('$12abc');
        press(field(), 'Enter');

        expect(ctx.onCommit).not.toHaveBeenCalled();
        expect(handle.isOpen).toBe(true);
      });

      // Every format reads back what it shows, in locales with other separators, signs and spaces.
      const LOCALES = ['en-US', 'de-DE', 'fr-FR', 'sv-SE', 'ja-JP'];

      it.each(LOCALES.flatMap((locale) => NUMBER_FORMATS.map((format) => [locale, format] as const)))('%s %s reads its own shown text back', (locale, format) => {
        [1234.5, -0.25, 7].forEach((value) => {
          const ctx = makeEditorContext({ locale });

          const shown = formatNumberValue(value, { format }, locale);

          openCellEditor(formatted(format), null, makeAnchor(), ctx);
          type(shown);
          press(field(), 'Enter');
          const committed = vi.mocked(ctx.onCommit).mock.calls[0]?.[0];

          expect(typeof committed, `${shown}`).toBe('number');
          expect(formatNumberValue(committed as number, { format }, locale), `${shown}`).toBe(shown);
          document.body.innerHTML = '';
          PopoverRegistry.resetForTests();
        });
      });
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
  it('initialText replaces the value, so typing over a selected cell starts a new value', () => {
    const ctx = makeEditorContext({ initialText: 'Z' });

    openCellEditor(makeProperty('text'), 'short', makeAnchor(), ctx);

    expect(field().value).toBe('Z');
    press(field(), 'Enter');
    expect(ctx.onCommit).toHaveBeenCalledWith('Z');
  });
});
