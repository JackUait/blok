import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpeedEntry, parseRate } from '../../../../src/tools/video/speed-entry';

describe('parseRate', () => {
  it('reads a plain number, a comma decimal and a trailing x', () => {
    expect(parseRate('1.5')).toBe(1.5);
    expect(parseRate(' 2,7 ')).toBe(2.7);
    expect(parseRate('1.25x')).toBe(1.25);
    expect(parseRate('3×')).toBe(3);
    expect(parseRate('.5')).toBe(0.5);
  });

  it('keeps a typed speed between 0.1x and 3x', () => {
    expect(parseRate('5')).toBe(3);
    expect(parseRate('0')).toBe(0.1);
    expect(parseRate('0.05')).toBe(0.1);
    expect(parseRate('1.333')).toBe(1.33);
  });

  it('gives null for text that is not a speed', () => {
    expect(parseRate('')).toBeNull();
    expect(parseRate('fast')).toBeNull();
    expect(parseRate('1.2.3')).toBeNull();
    expect(parseRate('-1')).toBeNull();
  });
});

describe('createSpeedEntry', () => {
  const setup = (rate = 1) => {
    const row = document.createElement('div');
    const readout = document.createElement('div');

    readout.className = 'p__speed-readout';
    readout.setAttribute('aria-hidden', 'true');
    readout.innerHTML = '<span class="p__speed-readout-digits">1</span><span class="p__speed-readout-unit">×</span>';
    row.append(readout);
    document.body.append(row);

    const state = { rate };
    const onRate = vi.fn((next: number) => { state.rate = next; });
    const t = vi.fn((_key: string, fallback: string) => fallback);
    const entry = createSpeedEntry({ readout, host: row, classPrefix: 'p', t, rate: () => state.rate, onRate });
    const field = (): HTMLInputElement | null => row.querySelector('input');
    const key = (target: Element, name: string): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });

      target.dispatchEvent(event);

      return event;
    };

    // Typing: replace the text the way a key would, then fire the events a browser fires.
    const type = (text: string): { blocked: boolean } => {
      const input = field();

      if (!input) throw new Error('no field');

      const before = new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true });

      input.dispatchEvent(before);
      if (before.defaultPrevented) return { blocked: true };
      input.value += text;
      input.setSelectionRange(input.value.length, input.value.length);
      input.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));

      return { blocked: false };
    };
    const clear = (): void => {
      const input = field();

      if (!input) throw new Error('no field');
      input.value = '';
      input.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
    };

    return { row, readout, entry, onRate, field, key, state, type, clear, t };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('opens a field holding the current speed when the number is clicked', () => {
    const ui = setup(1.5);

    ui.readout.click();

    const input = ui.field();

    expect(input).not.toBeNull();
    expect(input?.value).toBe('1.5');
    expect(input).toHaveFocus();
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe(3);
    expect(ui.readout.isConnected).toBe(false);
  });

  it('is a keyboard button with a name', () => {
    const ui = setup();

    expect(ui.readout.getAttribute('role')).toBe('button');
    expect(ui.readout.tabIndex).toBe(0);
    expect(ui.readout.getAttribute('aria-label')).toBe('Playback speed');
    expect(ui.readout.hasAttribute('aria-hidden')).toBe(false);

    ui.key(ui.readout, 'Enter');
    expect(ui.field()).not.toBeNull();
  });

  it('opens from Space too, without scrolling the page', () => {
    const ui = setup();
    const event = ui.key(ui.readout, ' ');

    expect(event.defaultPrevented).toBe(true);
    expect(ui.field()).not.toBeNull();
  });

  it('keeps the field\'s keys away from the editor', () => {
    const ui = setup();

    ui.readout.click();
    expect(ui.field()?.hasAttribute('data-blok-keyboard-owner')).toBe(true);
    expect(ui.readout.hasAttribute('data-blok-keyboard-owner')).toBe(true);
    expect(ui.field()?.inputMode).toBe('decimal');
    expect(ui.field()?.getAttribute('aria-label')).toBe('Playback speed');
  });

  it('keeps typed keys inside the field, away from the player\'s own shortcuts', () => {
    const ui = setup();
    const player = vi.fn();

    ui.row.addEventListener('keydown', player);
    ui.readout.click();

    const input = ui.field();

    if (!input) throw new Error('no field');

    const digit = ui.key(input, '2');

    ui.key(input, 'k');
    ui.key(input, 'ArrowLeft');

    expect(player).not.toHaveBeenCalled();
    expect(digit.defaultPrevented).toBe(false);
  });

  it('sets the typed speed on Enter and gives focus back to the number', () => {
    const ui = setup();

    ui.readout.click();

    const input = ui.field();

    if (!input) throw new Error('no field');
    input.value = '2.7';
    ui.key(input, 'Enter');

    expect(ui.onRate).toHaveBeenCalledExactlyOnceWith(2.7);
    expect(ui.field()).toBeNull();
    expect(ui.readout.isConnected).toBe(true);
    expect(ui.readout).toHaveFocus();
  });

  it('keeps the speed as it was on Escape, and stops Escape there', () => {
    const ui = setup();
    const outer = vi.fn();

    ui.row.addEventListener('keydown', outer);
    ui.readout.click();

    const input = ui.field();

    if (!input) throw new Error('no field');
    input.value = '2.7';
    ui.key(input, 'Escape');

    expect(ui.onRate).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
    expect(ui.field()).toBeNull();
    expect(ui.readout).toHaveFocus();
  });

  it('sets the typed speed when the field loses focus', () => {
    const ui = setup();

    ui.readout.click();

    const input = ui.field();

    if (!input) throw new Error('no field');
    input.value = '0.1';
    input.blur();

    expect(ui.onRate).toHaveBeenCalledExactlyOnceWith(0.1);
    expect(ui.field()).toBeNull();
  });

  it('keeps the speed as it was when the text is not a speed', () => {
    const ui = setup();

    ui.readout.click();

    const input = ui.field();

    if (!input) throw new Error('no field');
    input.value = 'fast';
    ui.key(input, 'Enter');

    expect(ui.onRate).not.toHaveBeenCalled();
    expect(ui.field()).toBeNull();
  });

  it('commit() sets an open field\'s speed once, and does nothing when none is open', () => {
    const ui = setup();

    ui.entry.commit();
    expect(ui.onRate).not.toHaveBeenCalled();

    ui.readout.click();

    const input = ui.field();

    if (!input) throw new Error('no field');
    input.value = '2.5';
    ui.entry.commit();
    input.blur();
    ui.entry.commit();

    expect(ui.onRate).toHaveBeenCalledExactlyOnceWith(2.5);
    expect(ui.field()).toBeNull();
  });

  it('sets the speed after Enter only once, though the field then blurs', () => {
    const ui = setup();

    ui.readout.click();

    const input = ui.field();

    if (!input) throw new Error('no field');
    input.value = '1.75';
    ui.key(input, 'Enter');
    input.dispatchEvent(new FocusEvent('blur'));

    expect(ui.onRate).toHaveBeenCalledTimes(1);
  });

  it('opens again after it closed', () => {
    const ui = setup();

    ui.readout.click();
    ui.entry.commit();
    ui.readout.click();

    expect(ui.field()?.value).toBe('1');
  });

  describe('the Well', () => {
    it('keeps the number and its × in one box, open or not', () => {
      const ui = setup(2.5);
      const closedBox = ui.readout;

      ui.readout.click();

      const box = ui.field()?.closest('.p__speed-readout');

      expect(box).not.toBeNull();
      expect(box?.classList.contains('p__speed-entry')).toBe(true);
      expect(box?.lastElementChild?.className).toBe(closedBox.lastElementChild?.className);
      expect(box?.lastElementChild?.textContent).toBe('×');
    });

    it('sizes the field from a hidden copy of its text', () => {
      const ui = setup(1);

      ui.readout.click();

      const sizer = ui.field()?.parentElement;

      expect(sizer?.className).toBe('p__speed-entry-sizer');
      expect(sizer?.getAttribute('data-value')).toBe('1');
      ui.clear();
      ui.type('2.75');
      expect(sizer?.getAttribute('data-value')).toBe('2.75');
    });

    it('marks the card while the field is open, so the presets can give way', () => {
      const ui = setup();

      expect(ui.row.hasAttribute('data-speed-entry')).toBe(false);
      ui.readout.click();
      expect(ui.row.getAttribute('data-speed-entry')).toBe('open');
      ui.key(ui.field() as HTMLInputElement, 'Escape');
      expect(ui.row.hasAttribute('data-speed-entry')).toBe(false);
    });
  });

  describe('the help line', () => {
    const line = (ui: ReturnType<typeof setup>): HTMLElement => ui.entry.helpLine;

    it('shows the range and how to set it', () => {
      const ui = setup();

      ui.readout.click();

      expect(line(ui).className).toBe('p__speed-help');
      expect(line(ui).textContent).toBe('0.1× to 3× · Enter to set');
      expect(line(ui).getAttribute('data-strong')).toBe('false');
      expect(line(ui).getAttribute('aria-live')).toBe('polite');
    });

    it('says what is wrong in stronger ink', () => {
      const ui = setup();

      ui.readout.click();
      ui.clear();
      ui.type('fast');
      expect(line(ui).textContent).toBe('Type a number, like 1.5');
      expect(line(ui).getAttribute('data-strong')).toBe('true');

      ui.clear();
      expect(line(ui).textContent).toBe('0.1× to 3× · Enter to set');
      expect(line(ui).getAttribute('data-strong')).toBe('false');

      ui.type('0');
      expect(ui.field()?.value).toBe('0');
      expect(line(ui).textContent).toBe('At least 0.1×');
      expect(line(ui).getAttribute('data-strong')).toBe('true');
    });

    it('reads every sentence through the player\'s own translations', () => {
      const ui = setup();

      ui.readout.click();
      ui.clear();
      ui.type('9');
      ui.clear();
      ui.type('0.0');
      ui.clear();
      ui.type('x');

      expect(ui.t.mock.calls.map(([key]) => key)).toEqual(expect.arrayContaining([
        'playbackSpeed', 'speedEntryRange', 'speedEntryTooHigh', 'speedEntryTooLow', 'speedEntryNotNumber',
      ]));
    });
  });

  describe('a speed past an end snaps to it as it is typed', () => {
    it('turns anything above 3 into 3 at once', () => {
      const ui = setup();

      ui.readout.click();
      ui.clear();
      ui.type('1');
      ui.type('0');

      expect(ui.field()?.value).toBe('3');
      expect(ui.entry.helpLine.textContent).toBe('Up to 3×');
      expect(ui.entry.helpLine.getAttribute('data-strong')).toBe('true');
    });

    it('turns a speed below 0.1 into 0.1 once no next key could reach 0.1', () => {
      const ui = setup();

      ui.readout.click();
      ui.clear();
      ui.type('0');
      expect(ui.field()?.value).toBe('0');
      ui.type('.');
      expect(ui.field()?.value).toBe('0.');
      ui.type('0');

      expect(ui.field()?.value).toBe('0.1');
      expect(ui.entry.helpLine.textContent).toBe('At least 0.1×');
    });

    it('leaves room to type 0.5 and 0.25', () => {
      const ui = setup();

      ui.readout.click();
      ui.clear();
      ['0', '.', '2', '5'].forEach((ch) => ui.type(ch));
      expect(ui.field()?.value).toBe('0.25');
    });

    it('ignores more digits at a snapped end, so 0.0 then 5 stays 0.1', () => {
      const ui = setup();

      ui.readout.click();
      ui.clear();
      ['0', '.', '0'].forEach((ch) => ui.type(ch));

      expect(ui.type('5')).toEqual({ blocked: true });
      expect(ui.field()?.value).toBe('0.1');

      ui.key(ui.field() as HTMLInputElement, 'Enter');
      expect(ui.onRate).toHaveBeenCalledExactlyOnceWith(0.1);
    });

    it('takes typing again once the text is cleared', () => {
      const ui = setup();

      ui.readout.click();
      ui.clear();
      ui.type('9');
      ui.clear();

      expect(ui.type('2')).toEqual({ blocked: false });
      expect(ui.field()?.value).toBe('2');
    });

    it('lets a selected snapped value be typed over', () => {
      const ui = setup();

      ui.readout.click();
      ui.clear();
      ui.type('9');

      const input = ui.field() as HTMLInputElement;

      input.setSelectionRange(0, input.value.length);

      const before = new InputEvent('beforeinput', { inputType: 'insertText', data: '2', bubbles: true, cancelable: true });

      input.dispatchEvent(before);
      expect(before.defaultPrevented).toBe(false);
    });
  });

  describe('arrow keys in the field', () => {
    it('step by 0.05, and by 0.25 with Shift, inside 0.1x to 3x', () => {
      const ui = setup(1);

      ui.readout.click();

      const input = ui.field() as HTMLInputElement;
      const arrow = (key: string, shiftKey = false): KeyboardEvent => {
        const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });

        input.dispatchEvent(event);

        return event;
      };

      expect(arrow('ArrowUp').defaultPrevented).toBe(true);
      expect(input.value).toBe('1.05');
      arrow('ArrowDown', true);
      expect(input.value).toBe('0.8');
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(3);
      expect(ui.onRate).not.toHaveBeenCalled();

      input.value = '2.9';
      arrow('ArrowUp', true);
      expect(input.value).toBe('3');
      expect(input.parentElement?.getAttribute('data-value')).toBe('3');
    });
  });
});
